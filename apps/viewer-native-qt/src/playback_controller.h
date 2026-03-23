#pragma once

#include <QJsonObject>
#include <QJsonArray>
#include <QList>
#include <QObject>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>

#include "libvlc_runtime.h"

class ApiClient;

class PlaybackController : public QObject {
  Q_OBJECT
  Q_PROPERTY(QString state READ state NOTIFY stateChanged)
  Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
  Q_PROPERTY(QString activeChannelId READ activeChannelId NOTIFY activeChannelIdChanged)
  Q_PROPERTY(QString activeContentId READ activeContentId NOTIFY activeContentIdChanged)
  Q_PROPERTY(QString activeContentKind READ activeContentKind NOTIFY activeContentKindChanged)
  Q_PROPERTY(QString activeTitle READ activeTitle NOTIFY activeTitleChanged)
  Q_PROPERTY(QString diagnosticsSessionId READ diagnosticsSessionId NOTIFY diagnosticsSessionIdChanged)
  Q_PROPERTY(QString decoderMode READ decoderMode NOTIFY decoderModeChanged)
  Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
  Q_PROPERTY(bool paused READ paused NOTIFY pausedChanged)
  Q_PROPERTY(double volume READ volume NOTIFY volumeChanged)
  Q_PROPERTY(bool muted READ muted NOTIFY mutedChanged)
  Q_PROPERTY(double positionSeconds READ positionSeconds NOTIFY positionSecondsChanged)
  Q_PROPERTY(double durationSeconds READ durationSeconds NOTIFY durationSecondsChanged)
  Q_PROPERTY(QVariantList audioTracks READ audioTracks NOTIFY audioTracksChanged)
  Q_PROPERTY(QString selectedAudioTrackId READ selectedAudioTrackId NOTIFY selectedAudioTrackIdChanged)
  Q_PROPERTY(QVariantMap recommendedNextEpisode READ recommendedNextEpisode NOTIFY recommendedNextEpisodeChanged)

public:
  explicit PlaybackController(ApiClient *apiClient, QObject *parent = nullptr);
  ~PlaybackController() override;

  QString state() const;
  QString lastError() const;
  QString activeChannelId() const;
  QString activeContentId() const;
  QString activeContentKind() const;
  QString activeTitle() const;
  QString diagnosticsSessionId() const;
  QString decoderMode() const;
  bool busy() const;
  bool paused() const;
  double volume() const;
  bool muted() const;
  double positionSeconds() const;
  double durationSeconds() const;
  QVariantList audioTracks() const;
  QString selectedAudioTrackId() const;
  QVariantMap recommendedNextEpisode() const;

  Q_INVOKABLE void playChannel(const QString &channelId);
  Q_INVOKABLE void playVod(const QString &kind, const QString &itemId, const QString &title = QString());
  Q_INVOKABLE void retryCurrent();
  Q_INVOKABLE void stop();
  Q_INVOKABLE void pause();
  Q_INVOKABLE void resume();
  Q_INVOKABLE void togglePause();
  Q_INVOKABLE void setVolume(double value);
  Q_INVOKABLE void toggleMuted();
  Q_INVOKABLE void seekTo(double seconds);
  Q_INVOKABLE void seekBy(double seconds);
  Q_INVOKABLE void selectAudioTrack(const QString &trackId);
  Q_INVOKABLE void playRecommendedNextEpisode();
  Q_INVOKABLE void setVideoSurfaceHandle(qulonglong handle);

signals:
  void stateChanged();
  void lastErrorChanged();
  void activeChannelIdChanged();
  void activeContentIdChanged();
  void activeContentKindChanged();
  void activeTitleChanged();
  void diagnosticsSessionIdChanged();
  void decoderModeChanged();
  void busyChanged();
  void pausedChanged();
  void volumeChanged();
  void mutedChanged();
  void positionSecondsChanged();
  void durationSecondsChanged();
  void audioTracksChanged();
  void selectedAudioTrackIdChanged();
  void recommendedNextEpisodeChanged();

private:
  enum class PlaybackMode {
    None,
    Live,
    Vod
  };

