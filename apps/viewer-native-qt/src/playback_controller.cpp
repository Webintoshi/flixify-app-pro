#include "playback_controller.h"

#include "api_client.h"

#include <QDateTime>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMetaObject>
#include <QNetworkReply>
#include <QSettings>
#include <QStringList>
#include <QUrl>
#include <QUrlQuery>
#include <QtGlobal>
#include <algorithm>
#include <array>
#include <cstdint>

namespace {

constexpr qint64 kLiveSourceCacheTtlMs = 30'000;
constexpr qint64 kLiveIssueWindowMs = 30'000;

QString extractReplyMessage(const QByteArray &body, const QString &fallback) {
  const QJsonDocument document = QJsonDocument::fromJson(body);
  if (document.isObject()) {
    const QString message = document.object().value(QStringLiteral("message")).toString().trimmed();
    if (!message.isEmpty()) {
      return message;
    }
  }

  const QString text = QString::fromUtf8(body).trimmed();
  return text.isEmpty() ? fallback : text;
}

bool isAuthStatusCode(const QNetworkReply *reply) {
  const int status = reply ? reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() : 0;
  return status == 401 || status == 403;
}

void addMediaOption(libvlc_media_t *media, const QString &value) {
  if (!media || value.trimmed().isEmpty()) {
    return;
  }

  const QByteArray bytes = value.toUtf8();
  libvlc_media_add_option(media, bytes.constData());
}

bool looksTurkish(const QString &language, const QString &title) {
  const QString normalizedLanguage = language.trimmed().toLower();
  const QString normalizedTitle = title.trimmed().toLower();
  return normalizedLanguage == QStringLiteral("tr") || normalizedLanguage.startsWith(QStringLiteral("tur")) ||
         normalizedTitle.contains(QStringLiteral("turk")) || normalizedTitle.contains(QStringLiteral("turkish"));
}

QString sanitizeVideoFillMode(const QString &mode) {
  return mode.trimmed().toLower() == QStringLiteral("fill") ? QStringLiteral("fill") : QStringLiteral("fit");
}

QString sanitizeLiveCacheProfile(const QString &value) {
  return value.trimmed().toLower() == QStringLiteral("safe") ? QStringLiteral("safe") : QStringLiteral("fast");
}

qint64 nowMs() {
  return QDateTime::currentMSecsSinceEpoch();
}

int liveNetworkCachingMs(const QString &cacheProfile) {
  return sanitizeLiveCacheProfile(cacheProfile) == QStringLiteral("safe") ? 1000 : 400;
}

int liveFileCachingMs(const QString &cacheProfile) {
  return sanitizeLiveCacheProfile(cacheProfile) == QStringLiteral("safe") ? 800 : 300;
}

}

#define m_player (m_playerSlots[0].player)
#define m_videoSurfaceHandle (m_playerSlots[0].surfaceHandle)
#define m_surfaceWidth (m_playerSlots[0].surfaceWidth)
#define m_surfaceHeight (m_playerSlots[0].surfaceHeight)

PlaybackController::PlaybackController(ApiClient *apiClient, QObject *parent)
  : QObject(parent), m_apiClient(apiClient) {
  m_timelineTimer.setInterval(500);
  connect(&m_timelineTimer, &QTimer::timeout, this, &PlaybackController::updateTimeline);

  m_liveSlotStopTimer.setSingleShot(true);
  connect(&m_liveSlotStopTimer, &QTimer::timeout, this, [this]() {
    if (m_delayedStopSlot < 0 || m_delayedStopSlot >= static_cast<int>(m_playerSlots.size())) {
      return;
    }
    if (m_delayedStopSlot != currentPlaybackSlot()) {
      if (libvlc_media_player_t *player = playerForSlot(m_delayedStopSlot)) {
        libvlc_media_player_stop(player);
      }
    }
    m_delayedStopSlot = -1;
  });

  for (int index = 0; index < static_cast<int>(m_playerEventContexts.size()); ++index) {
    m_playerEventContexts[index].controller = this;
    m_playerEventContexts[index].slotIndex = index;
  }

  QSettings settings;
  m_videoFillMode = sanitizeVideoFillMode(
    settings.value(QStringLiteral("player/videoFillMode"), QStringLiteral("fit")).toString()
  );
}

PlaybackController::~PlaybackController() {
  stop();
  for (PlayerSlotState &slot : m_playerSlots) {
    if (slot.player) {
      libvlc_media_player_release(slot.player);
      slot.player = nullptr;
    }
  }
  if (m_vlc) {
    libvlc_release(m_vlc);
    m_vlc = nullptr;
  }
}

QString PlaybackController::state() const {
  return m_state;
}

QString PlaybackController::lastError() const {
  return m_lastError;
}

QString PlaybackController::activeChannelId() const {
  return m_activeChannelId;
}

QString PlaybackController::activeContentId() const {
  return m_activeTarget.itemId;
}

QString PlaybackController::activeContentKind() const {
  return m_activeTarget.kind;
}

QString PlaybackController::activeTitle() const {
  return m_activeTarget.title;
}

QString PlaybackController::diagnosticsSessionId() const {
  return m_diagnosticsSessionId;
}

QString PlaybackController::decoderMode() const {
  return m_decoderMode;
}

QString PlaybackController::videoFillMode() const {
  return m_videoFillMode;
}

int PlaybackController::activeVideoSlot() const {
  return m_activeVideoSlot;
}

void PlaybackController::setVideoFillMode(const QString &mode) {
  const QString newMode = sanitizeVideoFillMode(mode);
  if (newMode == m_videoFillMode) {
    return;
  }
  m_videoFillMode = newMode;
  QSettings settings;
  settings.setValue(QStringLiteral("player/videoFillMode"), m_videoFillMode);
  emit videoFillModeChanged();
  updateVideoCrop(0);
  updateVideoCrop(1);
}

bool PlaybackController::busy() const {
  return m_busy;
}

bool PlaybackController::paused() const {
  return m_paused;
}

double PlaybackController::volume() const {
  return m_volume;
}

bool PlaybackController::muted() const {
  return m_muted;
}

double PlaybackController::positionSeconds() const {
  return m_positionSeconds;
}

double PlaybackController::durationSeconds() const {
  return m_durationSeconds;
}

QVariantList PlaybackController::audioTracks() const {
  return m_audioTracks;
}

QString PlaybackController::selectedAudioTrackId() const {
  return m_selectedAudioTrackId;
}

QVariantMap PlaybackController::recommendedNextEpisode() const {
  return m_recommendedNextEpisode;
}

void PlaybackController::playChannel(const QString &channelId) {
  const QString normalizedChannelId = channelId.trimmed();
  if (normalizedChannelId.isEmpty()) {
    return;
  }

  if (m_player) {
    libvlc_media_player_stop(m_player);
  }

  const QVariantMap channel = m_apiClient ? m_apiClient->liveChannelById(normalizedChannelId) : QVariantMap();
  PlaybackTarget target;
  target.mode = PlaybackMode::Live;
  target.itemId = normalizedChannelId;
  target.kind = QStringLiteral("live");
  target.title = channel.value(QStringLiteral("title")).toString();

  setActiveContent(target);
  setActiveChannelId(normalizedChannelId);
  setActiveVideoSlot(0);
  setRecommendedNextEpisode({});
  clearSelectionState();
  resetPlaybackMetrics();
  m_pendingResumeSeconds = 0.0;
  m_lastResolvedSource = QJsonObject();
  m_requestedAudioTrackId.clear();
  m_requestedLiveChannelId = normalizedChannelId;
  m_requestedLiveTitle = target.title;
  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  m_autoSelectingPreferredAudioTrack = false;
  m_waitingForVideoSurface = false;
  m_liveCacheProfile = m_forceRelayRestart ? sanitizeLiveCacheProfile(m_liveCacheProfile) : QStringLiteral("fast");
  m_liveIssueWindowStartedAt = 0;
  m_lastLiveIssueAt = 0;
  m_liveIssueCount = 0;
  m_liveSwitchRequestedAt = nowMs();
  resetLiveSwitchState();
  setLastError(QString());
  setDecoderMode(QStringLiteral("hardware"));

  m_candidates = buildCandidateQueue(normalizedChannelId);
  if (m_candidates.isEmpty()) {
    failActiveTarget(QStringLiteral("Secilen kanal native katalogda bulunamadi."), QStringLiteral("channel-not-found"));
    return;
  }

  m_candidateIndex = -1;
  prepareLiveSlot(0, normalizedChannelId, m_liveSwitchRequestedAt);
  if (tryOpenCachedLiveSource(normalizedChannelId, 0)) {
    return;
  }
  resolveCandidateAt(0);
}

