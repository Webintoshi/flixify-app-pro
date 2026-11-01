#include "player.h"
#include "vlc_runtime.h"
#include <QDateTime>
#include <QFileInfo>
#include <QPointer>
#include <QRegularExpression>
#include <QUrl>
#include <QtConcurrent/QtConcurrentRun>
#include <array>

namespace {
constexpr std::array<int, 5> vlcEvents{0x102, 0x104, 0x105, 0x109, 0x10a};
qint64 now() { return QDateTime::currentMSecsSinceEpoch(); }
}

struct DesktopPlayer::Session {
  VlcRuntime *runtime = nullptr;
  libvlc_instance_t *engine = nullptr;
  libvlc_media_player_t *player = nullptr;
  QPointer<DesktopPlayer> owner;
  quint64 generation = 0;
  static void event(const libvlc_event_t *event, void *opaque) {
    auto *self = static_cast<Session *>(opaque);
    const auto owner = self->owner;
    const auto generation = self->generation;
    const int type = event->type;
    if (owner) QMetaObject::invokeMethod(owner, [owner, generation, type] {
      if (owner) owner->onVlcEvent(generation, type);
    }, Qt::QueuedConnection);
  }
  void dispose() {
    if (player) {
      auto *manager = runtime->events(player);
      for (int event : vlcEvents) runtime->detach(manager, event, &Session::event, this);
      runtime->stop(player);
      runtime->releasePlayer(player); player = nullptr;
    }
    if (engine) { runtime->release(engine); engine = nullptr; }
  }
  ~Session() { dispose(); }
};

DesktopPlayer::DesktopPlayer(QObject *parent, bool allowTestMedia) : QObject(parent), allowTestMedia_(allowTestMedia) {
  timer_.setInterval(250);
  connect(&timer_, &QTimer::timeout, this, &DesktopPlayer::tick);
  connect(&stopping_, &QFutureWatcher<void>::finished, this, &DesktopPlayer::startPending);
  timer_.start();
}
DesktopPlayer::~DesktopPlayer() {
  timer_.stop(); pending_.clear(); active_ = false; ++generation_;
  if (session_) { session_->dispose(); session_.reset(); }
  stopping_.waitForFinished();
}
QString DesktopPlayer::key(const QVariantMap &item) {
  return item.value("kind").toString() + ":" + item.value("seriesID").toString() + ":" + item.value("id").toString();
}
Playback::Episode DesktopPlayer::episode(const QVariantMap &item) {
  return {item.value("scope").toString().toStdString(), item.value("seriesID").toString().toStdString(),
          item.value("id").toString().toStdString(), item.value("season").toInt(), item.value("episode").toInt()};
}
bool DesktopPlayer::eligible() const { return active_ && !scope_.isEmpty() && expiry_ > now(); }

