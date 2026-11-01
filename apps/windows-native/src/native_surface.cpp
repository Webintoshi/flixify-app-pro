#include "native_surface.h"
#include "player.h"
#include <QEvent>
#include <QPainter>
#include <QPointer>
#include <QQuickWindow>
#include <QPlatformSurfaceEvent>
#if defined(Q_OS_WIN)
#include <windows.h>
namespace {
constexpr wchar_t surfaceClass[] = L"FlixifyProVideoSurface";
LRESULT CALLBACK surfaceProcedure(HWND hwnd, UINT message, WPARAM w, LPARAM l) {
  if (message == WM_NCCREATE) {
    auto *data = reinterpret_cast<CREATESTRUCTW *>(l);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(data->lpCreateParams));
  }
  auto *surface = reinterpret_cast<NativeVideoSurface *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCHITTEST && surface && surface->mousePassthrough()) return HTTRANSPARENT;
  if (message == WM_MOUSEMOVE && surface) {
    QPointer<NativeVideoSurface> guard(surface);
    QMetaObject::invokeMethod(surface, [guard] { if (guard) guard->notifyPointerActivity(); }, Qt::QueuedConnection);
  }
  if (message == WM_ERASEBKGND) return 1;
  return DefWindowProcW(hwnd, message, w, l);
}
bool registerSurface() {
  static const bool registered = [] {
    WNDCLASSW wc{};
    wc.lpfnWndProc = surfaceProcedure; wc.hInstance = GetModuleHandleW(nullptr);
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW); wc.lpszClassName = surfaceClass;
    return RegisterClassW(&wc) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  }();
  return registered;
}
}
#endif

NativeVideoSurface::NativeVideoSurface(QQuickItem *parent) : QQuickPaintedItem(parent) {
  setOpaquePainting(true);
  connect(this, &QQuickItem::windowChanged, this, [this] {
    destroySurface();
    if (window()) window()->installEventFilter(this);
    synchronize();
  });
  for (auto signal : {&QQuickItem::xChanged, &QQuickItem::yChanged, &QQuickItem::widthChanged,
                      &QQuickItem::heightChanged, &QQuickItem::visibleChanged}) {
    connect(this, signal, this, &NativeVideoSurface::synchronize);
  }
}
NativeVideoSurface::~NativeVideoSurface() { destroySurface(); }
void NativeVideoSurface::setMousePassthrough(bool value) {
  if (passthrough_ == value) return;
  passthrough_ = value; emit mousePassthroughChanged();
}
void NativeVideoSurface::setFrontSurface(bool value) {
  if (front_ == value) return;
  front_ = value; synchronize(); emit frontSurfaceChanged();
}
void NativeVideoSurface::paint(QPainter *painter) { painter->fillRect(boundingRect(), Qt::black); }
void NativeVideoSurface::notifyPointerActivity() { emit pointerActivity(); }
QObject *NativeVideoSurface::playbackController() const { return player_; }
void NativeVideoSurface::setPlaybackController(QObject *controller) { player_ = qobject_cast<DesktopPlayer *>(controller); }
bool NativeVideoSurface::eventFilter(QObject *object, QEvent *event) {
  if (object == window() && event->type() == QEvent::PlatformSurface &&
      static_cast<QPlatformSurfaceEvent *>(event)->surfaceEventType() == QPlatformSurfaceEvent::SurfaceAboutToBeDestroyed) {
    destroySurface();
    return false;
  }
  if (object == window() && (event->type() == QEvent::Resize || event->type() == QEvent::Show ||
      event->type() == QEvent::Hide || event->type() == QEvent::DevicePixelRatioChange ||
      event->type() == QEvent::Move)) synchronize();
  return QQuickPaintedItem::eventFilter(object, event);
}
void NativeVideoSurface::synchronize() {
  if (!window()) return;
#if defined(Q_OS_WIN)
  if (!handle_ && registerSurface()) {
    auto parent = reinterpret_cast<HWND>(window()->winId());
    auto child = CreateWindowExW(WS_EX_NOREDIRECTIONBITMAP, surfaceClass, L"",
        WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN, 0, 0, 1, 1, parent, nullptr,
        GetModuleHandleW(nullptr), this);
    if (child) { handle_ = reinterpret_cast<quintptr>(child); emit surfaceHandleChanged(); }
  }
  if (!handle_) return;
  auto hwnd = reinterpret_cast<HWND>(quintptr(handle_));
  if (!isVisible() || !window()->isVisible() || width() < 1 || height() < 1) { ShowWindow(hwnd, SW_HIDE); return; }
  const QPointF point = mapToScene(QPointF(0, 0));
  const qreal scale = window()->devicePixelRatio();
  SetWindowPos(hwnd, front_ ? HWND_TOP : HWND_BOTTOM, qRound(point.x() * scale), qRound(point.y() * scale),
      qRound(width() * scale), qRound(height() * scale), SWP_NOACTIVATE | SWP_SHOWWINDOW);
#else
  const auto handle = qulonglong(window()->winId());
  if (handle != handle_) { handle_ = handle; emit surfaceHandleChanged(); }
#endif
}
void NativeVideoSurface::destroySurface() {
  if (handle_ && player_) player_->releaseSurface(handle_);
#if defined(Q_OS_WIN)
  if (handle_) DestroyWindow(reinterpret_cast<HWND>(quintptr(handle_)));
#endif
  if (handle_) { handle_ = 0; emit surfaceHandleChanged(); }
}
