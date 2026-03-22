#include "native_video_surface.h"

#include <QPainter>
#include <QQuickWindow>

NativeVideoSurface::NativeVideoSurface(QQuickItem *parent)
  : QQuickPaintedItem(parent) {
  setAntialiasing(false);
  connect(this, &QQuickItem::windowChanged, this, [this]() { syncSurfaceHandle(); });
}

qulonglong NativeVideoSurface::surfaceHandle() const {
  return m_surfaceHandle;
}

void NativeVideoSurface::paint(QPainter *painter) {
  painter->fillRect(boundingRect(), QColor(QStringLiteral("#121212")));
  painter->setPen(QColor(QStringLiteral("#e6e6e6")));
  painter->drawText(
    boundingRect().adjusted(24, 24, -24, -24),
    Qt::AlignCenter,
    QStringLiteral("Native libVLC playback surface")
  );
}

void NativeVideoSurface::syncSurfaceHandle() {
  const qulonglong nextHandle = window() ? static_cast<qulonglong>(window()->winId()) : 0;
  if (nextHandle == m_surfaceHandle) {
    return;
  }

  m_surfaceHandle = nextHandle;
  emit surfaceHandleChanged();
  update();
}