void DesktopPlayer::open(const QVariantMap &media) {
  const auto item = media.value("item").toMap();
  const QString kind = item.value("kind").toString(), scope = media.value("scope").toString();
  const qint64 expiry = media.value("expiresAt").toLongLong();
  const QUrl url(media.value("url").toString(), QUrl::StrictMode);
  const bool fixtureFile = allowTestMedia_ && url.isLocalFile() && QFileInfo(url.toLocalFile()).isFile();
  if (!url.isValid() || (!fixtureFile && url.scheme() != "http" && url.scheme() != "https") ||
      (!fixtureFile && url.host().isEmpty()) || !url.userInfo().isEmpty() || !url.fragment().isEmpty() ||
      scope.isEmpty() || item.value("scope").toString() != scope || expiry <= now() ||
      (kind != "live" && kind != "movie" && kind != "episode") || item.value("id").toString().isEmpty()) {
    if (active_) fail(QStringLiteral("İzleme erişimi doğrulanamadı."));
    return;
  }
  const bool refresh = awaitingRefresh_ && active_ && key(item) == key(item_) && scope == scope_;
  if (refresh) {
    if (!recovery_ || !recovery_->admit(scope.toStdString(), key(item).toStdString(), expiry, now())) {
      fail(QStringLiteral("İzleme erişimin sona erdi.")); return;
    }
  } else {
    if (active_) emit progress(item_, position_, duration_, false);
    recovery_ = std::make_unique<Playback::Recovery>(scope.toStdString(), key(item).toStdString(), expiry);
    hasFrame_ = false; position_ = 0; duration_ = 0; held_ = 0;
  }
  ++generation_; releaseCurrent();
  media_ = media; pending_ = media; item_ = item; next_ = media.value("next").toMap(); scope_ = scope; expiry_ = expiry;
  resume_ = refresh && !live() ? position_ : std::max<qint64>(0, media.value("resumeMs").toLongLong());
  awaitingRefresh_ = false; error_.clear(); ended_ = false; wantsPlay_ = true;
  active_ = true; playing_ = false; loading_ = !hasFrame_; controls_ = true;
  countdown_ = Playback::NextEpisode(); nextCountdown_ = 0; audioTracks_.clear(); subtitleTracks_.clear();
  interactionAt_ = startedAt_ = progressedAt_ = now(); savedAt_ = 0; tracksAt_ = 0;
  emit stateChanged(); startPending();
}
void DesktopPlayer::releaseCurrent() {
  if (!session_) return;
  auto old = std::move(session_);
  stopping_.setFuture(QtConcurrent::run([old] { old->dispose(); }));
}
void DesktopPlayer::startPending() {
  if (!active_ || pending_.isEmpty() || !surface_ || stopping_.isRunning()) return;
  if (!eligible()) { fail(QStringLiteral("İzleme erişimin sona erdi.")); return; }
  auto &runtime = VlcRuntime::instance();
  if (!runtime.ready()) { fail(runtime.error()); return; }
  qputenv("VLC_PLUGIN_PATH", runtime.plugins().toUtf8());
  const char *args[] = {"--no-video-title-show", "--no-osd", "--no-media-library", "--quiet", "--no-lua"};
  auto session = std::make_shared<Session>(); session->runtime = &runtime;
  session->engine = runtime.create(int(std::size(args)), args);
  if (!session->engine) { fail(QStringLiteral("Video motoru başlatılamadı.")); return; }
  session->player = runtime.player(session->engine);
  if (!session->player) { fail(QStringLiteral("Oynatıcı başlatılamadı.")); return; }
  const QUrl url(pending_.value("url").toString());
  const auto encoded = url.toEncoded();
  auto *media = runtime.media(session->engine, encoded.constData());
  if (!media) { fail(QStringLiteral("İçerik açılamadı.")); return; }
  runtime.addOption(media, live() ? ":network-caching=1000" : ":network-caching=1500");
  runtime.addOption(media, ":avcodec-hw=any");
  runtime.addOption(media, ":http-reconnect");
  runtime.setMedia(session->player, media); runtime.releaseMedia(media);
#if defined(Q_OS_WIN)
  runtime.setHwnd(session->player, reinterpret_cast<void *>(quintptr(surface_)));
#elif defined(Q_OS_MACOS)
  runtime.setNSObject(session->player, reinterpret_cast<void *>(quintptr(surface_)));
#else
  runtime.setXWindow(session->player, quint32(surface_));
#endif
  session->owner = this; session->generation = generation_;
  auto *manager = runtime.events(session->player);
  for (int event : vlcEvents) runtime.attach(manager, event, &Session::event, session.get());
  runtime.setVolume(session->player, volume_); runtime.setMute(session->player, muted_ ? 1 : 0);
  session_ = std::move(session); pending_.clear(); startedAt_ = progressedAt_ = now();
  if (runtime.play(session_->player) != 0) recover(Playback::Trigger::DecoderError);
}
void DesktopPlayer::close() {
  if (active_ && !item_.isEmpty()) emit progress(item_, position_, duration_, false);
  active_ = false; wantsPlay_ = false; playing_ = false; loading_ = false; controls_ = true;
  awaitingRefresh_ = false; ++generation_; pending_.clear(); countdown_.cancel(); nextCountdown_ = 0;
  if (recovery_) recovery_->stop();
  releaseCurrent(); media_.clear(); item_.clear(); next_.clear(); scope_.clear(); error_.clear();
  audioTracks_.clear(); subtitleTracks_.clear(); hasFrame_ = false; held_ = 0;
  emit stateChanged();
}
void DesktopPlayer::fail(const QString &message) {
  ++generation_; pending_.clear(); awaitingRefresh_ = false; wantsPlay_ = false;
  playing_ = false; loading_ = false; error_ = message; controls_ = true;
  countdown_.cancel(); nextCountdown_ = 0;
  if (recovery_) recovery_->stop();
  releaseCurrent(); emit stateChanged();
}
void DesktopPlayer::recover(Playback::Trigger trigger) {
  if (!Playback::Recovery::recovers(trigger, live()) || awaitingRefresh_) return;
  if (!eligible() || !recovery_ || !recovery_->claim(scope_.toStdString(), key(item_).toStdString(), now())) {
    fail(QStringLiteral("Yayın açılamadı. Daha sonra tekrar deneyebilirsin.")); return;
  }
  awaitingRefresh_ = true; playing_ = false; loading_ = !hasFrame_; ++generation_;
  releaseCurrent(); startedAt_ = now();
  emit stateChanged(); emit refreshRequested(item_);
}
void DesktopPlayer::onVlcEvent(quint64 generation, int event) {
  if (!active_ || !session_ || generation != generation_) return;
  if (!eligible()) { fail(QStringLiteral("İzleme erişimin sona erdi.")); return; }
  if (event == 0x104) { playing_ = true; loading_ = false; progressedAt_ = now(); }
  else if (event == 0x105) { playing_ = false; controls_ = true; }
  else if (event == 0x10a) { recover(Playback::Trigger::DecoderError); return; }
  else if (event == 0x109) {
    if (live()) { recover(Playback::Trigger::Ended); return; }
    const qint64 finalTime = session_->runtime->time(session_->player);
    const qint64 finalLength = session_->runtime->length(session_->player);
    if (finalTime > position_) position_ = finalTime;
    if (finalLength > duration_) duration_ = finalLength;
    playing_ = false; loading_ = false; wantsPlay_ = false; controls_ = true; ended_ = true;
    if (Playback::trueEnd(position_, duration_)) {
      emit progress(item_, position_, duration_, true);
      if (item_.value("kind").toString() == "episode" && next_.value("kind").toString() == "episode")
        countdown_.begin(episode(item_), episode(next_), duration_, now());
      nextCountdown_ = countdown_.remaining(now());
    } else error_ = QStringLiteral("İçerik tamamlanmadan bağlantı kesildi. Yeniden açabilirsin.");
  }
  emit stateChanged();
}
void DesktopPlayer::tick() {
  if (!active_) return;
  const auto instant = now();
  if (!eligible()) { fail(QStringLiteral("İzleme erişimin sona erdi.")); return; }
  if (awaitingRefresh_ && instant - startedAt_ >= 30000) { fail(QStringLiteral("Bağlantı kurulamadı. Daha sonra tekrar dene.")); return; }
  if (session_) {
    auto &r = *session_->runtime; auto *p = session_->player;
    const qint64 position = std::max<qint64>(0, r.time(p)), duration = std::max<qint64>(0, r.length(p));
    if (duration > 0) duration_ = duration;
    if (position > position_ + 100 || position + 100 < position_) progressedAt_ = instant;
    position_ = position;
    unsigned w = 0, h = 0;
    if (r.videoSize(p, 0, &w, &h) == 0 && w > 0 && h > 0 && position > 0) hasFrame_ = true;
    if (resume_ > 0 && !live() && duration_ > 0 && r.isPlaying(p)) {
      r.setTime(p, std::min(resume_, std::max<qint64>(0, duration_ - 1000))); resume_ = 0; progressedAt_ = instant;
    }
    if (!ended_ && wantsPlay_ && !held_ && !awaitingRefresh_) {
      if (!hasFrame_ && instant - startedAt_ >= 30000) { recover(Playback::Trigger::StartupTimeout); return; }
      if (hasFrame_ && instant - progressedAt_ >= 12000) { recover(Playback::Trigger::Stall); return; }
    } else if (!wantsPlay_ || held_) progressedAt_ = instant;
    if (instant - tracksAt_ > 2000) { updateTracks(); tracksAt_ = instant; }
    if (instant - savedAt_ > 5000 && !ended_) { emit progress(item_, position_, duration_, false); savedAt_ = instant; }
  }
  if (countdown_.pending()) {
    nextCountdown_ = countdown_.remaining(instant);
    if (countdown_.claim(instant)) { const auto next = next_; close(); emit playRequested(next); return; }
  }
  if (Playback::hideControls(interactionAt_, instant, playing_, held_ > 0, countdown_.pending())) controls_ = false;
  emit stateChanged();
}
void DesktopPlayer::togglePause() {
  interact();
  if (!session_ || !eligible()) return;
  if (ended_) { auto restart = media_; restart["resumeMs"] = 0; open(restart); return; }
  wantsPlay_ = !wantsPlay_; session_->runtime->pause(session_->player, wantsPlay_ ? 0 : 1);
  playing_ = wantsPlay_; progressedAt_ = now(); emit stateChanged();
}
void DesktopPlayer::seekBy(int seconds) { seek(position_ + qint64(seconds) * 1000); }
void DesktopPlayer::seek(qint64 position) {
  interact(); if (!session_ || live() || !eligible() || duration_ <= 0) return;
  position_ = std::clamp<qint64>(position, 0, duration_); session_->runtime->setTime(session_->player, position_);
  progressedAt_ = now(); emit stateChanged();
}
void DesktopPlayer::setVolume(int volume) {
  volume_ = std::clamp(volume, 0, 100);
  if (session_) session_->runtime->setVolume(session_->player, volume_);
  interact();
}
void DesktopPlayer::setMuted(bool value) {
  muted_ = value; if (session_) session_->runtime->setMute(session_->player, value ? 1 : 0); interact();
}
void DesktopPlayer::selectAudio(int id) {
  if (!session_) return;
  for (const auto &track : audioTracks_) if (track.toMap().value("id").toInt() == id) {
    session_->runtime->setAudioTrack(session_->player, id); audioTrack_ = id; break;
  }
  interact();
}
void DesktopPlayer::selectSubtitle(int id) {
  if (!session_) return;
  for (const auto &track : subtitleTracks_) if (track.toMap().value("id").toInt() == id) {
    session_->runtime->setSubtitleTrack(session_->player, id); subtitleTrack_ = id; break;
  }
  interact();
}
void DesktopPlayer::updateTracks() {
  if (!session_) return;
  auto &r = *session_->runtime;
  auto read = [&r](libvlc_track_description_t *head) {
    QVariantList list; int count = 0;
    for (auto *t = head; t && count < 64; t = t->p_next, ++count) {
      QString title = QString::fromUtf8(t->psz_name ? t->psz_name : "").left(128);
      title.remove(QRegularExpression(QStringLiteral("[\\x00-\\x1f\\x7f]")));
      if (t->i_id == -1) title = QStringLiteral("Kapalı");
      list.append(QVariantMap{{"id", t->i_id}, {"title", title}});
    }
    if (head) r.releaseTracks(head);
    return list;
  };
  audioTracks_ = read(r.audioTracks(session_->player)); subtitleTracks_ = read(r.subtitleTracks(session_->player));
  audioTrack_ = r.audioTrack(session_->player); subtitleTrack_ = r.subtitleTrack(session_->player);
}
void DesktopPlayer::interact() { controls_ = true; interactionAt_ = now(); emit stateChanged(); }
void DesktopPlayer::holdControls(bool hold) { held_ = std::max(0, held_ + (hold ? 1 : -1)); interact(); }
void DesktopPlayer::setFullScreen(bool value) { fullScreen_ = value; interact(); }
void DesktopPlayer::cancelNext() { countdown_.cancel(); nextCountdown_ = 0; interact(); }
void DesktopPlayer::playNext() {
  Playback::NextEpisode check;
  if (!eligible() || item_.value("kind") != "episode" || next_.value("kind") != "episode" ||
      !check.begin(episode(item_), episode(next_), std::max<qint64>(1, duration_), now())) return;
  const auto next = next_; close(); emit playRequested(next);
}
void DesktopPlayer::setSurface(qulonglong handle) {
  if (surface_ == handle) return;
  surface_ = handle;
  if (session_ && !handle) { close(); return; }
  startPending();
}
void DesktopPlayer::releaseSurface(qulonglong handle) {
  if (!handle || surface_ != handle) return;
  close();
  stopping_.waitForFinished();
  surface_ = 0;
}
void DesktopPlayer::switchChannel(int direction) { if (live() && eligible()) emit channelRequested(direction < 0 ? -1 : 1); }
void DesktopPlayer::extendAccess(qint64 expiry, const QString &scope) {
  if (!active_ || scope != scope_ || expiry <= now()) return;
  if (recovery_ && recovery_->admit(scope.toStdString(), key(item_).toStdString(), expiry, now())) {
    expiry_ = expiry; media_["expiresAt"] = expiry; emit stateChanged();
  }
}