void PlaybackController::playVod(const QString &kind, const QString &itemId, const QString &title) {
  const QString normalizedKind = kind.trimmed().toLower();
  const QString normalizedItemId = itemId.trimmed();
  if ((normalizedKind != QStringLiteral("movie") && normalizedKind != QStringLiteral("episode")) ||
      normalizedItemId.isEmpty()) {
    return;
  }

  if (m_player) {
    libvlc_media_player_stop(m_player);
  }

  QString resolvedTitle = title.trimmed();
  if (resolvedTitle.isEmpty() && m_apiClient) {
    const QVariantMap item =
      normalizedKind == QStringLiteral("movie") ? m_apiClient->movieById(normalizedItemId)
                                                : m_apiClient->episodeById(normalizedItemId);
    resolvedTitle = item.value(QStringLiteral("title")).toString().trimmed();
  }

  PlaybackTarget target;
  target.mode = PlaybackMode::Vod;
  target.itemId = normalizedItemId;
  target.kind = normalizedKind;
  target.title = resolvedTitle;

  setActiveContent(target);
  setActiveChannelId(QString());
  setActiveVideoSlot(0);
  clearSelectionState();
  resetPlaybackMetrics();
  m_pendingResumeSeconds = 0.0;
  setRecommendedNextEpisode({});
  m_lastResolvedSource = QJsonObject();
  m_requestedAudioTrackId.clear();
  m_requestedLiveChannelId.clear();
  m_requestedLiveTitle.clear();
  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  m_autoSelectingPreferredAudioTrack = false;
  m_waitingForVideoSurface = false;
  resetLiveSwitchState();
  setLastError(QString());
  setDecoderMode(QStringLiteral("hardware"));

  resolveVodSource();
}

void PlaybackController::retryCurrent() {
  if (isActiveLive() && !m_activeChannelId.isEmpty()) {
    m_forceRelayRestart = true;
    clearLiveSourceCache(m_activeChannelId);
    playChannel(m_activeChannelId);
    return;
  }

  if (isActiveVod() && !m_activeTarget.itemId.isEmpty()) {
    playVod(m_activeTarget.kind, m_activeTarget.itemId, m_activeTarget.title);
  }
}

void PlaybackController::stop() {
  m_timelineTimer.stop();
  m_liveSlotStopTimer.stop();
  m_delayedStopSlot = -1;
  if (m_player) {
    libvlc_media_player_stop(m_player);
  }
  m_lastResolvedSource = QJsonObject();
  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  m_autoSelectingPreferredAudioTrack = false;
  m_waitingForVideoSurface = false;
  m_pendingResumeSeconds = 0.0;
  resetLiveSwitchState();
  setBusy(false);
  setPaused(true);
  setState(QStringLiteral("idle"));
  resetPlaybackMetrics();
}

void PlaybackController::pause() {
  if (!m_player) {
    return;
  }

  libvlc_media_player_set_pause(m_player, 1);
  setPaused(true);
}

void PlaybackController::resume() {
  if (!m_player) {
    return;
  }

  if (libvlc_media_player_play(m_player) == 0) {
    setPaused(false);
    setState(QStringLiteral("playing"));
  }
}

void PlaybackController::togglePause() {
  if (!m_player) {
    return;
  }

  if (paused()) {
    resume();
    return;
  }

  pause();
}

void PlaybackController::setVolume(double value) {
  const double normalized = std::clamp(value, 0.0, 1.0);
  if (normalized > 0.0) {
    m_lastAudibleVolume = normalized;
  }

  setVolumeLevel(normalized);
  setMuted(normalized <= 0.0);
  applyAudioState(currentPlayer(), normalized > 0.0);
}

void PlaybackController::toggleMuted() {
  const bool nextMuted = !m_muted;
  if (nextMuted) {
    if (m_volume > 0.0) {
      m_lastAudibleVolume = m_volume;
    }
    setVolumeLevel(0.0);
    setMuted(true);
    applyAudioState(currentPlayer(), false);
    return;
  }

  const double restoredVolume = m_lastAudibleVolume > 0.0 ? m_lastAudibleVolume : 1.0;
  setVolumeLevel(restoredVolume);
  setMuted(false);
  applyAudioState(currentPlayer(), true);
}

void PlaybackController::seekTo(double seconds) {
  if (!m_player || !isActiveVod()) {
    return;
  }

  const double normalizedSeconds = qMax(0.0, seconds);
  libvlc_media_player_set_time(m_player, static_cast<libvlc_time_t>(normalizedSeconds * 1000.0));
  setPositionSeconds(normalizedSeconds);
}

void PlaybackController::seekBy(double seconds) {
  seekTo(positionSeconds() + seconds);
}

void PlaybackController::selectAudioTrack(const QString &trackId) {
  if (!isActiveVod()) {
    return;
  }

  const QString normalizedTrackId = trackId.trimmed();
  if (normalizedTrackId.isEmpty() || normalizedTrackId == selectedAudioTrackId()) {
    return;
  }

  m_requestedAudioTrackId = normalizedTrackId;
  m_pendingResumeSeconds = positionSeconds();
  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  setDecoderMode(QStringLiteral("hardware"));
  resolveVodSource(normalizedTrackId);
}

void PlaybackController::playRecommendedNextEpisode() {
  const QVariantMap nextEpisode = recommendedNextEpisode();
  const QString nextEpisodeId = nextEpisode.value(QStringLiteral("id")).toString();
  if (nextEpisodeId.isEmpty()) {
    return;
  }

  playVod(QStringLiteral("episode"), nextEpisodeId, nextEpisode.value(QStringLiteral("title")).toString());
}

void PlaybackController::setVideoSurfaceHandle(int slotIndex, qulonglong handle) {
  if (slotIndex < 0 || slotIndex >= static_cast<int>(m_playerSlots.size())) {
    return;
  }

  PlayerSlotState &slot = slotState(slotIndex);
  if (handle == slot.surfaceHandle) {
    return;
  }

  slot.surfaceHandle = handle;
  bindVideoSurface(slotIndex);
  if (slot.surfaceHandle != 0 && m_waitingForVideoSurface && !slot.lastResolvedSource.isEmpty()) {
    m_waitingForVideoSurface = false;
    const QJsonObject source = slot.lastResolvedSource;
    QTimer::singleShot(0, this, [this, slotIndex, source]() {
      openResolvedSource(source, slotIndex);
    });
  }
}

void PlaybackController::setVideoSurfaceGeometry(int slotIndex, int width, int height) {
  if (slotIndex < 0 || slotIndex >= static_cast<int>(m_playerSlots.size())) {
    return;
  }

  PlayerSlotState &slot = slotState(slotIndex);
  if (width == slot.surfaceWidth && height == slot.surfaceHeight) {
    return;
  }
  slot.surfaceWidth = width;
  slot.surfaceHeight = height;
  updateVideoCrop(slotIndex);
}

QSize PlaybackController::getVideoSize(libvlc_media_player_t *player) const {
  if (!player) {
    return QSize();
  }
  unsigned int vw = 0, vh = 0;
  libvlc_video_get_size(player, 0, &vw, &vh);
  if (vw > 0 && vh > 0) {
    return QSize(static_cast<int>(vw), static_cast<int>(vh));
  }
  return QSize();
}