  struct PlaybackTarget {
    PlaybackMode mode = PlaybackMode::None;
    QString itemId;
    QString kind;
    QString title;
  };

  struct ChannelCandidate {
    QString channelId;
    QString title;
    QString variantGroupKey;
    int qualityRank = -1;
  };

  void setState(const QString &value);
  void setLastError(const QString &value);
  void setActiveChannelId(const QString &value);
  void setActiveContent(const PlaybackTarget &target);
  void setDiagnosticsSessionId(const QString &value);
  void setDecoderMode(const QString &value);
  void setBusy(bool value);
  void setPaused(bool value);
  void setVolumeLevel(double value);
  void setMuted(bool value);
  void setPositionSeconds(double value);
  void setDurationSeconds(double value);
  void setAudioTracks(const QVariantList &value);
  void setSelectedAudioTrackId(const QString &value);
  void setRecommendedNextEpisode(const QVariantMap &value);

  QList<ChannelCandidate> buildCandidateQueue(const QString &channelId) const;
  void resolveCandidateAt(int index);
  void resolveVodSource(const QString &audioTrackId = QString());
  void openResolvedSource(const QJsonObject &source);
  void advanceToNextCandidate(const QString &reason);
  void failActiveTarget(const QString &reason, const QString &errorCode = QStringLiteral("playback-error"));
  void retryCurrentSourceInSoftwareMode(const QString &reason);
  void retryResolvedVodSource(const QString &reason);
  void recreatePlayer();
  void attachPlayerEvents();
  void bindVideoSurface();
  void reportPlaybackEvent(const QString &event, const QString &nativeState, const QString &errorCode, const QString &errorMessage);
  void updateTimeline();
  void resetPlaybackMetrics();
  void clearSelectionState();
  void refreshRecommendedNextEpisode();
  bool isActiveLive() const;
  bool isActiveVod() const;
  QString currentPlaybackPath() const;
  QString normalizedPlatformName() const;
  QString choosePreferredAudioTrackId(const QJsonArray &tracks, const QString &serverDefault, const QString &serverSelected) const;
  static QVariantList mapAudioTracks(const QJsonArray &tracks);

  void handlePlaying();
  void handleBuffering(float percent);
  void handleEncounteredError();
  void handleStopped();
  void handleEndReached();

  static void handleVlcEvent(const libvlc_event_t *event, void *opaque);

  ApiClient *m_apiClient = nullptr;
  libvlc_instance_t *m_vlc = nullptr;
  libvlc_media_player_t *m_player = nullptr;
  QTimer m_timelineTimer;
  qulonglong m_videoSurfaceHandle = 0;
  QList<ChannelCandidate> m_candidates;
  int m_candidateIndex = -1;
  bool m_busy = false;
  bool m_paused = true;
  bool m_muted = false;
  bool m_retryingSoftwareDecode = false;
  bool m_retryingVodResolve = false;
  bool m_autoSelectingPreferredAudioTrack = false;
  QString m_state = QStringLiteral("idle");
  QString m_lastError;
  QString m_activeChannelId;
  PlaybackTarget m_activeTarget;
  QString m_diagnosticsSessionId;
  QString m_decoderMode = QStringLiteral("hardware");
  double m_volume = 1.0;
  double m_lastAudibleVolume = 1.0;
  double m_positionSeconds = 0.0;
  double m_durationSeconds = 0.0;
  double m_pendingResumeSeconds = 0.0;
  QVariantList m_audioTracks;
  QString m_selectedAudioTrackId;
  QVariantMap m_recommendedNextEpisode;
  QJsonObject m_lastResolvedSource;
  QString m_requestedAudioTrackId;
};
