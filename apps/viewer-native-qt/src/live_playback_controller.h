#pragma once

#include <QJsonObject>
#include <QJsonArray>
#include <QHash>
#include <QList>
#include <QObject>
#include <QSize>
#include <QTimer>
#include <QVariantList>
#include <QVariantMap>
#include <array>

#include "libvlc_runtime.h"

class ApiClient;

class LivePlaybackController : public QObject {
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
  Q_PROPERTY(QString videoFillMode READ videoFillMode WRITE setVideoFillMode NOTIFY videoFillModeChanged)
  Q_PROPERTY(bool liveFullscreenActive READ liveFullscreenActive WRITE setLiveFullscreenActive NOTIFY liveFullscreenActiveChanged)
  Q_PROPERTY(int activeVideoSlot READ activeVideoSlot NOTIFY activeVideoSlotChanged)

public:
  explicit LivePlaybackController(ApiClient *apiClient, QObject *parent = nullptr);
  ~LivePlaybackController() override;

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
  QString videoFillMode() const;
  bool liveFullscreenActive() const;
  int activeVideoSlot() const;
  void setVideoFillMode(const QString &mode);
  void setLiveFullscreenActive(bool active);

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
  Q_INVOKABLE void setVideoSurfaceHandle(int slotIndex, qulonglong handle);
  Q_INVOKABLE void setVideoSurfaceGeometry(int slotIndex, int width, int height);
  Q_INVOKABLE void refreshVideoLayout();

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
  void videoFillModeChanged();
  void liveFullscreenActiveChanged();
  void activeVideoSlotChanged();

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

  struct CachedLiveSource {
    QJsonObject source;
    qint64 expiresAt = 0;
    QString cacheProfile = QStringLiteral("fast");
    bool prefetched = false;
  };

  struct PlayerSlotContext {
    LivePlaybackController *controller = nullptr;
    int slotIndex = 0;
  };

  struct PlayerSlotState {
    libvlc_media_player_t *player = nullptr;
    qulonglong surfaceHandle = 0;
    int surfaceWidth = 0;
    int surfaceHeight = 0;
    QString channelId;
    qint64 requestStartedAt = 0;
    bool sourceFromCache = false;
    bool prefetched = false;
    int fallbackCount = 0;
    QJsonObject lastResolvedSource;
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
  void setActiveVideoSlot(int value);

  QList<ChannelCandidate> buildCandidateQueue(const QString &channelId) const;
  void resolveCandidateAt(int index);
  void resolveVodSource(const QString &audioTrackId = QString());
  void openResolvedSource(const QJsonObject &source, int slotIndex, bool sourceFromCache = false, bool prefetched = false);
  void advanceToNextCandidate(const QString &reason);
  void failActiveTarget(const QString &reason, const QString &errorCode = QStringLiteral("playback-error"));
  void retryCurrentSourceInSoftwareMode(const QString &reason);
  void retryResolvedVodSource(const QString &reason);
  bool ensurePlayerReady(int slotIndex);
  bool ensureAudioOutputReady(libvlc_media_player_t *player);
  void applyAudioState(libvlc_media_player_t *player, bool recoverOutput = false);
  void recreatePlayer(int slotIndex);
  void attachPlayerEvents(int slotIndex);
  void bindVideoSurface(int slotIndex);
  void reportPlaybackEvent(
    const QString &event,
    const QString &nativeState,
    const QString &errorCode,
    const QString &errorMessage,
    int slotIndex = -1,
    const QString &channelIdOverride = QString()
  );
  void updateTimeline();
  void resetPlaybackMetrics();
  void clearSelectionState();
  void refreshRecommendedNextEpisode();
  bool isActiveLive() const;
  bool isActiveVod() const;
  QString currentPlaybackPath(const QString &channelIdOverride = QString()) const;
  QString normalizedPlatformName() const;
  QString choosePreferredAudioTrackId(const QJsonArray &tracks, const QString &serverDefault, const QString &serverSelected) const;
  static QVariantList mapAudioTracks(const QJsonArray &tracks);
  void updateVideoCrop(int slotIndex = -1);
  QSize getVideoSize(libvlc_media_player_t *player) const;
  libvlc_media_player_t *currentPlayer() const;
  libvlc_media_player_t *playerForSlot(int slotIndex) const;
  PlayerSlotState &slotState(int slotIndex);
  const PlayerSlotState &slotState(int slotIndex) const;
  int currentPlaybackSlot() const;
  QString rendererBackendName() const;
  QString liveResolvePath(const QString &channelId, bool forceRelayRestart) const;
  void prepareLiveSlot(int slotIndex, const QString &channelId, qint64 requestStartedAt);
  void activateLiveSlot(int slotIndex);
  void scheduleStopSlot(int slotIndex, int delayMs = 320);
  void resetLiveSwitchState();
  void clearLiveSourceCache(const QString &channelId = QString());
  void storeLiveSourceCache(const QString &channelId, const QJsonObject &source, bool prefetched);
  bool tryOpenCachedLiveSource(const QString &channelId, int slotIndex);
  void prefetchLiveChannel(const QString &channelId);
  void prefetchLiveCandidates();
  void noteLiveIssue(const QString &reason, bool escalateToSafeProfile);
  void restartActiveLiveWithSafeProfile(const QString &reason);

  void handlePlaying(int slotIndex);
  void handleBuffering(int slotIndex, float percent);
  void handleEncounteredError(int slotIndex);
  void handleStopped(int slotIndex);
  void handleEndReached(int slotIndex);

  static void handleVlcEvent(const libvlc_event_t *event, void *opaque);

  ApiClient *m_apiClient = nullptr;
  libvlc_instance_t *m_vlc = nullptr;
  QTimer m_timelineTimer;
  QTimer m_liveSlotStopTimer;
  QList<ChannelCandidate> m_candidates;
  int m_candidateIndex = -1;
  bool m_busy = false;
  bool m_paused = true;
  bool m_muted = false;
  bool m_retryingSoftwareDecode = false;
  bool m_retryingVodResolve = false;
  bool m_autoSelectingPreferredAudioTrack = false;
  bool m_waitingForVideoSurface = false;
  bool m_liveSwitchInProgress = false;
  bool m_forceRelayRestart = false;
  QString m_videoFillMode = QStringLiteral("fit");
  bool m_liveFullscreenActive = false;
  int m_activeVideoSlot = 0;
  int m_pendingLiveSlot = -1;
  int m_delayedStopSlot = -1;
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
  QString m_requestedLiveChannelId;
  QString m_requestedLiveTitle;
  QString m_liveCacheProfile = QStringLiteral("fast");
  qint64 m_liveSwitchRequestedAt = 0;
  qint64 m_liveIssueWindowStartedAt = 0;
  qint64 m_lastLiveIssueAt = 0;
  int m_liveIssueCount = 0;
  QHash<QString, CachedLiveSource> m_liveSourceCache;
  std::array<PlayerSlotState, 2> m_playerSlots {};
  std::array<PlayerSlotContext, 2> m_playerEventContexts {};
};