void PlaybackController::updateVideoCrop(int slotIndex) {
  const int effectiveSlot = slotIndex >= 0 ? slotIndex : currentPlaybackSlot();
  libvlc_media_player_t *player = playerForSlot(effectiveSlot);
  if (!player) {
    return;
  }

  if (m_videoFillMode == QStringLiteral("fit")) {
    libvlc_video_set_crop_geometry(player, nullptr);
    return;
  }

  const PlayerSlotState &slot = slotState(effectiveSlot);
  if (slot.surfaceWidth <= 0 || slot.surfaceHeight <= 0) {
    return;
  }

  const QSize videoSize = getVideoSize(player);
  if (!videoSize.isValid() || videoSize.width() <= 0 || videoSize.height() <= 0) {
    return;
  }

  const double surfaceRatio = static_cast<double>(slot.surfaceWidth) / static_cast<double>(slot.surfaceHeight);
  const double videoRatio = static_cast<double>(videoSize.width()) / static_cast<double>(videoSize.height());

  int cropX = 0, cropY = 0, cropW = videoSize.width(), cropH = videoSize.height();

  if (videoRatio > surfaceRatio) {
    cropW = qRound(videoSize.height() * surfaceRatio);
    cropX = (videoSize.width() - cropW) / 2;
  } else if (videoRatio < surfaceRatio) {
    cropH = qRound(videoSize.width() / surfaceRatio);
    cropY = (videoSize.height() - cropH) / 2;
  }

  const QString cropGeometry = QStringLiteral("%1x%2+%3+%4").arg(cropW).arg(cropH).arg(cropX).arg(cropY);
  const QByteArray cropBytes = cropGeometry.toUtf8();
  libvlc_video_set_crop_geometry(player, cropBytes.constData());
}

void PlaybackController::setState(const QString &value) {
  if (value == m_state) {
    return;
  }
  m_state = value;
  emit stateChanged();
}

void PlaybackController::setLastError(const QString &value) {
  if (value == m_lastError) {
    return;
  }
  m_lastError = value;
  emit lastErrorChanged();
}

void PlaybackController::setActiveChannelId(const QString &value) {
  if (value == m_activeChannelId) {
    return;
  }
  m_activeChannelId = value;
  emit activeChannelIdChanged();
}

void PlaybackController::setActiveContent(const PlaybackTarget &target) {
  const bool idChanged = target.itemId != m_activeTarget.itemId;
  const bool kindChanged = target.kind != m_activeTarget.kind;
  const bool titleChanged = target.title != m_activeTarget.title;
  m_activeTarget = target;

  if (idChanged) {
    emit activeContentIdChanged();
  }
  if (kindChanged) {
    emit activeContentKindChanged();
  }
  if (titleChanged) {
    emit activeTitleChanged();
  }
}

void PlaybackController::setDiagnosticsSessionId(const QString &value) {
  if (value == m_diagnosticsSessionId) {
    return;
  }
  m_diagnosticsSessionId = value;
  emit diagnosticsSessionIdChanged();
}

void PlaybackController::setDecoderMode(const QString &value) {
  if (value == m_decoderMode) {
    return;
  }
  m_decoderMode = value;
  emit decoderModeChanged();
}

void PlaybackController::setBusy(bool value) {
  if (value == m_busy) {
    return;
  }
  m_busy = value;
  emit busyChanged();
}

void PlaybackController::setPaused(bool value) {
  if (value == m_paused) {
    return;
  }
  m_paused = value;
  emit pausedChanged();
}

void PlaybackController::setVolumeLevel(double value) {
  if (qFuzzyCompare(value + 1.0, m_volume + 1.0)) {
    return;
  }
  m_volume = value;
  emit volumeChanged();
}

void PlaybackController::setMuted(bool value) {
  if (value == m_muted) {
    return;
  }
  m_muted = value;
  emit mutedChanged();
}

void PlaybackController::setPositionSeconds(double value) {
  if (qFuzzyCompare(value + 1.0, m_positionSeconds + 1.0)) {
    return;
  }
  m_positionSeconds = value;
  emit positionSecondsChanged();
}

void PlaybackController::setDurationSeconds(double value) {
  if (qFuzzyCompare(value + 1.0, m_durationSeconds + 1.0)) {
    return;
  }
  m_durationSeconds = value;
  emit durationSecondsChanged();
}

void PlaybackController::setAudioTracks(const QVariantList &value) {
  if (value == m_audioTracks) {
    return;
  }
  m_audioTracks = value;
  emit audioTracksChanged();
}

void PlaybackController::setSelectedAudioTrackId(const QString &value) {
  if (value == m_selectedAudioTrackId) {
    return;
  }
  m_selectedAudioTrackId = value;
  emit selectedAudioTrackIdChanged();
}

void PlaybackController::setRecommendedNextEpisode(const QVariantMap &value) {
  if (value == m_recommendedNextEpisode) {
    return;
  }
  m_recommendedNextEpisode = value;
  emit recommendedNextEpisodeChanged();
}

void PlaybackController::setActiveVideoSlot(int value) {
  const int normalized = value == 1 ? 1 : 0;
  if (normalized == m_activeVideoSlot) {
    return;
  }
  m_activeVideoSlot = normalized;
  emit activeVideoSlotChanged();
}

QList<PlaybackController::ChannelCandidate> PlaybackController::buildCandidateQueue(const QString &channelId) const {
  QList<ChannelCandidate> candidates;
  if (!m_apiClient) {
    return candidates;
  }

  const QVariantMap current = m_apiClient->liveChannelById(channelId);
  if (current.isEmpty()) {
    return candidates;
  }

  const QString targetGroup = current.value(QStringLiteral("variantGroupKey")).toString().trimmed();
  const QVariantList catalog = m_apiClient->liveChannels();
  for (const QVariant &item : catalog) {
    const QVariantMap map = item.toMap();
    const QString itemId = map.value(QStringLiteral("id")).toString();
    const QString itemGroup = map.value(QStringLiteral("variantGroupKey")).toString().trimmed();
    if (itemId == channelId || (!targetGroup.isEmpty() && itemGroup == targetGroup)) {
      ChannelCandidate candidate;
      candidate.channelId = itemId;
      candidate.title = map.value(QStringLiteral("title")).toString();
      candidate.variantGroupKey = itemGroup;
      candidate.qualityRank = map.contains(QStringLiteral("qualityRank"))
                                ? map.value(QStringLiteral("qualityRank")).toInt()
                                : -1;
      candidates.push_back(candidate);
    }
  }

  std::sort(candidates.begin(), candidates.end(), [](const auto &left, const auto &right) {
    if (left.channelId == right.channelId) {
      return false;
    }
    if (left.qualityRank != right.qualityRank) {
      return left.qualityRank > right.qualityRank;
    }
    return left.title.toLower() < right.title.toLower();
  });

  for (int index = 0; index < candidates.size(); ++index) {
    if (candidates[index].channelId == channelId) {
      candidates.move(index, 0);
      break;
    }
  }

  return candidates;
}

