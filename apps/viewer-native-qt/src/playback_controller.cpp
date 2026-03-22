#include "playback_controller.h"

#include "api_client.h"

#include <QJsonDocument>
#include <QNetworkReply>
#include <QUrl>
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

void addMediaOption(libvlc_media_t *media, const QString &value) {
  if (!media || value.trimmed().isEmpty()) {
    return;
  }

  const QByteArray bytes = value.toUtf8();
  libvlc_media_add_option(media, bytes.constData());
}

}

PlaybackController::PlaybackController(ApiClient *apiClient, QObject *parent)
  : QObject(parent), m_apiClient(apiClient) {
  const char *arguments[] = {
    "--quiet",
    "--no-video-title-show",
    "--http-reconnect",
    "--network-caching=1200",
    "--file-caching=1000"
  };
  m_vlc = libvlc_new(static_cast<int>(std::size(arguments)), arguments);
  recreatePlayer();
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

QString PlaybackController::diagnosticsSessionId() const {
  return m_diagnosticsSessionId;
}

QString PlaybackController::decoderMode() const {
  return m_decoderMode;
}

bool PlaybackController::busy() const {
  return m_busy;
}

void PlaybackController::playChannel(const QString &channelId) {
  m_candidates = buildCandidateQueue(channelId);
  if (m_candidates.isEmpty()) {
    setLastError(QStringLiteral("Secilen kanal native katalogda bulunamadi."));
    setState(QStringLiteral("error"));
    return;
  }

  m_candidateIndex = -1;
  m_retryingSoftwareDecode = false;
  setLastError(QString());
  setDecoderMode(QStringLiteral("hardware"));
  resolveCandidateAt(0);
}

void PlaybackController::retryCurrent() {
  if (!m_activeChannelId.isEmpty()) {
    playChannel(m_activeChannelId);
  }
}

void PlaybackController::stop() {
  if (m_player) {
    libvlc_media_player_stop(m_player);
  }
  m_lastResolvedSource = QJsonObject();
  setBusy(false);
  setState(QStringLiteral("idle"));
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
      candidate.qualityRank = map.value(QStringLiteral("qualityRank")).toInt(-1);
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

  const QString path = QStringLiteral("/me/native/live/%1/playback")
                         .arg(QString::fromUtf8(QUrl::toPercentEncoding(m_candidates[index].channelId)));
  QNetworkReply *reply = m_apiClient->network()->get(m_apiClient->authorizedRequest(path));
  connect(reply, &QNetworkReply::finished, this, [this, reply]() {
    const QByteArray body = reply->readAll();
    const bool ok = reply->error() == QNetworkReply::NoError;
    reply->deleteLater();

    if (!ok) {
      const QString message = extractReplyMessage(body, QStringLiteral("Native playback source resolve failed."));
      reportPlaybackEvent(QStringLiteral("failed"), QStringLiteral("resolve-failed"), QStringLiteral("resolve-error"), message);
      advanceToNextCandidate(message);
      return;
    }

    openResolvedSource(QJsonDocument::fromJson(body).object());
  });
}

void PlaybackController::openResolvedSource(const QJsonObject &source) {
  if (!m_player || !m_vlc) {
    setLastError(QStringLiteral("libVLC player baslatilamadi."));
    setState(QStringLiteral("error"));
    setBusy(false);
    return;
  }

  m_lastResolvedSource = source;
  setDiagnosticsSessionId(source.value(QStringLiteral("diagnosticsSessionId")).toString());
  setState(QStringLiteral("opening"));

  const QString url = source.value(QStringLiteral("url")).toString();
  libvlc_media_t *media = libvlc_media_new_location(m_vlc, url.toUtf8().constData());
  if (!media) {
    advanceToNextCandidate(QStringLiteral("libVLC medya nesnesi olusturulamadi."));
    return;
  }

  addMediaOption(media, QStringLiteral(":network-caching=1200"));
  addMediaOption(media, QStringLiteral(":live-caching=1200"));
  addMediaOption(media, decoderMode() == QStringLiteral("hardware")
                           ? QStringLiteral(":avcodec-hw=any")
                           : QStringLiteral(":avcodec-hw=none"));

  const QString userAgent = source.value(QStringLiteral("userAgent")).toString().trimmed();
  if (!userAgent.isEmpty()) {
    addMediaOption(media, QStringLiteral(":http-user-agent=%1").arg(userAgent));
  }

  const QString cookie = source.value(QStringLiteral("cookie")).toString().trimmed();
  if (!cookie.isEmpty()) {
    addMediaOption(media, QStringLiteral(":http-cookie=%1").arg(cookie));
  }

  const QJsonObject headers = source.value(QStringLiteral("headers")).toObject();
  const QString referer = headers.value(QStringLiteral("Referer")).toString().trimmed();
  if (!referer.isEmpty()) {
    addMediaOption(media, QStringLiteral(":http-referrer=%1").arg(referer));
  }

  libvlc_media_player_set_media(m_player, media);
  libvlc_media_release(media);
  bindVideoSurface();

  if (libvlc_media_player_play(m_player) != 0) {
    if (!m_retryingSoftwareDecode && decoderMode() == QStringLiteral("hardware")) {
      retryCurrentSourceInSoftwareMode(QStringLiteral("Hardware decode open basarisiz."));
      return;
    }

    advanceToNextCandidate(QStringLiteral("libVLC medya oynatici acilamadi."));
    return;
  }

  setBusy(false);
}

void PlaybackController::advanceToNextCandidate(const QString &reason) {
  setLastError(reason);
  if (m_candidateIndex + 1 < m_candidates.size()) {
    m_retryingSoftwareDecode = false;
    setDecoderMode(QStringLiteral("hardware"));
    resolveCandidateAt(m_candidateIndex + 1);
    return;
  }

  setBusy(false);
  setState(QStringLiteral("error"));
}

void PlaybackController::retryCurrentSourceInSoftwareMode(const QString &reason) {
  if (m_lastResolvedSource.isEmpty()) {
    advanceToNextCandidate(reason);
    return;
  }

  m_retryingSoftwareDecode = true;
  setDecoderMode(QStringLiteral("software"));
  setLastError(reason);
  openResolvedSource(m_lastResolvedSource);
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
  bindVideoSurface();
}

void PlaybackController::attachPlayerEvents() {
  if (!m_player) {
    return;
  }

  libvlc_event_manager_t *manager = libvlc_media_player_event_manager(m_player);
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
  if (!m_apiClient || activeChannelId().isEmpty()) {
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

  const QString path = QStringLiteral("/me/live/%1/health")
                         .arg(QString::fromUtf8(QUrl::toPercentEncoding(activeChannelId())));
  QNetworkReply *reply = m_apiClient->network()->post(
    m_apiClient->authorizedRequest(path),
    QJsonDocument(payload).toJson(QJsonDocument::Compact)
  );
  connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
}

void PlaybackController::handlePlaying() {
  setBusy(false);
  setLastError(QString());
  const bool recovered = m_retryingSoftwareDecode || m_candidateIndex > 0;
  setState(QStringLiteral("playing"));
  reportPlaybackEvent(
    recovered ? QStringLiteral("recovered") : QStringLiteral("playing"),
    QStringLiteral("playing"),
    QString(),
    QString()
  );
}

void PlaybackController::handleBuffering(float percent) {
  if (percent < 100.0f) {
    setState(QStringLiteral("buffering"));
  }
}

void PlaybackController::handleEncounteredError() {
  reportPlaybackEvent(
    QStringLiteral("failed"),
    QStringLiteral("encountered-error"),
    QStringLiteral("libvlc-error"),
    QStringLiteral("libVLC akisi acamadi.")
  );

  if (!m_retryingSoftwareDecode && decoderMode() == QStringLiteral("hardware")) {
    retryCurrentSourceInSoftwareMode(QStringLiteral("Hardware decode fallback tetiklendi."));
    return;
  }

  advanceToNextCandidate(QStringLiteral("Kanal sonraki sibling varyanta dusuruldu."));
}

void PlaybackController::handleStopped() {
  setState(QStringLiteral("stopped"));
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
    case libvlc_MediaPlayerEndReached:
      QMetaObject::invokeMethod(self, [self]() { self->handleStopped(); }, Qt::QueuedConnection);
      break;
    default:
      break;
  }
}
