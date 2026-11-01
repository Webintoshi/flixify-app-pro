#pragma once
#include "playback_policy.h"
#include <QFutureWatcher>
#include <QObject>
#include <QTimer>
#include <QVariantMap>
#include <memory>

class DesktopPlayer : public QObject {
  Q_OBJECT
  Q_PROPERTY(bool active READ active NOTIFY stateChanged)
  Q_PROPERTY(bool playing READ playing NOTIFY stateChanged)
  Q_PROPERTY(bool loading READ loading NOTIFY stateChanged)
  Q_PROPERTY(bool live READ live NOTIFY stateChanged)
  Q_PROPERTY(bool controlsVisible READ controlsVisible NOTIFY stateChanged)
  Q_PROPERTY(bool muted READ muted NOTIFY stateChanged)
  Q_PROPERTY(bool fullScreen READ fullScreen NOTIFY stateChanged)
  Q_PROPERTY(bool hasVideoFrame READ hasVideoFrame NOTIFY stateChanged)
  Q_PROPERTY(QString error READ error NOTIFY stateChanged)
  Q_PROPERTY(QString title READ title NOTIFY stateChanged)
  Q_PROPERTY(qint64 positionMs READ positionMs NOTIFY stateChanged)
  Q_PROPERTY(qint64 durationMs READ durationMs NOTIFY stateChanged)
  Q_PROPERTY(int volume READ volume NOTIFY stateChanged)
  Q_PROPERTY(int nextCountdown READ nextCountdown NOTIFY stateChanged)
  Q_PROPERTY(QVariantMap item READ item NOTIFY stateChanged)
  Q_PROPERTY(QVariantMap nextItem READ nextItem NOTIFY stateChanged)
  Q_PROPERTY(QVariantList audioTracks READ audioTracks NOTIFY stateChanged)
  Q_PROPERTY(QVariantList subtitleTracks READ subtitleTracks NOTIFY stateChanged)
  Q_PROPERTY(int audioTrack READ audioTrack NOTIFY stateChanged)
  Q_PROPERTY(int subtitleTrack READ subtitleTrack NOTIFY stateChanged)
 public:
  explicit DesktopPlayer(QObject *parent = nullptr, bool allowTestMedia = false);
  ~DesktopPlayer() override;
  bool active() const { return active_; }
  bool playing() const { return playing_; }
  bool loading() const { return loading_; }
  bool live() const { return item_.value("kind").toString() == "live"; }
  bool controlsVisible() const { return controls_; }
  bool muted() const { return muted_; }
  bool fullScreen() const { return fullScreen_; }
  bool hasVideoFrame() const { return hasFrame_; }
  QString error() const { return error_; }
  QString title() const { return item_.value("title").toString(); }
  qint64 positionMs() const { return position_; }
  qint64 durationMs() const { return duration_; }
  int volume() const { return volume_; }
  int nextCountdown() const { return nextCountdown_; }
  QVariantMap item() const { return item_; }
  QVariantMap nextItem() const { return next_; }
  QVariantList audioTracks() const { return audioTracks_; }
  QVariantList subtitleTracks() const { return subtitleTracks_; }
  int audioTrack() const { return audioTrack_; }
  int subtitleTrack() const { return subtitleTrack_; }
  Q_INVOKABLE void open(const QVariantMap &media);
  Q_INVOKABLE void close();
  Q_INVOKABLE void togglePause();
  Q_INVOKABLE void seekBy(int seconds);
  Q_INVOKABLE void seek(qint64 positionMs);
  Q_INVOKABLE void setVolume(int volume);
  Q_INVOKABLE void setMuted(bool muted);
  Q_INVOKABLE void selectAudio(int id);
  Q_INVOKABLE void selectSubtitle(int id);
  Q_INVOKABLE void interact();
  Q_INVOKABLE void holdControls(bool hold);
  Q_INVOKABLE void setFullScreen(bool value);
  Q_INVOKABLE void cancelNext();
  Q_INVOKABLE void playNext();
  Q_INVOKABLE void setSurface(qulonglong handle);
  void releaseSurface(qulonglong handle);
  Q_INVOKABLE void switchChannel(int direction);
  void extendAccess(qint64 expiresAt, const QString &scope);
 signals:
  void stateChanged();
  void progress(QVariantMap item, qint64 positionMs, qint64 durationMs, bool ended);
  void refreshRequested(QVariantMap item);
  void playRequested(QVariantMap item);
  void channelRequested(int direction);
 private:
  struct Session;
  void startPending();
  void releaseCurrent();
  void onVlcEvent(quint64 generation, int event);
  void tick();
  void recover(Playback::Trigger trigger);
  void fail(const QString &message);
  void updateTracks();
  bool eligible() const;
  static QString key(const QVariantMap &item);
  static Playback::Episode episode(const QVariantMap &item);
  std::shared_ptr<Session> session_;
  QFutureWatcher<void> stopping_;
  QTimer timer_;
  std::unique_ptr<Playback::Recovery> recovery_;
  Playback::NextEpisode countdown_;
  QVariantMap media_, pending_, item_, next_;
  QVariantList audioTracks_, subtitleTracks_;
  QString error_, scope_;
  qint64 expiry_ = 0, position_ = 0, duration_ = 0, resume_ = 0;
  qint64 interactionAt_ = 0, startedAt_ = 0, progressedAt_ = 0, savedAt_ = 0, tracksAt_ = 0;
  quint64 generation_ = 0;
  qulonglong surface_ = 0;
  int volume_ = 85, audioTrack_ = -1, subtitleTrack_ = -1, nextCountdown_ = 0, held_ = 0;
  bool active_ = false, playing_ = false, loading_ = false, controls_ = true, muted_ = false;
  bool fullScreen_ = true, wantsPlay_ = false, hasFrame_ = false, ended_ = false;
  bool awaitingRefresh_ = false, allowTestMedia_ = false;
};