void PlaybackController::resolveCandidateAt(int index) {
  if (!m_apiClient || index < 0 || index >= m_candidates.size()) {
    if (m_lastError.isEmpty()) {
      setLastError(QStringLiteral("Native playback fallback zinciri tukendi."));
    }
    setBusy(false);
    setState(QStringLiteral("error"));
    return;
  }

  m_candidateIndex = index;
  setBusy(true);
  setState(QStringLiteral("resolving"));
  setActiveChannelId(m_candidates[index].channelId);
  resetPlaybackMetrics();
  const int slotIndex = currentPlaybackSlot();
  prepareLiveSlot(slotIndex, m_candidates[index].channelId, m_liveSwitchRequestedAt > 0 ? m_liveSwitchRequestedAt : nowMs());
  if (tryOpenCachedLiveSource(m_candidates[index].channelId, slotIndex)) {
    return;
  }

  const bool forceRelayRestart = m_forceRelayRestart;
  const QString path = liveResolvePath(m_candidates[index].channelId, forceRelayRestart);
  m_forceRelayRestart = false;
  const int requestedIndex = index;
  QNetworkReply *reply = m_apiClient->network()->get(m_apiClient->authorizedRequest(path));
  connect(reply, &QNetworkReply::finished, this, [this, reply, requestedIndex, slotIndex, forceRelayRestart]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatusCode(reply);
    reply->deleteLater();

    if (!ok) {
      if (authFailed && m_apiClient) {
        m_apiClient->refreshSession([this, requestedIndex, forceRelayRestart](bool success) {
          if (success) {
            m_forceRelayRestart = forceRelayRestart;
            resolveCandidateAt(requestedIndex);
            return;
          }
          failActiveTarget(QStringLiteral("Oturum suresi doldu. Lutfen tekrar giris yapin."), QStringLiteral("auth-expired"));
        });
        return;
      }

      const QString message = extractReplyMessage(body, QStringLiteral("Native playback source resolve failed."));
      clearLiveSourceCache(m_candidates.value(requestedIndex).channelId);
      reportPlaybackEvent(
        QStringLiteral("failed"),
        QStringLiteral("resolve-failed"),
        QStringLiteral("resolve-error"),
        message,
        slotIndex,
        m_candidates.value(requestedIndex).channelId
      );
      advanceToNextCandidate(message);
      return;
    }

    const QJsonObject source = QJsonDocument::fromJson(body).object();
    storeLiveSourceCache(m_candidates.value(requestedIndex).channelId, source, false);
    openResolvedSource(source, slotIndex);
  });
}

void PlaybackController::resolveVodSource(const QString &audioTrackId) {
  if (!m_apiClient || !isActiveVod()) {
    return;
  }

  setBusy(true);
  setState(QStringLiteral("resolving"));
  resetPlaybackMetrics();

  const QString normalizedAudioTrackId = audioTrackId.trimmed();
  if (!normalizedAudioTrackId.isEmpty()) {
    m_requestedAudioTrackId = normalizedAudioTrackId;
  }
  const QString requestedAudioTrackId = !normalizedAudioTrackId.isEmpty() ? normalizedAudioTrackId : m_requestedAudioTrackId;

  QString path = QStringLiteral("/me/native/vod/%1/%2/playback")
                   .arg(m_activeTarget.kind, QString::fromUtf8(QUrl::toPercentEncoding(m_activeTarget.itemId)));
  QUrl url = m_apiClient->resolvedUrl(path);
  QUrlQuery query(url);
  query.addQueryItem(QStringLiteral("platform"), normalizedPlatformName());
  if (!normalizedAudioTrackId.isEmpty()) {
    query.addQueryItem(QStringLiteral("audioTrackId"), normalizedAudioTrackId);
  } else if (!m_requestedAudioTrackId.isEmpty()) {
    query.addQueryItem(QStringLiteral("audioTrackId"), m_requestedAudioTrackId);
  }
  url.setQuery(query);

  QNetworkRequest request(url);
  request.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("application/json"));
  request.setRawHeader("Accept", "application/json");
  if (!m_apiClient->accessToken().isEmpty()) {
    request.setRawHeader("Authorization", QByteArray("Bearer ") + m_apiClient->accessToken().toUtf8());
  }
  request.setRawHeader("X-Flixify-Client-Runtime", "native");

  QNetworkReply *reply = m_apiClient->network()->get(request);
  connect(reply, &QNetworkReply::finished, this, [this, reply, requestedAudioTrackId]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatusCode(reply);
    reply->deleteLater();

    if (!ok) {
      if (authFailed && m_apiClient) {
        m_apiClient->refreshSession([this, requestedAudioTrackId](bool success) {
          if (success) {
            resolveVodSource(requestedAudioTrackId);
            return;
          }
          failActiveTarget(QStringLiteral("Oturum suresi doldu. Lutfen tekrar giris yapin."), QStringLiteral("auth-expired"));
        });
        return;
      }

      const QString message = extractReplyMessage(body, QStringLiteral("Native VOD playback source resolve failed."));
      failActiveTarget(message, QStringLiteral("resolve-error"));
      return;
    }

    const QJsonObject source = QJsonDocument::fromJson(body).object();
    const QJsonArray tracks = source.value(QStringLiteral("audioTracks")).toArray();
    const QString serverDefaultAudioTrackId = source.value(QStringLiteral("defaultAudioTrackId")).toString();
    const QString serverSelectedAudioTrackId = source.value(QStringLiteral("selectedAudioTrackId")).toString();
    const QString preferredAudioTrackId =
      choosePreferredAudioTrackId(tracks, serverDefaultAudioTrackId, serverSelectedAudioTrackId);

    if (!m_requestedAudioTrackId.isEmpty() && preferredAudioTrackId != m_requestedAudioTrackId) {
      m_requestedAudioTrackId.clear();
    }

    if (!m_requestedAudioTrackId.isEmpty() || preferredAudioTrackId == serverSelectedAudioTrackId ||
        preferredAudioTrackId.isEmpty() || m_autoSelectingPreferredAudioTrack) {
      m_autoSelectingPreferredAudioTrack = false;
      setAudioTracks(mapAudioTracks(tracks));
      setSelectedAudioTrackId(
        !preferredAudioTrackId.isEmpty() ? preferredAudioTrackId
                                         : !serverSelectedAudioTrackId.isEmpty() ? serverSelectedAudioTrackId
                                                                                 : serverDefaultAudioTrackId
      );
      refreshRecommendedNextEpisode();
      m_lastResolvedSource = source;
      if (!m_requestedAudioTrackId.isEmpty()) {
        reportPlaybackEvent(QStringLiteral("audio-track-selected"), QStringLiteral("resolved"), QString(), QString());
      }
      reportPlaybackEvent(QStringLiteral("session-created"), QStringLiteral("resolved"), QString(), QString());
      openResolvedSource(source, 0);
      return;
    }

    m_autoSelectingPreferredAudioTrack = true;
    m_requestedAudioTrackId = preferredAudioTrackId;
    resolveVodSource(preferredAudioTrackId);
  });
}

