#include "fake_vlc_runtime.h"
#include "vlc_runtime.h"
#include <QCoreApplication>
#include <QMutex>
#include <QMutexLocker>
#include <QSemaphore>
#include <QThread>
#include <atomic>
#include <algorithm>
#include <vector>

struct libvlc_instance_t {};
struct libvlc_media_t {};
struct libvlc_media_player_t {
  struct Callback { int type; VlcCallback callback; void *opaque; };
  std::vector<Callback> callbacks;
  qint64 position = 10000;
  qint64 duration = 120000;
  bool playing = false;
  int audio = 1, subtitle = 2;
};
namespace {
QMutex mutex;
QString blockedOperation;
QStringList operations;
QSemaphore entered, released;
std::atomic_bool guiCall = false;
std::atomic_int active = 0, peak = 0;
std::atomic<qint64> endPosition = -1, endDuration = 0;
std::atomic_int failedAttach = -1;
std::atomic_bool bufferPending = false;
std::atomic<float> bufferPercent = 100;
double lastRate = 1;
QString lastAspect;
struct Call {
  explicit Call(const char *name) {
    const auto concurrent = ++active;
    int previous = peak;
    while (concurrent > previous && !peak.compare_exchange_weak(previous, concurrent)) {}
    if (QThread::currentThread() == QCoreApplication::instance()->thread()) guiCall = true;
    bool wait = false;
    {
      QMutexLocker lock(&mutex);
      operations.append(QString::fromLatin1(name));
      if (blockedOperation == QLatin1String(name)) { blockedOperation.clear(); wait = true; }
    }
    if (wait) { entered.release(); released.acquire(); }
  }
  ~Call() { --active; }
};
libvlc_track_description_t *track(int id) {
  auto *entry = new libvlc_track_description_t{id, nullptr, nullptr};
  return entry;
}
}
namespace FakeVlc {
void reset() {
  QMutexLocker lock(&mutex);
  operations.clear(); blockedOperation.clear(); guiCall = false; peak = 0;
  endPosition = -1; failedAttach = -1; lastRate = 1; lastAspect.clear();
  bufferPending = false; bufferPercent = 100;
  entered.tryAcquire(entered.available()); released.tryAcquire(released.available());
}
void block(const QString &operation) { QMutexLocker lock(&mutex); blockedOperation = operation; }
bool awaitBlocked(int timeoutMs) { return entered.tryAcquire(1, timeoutMs); }
void unblock() { released.release(); }
QStringList calls() { QMutexLocker lock(&mutex); return operations; }
bool calledOnGuiThread() { return guiCall; }
int concurrentCalls() { return peak; }
void finishAt(qint64 position, qint64 duration) { endDuration = duration; endPosition = position; }
double appliedRate() { QMutexLocker lock(&mutex); return lastRate; }
QString appliedAspect() { QMutexLocker lock(&mutex); return lastAspect; }
void failAttach(int event) { failedAttach = event; }
void bufferAt(float percent) { bufferPercent = percent; bufferPending = true; }
}

