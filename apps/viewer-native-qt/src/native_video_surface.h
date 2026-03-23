#pragma once

#include <QQuickPaintedItem>

class NativeVideoSurface : public QQuickPaintedItem {
  Q_OBJECT
  Q_PROPERTY(qulonglong surfaceHandle READ surfaceHandle NOTIFY surfaceHandleChanged)

public:
  explicit NativeVideoSurface(QQuickItem *parent = nullptr);
  ~NativeVideoSurface() override;

  qulonglong surfaceHandle() const;
  void paint(QPainter *painter) override;

signals:
  void surfaceHandleChanged();
  void pointerActivity();

private:
  void syncSurfaceHandle();
  void updateNativeSurfaceGeometry();

#if defined(Q_OS_WIN)
  void ensureNativeSurface();
  void destroyNativeSurface();
  void *m_nativeSurfaceHandle = nullptr;
#endif

  qulonglong m_surfaceHandle = 0;
};
