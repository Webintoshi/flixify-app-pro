#include "player.h"
#include "vlc_runtime.h"
#include <QDateTime>
#include <QFileInfo>
#include <QMutex>
#include <QMutexLocker>
#include <QPointer>
#include <QRegularExpression>
#include <QUrl>
#include <QtConcurrent/QtConcurrentRun>
#include <array>
#include <atomic>
#include <cmath>

namespace {
constexpr std::array<int, 6> vlcEvents{0x102, 0x104, 0x105, 0x109, 0x10a, 0x103};
qint64 now() { return QDateTime::currentMSecsSinceEpoch(); }
}

struct DesktopPlayer::Session {
  VlcRuntime *runtime = nullptr;
  libvlc_instance_t *engine = nullptr;
  libvlc_media_player_t *player = nullptr;
  QPointer<DesktopPlayer> owner;
  quint64 generation = 0;
  size_t attachedEvents = 0;
  std::atomic_bool cancelled = false;
  QMutex commandMutex;
  std::array<std::function<void(Session &)>, size_t(Command::Count)> commands;
  bool controlsQueued = false;
  static void event(const libvlc_event_t *event, void *opaque) {
    auto *self = static_cast<Session *>(opaque);
    const auto owner = self->owner;
    const auto generation = self->generation;
    const int type = event->type;
    float percent=100;
    if(type==0x103){percent=event->u.media_player_buffering.new_cache;if(!std::isfinite(percent))return;percent=std::clamp(percent,0.0f,100.0f);}
    if (owner) QMetaObject::invokeMethod(owner, [owner, generation, type, percent] {
      if (owner) owner->onVlcEvent(generation, type, percent);
    }, Qt::QueuedConnection);
  }
  void dispose() {
    if (player) {
      auto *manager = runtime->events(player);
      for (size_t i = 0; i < attachedEvents; ++i) runtime->detach(manager, vlcEvents[i], &Session::event, this);
      attachedEvents = 0;
      runtime->stop(player);
      runtime->releasePlayer(player); player = nullptr;
    }
    if (engine) { runtime->release(engine); engine = nullptr; }
  }
  ~Session() { Q_ASSERT(!player && !engine); }
};

