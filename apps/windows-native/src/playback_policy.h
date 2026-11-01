#pragma once
#include <algorithm>
#include <cstdint>
#include <string>

namespace Playback {
using Time = std::int64_t;
enum class Trigger { DecoderError, Ended, StartupTimeout, Stall };

class Recovery {
 public:
  Recovery(std::string scope, std::string key, Time expiresAt)
      : scope_(std::move(scope)), key_(std::move(key)), expiresAt_(expiresAt) {}
  static bool recovers(Trigger trigger, bool live) { return trigger != Trigger::Ended || live; }
  bool allows(const std::string &scope, const std::string &key, Time now) {
    if (stopped_ || scope_.empty() || scope != scope_ || key != key_ || expiresAt_ <= now) {
      stopped_ = true;
      return false;
    }
    return true;
  }
  bool admit(const std::string &scope, const std::string &key, Time expiry, Time now) {
    if (stopped_ || scope_.empty() || scope != scope_ || key != key_ || expiry <= now) {
      stopped_ = true;
      return false;
    }
    expiresAt_ = expiry;
    return true;
  }
  bool claim(const std::string &scope, const std::string &key, Time now) {
    if (!allows(scope, key, now) || attempts_ >= 2) return false;
    ++attempts_;
    return true;
  }
  void stop() { stopped_ = true; }
  int attempts() const { return attempts_; }
 private:
  std::string scope_, key_;
  Time expiresAt_;
  int attempts_ = 0;
  bool stopped_ = false;
};

struct Episode { std::string scope, seriesID, id; int season = 0, number = 0; };
class NextEpisode {
 public:
  bool begin(const Episode &item, const Episode &next, Time duration, Time now) {
    if (cancelled_ || handled_ || deadline_ >= 0 || duration <= 0 || item.scope.empty() ||
        item.scope != next.scope || item.seriesID.empty() || item.seriesID != next.seriesID ||
        item.id == next.id || next.id.empty() || next.season < item.season ||
        (next.season == item.season && next.number <= item.number)) return false;
    deadline_ = now + 5000;
    return true;
  }
  bool pending() const { return deadline_ >= 0 && !cancelled_ && !handled_; }
  int remaining(Time now) const { return pending() ? int(std::max<Time>(0, deadline_ - now + 999) / 1000) : 0; }
  bool claim(Time now, bool immediately = false) {
    if (!pending() || (!immediately && now < deadline_)) return false;
    handled_ = true; deadline_ = -1;
    return true;
  }
  void cancel() { cancelled_ = true; deadline_ = -1; }
 private:
  Time deadline_ = -1;
  bool cancelled_ = false, handled_ = false;
};

inline bool trueEnd(Time position, Time duration) {
  return duration > 0 && position >= 0 && position <= duration + 5000 &&
      duration - position <= std::clamp<Time>(duration / 100, 2000, 5000);
}
inline bool watched(Time position, Time duration) {
  return duration > 0 && position > 0 && position <= duration + 5000 &&
      duration - position <= std::min<Time>(duration / 20, 120000);
}
inline bool hideControls(Time interaction, Time now, bool playing, bool held, bool nextPending) {
  return playing && !held && !nextPending && now - interaction >= 2000;
}
}
