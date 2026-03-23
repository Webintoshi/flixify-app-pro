#include "playback_controller.h"

#include "api_client.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkReply>
#include <QUrl>
#include <QUrlQuery>
#include <QtGlobal>
#include <algorithm>
#include <cstdint>

namespace {

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

}

PlaybackController::PlaybackController(ApiClient *apiClient, QObject *parent)
  : QObject(parent), m_apiClient(apiClient) {
  m_timelineTimer.setInterval(500);
  connect(&m_timelineTimer, &QTimer::timeout, this, &PlaybackController::updateTimeline);
}

PlaybackController::~PlaybackController() {
  stop();
  if (m_player) {
    libvlc_media_player_release(m_player);
    m_player = nullptr;
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
  setRecommendedNextEpisode({});
  clearSelectionState();
  resetPlaybackMetrics();
  m_pendingResumeSeconds = 0.0;
  m_lastResolvedSource = QJsonObject();
  m_requestedAudioTrackId.clear();
  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  m_autoSelectingPreferredAudioTrack = false;
  setLastError(QString());
  setDecoderMode(QStringLiteral("hardware"));

  m_candidates = buildCandidateQueue(normalizedChannelId);
  if (m_candidates.isEmpty()) {
    failActiveTarget(QStringLiteral("Secilen kanal native katalogda bulunamadi."), QStringLiteral("channel-not-found"));
    return;
  }

  m_candidateIndex = -1;
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
  clearSelectionState();
  resetPlaybackMetrics();
  m_pendingResumeSeconds = 0.0;
  setRecommendedNextEpisode({});
  m_lastResolvedSource = QJsonObject();
  m_requestedAudioTrackId.clear();
  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  m_autoSelectingPreferredAudioTrack = false;
  setLastError(QString());
  setDecoderMode(QStringLiteral("hardware"));

  resolveVodSource();
}

void PlaybackController::retryCurrent() {
  if (isActiveLive() && !m_activeChannelId.isEmpty()) {
    playChannel(m_activeChannelId);
    return;
  }

  if (isActiveVod() && !m_activeTarget.itemId.isEmpty()) {
    playVod(m_activeTarget.kind, m_activeTarget.itemId, m_activeTarget.title);
  }
}

void PlaybackController::stop() {
  m_timelineTimer.stop();
  if (m_player) {
    libvlc_media_player_stop(m_player);
  }
  m_lastResolvedSource = QJsonObject();
  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
  m_autoSelectingPreferredAudioTrack = false;
  m_pendingResumeSeconds = 0.0;
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

  if (m_player) {
    libvlc_audio_set_volume(m_player, qRound(normalized * 100.0));
    libvlc_audio_set_mute(m_player, normalized <= 0.0 ? 1 : 0);
  }

  setVolumeLevel(normalized);
  setMuted(normalized <= 0.0);
}

void PlaybackController::toggleMuted() {
  const bool nextMuted = !m_muted;
  if (nextMuted) {
    if (m_volume > 0.0) {
      m_lastAudibleVolume = m_volume;
    }
    if (m_player) {
      libvlc_audio_set_mute(m_player, 1);
    }
    setVolumeLevel(0.0);
    setMuted(true);
    return;
  }

  const double restoredVolume = m_lastAudibleVolume > 0.0 ? m_lastAudibleVolume : 1.0;
  if (m_player) {
    libvlc_audio_set_volume(m_player, qRound(restoredVolume * 100.0));
    libvlc_audio_set_mute(m_player, 0);
  }
  setVolumeLevel(restoredVolume);
  setMuted(false);
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

void PlaybackController::setVideoSurfaceHandle(qulonglong handle) {
  if (handle == m_videoSurfaceHandle) {
    return;
  }

  m_videoSurfaceHandle = handle;
  bindVideoSurface();
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

  const QString path = QStringLiteral("/me/native/live/%1/playback")
                         .arg(QString::fromUtf8(QUrl::toPercentEncoding(m_candidates[index].channelId)));
  const int requestedIndex = index;
  QNetworkReply *reply = m_apiClient->network()->get(m_apiClient->authorizedRequest(path));
  connect(reply, &QNetworkReply::finished, this, [this, reply, requestedIndex]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    const bool authFailed = isAuthStatusCode(reply);
    reply->deleteLater();

    if (!ok) {
      if (authFailed && m_apiClient) {
        m_apiClient->refreshSession([this, requestedIndex](bool success) {
          if (success) {
            resolveCandidateAt(requestedIndex);
            return;
          }
          failActiveTarget(QStringLiteral("Oturum suresi doldu. Lutfen tekrar giris yapin."), QStringLiteral("auth-expired"));
        });
        return;
      }

      const QString message = extractReplyMessage(body, QStringLiteral("Native playback source resolve failed."));
      reportPlaybackEvent(QStringLiteral("failed"), QStringLiteral("resolve-failed"), QStringLiteral("resolve-error"), message);
      advanceToNextCandidate(message);
      return;
    }

    openResolvedSource(QJsonDocument::fromJson(body).object());
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
      openResolvedSource(source);
      return;
    }

    m_autoSelectingPreferredAudioTrack = true;
    m_requestedAudioTrackId = preferredAudioTrackId;
    resolveVodSource(preferredAudioTrackId);
  });
}