void PlaybackController::openResolvedSource(const QJsonObject &source, int slotIndex, bool sourceFromCache, bool prefetched) {
  if (!ensurePlayerReady(slotIndex)) {
    failActiveTarget(
      lastError().trimmed().isEmpty() ? QStringLiteral("libVLC player baslatilamadi.") : lastError(),
      QStringLiteral("player-init-failed")
    );
    return;
  }

  const QString url = source.value(QStringLiteral("url")).toString();
  if (url.trimmed().isEmpty()) {
    failActiveTarget(QStringLiteral("Native playback source URL bos geldi."), QStringLiteral("missing-url"));
    return;
  }

  PlayerSlotState &slot = slotState(slotIndex);
  slot.lastResolvedSource = source;
  slot.sourceFromCache = sourceFromCache;
  slot.prefetched = prefetched;
  m_lastResolvedSource = source;
  setDiagnosticsSessionId(source.value(QStringLiteral("diagnosticsSessionId")).toString());
  setState(QStringLiteral("opening"));
  if (slot.surfaceHandle == 0) {
    m_waitingForVideoSurface = true;
    setBusy(true);
    setPaused(true);
    return;
  }
  m_waitingForVideoSurface = false;

  libvlc_media_t *media = libvlc_media_new_location(m_vlc, url.toUtf8().constData());
  if (!media) {
    if (isActiveVod()) {
      retryResolvedVodSource(QStringLiteral("libVLC medya nesnesi olusturulamadi."));
      return;
    }
    advanceToNextCandidate(QStringLiteral("libVLC medya nesnesi olusturulamadi."));
    return;
  }

  addMediaOption(
    media,
    QStringLiteral(":network-caching=%1")
      .arg(isActiveLive() ? liveNetworkCachingMs(m_liveCacheProfile) : 1200)
  );
  addMediaOption(
    media,
    QStringLiteral(":file-caching=%1")
      .arg(isActiveLive() ? liveFileCachingMs(m_liveCacheProfile) : 1000)
  );
  addMediaOption(media, decoderMode() == QStringLiteral("hardware")
                           ? QStringLiteral(":avcodec-hw=any")
                           : QStringLiteral(":avcodec-hw=none"));

  const QString userAgent = source.value(QStringLiteral("userAgent")).toString().trimmed();
  const QJsonObject headers = source.value(QStringLiteral("headers")).toObject();
  const QString headerUserAgent = headers.value(QStringLiteral("User-Agent")).toString().trimmed();
  if (!userAgent.isEmpty() || !headerUserAgent.isEmpty()) {
    addMediaOption(
      media,
      QStringLiteral(":http-user-agent=%1").arg(!userAgent.isEmpty() ? userAgent : headerUserAgent)
    );
  }

  const QString cookie = source.value(QStringLiteral("cookie")).toString().trimmed();
  const QString headerCookie = headers.value(QStringLiteral("Cookie")).toString().trimmed();
  if (!cookie.isEmpty() || !headerCookie.isEmpty()) {
    addMediaOption(
      media,
      QStringLiteral(":http-cookie=%1").arg(!cookie.isEmpty() ? cookie : headerCookie)
    );
  }

  const QString referer = headers.value(QStringLiteral("Referer")).toString().trimmed();
  const QString referrer = headers.value(QStringLiteral("Referrer")).toString().trimmed();
  if (!referer.isEmpty() || !referrer.isEmpty()) {
    addMediaOption(
      media,
      QStringLiteral(":http-referrer=%1").arg(!referer.isEmpty() ? referer : referrer)
    );
  }

  libvlc_media_player_t *player = playerForSlot(slotIndex);
  libvlc_media_player_set_media(player, media);
  libvlc_media_release(media);
  bindVideoSurface(slotIndex);

  if (libvlc_media_player_play(player) != 0) {
    if (!m_retryingSoftwareDecode && decoderMode() == QStringLiteral("hardware")) {
      retryCurrentSourceInSoftwareMode(QStringLiteral("Hardware decode open basarisiz."));
      return;
    }

    if (isActiveVod()) {
      retryResolvedVodSource(QStringLiteral("libVLC medya oynatici VOD akisini acamadi."));
      return;
    }

    advanceToNextCandidate(QStringLiteral("libVLC medya oynatici acilamadi."));
    return;
  }

  applyAudioState(player, true);
  setBusy(false);
  setPaused(false);
}

void PlaybackController::advanceToNextCandidate(const QString &reason) {
  setLastError(reason);
  if (m_candidateIndex + 1 < m_candidates.size()) {
    m_retryingSoftwareDecode = false;
    setDecoderMode(QStringLiteral("hardware"));
    clearLiveSourceCache(m_candidates.value(m_candidateIndex).channelId);
    resolveCandidateAt(m_candidateIndex + 1);
    return;
  }

  failActiveTarget(reason, QStringLiteral("fallback-exhausted"));
}

void PlaybackController::failActiveTarget(const QString &reason, const QString &errorCode) {
  m_timelineTimer.stop();
  setLastError(reason);
  setBusy(false);
  setPaused(true);
  m_waitingForVideoSurface = false;
  clearLiveSourceCache(isActiveLive() ? m_activeChannelId : QString());
  setState(QStringLiteral("error"));
  reportPlaybackEvent(
    isActiveVod() ? QStringLiteral("playback-failed") : QStringLiteral("failed"),
    QStringLiteral("terminal-failure"),
    errorCode,
    reason,
    currentPlaybackSlot()
  );
}

void PlaybackController::retryCurrentSourceInSoftwareMode(const QString &reason) {
  if (m_lastResolvedSource.isEmpty()) {
    if (isActiveVod()) {
      retryResolvedVodSource(reason);
      return;
    }
    advanceToNextCandidate(reason);
    return;
  }

  m_retryingSoftwareDecode = true;
  setDecoderMode(QStringLiteral("software"));
  setLastError(reason);
  noteLiveIssue(reason, false);
  openResolvedSource(m_lastResolvedSource, currentPlaybackSlot());
}

void PlaybackController::retryResolvedVodSource(const QString &reason) {
  if (!isActiveVod()) {
    failActiveTarget(reason, QStringLiteral("vod-retry-invalid"));
    return;
  }

  if (m_retryingVodResolve) {
    failActiveTarget(reason, QStringLiteral("vod-reresolve-exhausted"));
    return;
  }

  m_retryingVodResolve = true;
  m_retryingSoftwareDecode = false;
  setDecoderMode(QStringLiteral("hardware"));
  setLastError(reason);
  m_pendingResumeSeconds = positionSeconds();
  resolveVodSource(m_requestedAudioTrackId);
}

bool PlaybackController::ensurePlayerReady(int slotIndex) {
  if (playerForSlot(slotIndex) && m_vlc) {
    return true;
  }

  if (!m_vlc) {
    const char *arguments[] = {
      "--quiet",
      "--no-video-title-show",
      "--http-reconnect",
      "--network-caching=400",
      "--file-caching=300"
    };
    m_vlc = libvlc_new(static_cast<int>(std::size(arguments)), arguments);
    if (!m_vlc) {
      setState(QStringLiteral("error"));
      setLastError(
        flixifyLibVlcRuntimeError().trimmed().isEmpty() ? QStringLiteral("libVLC runtime yuklenemedi.")
                                                        : flixifyLibVlcRuntimeError()
      );
      return false;
    }
  }

  recreatePlayer(slotIndex);
  if (!playerForSlot(slotIndex)) {
    setState(QStringLiteral("error"));
    setLastError(QStringLiteral("libVLC player baslatilamadi."));
    return false;
  }

  return true;
}

bool PlaybackController::ensureAudioOutputReady(libvlc_media_player_t *player) {
  if (!player) {
    return false;
  }

#if defined(Q_OS_WIN)
  static constexpr std::array<const char *, 4> preferredOutputs = {
    "mmdevice",
    "wasapi",
    "directsound",
    "waveout"
  };

  for (const char *outputName : preferredOutputs) {
    if (libvlc_audio_output_set(player, outputName) == 0) {
      return true;
    }
  }
#endif

  return true;
}

void PlaybackController::applyAudioState(libvlc_media_player_t *player, bool recoverOutput) {
  if (!player) {
    return;
  }

  if (recoverOutput) {
    ensureAudioOutputReady(player);
  }

  const double baseVolume = m_muted ? (m_lastAudibleVolume > 0.0 ? m_lastAudibleVolume : 1.0) : m_volume;
  const int targetVolume = qRound(std::clamp(baseVolume, 0.0, 1.0) * 100.0);
  libvlc_audio_set_volume(player, targetVolume);
  libvlc_audio_set_mute(player, m_muted ? 1 : 0);

  if (!m_muted) {
    if (libvlc_audio_get_mute(player) != 0) {
      libvlc_audio_set_mute(player, 0);
    }
    if (targetVolume > 0 && libvlc_audio_get_volume(player) <= 0) {
      libvlc_audio_set_volume(player, targetVolume);
    }
  }
}

void PlaybackController::recreatePlayer(int slotIndex) {
  if (!m_vlc) {
    return;
  }

  if (slotIndex < 0 || slotIndex >= static_cast<int>(m_playerSlots.size())) {
    return;
  }

  PlayerSlotState &slot = slotState(slotIndex);
  if (slot.player) {
    libvlc_media_player_release(slot.player);
  }

  slot.player = libvlc_media_player_new(m_vlc);
  attachPlayerEvents(slotIndex);
  applyAudioState(slot.player, true);
  bindVideoSurface(slotIndex);
}

