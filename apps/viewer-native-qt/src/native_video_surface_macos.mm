#import <AppKit/AppKit.h>

#include <QPointF>
#include <QQuickWindow>
#include <QtGlobal>

#include "native_video_surface.h"

@interface FlixifyMacVideoSurfaceView : NSView

- (instancetype)initWithOwner:(NativeVideoSurface *)owner;

@property(nonatomic, assign) NativeVideoSurface *owner;

@end

@implementation FlixifyMacVideoSurfaceView {
  NSTrackingArea *_trackingArea;
}

- (instancetype)initWithOwner:(NativeVideoSurface *)owner {
  self = [super initWithFrame:NSMakeRect(0.0, 0.0, 0.0, 0.0)];
  if (self) {
    self.owner = owner;
    self.hidden = YES;
    self.wantsLayer = YES;
    self.layer.backgroundColor = NSColor.blackColor.CGColor;
  }
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  Q_UNUSED(event);
  return YES;
}

- (NSView *)hitTest:(NSPoint)point {
  if (self.owner && self.owner->mousePassthrough()) {
    return nil;
  }

  return [super hitTest:point];
}

- (void)updateTrackingAreas {
  if (_trackingArea) {
    [self removeTrackingArea:_trackingArea];
    [_trackingArea release];
    _trackingArea = nil;
  }

  _trackingArea = [[NSTrackingArea alloc]
    initWithRect:NSZeroRect
         options:(NSTrackingMouseMoved | NSTrackingActiveAlways | NSTrackingInVisibleRect)
           owner:self
        userInfo:nil];
  [self addTrackingArea:_trackingArea];
  [super updateTrackingAreas];
}

- (void)mouseMoved:(NSEvent *)event {
  Q_UNUSED(event);
  if (self.owner) {
    self.owner->notifyPointerActivity();
  }
  [super mouseMoved:event];
}

- (void)scrollWheel:(NSEvent *)event {
  if (self.owner) {
    self.owner->notifyPointerActivity();
  }

  if (self.owner && self.owner->mousePassthrough()) {
    [[self nextResponder] scrollWheel:event];
    return;
  }

  [super scrollWheel:event];
}

@end

namespace {

NSView *flixifyParentViewForWindow(QQuickWindow *window) {
  if (!window) {
    return nil;
  }

  return reinterpret_cast<NSView *>(window->winId());
}

CGFloat flixifySurfaceOriginY(NSView *parentView, CGFloat targetY, CGFloat targetHeight) {
  if (!parentView) {
    return targetY;
  }

  if ([parentView isFlipped]) {
    return targetY;
  }

  return qMax<CGFloat>(0.0, NSHeight(parentView.bounds) - targetY - targetHeight);
}

}  // namespace

void NativeVideoSurface::ensureNativeSurface() {
  if (m_nativeSurfaceHandle || !window()) {
    return;
  }

  NSView *parentView = flixifyParentViewForWindow(window());
  if (!parentView) {
    return;
  }

  FlixifyMacVideoSurfaceView *surfaceView = [[FlixifyMacVideoSurfaceView alloc] initWithOwner:this];
  [parentView addSubview:surfaceView positioned:NSWindowAbove relativeTo:nil];
  if (parentView.window) {
    [parentView.window setAcceptsMouseMovedEvents:YES];
  }

  m_nativeSurfaceHandle = surfaceView;
  updateMacNativeSurfaceGeometry();
}

void NativeVideoSurface::destroyNativeSurface() {
  if (!m_nativeSurfaceHandle) {
    return;
  }

  NSView *surfaceView = static_cast<NSView *>(m_nativeSurfaceHandle);
  [surfaceView removeFromSuperview];
  [surfaceView release];
  m_nativeSurfaceHandle = nullptr;
}

void NativeVideoSurface::updateMacNativeSurfaceGeometry() {
  if (!m_nativeSurfaceHandle || !window()) {
    return;
  }

  NSView *surfaceView = static_cast<NSView *>(m_nativeSurfaceHandle);
  NSView *parentView = flixifyParentViewForWindow(window());
  if (!surfaceView || !parentView) {
    return;
  }

  if (surfaceView.superview != parentView) {
    [parentView addSubview:surfaceView];
  }

  [parentView addSubview:surfaceView positioned:(m_frontSurface ? NSWindowAbove : NSWindowBelow) relativeTo:nil];

  const QPointF topLeft = mapToScene(QPointF(0.0, 0.0));
  const CGFloat targetX = static_cast<CGFloat>(qRound(topLeft.x()));
  const CGFloat targetY = static_cast<CGFloat>(qRound(topLeft.y()));
  const CGFloat targetWidth = static_cast<CGFloat>(qMax(0, qRound(width())));
  const CGFloat targetHeight = static_cast<CGFloat>(qMax(0, qRound(height())));
  const bool shouldShow = isVisible() && targetWidth > 1.0 && targetHeight > 1.0;

  if (!shouldShow) {
    surfaceView.hidden = YES;
    return;
  }

  surfaceView.hidden = NO;
  surfaceView.frame = NSMakeRect(
    targetX,
    flixifySurfaceOriginY(parentView, targetY, targetHeight),
    targetWidth,
    targetHeight
  );
}
