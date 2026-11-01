#pragma once
#include <QQuickPaintedItem>
#include <QPointer>
class DesktopPlayer;

class NativeVideoSurface : public QQuickPaintedItem {
  Q_OBJECT
  Q_PROPERTY(qulonglong surfaceHandle READ surfaceHandle NOTIFY surfaceHandleChanged)
  Q_PROPERTY(bool mousePassthrough READ mousePassthrough WRITE setMousePassthrough NOTIFY mousePassthroughChanged)
  Q_PROPERTY(bool frontSurface READ frontSurface WRITE setFrontSurface NOTIFY frontSurfaceChanged)
  Q_PROPERTY(QObject *playbackController READ playbackController WRITE setPlaybackController)
 public:
  explicit NativeVideoSurface(QQuickItem *parent = nullptr);
  ~NativeVideoSurface() override;
  qulonglong surfaceHandle() const { return handle_; }
  bool mousePassthrough() const { return passthrough_; }
  bool frontSurface() const { return front_; }
  void setMousePassthrough(bool value);
  void setFrontSurface(bool value);
  void paint(QPainter *painter) override;
  void notifyPointerActivity();
  QObject *playbackController() const;
  void setPlaybackController(QObject *controller);
 signals:
  void surfaceHandleChanged();
  void mousePassthroughChanged();
  void frontSurfaceChanged();
  void pointerActivity();
 protected:
  bool eventFilter(QObject *object, QEvent *event) override;
 private:
  void synchronize();
  void destroySurface();
  qulonglong handle_ = 0;
  bool passthrough_ = true, front_ = true;
  QPointer<DesktopPlayer> player_;
};