void PlaybackController::attachPlayerEvents(int slotIndex) {
  libvlc_media_player_t *player = playerForSlot(slotIndex);
  if (!player) {
    return;
  }

  libvlc_event_manager_t *manager = libvlc_media_player_event_manager(player);
  if (!manager) {
    return;
  }
  libvlc_event_attach(manager, libvlc_MediaPlayerPlaying, &PlaybackController::handleVlcEvent, &m_playerEventContexts[slotIndex]);
  libvlc_event_attach(manager, libvlc_MediaPlayerBuffering, &PlaybackController::handleVlcEvent, &m_playerEventContexts[slotIndex]);
  libvlc_event_attach(manager, libvlc_MediaPlayerEncounteredError, &PlaybackController::handleVlcEvent, &m_playerEventContexts[slotIndex]);
  libvlc_event_attach(manager, libvlc_MediaPlayerStopped, &PlaybackController::handleVlcEvent, &m_playerEventContexts[slotIndex]);
  libvlc_event_attach(manager, libvlc_MediaPlayerEndReached, &PlaybackController::handleVlcEvent, &m_playerEventContexts[slotIndex]);
}

void PlaybackController::bindVideoSurface(int slotIndex) {
  const PlayerSlotState &slot = slotState(slotIndex);
  if (!slot.player || slot.surfaceHandle == 0) {
    return;
  }

#if defined(Q_OS_WIN)
  libvlc_media_player_set_hwnd(slot.player, reinterpret_cast<void *>(static_cast<quintptr>(slot.surfaceHandle)));
#elif defined(Q_OS_MACOS)
  libvlc_media_player_set_nsobject(slot.player, reinterpret_cast<void *>(static_cast<quintptr>(slot.surfaceHandle)));
#elif defined(Q_OS_LINUX)
  libvlc_media_player_set_xwindow(slot.player, static_cast<uint32_t>(slot.surfaceHandle));
#endif
}

void PlaybackController::reportPlaybackEvent(
  const QString &event,
  const QString &nativeState,
  const QString &errorCode,
  const QString &errorMessage,
  int slotIndex,
  const QString &channelIdOverride
) {
  if (!m_apiClient || m_activeTarget.itemId.isEmpty()) {
    return;
  }

  const int effectiveSlot = slotIndex >= 0 ? slotIndex : currentPlaybackSlot();
  const PlayerSlotState &slot = slotState(effectiveSlot);
  QJsonObject payload;
  payload.insert(QStringLiteral("event"), event);
  payload.insert(QStringLiteral("clientRuntime"), QStringLiteral("native"));
  payload.insert(QStringLiteral("playerEngine"), QStringLiteral("libvlc"));
  payload.insert(QStringLiteral("decoderMode"), decoderMode());
  payload.insert(QStringLiteral("diagnosticsSessionId"), diagnosticsSessionId());
  payload.insert(
    QStringLiteral("sourceTransport"),
    (slot.lastResolvedSource.isEmpty() ? m_lastResolvedSource : slot.lastResolvedSource).value(QStringLiteral("transport")).toString()
  );
  payload.insert(QStringLiteral("openErrorCode"), errorCode);
  payload.insert(QStringLiteral("nativeState"), nativeState);
  if (!errorMessage.trimmed().isEmpty()) {
    payload.insert(QStringLiteral("errorMessage"), errorMessage);
  }

  if (isActiveVod()) {
    payload.insert(
      QStringLiteral("deliveryMode"),
      (slot.lastResolvedSource.isEmpty() ? m_lastResolvedSource : slot.lastResolvedSource).value(QStringLiteral("deliveryMode")).toString()
    );
    payload.insert(QStringLiteral("audioTrackId"), selectedAudioTrackId());
    payload.insert(QStringLiteral("currentTime"), positionSeconds());
  }

  QJsonObject detail;
  if (slot.requestStartedAt > 0) {
    detail.insert(QStringLiteral("ttffMs"), static_cast<double>(qMax<qint64>(0, nowMs() - slot.requestStartedAt)));
  }
  if (m_liveSwitchRequestedAt > 0 && isActiveLive()) {
    detail.insert(QStringLiteral("switchMs"), static_cast<double>(qMax<qint64>(0, nowMs() - m_liveSwitchRequestedAt)));
  }
  detail.insert(QStringLiteral("fallbackCount"), slot.fallbackCount);
  detail.insert(QStringLiteral("prefetched"), slot.prefetched || slot.sourceFromCache);
  detail.insert(QStringLiteral("rendererBackend"), rendererBackendName());
  detail.insert(QStringLiteral("cacheProfile"), isActiveLive() ? sanitizeLiveCacheProfile(m_liveCacheProfile) : QStringLiteral("vod"));
  detail.insert(QStringLiteral("activeCandidateIndex"), m_candidateIndex);
  payload.insert(QStringLiteral("detail"), detail);

  const QString path = currentPlaybackPath(channelIdOverride);
  if (path.isEmpty()) {
    return;
  }

  QNetworkReply *reply = m_apiClient->network()->post(
    m_apiClient->authorizedRequest(path),
    QJsonDocument(payload).toJson(QJsonDocument::Compact)
  );
  connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
}

void PlaybackController::updateTimeline() {
  libvlc_media_player_t *player = currentPlayer();
  if (!player) {
    return;
  }

  const libvlc_time_t positionMs = libvlc_media_player_get_time(player);
  const libvlc_time_t durationMs = libvlc_media_player_get_length(player);
  setPositionSeconds(positionMs > 0 ? static_cast<double>(positionMs) / 1000.0 : 0.0);
  setDurationSeconds(durationMs > 0 ? static_cast<double>(durationMs) / 1000.0 : 0.0);
  setPaused(libvlc_media_player_is_playing(player) == 0 && state() != QStringLiteral("buffering") &&
            state() != QStringLiteral("opening"));
}

void PlaybackController::resetPlaybackMetrics() {
  m_timelineTimer.stop();
  setPositionSeconds(0.0);
  setDurationSeconds(0.0);
  setPaused(true);
}

void PlaybackController::clearSelectionState() {
  setAudioTracks({});
  setSelectedAudioTrackId(QString());
}

void PlaybackController::refreshRecommendedNextEpisode() {
  if (!m_apiClient || !isActiveVod() || m_activeTarget.kind != QStringLiteral("episode")) {
    setRecommendedNextEpisode({});
    return;
  }

  setRecommendedNextEpisode(m_apiClient->nextEpisodeForEpisode(m_activeTarget.itemId));
}

bool PlaybackController::isActiveLive() const {
  return m_activeTarget.mode == PlaybackMode::Live;
}

bool PlaybackController::isActiveVod() const {
  return m_activeTarget.mode == PlaybackMode::Vod;
}

QString PlaybackController::currentPlaybackPath(const QString &channelIdOverride) const {
  if (isActiveLive()) {
    const QString channelId =
      !channelIdOverride.trimmed().isEmpty() ? channelIdOverride.trimmed() : m_activeChannelId.trimmed();
    if (channelId.isEmpty()) {
      return {};
    }
    return QStringLiteral("/me/live/%1/health").arg(QString::fromUtf8(QUrl::toPercentEncoding(channelId)));
  }

  if (isActiveVod()) {
    return QStringLiteral("/me/vod/%1/%2/health")
      .arg(m_activeTarget.kind, QString::fromUtf8(QUrl::toPercentEncoding(m_activeTarget.itemId)));
  }

  return {};
}

QString PlaybackController::normalizedPlatformName() const {
  return m_apiClient ? m_apiClient->normalizedPlatformName() : QStringLiteral("native-qt");
}

QString PlaybackController::choosePreferredAudioTrackId(
  const QJsonArray &tracks,
  const QString &serverDefault,
  const QString &serverSelected
) const {
  auto containsTrack = [&tracks](const QString &trackId) {
    if (trackId.trimmed().isEmpty()) {
      return false;
    }

    for (const QJsonValue &value : tracks) {
      if (value.toObject().value(QStringLiteral("id")).toString() == trackId) {
        return true;
      }
    }

    return false;
  };

  if (containsTrack(m_requestedAudioTrackId)) {
    return m_requestedAudioTrackId;
  }

  for (const QJsonValue &value : tracks) {
    const QJsonObject track = value.toObject();
    if (looksTurkish(
          track.value(QStringLiteral("language")).toString(),
          track.value(QStringLiteral("title")).toString()
        )) {
      return track.value(QStringLiteral("id")).toString();
    }
  }

  if (containsTrack(serverDefault)) {
    return serverDefault;
  }

  if (containsTrack(serverSelected)) {
    return serverSelected;
  }

  if (!tracks.isEmpty()) {
    return tracks.first().toObject().value(QStringLiteral("id")).toString();
  }

  return {};
}

