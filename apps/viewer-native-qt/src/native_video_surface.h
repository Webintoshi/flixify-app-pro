#pragma once

#include <QQuickPaintedItem>

class NativeVideoSurface : public QQuickPaintedItem {
  Q_OBJECT
  Q_PROPERTY(qulonglong surfaceHandle READ surfaceHandle NOTIFY surfaceHandleChanged)
  Q_PROPERTY(bool mousePassthrough READ mousePassthrough WRITE setMousePassthrough NOTIFY mousePassthroughChanged)
  Q_PROPERTY(bool frontSurface READ frontSurface WRITE setFrontSurface NOTIFY frontSurfaceChanged)

public:
  explicit NativeVideoSurface(QQuickItem *parent = nullptr);
  ~NativeVideoSurface() override;

  qulonglong surfaceHandle() const;
  bool mousePassthrough() const;
  void setMousePassthrough(bool enabled);
  bool frontSurface() const;
  void setFrontSurface(bool enabled);
  void paint(QPainter *painter) override;
  void notifyPointerActivity();

signals:
  void surfaceHandleChanged();
  void mousePassthroughChanged();
  void frontSurfaceChanged();
  void pointerActivity();

private:
  void syncSurfaceHandle();
  void updateNativeSurfaceGeometry();
  void ensureNativeSurface();
  void destroyNativeSurface();

#if defined(Q_OS_WIN)
  void *m_nativeSurfaceHandle = nullptr;
#elif defined(Q_OS_MACOS)
  void updateMacNativeSurfaceGeometry();
  void *m_nativeSurfaceHandle = nullptr;
#endif

  qulonglong m_surfaceHandle = 0;
  bool m_mousePassthrough = true;
  bool m_frontSurface = true;
};
