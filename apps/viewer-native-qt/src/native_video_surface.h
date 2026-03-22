#pragma once

#include <QQuickPaintedItem>

class NativeVideoSurface : public QQuickPaintedItem {
  Q_OBJECT
  Q_PROPERTY(qulonglong surfaceHandle READ surfaceHandle NOTIFY surfaceHandleChanged)

public:
  explicit NativeVideoSurface(QQuickItem *parent = nullptr);

  qulonglong surfaceHandle() const;
  void paint(QPainter *painter) override;

signals:
  void surfaceHandleChanged();

private:
  void syncSurfaceHandle();

  qulonglong m_surfaceHandle = 0;
};