QVariantList PlaybackController::mapAudioTracks(const QJsonArray &tracks) {
  QVariantList items;
  items.reserve(tracks.size());

  for (const QJsonValue &value : tracks) {
    const QJsonObject track = value.toObject();
    QVariantMap row;
    row.insert(QStringLiteral("id"), track.value(QStringLiteral("id")).toString());
    row.insert(QStringLiteral("language"), track.value(QStringLiteral("language")).toString());
    row.insert(QStringLiteral("title"), track.value(QStringLiteral("title")).toString());
    row.insert(QStringLiteral("channels"), track.value(QStringLiteral("channels")).toInt());
    row.insert(QStringLiteral("isDefault"), track.value(QStringLiteral("isDefault")).toBool());
    items.push_back(row);
  }

  return items;
}

libvlc_media_player_t *PlaybackController::currentPlayer() const {
  return playerForSlot(currentPlaybackSlot());
}

libvlc_media_player_t *PlaybackController::playerForSlot(int slotIndex) const {
  if (slotIndex < 0 || slotIndex >= static_cast<int>(m_playerSlots.size())) {
    return nullptr;
  }
  return m_playerSlots[slotIndex].player;
}

PlaybackController::PlayerSlotState &PlaybackController::slotState(int slotIndex) {
  return m_playerSlots[slotIndex];
}

const PlaybackController::PlayerSlotState &PlaybackController::slotState(int slotIndex) const {
  return m_playerSlots[slotIndex];
}

int PlaybackController::currentPlaybackSlot() const {
  return m_activeVideoSlot;
}

QString PlaybackController::rendererBackendName() const {
  const QString effective = qEnvironmentVariable("FLIXIFY_GRAPHICS_BACKEND_EFFECTIVE").trimmed().toLower();
  if (!effective.isEmpty()) {
    return effective;
  }
  const QString fallback = qEnvironmentVariable("QSG_RHI_BACKEND").trimmed().toLower();
  return fallback.isEmpty() ? QStringLiteral("unknown") : fallback;
}

QString PlaybackController::liveResolvePath(const QString &channelId, bool forceRelayRestart) const {
  QUrl url = m_apiClient->resolvedUrl(
    QStringLiteral("/me/native/live/%1/playback").arg(QString::fromUtf8(QUrl::toPercentEncoding(channelId)))
  );
  QUrlQuery query(url);
  query.addQueryItem(QStringLiteral("platform"), normalizedPlatformName());
  query.addQueryItem(QStringLiteral("clientRuntime"), QStringLiteral("native"));
  query.addQueryItem(QStringLiteral("preferRelay"), QStringLiteral("1"));
  query.addQueryItem(QStringLiteral("cacheProfile"), sanitizeLiveCacheProfile(m_liveCacheProfile));
  if (forceRelayRestart) {
    query.addQueryItem(QStringLiteral("forceRelayRestart"), QStringLiteral("1"));
  }
  url.setQuery(query);
  return url.toString();
}

void PlaybackController::prepareLiveSlot(int slotIndex, const QString &channelId, qint64 requestStartedAt) {
  if (slotIndex < 0 || slotIndex >= static_cast<int>(m_playerSlots.size())) {
    return;
  }

  PlayerSlotState &slot = slotState(slotIndex);
  slot.channelId = channelId;
  slot.requestStartedAt = requestStartedAt > 0 ? requestStartedAt : nowMs();
  slot.fallbackCount = qMax(0, m_candidateIndex);
}

void PlaybackController::activateLiveSlot(int slotIndex) {
  if (slotIndex < 0 || slotIndex >= static_cast<int>(m_playerSlots.size())) {
    return;
  }

  setActiveVideoSlot(slotIndex);
  const PlayerSlotState &slot = slotState(slotIndex);
  if (!slot.channelId.isEmpty()) {
    setActiveChannelId(slot.channelId);
  }
  if (!slot.lastResolvedSource.isEmpty()) {
    m_lastResolvedSource = slot.lastResolvedSource;
    setDiagnosticsSessionId(slot.lastResolvedSource.value(QStringLiteral("diagnosticsSessionId")).toString());
  }
  if (m_delayedStopSlot >= 0 && m_delayedStopSlot != slotIndex) {
    scheduleStopSlot(m_delayedStopSlot);
  }
}

void PlaybackController::scheduleStopSlot(int slotIndex, int delayMs) {
  if (slotIndex < 0 || slotIndex >= static_cast<int>(m_playerSlots.size())) {
    return;
  }
  m_delayedStopSlot = slotIndex;
  m_liveSlotStopTimer.start(qMax(120, delayMs));
}

void PlaybackController::resetLiveSwitchState() {
  m_liveSwitchInProgress = false;
  m_pendingLiveSlot = -1;
  m_liveSwitchRequestedAt = 0;
}

void PlaybackController::clearLiveSourceCache(const QString &channelId) {
  const QString normalizedChannelId = channelId.trimmed();
  if (!normalizedChannelId.isEmpty()) {
    m_liveSourceCache.remove(normalizedChannelId);
    return;
  }

  const qint64 expiresBefore = nowMs();
  for (auto iterator = m_liveSourceCache.begin(); iterator != m_liveSourceCache.end();) {
    if (iterator.value().expiresAt <= expiresBefore) {
      iterator = m_liveSourceCache.erase(iterator);
    } else {
      ++iterator;
    }
  }
}

void PlaybackController::storeLiveSourceCache(const QString &channelId, const QJsonObject &source, bool prefetched) {
  if (channelId.trimmed().isEmpty() || source.value(QStringLiteral("url")).toString().trimmed().isEmpty()) {
    return;
  }

  CachedLiveSource cached;
  cached.source = source;
  cached.expiresAt = nowMs() + kLiveSourceCacheTtlMs;
  cached.cacheProfile = sanitizeLiveCacheProfile(m_liveCacheProfile);
  cached.prefetched = prefetched;
  m_liveSourceCache.insert(channelId.trimmed(), cached);
}

bool PlaybackController::tryOpenCachedLiveSource(const QString &channelId, int slotIndex) {
  clearLiveSourceCache();
  const auto iterator = m_liveSourceCache.constFind(channelId.trimmed());
  if (iterator == m_liveSourceCache.constEnd()) {
    return false;
  }
  if (iterator.value().cacheProfile != sanitizeLiveCacheProfile(m_liveCacheProfile) ||
      iterator.value().expiresAt <= nowMs()) {
    m_liveSourceCache.remove(channelId.trimmed());
    return false;
  }

  openResolvedSource(iterator.value().source, slotIndex, true, iterator.value().prefetched);
  return true;
}

void PlaybackController::prefetchLiveChannel(const QString &channelId) {
  if (!m_apiClient || channelId.trimmed().isEmpty()) {
    return;
  }

  const auto iterator = m_liveSourceCache.constFind(channelId.trimmed());
  if (iterator != m_liveSourceCache.constEnd() &&
      iterator.value().cacheProfile == sanitizeLiveCacheProfile(m_liveCacheProfile) &&
      iterator.value().expiresAt > nowMs()) {
    return;
  }

  QNetworkReply *reply = m_apiClient->network()->get(m_apiClient->authorizedRequest(liveResolvePath(channelId, false)));
  connect(reply, &QNetworkReply::finished, this, [this, reply, channelId]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();
    if (!ok) {
      return;
    }
    storeLiveSourceCache(channelId, QJsonDocument::fromJson(body).object(), true);
  });
}

