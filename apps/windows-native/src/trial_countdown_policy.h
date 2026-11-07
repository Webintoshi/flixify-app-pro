#pragma once
#include <cstdint>

class TrialCountdownClock {
public:
  enum class Status { None, Pending, Active, Expired, Unavailable };
  void clear() { state_ = Status::None; remainingMs_ = 0; anchor_ = 0; }
  void install(Status state, std::int64_t serverNow, std::int64_t endsAt, std::int64_t monotonicNow) {
    clear(); state_ = state;
    if (state != Status::Active && state != Status::Expired) return;
    constexpr std::int64_t earliest = 946684800000;
    constexpr std::int64_t latest = 4102444800000;
    if (serverNow < earliest || serverNow > latest || endsAt < earliest || endsAt > latest || monotonicNow < 0 ||
        (state == Status::Active && (endsAt <= serverNow || endsAt - serverNow > 31LL * 86400000)) ||
        (state == Status::Expired && endsAt > serverNow)) { state_ = Status::Unavailable; return; }
    anchor_ = monotonicNow;
    remainingMs_ = state == Status::Active ? endsAt - serverNow : 0;
  }
  Status status(std::int64_t monotonicNow) const {
    return state_ == Status::Active && remainingSeconds(monotonicNow) == 0 ? Status::Expired : state_;
  }
  std::int64_t remainingSeconds(std::int64_t monotonicNow) const {
    if (state_ != Status::Active) return 0;
    const auto elapsed = monotonicNow >= anchor_ ? monotonicNow - anchor_ : 0;
    const auto remaining = elapsed >= remainingMs_ ? 0 : remainingMs_ - elapsed;
    return (remaining + 999) / 1000;
  }
private:
  Status state_ = Status::None;
  std::int64_t remainingMs_ = 0, anchor_ = 0;
};
