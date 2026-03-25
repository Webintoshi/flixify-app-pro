#include "native_video_surface.h"

#include <QPainter>
#include <QPointF>
#include <QQuickWindow>
#include <QMetaObject>
#include <QtGlobal>

#if defined(Q_OS_WIN)
#include <windows.h>
#endif

#if defined(Q_OS_WIN)
namespace {

constexpr wchar_t kFlixifyVideoSurfaceClassName[] = L"FlixifyNativeVideoSurfaceWindow";

LRESULT CALLBACK flixifyVideoSurfaceProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
	    case WM_NCCREATE: {
	      auto *createStruct = reinterpret_cast<CREATESTRUCTW *>(lParam);
	      if (createStruct && createStruct->lpCreateParams) {
	        SetWindowLongPtrW(
	          hwnd,
          GWLP_USERDATA,
          reinterpret_cast<LONG_PTR>(createStruct->lpCreateParams)
        );
	      }
	      break;
	    }
	    case WM_NCHITTEST: {
	      if (auto *instance = reinterpret_cast<NativeVideoSurface *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA))) {
	        if (instance->mousePassthrough()) {
	          return HTTRANSPARENT;
	        }
	      }
	      break;
	    }
	    case WM_MOUSEMOVE:
	    case WM_MOUSEWHEEL:
	    case WM_NCMOUSEMOVE: {
	      if (auto *instance = reinterpret_cast<NativeVideoSurface *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA))) {
	        QMetaObject::invokeMethod(instance, [instance]() {
          instance->pointerActivity();
        }, Qt::QueuedConnection);
      }
      break;
    }
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT: {
      PAINTSTRUCT paintStruct;
      HDC hdc = BeginPaint(hwnd, &paintStruct);
      if (hdc) {
        RECT rect;
        GetClientRect(hwnd, &rect);
        HBRUSH brush = CreateSolidBrush(RGB(8, 10, 16));
        FillRect(hdc, &rect, brush);
        DeleteObject(brush);
      }
      EndPaint(hwnd, &paintStruct);
      return 0;
    }
    default:
      return DefWindowProcW(hwnd, message, wParam, lParam);
  }

  return DefWindowProcW(hwnd, message, wParam, lParam);
}

ATOM ensureFlixifyVideoSurfaceClass() {
  static ATOM atom = 0;
  if (atom != 0) {
    return atom;
  }

  WNDCLASSW windowClass = {};
  windowClass.lpfnWndProc = flixifyVideoSurfaceProc;
  windowClass.hInstance = GetModuleHandleW(nullptr);
  windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  windowClass.hbrBackground = nullptr;
  windowClass.lpszClassName = kFlixifyVideoSurfaceClassName;
  atom = RegisterClassW(&windowClass);
  return atom;
}

}
#endif

NativeVideoSurface::NativeVideoSurface(QQuickItem *parent)
  : QQuickPaintedItem(parent) {
  setAntialiasing(false);
  setOpaquePainting(true);
  connect(this, &QQuickItem::windowChanged, this, [this]() {
    syncSurfaceHandle();
    updateNativeSurfaceGeometry();
  });
  connect(this, &QQuickItem::xChanged, this, &NativeVideoSurface::updateNativeSurfaceGeometry);
  connect(this, &QQuickItem::yChanged, this, &NativeVideoSurface::updateNativeSurfaceGeometry);
  connect(this, &QQuickItem::widthChanged, this, &NativeVideoSurface::updateNativeSurfaceGeometry);
  connect(this, &QQuickItem::heightChanged, this, &NativeVideoSurface::updateNativeSurfaceGeometry);
  connect(this, &QQuickItem::visibleChanged, this, &NativeVideoSurface::updateNativeSurfaceGeometry);
}

NativeVideoSurface::~NativeVideoSurface() {
#if defined(Q_OS_WIN)
  destroyNativeSurface();
#endif
}

qulonglong NativeVideoSurface::surfaceHandle() const {
  return m_surfaceHandle;
}

bool NativeVideoSurface::mousePassthrough() const {
  return m_mousePassthrough;
}

void NativeVideoSurface::setMousePassthrough(bool enabled) {
  if (m_mousePassthrough == enabled) {
    return;
  }

  m_mousePassthrough = enabled;
  emit mousePassthroughChanged();
}

bool NativeVideoSurface::frontSurface() const {
  return m_frontSurface;
}

void NativeVideoSurface::setFrontSurface(bool enabled) {
  if (m_frontSurface == enabled) {
    return;
  }

  m_frontSurface = enabled;
  emit frontSurfaceChanged();
  updateNativeSurfaceGeometry();
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
#if defined(Q_OS_WIN)
  if (window()) {
    ensureNativeSurface();
  } else {
    destroyNativeSurface();
  }
  const qulonglong nextHandle =
    m_nativeSurfaceHandle ? static_cast<qulonglong>(reinterpret_cast<quintptr>(m_nativeSurfaceHandle)) : 0;
#else
  const qulonglong nextHandle = window() ? static_cast<qulonglong>(window()->winId()) : 0;
#endif
  if (nextHandle == m_surfaceHandle) {
    return;
  }

  m_surfaceHandle = nextHandle;
  emit surfaceHandleChanged();
  update();
}

void NativeVideoSurface::updateNativeSurfaceGeometry() {
#if defined(Q_OS_WIN)
  if (!m_nativeSurfaceHandle || !window()) {
    return;
  }

  auto *surfaceWindow = reinterpret_cast<HWND>(m_nativeSurfaceHandle);
  const QPointF topLeft = mapToScene(QPointF(0.0, 0.0));
  const int targetX = qRound(topLeft.x());
  const int targetY = qRound(topLeft.y());
  const int targetWidth = qMax(0, qRound(width()));
  const int targetHeight = qMax(0, qRound(height()));
  const bool shouldShow = isVisible() && targetWidth > 1 && targetHeight > 1;

  if (!shouldShow) {
    ShowWindow(surfaceWindow, SW_HIDE);
    return;
  }

  SetWindowPos(
    surfaceWindow,
    m_frontSurface ? HWND_TOP : HWND_BOTTOM,
    targetX,
    targetY,
    targetWidth,
    targetHeight,
    SWP_NOACTIVATE
  );
  ShowWindow(surfaceWindow, SW_SHOWNOACTIVATE);
#endif
}

#if defined(Q_OS_WIN)
void NativeVideoSurface::ensureNativeSurface() {
  if (m_nativeSurfaceHandle || !window()) {
    return;
  }

  if (ensureFlixifyVideoSurfaceClass() == 0) {
    return;
  }

  auto *parentHandle = reinterpret_cast<HWND>(window()->winId());
  if (!parentHandle) {
    return;
  }

  HWND childHandle = CreateWindowExW(
    WS_EX_NOREDIRECTIONBITMAP,
    kFlixifyVideoSurfaceClassName,
    L"",
    WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
    0,
    0,
    0,
    0,
    parentHandle,
    nullptr,
    GetModuleHandleW(nullptr),
    this
  );

  if (!childHandle) {
    return;
  }

  m_nativeSurfaceHandle = childHandle;
  updateNativeSurfaceGeometry();
}

void NativeVideoSurface::destroyNativeSurface() {
  if (!m_nativeSurfaceHandle) {
    return;
  }

  DestroyWindow(reinterpret_cast<HWND>(m_nativeSurfaceHandle));
  m_nativeSurfaceHandle = nullptr;
}
#endif