void PlaybackController::prefetchLiveCandidates() {
  if (!m_apiClient || m_candidates.isEmpty()) {
    return;
  }

  QStringList channelsToPrefetch;
  if (m_candidates.size() > 1) {
    channelsToPrefetch.push_back(m_candidates[1].channelId);
  }

  const QVariantList catalog = m_apiClient->liveChannels();
  int activeIndex = -1;
  for (int index = 0; index < catalog.size(); ++index) {
    if (catalog[index].toMap().value(QStringLiteral("id")).toString() == m_activeChannelId) {
      activeIndex = index;
      break;
    }
  }

  if (activeIndex > 0) {
    channelsToPrefetch.push_back(catalog[activeIndex - 1].toMap().value(QStringLiteral("id")).toString());
  }
  if (activeIndex >= 0 && activeIndex + 1 < catalog.size()) {
    channelsToPrefetch.push_back(catalog[activeIndex + 1].toMap().value(QStringLiteral("id")).toString());
  }

  channelsToPrefetch.removeAll(QString());
  channelsToPrefetch.removeDuplicates();
  for (const QString &channelId : channelsToPrefetch) {
    if (channelId != m_activeChannelId) {
      prefetchLiveChannel(channelId);
    }
  }
}

void PlaybackController::noteLiveIssue(const QString &reason, bool escalateToSafeProfile) {
  if (!isActiveLive()) {
    return;
  }

  const qint64 currentTimeMs = nowMs();
  if (m_liveIssueWindowStartedAt <= 0 || currentTimeMs - m_liveIssueWindowStartedAt > kLiveIssueWindowMs) {
    m_liveIssueWindowStartedAt = currentTimeMs;
    m_liveIssueCount = 0;
  }

  if (!escalateToSafeProfile && m_lastLiveIssueAt > 0 && currentTimeMs - m_lastLiveIssueAt < 1500) {
    return;
  }

  m_lastLiveIssueAt = currentTimeMs;
  m_liveIssueCount += 1;
  if (!reason.trimmed().isEmpty()) {
    setLastError(reason);
  }
}

void PlaybackController::restartActiveLiveWithSafeProfile(const QString &reason) {
  if (!isActiveLive() || sanitizeLiveCacheProfile(m_liveCacheProfile) == QStringLiteral("safe")) {
    return;
  }

  m_liveCacheProfile = QStringLiteral("safe");
  m_forceRelayRestart = true;
  clearLiveSourceCache(!m_activeChannelId.isEmpty() ? m_activeChannelId : m_requestedLiveChannelId);
  if (!reason.trimmed().isEmpty()) {
    setLastError(reason);
  }
  if (!m_activeChannelId.isEmpty()) {
    playChannel(m_activeChannelId);
  }
}

void PlaybackController::handlePlaying(int slotIndex) {
  setBusy(false);
  setLastError(QString());
  setState(QStringLiteral("playing"));
  setPaused(false);
  m_waitingForVideoSurface = false;
  activateLiveSlot(slotIndex);
  applyAudioState(playerForSlot(slotIndex), true);
  if (!m_timelineTimer.isActive()) {
    m_timelineTimer.start();
  }

  updateVideoCrop(slotIndex);

  if (m_pendingResumeSeconds > 0.0 && isActiveVod()) {
    libvlc_media_player_set_time(playerForSlot(slotIndex), static_cast<libvlc_time_t>(m_pendingResumeSeconds * 1000.0));
    m_pendingResumeSeconds = 0.0;
  }

  updateTimeline();

  const bool recovered = m_retryingSoftwareDecode || m_retryingVodResolve || m_candidateIndex > 0;
  if (isActiveLive()) {
    reportPlaybackEvent(
      recovered ? QStringLiteral("recovered") : QStringLiteral("playing"),
      QStringLiteral("playing"),
      QString(),
      QString(),
      slotIndex,
      slotState(slotIndex).channelId
    );
    resetLiveSwitchState();
    prefetchLiveCandidates();
  } else if (isActiveVod() && recovered) {
    reportPlaybackEvent(QStringLiteral("recovered"), QStringLiteral("playing"), QString(), QString(), slotIndex);
  }

  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  m_liveIssueWindowStartedAt = nowMs();
  m_lastLiveIssueAt = 0;
  m_liveIssueCount = 0;
}

void PlaybackController::handleBuffering(int slotIndex, float percent) {
  if (percent < 100.0f) {
    setState(QStringLiteral("buffering"));
    if (isActiveLive() && percent < 5.0f) {
      noteLiveIssue(QStringLiteral("Canli yayin tekrar buffer dolduruyor."), false);
      if (sanitizeLiveCacheProfile(m_liveCacheProfile) != QStringLiteral("safe") && m_liveIssueCount >= 2) {
        restartActiveLiveWithSafeProfile(QStringLiteral("Canli yayin safe profile ile yeniden baslatiliyor."));
      }
    }
  }
  setPaused(false);
  updateTimeline();
}

void PlaybackController::handleEncounteredError(int slotIndex) {
  if (!m_retryingSoftwareDecode && decoderMode() == QStringLiteral("hardware")) {
    retryCurrentSourceInSoftwareMode(QStringLiteral("Hardware decode fallback tetiklendi."));
    return;
  }

  if (isActiveVod()) {
    retryResolvedVodSource(QStringLiteral("libVLC VOD akisini acamadi."));
    return;
  }

  noteLiveIssue(QStringLiteral("Canli yayin fallback tetiklendi."), true);
  if (sanitizeLiveCacheProfile(m_liveCacheProfile) != QStringLiteral("safe") && m_liveIssueCount >= 2) {
    restartActiveLiveWithSafeProfile(QStringLiteral("Canli yayin safe profile ile yeniden baslatiliyor."));
    return;
  }
  advanceToNextCandidate(QStringLiteral("Kanal sonraki sibling varyanta dusuruldu."));
}

void PlaybackController::handleStopped(int slotIndex) {
  if (state() == QStringLiteral("idle")) {
    return;
  }

  m_timelineTimer.stop();
  setPaused(true);
  setState(QStringLiteral("stopped"));
}

void PlaybackController::handleEndReached(int slotIndex) {
  if (isActiveLive()) {
    noteLiveIssue(QStringLiteral("Canli yayin sona erdi."), true);
    advanceToNextCandidate(QStringLiteral("Canli yayin sona erdi."));
    return;
  }

  m_timelineTimer.stop();
  setPaused(true);
  setState(QStringLiteral("ended"));
  if (durationSeconds() > 0.0) {
    setPositionSeconds(durationSeconds());
  }
  refreshRecommendedNextEpisode();
}

void PlaybackController::handleVlcEvent(const libvlc_event_t *event, void *opaque) {
  auto *context = static_cast<PlayerSlotContext *>(opaque);
  if (!context || !context->controller) {
    return;
  }

  auto *self = context->controller;
  const int slotIndex = context->slotIndex;

  switch (event->type) {
    case libvlc_MediaPlayerPlaying:
      QMetaObject::invokeMethod(self, [self, slotIndex]() { self->handlePlaying(slotIndex); }, Qt::QueuedConnection);
      break;
    case libvlc_MediaPlayerBuffering: {
      const float percent = event->u.media_player_buffering.new_cache;
      QMetaObject::invokeMethod(
        self,
        [self, slotIndex, percent]() { self->handleBuffering(slotIndex, percent); },
        Qt::QueuedConnection
      );
      break;
    }
    case libvlc_MediaPlayerEncounteredError:
      QMetaObject::invokeMethod(
        self,
        [self, slotIndex]() { self->handleEncounteredError(slotIndex); },
        Qt::QueuedConnection
      );
      break;
    case libvlc_MediaPlayerStopped:
      QMetaObject::invokeMethod(self, [self, slotIndex]() { self->handleStopped(slotIndex); }, Qt::QueuedConnection);
      break;
    case libvlc_MediaPlayerEndReached:
      QMetaObject::invokeMethod(self, [self, slotIndex]() { self->handleEndReached(slotIndex); }, Qt::QueuedConnection);
      break;
    default:
      break;
  }
}