VlcRuntime &VlcRuntime::instance() { static VlcRuntime runtime; return runtime; }
VlcRuntime::VlcRuntime() {
  create = [](int, const char *const *) { Call call("create"); return new libvlc_instance_t; };
  release = [](libvlc_instance_t *p) { Call call("release"); delete p; };
  media = [](libvlc_instance_t *, const char *) { Call call("media"); return new libvlc_media_t; };
  releaseMedia = [](libvlc_media_t *p) { Call call("releaseMedia"); delete p; };
  addOption = [](libvlc_media_t *, const char *) { Call call("addOption"); };
  player = [](libvlc_instance_t *) { Call call("player"); return new libvlc_media_player_t; };
  releasePlayer = [](libvlc_media_player_t *p) { Call call("releasePlayer"); delete p; };
  setMedia = [](libvlc_media_player_t *, libvlc_media_t *) { Call call("setMedia"); };
  play = [](libvlc_media_player_t *p) {
    Call call("play");
    p->playing = true;
    libvlc_event_t event{0x104, p};
    for (const auto &entry : p->callbacks) if (entry.type == event.type) entry.callback(&event, entry.opaque);
    return 0;
  };
  stop = [](libvlc_media_player_t *p) { Call call("stop"); p->playing = false; };
  pause = [](libvlc_media_player_t *p, int paused) { Call call("pause"); p->playing = !paused; };
  setTime = [](libvlc_media_player_t *p, qint64 position) { Call call("seek"); p->position = position; };
  setRate = [](libvlc_media_player_t *, float value) {
    Call call("rate"); QMutexLocker lock(&mutex); lastRate = value; return 0;
  };
  setAspect = [](libvlc_media_player_t *, const char *value) {
    Call call("aspect"); QMutexLocker lock(&mutex); lastAspect = QString::fromLatin1(value);
  };
  time = [](libvlc_media_player_t *p) -> qint64 {
    Call call("time");
    if (bufferPending.exchange(false)) {
      libvlc_event_t event{0x103,p}; event.u.media_player_buffering.new_cache=bufferPercent;
      for (const auto &entry : p->callbacks) if (entry.type==event.type) entry.callback(&event,entry.opaque);
    }
    const auto position = endPosition.exchange(-1);
    if (position >= 0) {
      p->position = position; p->duration = endDuration;
      p->playing = false;
      libvlc_event_t event{0x109, p};
      for (const auto &entry : p->callbacks) if (entry.type == event.type) entry.callback(&event, entry.opaque);
    }
    return p->position;
  };
  length = [](libvlc_media_player_t *p) -> qint64 { Call call("length"); return p->duration; };
  isPlaying = [](libvlc_media_player_t *p) { Call call("isPlaying"); return p->playing ? 1 : 0; };
  volume = [](libvlc_media_player_t *) { Call call("getVolume"); return 85; };
  setVolume = [](libvlc_media_player_t *, int) { Call call("volume"); return 0; };
  mute = [](libvlc_media_player_t *) { Call call("getMute"); return 0; };
  setMute = [](libvlc_media_player_t *, int) { Call call("mute"); };
  audioTrack = [](libvlc_media_player_t *p) { Call call("audioTrack"); return p->audio; };
  setAudioTrack = [](libvlc_media_player_t *p, int id) { Call call("audio"); p->audio = id; return 0; };
  subtitleTrack = [](libvlc_media_player_t *p) { Call call("subtitleTrack"); return p->subtitle; };
  setSubtitleTrack = [](libvlc_media_player_t *p, int id) { Call call("subtitle"); p->subtitle = id; return 0; };
  audioTracks = [](libvlc_media_player_t *) { Call call("audioTracks"); return track(1); };
  subtitleTracks = [](libvlc_media_player_t *) { Call call("subtitleTracks"); return track(2); };
  releaseTracks = [](libvlc_track_description_t *p) { Call call("releaseTracks"); delete p; };
  videoSize = [](libvlc_media_player_t *, unsigned, unsigned *width, unsigned *height) {
    Call call("videoSize"); *width = 1280; *height = 720; return 0;
  };
  events = [](libvlc_media_player_t *p) { Call call("events"); return reinterpret_cast<libvlc_event_manager_t *>(p); };
  attach = [](libvlc_event_manager_t *manager, int type, VlcCallback callback, void *opaque) {
    Call call("attach");
    if (type == failedAttach) return -1;
    reinterpret_cast<libvlc_media_player_t *>(manager)->callbacks.push_back({type, callback, opaque}); return 0;
  };
  detach = [](libvlc_event_manager_t *manager, int type, VlcCallback callback, void *opaque) {
    Call call("detach");
    auto &callbacks = reinterpret_cast<libvlc_media_player_t *>(manager)->callbacks;
    const auto found = std::find_if(callbacks.begin(), callbacks.end(), [&](const auto &entry) {
      return entry.type == type && entry.callback == callback && entry.opaque == opaque;
    });
    if (found == callbacks.end()) { QMutexLocker lock(&mutex); operations.append("invalidDetachWouldAbortVlc"); }
    else callbacks.erase(found);
  };
  setHwnd = [](libvlc_media_player_t *, void *) { Call call("surface"); };
  setNSObject = [](libvlc_media_player_t *, void *) { Call call("surface"); };
  setXWindow = [](libvlc_media_player_t *, quint32) { Call call("surface"); };
}