DesktopPlayer::DesktopPlayer(QObject *parent, bool allowTestMedia) : QObject(parent), allowTestMedia_(allowTestMedia) {
  worker_.setMaxThreadCount(1);
  timer_.setInterval(250);
  connect(&timer_, &QTimer::timeout, this, &DesktopPlayer::tick);
  connect(&opening_, &QFutureWatcher<StartResult>::finished, this, [this] {
    openingPending_ = false;
    const auto result = opening_.result();
    if (active_ && session_ && result.generation == generation_) {
      startedAt_ = progressedAt_ = now();
      if (!result.error.isEmpty()) fail(result.error);
      else if (result.playFailed) recover(Playback::Trigger::DecoderError);
      else requestSample();
    }
    startPending();
  });
  connect(&polling_, &QFutureWatcher<Snapshot>::finished, this, [this] {
    samplePending_ = false;
    const auto sample = polling_.result();
    applySample(sample);
    if (pendingEnd_) requestSample(true);
  });
  timer_.start();
}
DesktopPlayer::~DesktopPlayer() {
  timer_.stop(); pending_.clear(); active_ = false; ++generation_;
  releaseCurrent();
  worker_.waitForDone();
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
    if (active_) emit progress(item_, position_, positionConfirmed_ ? duration_ : 0, false);
    recovery_ = std::make_unique<Playback::Recovery>(scope.toStdString(), key(item).toStdString(), expiry);
    hasFrame_ = false; position_ = 0; duration_ = 0; held_ = 0;
  }
  ++generation_; releaseCurrent();
  media_ = media; pending_ = media; item_ = item; next_ = media.value("next").toMap(); scope_ = scope; expiry_ = expiry;
  resume_ = refresh && !live() ? position_ : std::max<qint64>(0, media.value("resumeMs").toLongLong());
  if (!live()) position_ = resume_;
  confirmedPosition_ = 0; positionConfirmed_ = false;
  awaitingRefresh_ = false; error_.clear(); ended_ = false; pendingEnd_ = false; wantsPlay_ = true;
  observedBuffering_=false;
  active_ = true; playing_ = false; loading_ = !hasFrame_; controls_ = true;
  countdown_ = Playback::NextEpisode(); nextCountdown_ = 0; audioTracks_.clear(); subtitleTracks_.clear();
  interactionAt_ = startedAt_ = progressedAt_ = now(); savedAt_ = 0; tracksAt_ = 0;
  emit stateChanged(); startPending();
}
void DesktopPlayer::releaseCurrent() {
  if (!session_) return;
  auto old = std::move(session_);
  old->cancelled = true;
  (void)QtConcurrent::run(&worker_, [old] { old->dispose(); });
}
void DesktopPlayer::startPending() {
  if (!active_ || pending_.isEmpty() || !surface_ || openingPending_ || session_) return;
  if (!eligible()) { fail(QStringLiteral("İzleme erişimin sona erdi.")); return; }
  auto session = std::make_shared<Session>();
  session->owner = this; session->generation = generation_;
  const auto encoded = QUrl(pending_.value("url").toString()).toEncoded();
  const bool isLive = live();
  const auto surface = surface_;
  const auto volume = volume_;
  const auto muted = muted_;
  const auto rate = isLive ? 1.0 : rate_;
  const auto aspect = aspect_ == QStringLiteral("Otomatik") ? QByteArray() : aspect_.toLatin1();
  session_ = session; pending_.clear(); openingPending_ = true;
  opening_.setFuture(QtConcurrent::run(&worker_, [session, encoded, isLive, surface, volume, muted, rate, aspect] {
    StartResult result; result.generation = session->generation;
    if (session->cancelled) return result;
    auto &runtime = VlcRuntime::instance(); session->runtime = &runtime;
    if (!runtime.ready()) { result.error = runtime.error(); return result; }
    qputenv("VLC_PLUGIN_PATH", runtime.plugins().toUtf8());
    const char *args[] = {"--no-video-title-show", "--no-osd", "--no-media-library", "--quiet", "--no-lua"};
    session->engine = runtime.create(int(std::size(args)), args);
    if (session->cancelled) return result;
    if (!session->engine) { result.error = QStringLiteral("Video motoru başlatılamadı."); return result; }
    session->player = runtime.player(session->engine);
    if (!session->player) { result.error = QStringLiteral("Oynatıcı başlatılamadı."); return result; }
    auto *media = runtime.media(session->engine, encoded.constData());
    if (!media) { result.error = QStringLiteral("İçerik açılamadı."); return result; }
    runtime.addOption(media, isLive ? ":network-caching=1000" : ":network-caching=1500");
    runtime.addOption(media, ":avcodec-hw=any");
    runtime.addOption(media, ":http-reconnect");
    runtime.setMedia(session->player, media); runtime.releaseMedia(media);
    if (session->cancelled) return result;
#if defined(Q_OS_WIN)
    runtime.setHwnd(session->player, reinterpret_cast<void *>(quintptr(surface)));
#elif defined(Q_OS_MACOS)
    runtime.setNSObject(session->player, reinterpret_cast<void *>(quintptr(surface)));
#else
    runtime.setXWindow(session->player, quint32(surface));
#endif
    auto *manager = runtime.events(session->player);
    if (!manager) { result.error = QStringLiteral("Video olayları başlatılamadı."); return result; }
    for (int event : vlcEvents) {
      if (session->cancelled) return result;
      if (runtime.attach(manager, event, &Session::event, session.get()) != 0) {
        result.error = QStringLiteral("Video olayları başlatılamadı."); return result;
      }
      ++session->attachedEvents;
    }
    runtime.setVolume(session->player, volume); runtime.setMute(session->player, muted ? 1 : 0);
    runtime.setRate(session->player, float(rate)); runtime.setAspect(session->player, aspect.constData());
    if (!session->cancelled) result.playFailed = runtime.play(session->player) != 0;
    return result;
  }));
}
void DesktopPlayer::close() {
  if (active_ && !item_.isEmpty()) emit progress(item_, position_, positionConfirmed_ ? duration_ : 0, false);
  active_ = false; wantsPlay_ = false; playing_ = false; loading_ = false; controls_ = true;
  awaitingRefresh_ = false; pendingEnd_ = false; ++generation_; pending_.clear(); countdown_.cancel(); nextCountdown_ = 0;
  if (recovery_) recovery_->stop();
  releaseCurrent(); media_.clear(); item_.clear(); next_.clear(); scope_.clear(); error_.clear();
  audioTracks_.clear(); subtitleTracks_.clear(); hasFrame_ = false; held_ = 0;
  observedBuffering_=false;
  emit stateChanged();
}
void DesktopPlayer::fail(const QString &message) {
  ++generation_; pending_.clear(); awaitingRefresh_ = false; pendingEnd_ = false; wantsPlay_ = false;
  playing_ = false; loading_ = false; error_ = message; controls_ = true;
  observedBuffering_=false;
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
void DesktopPlayer::onVlcEvent(quint64 generation, int event, float bufferPercent) {
  if (!active_ || !session_ || generation != generation_) return;
  if (!eligible()) { fail(QStringLiteral("İzleme erişimin sona erdi.")); return; }
  if (event == 0x103) { observedBuffering_=bufferPercent<100;emit stateChanged();return; }
  if (event == 0x104) { observedBuffering_=false;playing_ = true; loading_ = false; progressedAt_ = now(); }
  else if (event == 0x105) { playing_ = false; controls_ = true; }
  else if (event == 0x10a) { recover(Playback::Trigger::DecoderError); return; }
  else if (event == 0x109) {
    if (live()) { recover(Playback::Trigger::Ended); return; }
    playing_ = false; loading_ = false; wantsPlay_ = false; controls_ = true; ended_ = true;
    pendingEnd_ = true; requestSample(true);
  }
  emit stateChanged();
}
void DesktopPlayer::tick() {
  if (!active_) return;
  const auto instant = now();
  if (!eligible()) { fail(QStringLiteral("İzleme erişimin sona erdi.")); return; }
  if (awaitingRefresh_ && instant - startedAt_ >= 30000) { fail(QStringLiteral("Bağlantı kurulamadı. Daha sonra tekrar dene.")); return; }
  if (session_) {
    requestSample(pendingEnd_);
    if (!ended_ && wantsPlay_ && !held_ && !awaitingRefresh_) {
      if (!hasFrame_ && instant - startedAt_ >= 30000) { recover(Playback::Trigger::StartupTimeout); return; }
      if (hasFrame_ && instant - progressedAt_ >= 12000) { recover(Playback::Trigger::Stall); return; }
    } else if (!wantsPlay_ || held_) progressedAt_ = instant;
    if (instant - savedAt_ > 5000 && !ended_) {
      emit progress(item_, position_, positionConfirmed_ ? duration_ : 0, false); savedAt_ = instant;
    }
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
  wantsPlay_ = !wantsPlay_;
  queueCommand(Command::Pause, [pause = !wantsPlay_](Session &session) { session.runtime->pause(session.player, pause ? 1 : 0); });
  playing_ = wantsPlay_; progressedAt_ = now(); emit stateChanged();
}
void DesktopPlayer::seekBy(int seconds) { seek(position_ + qint64(seconds) * 1000); }
void DesktopPlayer::seek(qint64 position) {
  interact(); if (!session_ || live() || !eligible() || duration_ <= 0) return;
  position_ = std::clamp<qint64>(position, 0, duration_);
  confirmedPosition_ = 0; positionConfirmed_ = false;
  ++seekRevision_;
  queueCommand(Command::Seek, [position = position_](Session &session) { session.runtime->setTime(session.player, position); });
  progressedAt_ = now(); emit stateChanged();
}
void DesktopPlayer::setVolume(int volume) {
  volume_ = std::clamp(volume, 0, 100);
  queueCommand(Command::Volume, [volume = volume_](Session &session) { session.runtime->setVolume(session.player, volume); });
  interact();
}
void DesktopPlayer::setMuted(bool value) {
  muted_ = value;
  queueCommand(Command::Mute, [value](Session &session) { session.runtime->setMute(session.player, value ? 1 : 0); });
  interact();
}
void DesktopPlayer::setRate(double rate) {
  constexpr std::array<double, 6> allowed{0.5, 0.75, 1.0, 1.25, 1.5, 2.0};
  if (live() || std::find(allowed.begin(), allowed.end(), rate) == allowed.end()) return;
  rate_ = rate;
  queueCommand(Command::Rate, [rate](Session &session) { session.runtime->setRate(session.player, float(rate)); });
  interact();
}
void DesktopPlayer::setAspect(const QString &aspect) {
  if (aspect != QStringLiteral("Otomatik") && aspect != QStringLiteral("16:9") && aspect != QStringLiteral("4:3")) return;
  aspect_ = aspect;
  const auto value = aspect == QStringLiteral("Otomatik") ? QByteArray() : aspect.toLatin1();
  queueCommand(Command::Aspect, [value](Session &session) { session.runtime->setAspect(session.player, value.constData()); });
  interact();
}
void DesktopPlayer::selectAudio(int id) {
  if (!session_) return;
  for (const auto &track : audioTracks_) if (track.toMap().value("id").toInt() == id) {
    ++audioRevision_;
    queueCommand(Command::Audio, [id](Session &session) { session.runtime->setAudioTrack(session.player, id); }); audioTrack_ = id; break;
  }
  interact();
}
void DesktopPlayer::selectSubtitle(int id) {
  if (!session_) return;
  for (const auto &track : subtitleTracks_) if (track.toMap().value("id").toInt() == id) {
    ++subtitleRevision_;
    queueCommand(Command::Subtitle, [id](Session &session) { session.runtime->setSubtitleTrack(session.player, id); }); subtitleTrack_ = id; break;
  }
  interact();
}
void DesktopPlayer::queueCommand(Command kind, std::function<void(Session &)> command) {
  if (!session_) return;
  const auto session = session_;
  {
    QMutexLocker lock(&session->commandMutex);
    session->commands[size_t(kind)] = std::move(command);
    if (session->controlsQueued) return;
    session->controlsQueued = true;
  }
  (void)QtConcurrent::run(&worker_, [session] {
    for (;;) {
      decltype(session->commands) commands;
      {
        QMutexLocker lock(&session->commandMutex);
        commands.swap(session->commands);
        if (session->cancelled || std::none_of(commands.begin(), commands.end(), [](const auto &command) { return bool(command); })) {
          session->controlsQueued = false; return;
        }
      }
      for (const auto &command : commands)
        if (command && !session->cancelled && session->player) command(*session);
    }
  });
}
void DesktopPlayer::requestSample(bool final) {
  if (!session_ || openingPending_ || samplePending_) return;
  const auto session = session_;
  const bool tracks = now() - tracksAt_ > 2000;
  const auto seekRevision = seekRevision_, audioRevision = audioRevision_, subtitleRevision = subtitleRevision_;
  if (tracks) tracksAt_ = now();
  samplePending_ = true;
  polling_.setFuture(QtConcurrent::run(&worker_, [session, tracks, final, seekRevision, audioRevision, subtitleRevision] {
    Snapshot sample; sample.generation = session->generation; sample.final = final;
    sample.seekRevision = seekRevision; sample.audioRevision = audioRevision; sample.subtitleRevision = subtitleRevision;
    if (session->cancelled || !session->player) return sample;
    auto &r = *session->runtime; auto *p = session->player;
    sample.position = std::max<qint64>(0, r.time(p)); sample.duration = std::max<qint64>(0, r.length(p));
    unsigned width = 0, height = 0;
    sample.hasFrame = r.videoSize(p, 0, &width, &height) == 0 && width > 0 && height > 0 && sample.position > 0;
    sample.playing = r.isPlaying(p) != 0;
    if (tracks && !session->cancelled) {
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
      sample.audioTracks = read(r.audioTracks(p)); sample.subtitleTracks = read(r.subtitleTracks(p));
      sample.audioTrack = r.audioTrack(p); sample.subtitleTrack = r.subtitleTrack(p); sample.tracks = true;
    }
    sample.valid = !session->cancelled;
    return sample;
  }));
}
void DesktopPlayer::applySample(const Snapshot &sample) {
  if (!active_ || !session_ || !sample.valid || sample.generation != generation_) return;
  if (!eligible()) { fail(QStringLiteral("İzleme erişimin sona erdi.")); return; }
  const auto instant = now();
  if (sample.duration > 0) duration_ = sample.duration;
  if (sample.final) confirmedPosition_ = std::max(confirmedPosition_, sample.position);
  else if (sample.seekRevision == seekRevision_) confirmedPosition_ = sample.position;
  if ((sample.final || sample.seekRevision == seekRevision_) && (resume_ <= 0 || live())) {
    if (sample.position > position_ + 100 || sample.position + 100 < position_) progressedAt_ = instant;
    position_ = sample.final ? std::max(position_, sample.position) : sample.position;
    positionConfirmed_ = position_ == confirmedPosition_;
  }
  hasFrame_ = hasFrame_ || sample.hasFrame;if(sample.hasFrame)frameGeneration_=sample.generation;
  if (sample.tracks) {
    audioTracks_ = sample.audioTracks; subtitleTracks_ = sample.subtitleTracks;
    if (sample.audioRevision == audioRevision_) audioTrack_ = sample.audioTrack;
    if (sample.subtitleRevision == subtitleRevision_) subtitleTrack_ = sample.subtitleTrack;
  }
  if (resume_ > 0 && !live() && duration_ > 0 && sample.playing && !ended_ && !pendingEnd_) {
    const auto position = std::min(resume_, std::max<qint64>(0, duration_ - 1000));
    position_ = position;
    confirmedPosition_ = 0; positionConfirmed_ = false;
    ++seekRevision_;
    queueCommand(Command::Seek, [position](Session &session) { session.runtime->setTime(session.player, position); });
    resume_ = 0; progressedAt_ = instant;
  }
  if (sample.final && pendingEnd_) {
    pendingEnd_ = false;
    if (Playback::trueEnd(confirmedPosition_, duration_)) {
      position_ = confirmedPosition_; positionConfirmed_ = true;
      emit progress(item_, confirmedPosition_, duration_, true);
      if (item_.value("kind").toString() == "episode" && next_.value("kind").toString() == "episode")
        countdown_.begin(episode(item_), episode(next_), duration_, instant);
      nextCountdown_ = countdown_.remaining(instant);
    } else error_ = QStringLiteral("İçerik tamamlanmadan bağlantı kesildi. Yeniden açabilirsin.");
  }
  emit stateChanged();
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
  worker_.waitForDone();
  surface_ = 0;
}
void DesktopPlayer::switchChannel(int direction) { if (live() && eligible()) emit channelRequested(direction < 0 ? -1 : 1); }
void DesktopPlayer::extendAccess(qint64 expiry, const QString &scope) {
  if (!active_ || scope != scope_ || expiry <= now()) return;
  if (recovery_ && recovery_->admit(scope.toStdString(), key(item_).toStdString(), expiry, now())) {
    expiry_ = expiry; media_["expiresAt"] = expiry; emit stateChanged();
  }
}