void PlaybackController::openResolvedSource(const QJsonObject &source) {
  if (!ensurePlayerReady()) {
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

  m_lastResolvedSource = source;
  setDiagnosticsSessionId(source.value(QStringLiteral("diagnosticsSessionId")).toString());
  setState(QStringLiteral("opening"));

  libvlc_media_t *media = libvlc_media_new_location(m_vlc, url.toUtf8().constData());
  if (!media) {
    if (isActiveVod()) {
      retryResolvedVodSource(QStringLiteral("libVLC medya nesnesi olusturulamadi."));
      return;
    }
    advanceToNextCandidate(QStringLiteral("libVLC medya nesnesi olusturulamadi."));
    return;
  }

  addMediaOption(media, QStringLiteral(":network-caching=1200"));
  addMediaOption(media, QStringLiteral(":file-caching=1000"));
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

  libvlc_media_player_set_media(m_player, media);
  libvlc_media_release(media);
  bindVideoSurface();

  if (libvlc_media_player_play(m_player) != 0) {
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

  setBusy(false);
  setPaused(false);
}

void PlaybackController::advanceToNextCandidate(const QString &reason) {
  setLastError(reason);
  if (m_candidateIndex + 1 < m_candidates.size()) {
    m_retryingSoftwareDecode = false;
    setDecoderMode(QStringLiteral("hardware"));
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
  setState(QStringLiteral("error"));
  reportPlaybackEvent(
    isActiveVod() ? QStringLiteral("playback-failed") : QStringLiteral("failed"),
    QStringLiteral("terminal-failure"),
    errorCode,
    reason
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
  openResolvedSource(m_lastResolvedSource);
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

bool PlaybackController::ensurePlayerReady() {
  if (m_player && m_vlc) {
    return true;
  }

  if (!m_vlc) {
    const char *arguments[] = {
      "--quiet",
      "--no-video-title-show",
      "--http-reconnect",
      "--network-caching=1200",
      "--file-caching=1000"
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

  recreatePlayer();
  if (!m_player) {
    setState(QStringLiteral("error"));
    setLastError(QStringLiteral("libVLC player baslatilamadi."));
    return false;
  }

  return true;
}

void PlaybackController::recreatePlayer() {
  if (!m_vlc) {
    return;
  }

  if (m_player) {
    libvlc_media_player_release(m_player);
  }

  m_player = libvlc_media_player_new(m_vlc);
  attachPlayerEvents();
  if (m_player) {
    const double baseVolume = m_muted ? (m_lastAudibleVolume > 0.0 ? m_lastAudibleVolume : 1.0) : m_volume;
    libvlc_audio_set_volume(m_player, qRound(std::clamp(baseVolume, 0.0, 1.0) * 100.0));
    libvlc_audio_set_mute(m_player, m_muted ? 1 : 0);
  }
  bindVideoSurface();
}

void PlaybackController::attachPlayerEvents() {
  if (!m_player) {
    return;
  }

  libvlc_event_manager_t *manager = libvlc_media_player_event_manager(m_player);
  if (!manager) {
    return;
  }
  libvlc_event_attach(manager, libvlc_MediaPlayerPlaying, &PlaybackController::handleVlcEvent, this);
  libvlc_event_attach(manager, libvlc_MediaPlayerBuffering, &PlaybackController::handleVlcEvent, this);
  libvlc_event_attach(manager, libvlc_MediaPlayerEncounteredError, &PlaybackController::handleVlcEvent, this);
  libvlc_event_attach(manager, libvlc_MediaPlayerStopped, &PlaybackController::handleVlcEvent, this);
  libvlc_event_attach(manager, libvlc_MediaPlayerEndReached, &PlaybackController::handleVlcEvent, this);
}

void PlaybackController::bindVideoSurface() {
  if (!m_player || m_videoSurfaceHandle == 0) {
    return;
  }

#if defined(Q_OS_WIN)
  libvlc_media_player_set_hwnd(m_player, reinterpret_cast<void *>(static_cast<quintptr>(m_videoSurfaceHandle)));
#elif defined(Q_OS_MACOS)
  libvlc_media_player_set_nsobject(m_player, reinterpret_cast<void *>(static_cast<quintptr>(m_videoSurfaceHandle)));
#elif defined(Q_OS_LINUX)
  libvlc_media_player_set_xwindow(m_player, static_cast<uint32_t>(m_videoSurfaceHandle));
#endif
}

void PlaybackController::reportPlaybackEvent(
  const QString &event,
  const QString &nativeState,
  const QString &errorCode,
  const QString &errorMessage
) {
  if (!m_apiClient || m_activeTarget.itemId.isEmpty()) {
    return;
  }

  QJsonObject payload;
  payload.insert(QStringLiteral("event"), event);
  payload.insert(QStringLiteral("clientRuntime"), QStringLiteral("native"));
  payload.insert(QStringLiteral("playerEngine"), QStringLiteral("libvlc"));
  payload.insert(QStringLiteral("decoderMode"), decoderMode());
  payload.insert(QStringLiteral("diagnosticsSessionId"), diagnosticsSessionId());
  payload.insert(QStringLiteral("sourceTransport"), m_lastResolvedSource.value(QStringLiteral("transport")).toString());
  payload.insert(QStringLiteral("openErrorCode"), errorCode);
  payload.insert(QStringLiteral("nativeState"), nativeState);
  if (!errorMessage.trimmed().isEmpty()) {
    payload.insert(QStringLiteral("errorMessage"), errorMessage);
  }

  if (isActiveVod()) {
    payload.insert(QStringLiteral("deliveryMode"), m_lastResolvedSource.value(QStringLiteral("deliveryMode")).toString());
    payload.insert(QStringLiteral("audioTrackId"), selectedAudioTrackId());
    payload.insert(QStringLiteral("currentTime"), positionSeconds());
  }

  const QString path = currentPlaybackPath();
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
  if (!m_player) {
    return;
  }

  const libvlc_time_t positionMs = libvlc_media_player_get_time(m_player);
  const libvlc_time_t durationMs = libvlc_media_player_get_length(m_player);
  setPositionSeconds(positionMs > 0 ? static_cast<double>(positionMs) / 1000.0 : 0.0);
  setDurationSeconds(durationMs > 0 ? static_cast<double>(durationMs) / 1000.0 : 0.0);
  setPaused(libvlc_media_player_is_playing(m_player) == 0 && state() != QStringLiteral("buffering") &&
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

QString PlaybackController::currentPlaybackPath() const {
  if (isActiveLive()) {
    if (m_activeChannelId.isEmpty()) {
      return {};
    }
    return QStringLiteral("/me/live/%1/health")
      .arg(QString::fromUtf8(QUrl::toPercentEncoding(m_activeChannelId)));
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

void PlaybackController::handlePlaying() {
  setBusy(false);
  setLastError(QString());
  setState(QStringLiteral("playing"));
  setPaused(false);
  if (!m_timelineTimer.isActive()) {
    m_timelineTimer.start();
  }

  if (m_pendingResumeSeconds > 0.0 && isActiveVod()) {
    libvlc_media_player_set_time(m_player, static_cast<libvlc_time_t>(m_pendingResumeSeconds * 1000.0));
    m_pendingResumeSeconds = 0.0;
  }

  updateTimeline();

  const bool recovered = m_retryingSoftwareDecode || m_retryingVodResolve || m_candidateIndex > 0;
  if (isActiveLive()) {
    reportPlaybackEvent(
      recovered ? QStringLiteral("recovered") : QStringLiteral("playing"),
      QStringLiteral("playing"),
      QString(),
      QString()
    );
  } else if (isActiveVod() && recovered) {
    reportPlaybackEvent(QStringLiteral("recovered"), QStringLiteral("playing"), QString(), QString());
  }

  m_retryingSoftwareDecode = false;
  m_retryingVodResolve = false;
}

void PlaybackController::handleBuffering(float percent) {
  if (percent < 100.0f) {
    setState(QStringLiteral("buffering"));
  }
  setPaused(false);
  updateTimeline();
}

void PlaybackController::handleEncounteredError() {
  if (!m_retryingSoftwareDecode && decoderMode() == QStringLiteral("hardware")) {
    retryCurrentSourceInSoftwareMode(QStringLiteral("Hardware decode fallback tetiklendi."));
    return;
  }

  if (isActiveVod()) {
    retryResolvedVodSource(QStringLiteral("libVLC VOD akisini acamadi."));
    return;
  }

  advanceToNextCandidate(QStringLiteral("Kanal sonraki sibling varyanta dusuruldu."));
}

void PlaybackController::handleStopped() {
  if (state() == QStringLiteral("idle")) {
    return;
  }

  m_timelineTimer.stop();
  setPaused(true);
  setState(QStringLiteral("stopped"));
}

void PlaybackController::handleEndReached() {
  m_timelineTimer.stop();
  setPaused(true);
  setState(QStringLiteral("ended"));
  if (durationSeconds() > 0.0) {
    setPositionSeconds(durationSeconds());
  }
  refreshRecommendedNextEpisode();
}

void PlaybackController::handleVlcEvent(const libvlc_event_t *event, void *opaque) {
  auto *self = static_cast<PlaybackController *>(opaque);
  if (!self) {
    return;
  }

  switch (event->type) {
    case libvlc_MediaPlayerPlaying:
      QMetaObject::invokeMethod(self, [self]() { self->handlePlaying(); }, Qt::QueuedConnection);
      break;
    case libvlc_MediaPlayerBuffering: {
      const float percent = event->u.media_player_buffering.new_cache;
      QMetaObject::invokeMethod(self, [self, percent]() { self->handleBuffering(percent); }, Qt::QueuedConnection);
      break;
    }
    case libvlc_MediaPlayerEncounteredError:
      QMetaObject::invokeMethod(self, [self]() { self->handleEncounteredError(); }, Qt::QueuedConnection);
      break;
    case libvlc_MediaPlayerStopped:
      QMetaObject::invokeMethod(self, [self]() { self->handleStopped(); }, Qt::QueuedConnection);
      break;
    case libvlc_MediaPlayerEndReached:
      QMetaObject::invokeMethod(self, [self]() { self->handleEndReached(); }, Qt::QueuedConnection);
      break;
    default:
      break;
  }
}
