#include "playback_policy.h"
#include <cstdlib>
#include <iostream>

static int checks = 0;
static void require(bool value, const char *message) {
  ++checks;
  if (!value) { std::cerr << message << '\n'; std::exit(1); }
}

int main() {
  using namespace Playback;
  Recovery recovery("account:source", "episode:11:21", 10000);
  require(!Recovery::recovers(Trigger::Ended, false), "VOD end must not recover");
  require(Recovery::recovers(Trigger::Ended, true), "live EOF may recover");
  require(recovery.claim("account:source", "episode:11:21", 1000), "first retry allowed");
  require(recovery.claim("account:source", "episode:11:21", 2000), "second retry allowed");
  require(!recovery.claim("account:source", "episode:11:21", 3000), "third retry denied");
  Recovery changed("a:s", "live::1", 10000);
  require(!changed.claim("a:other", "live::1", 1), "scope changes close recovery");
  require(!changed.admit("a:s", "live::1", 20000, 2), "revoked recovery cannot reopen");
  Recovery expired("a:s", "live::1", 1000);
  require(!expired.claim("a:s", "live::1", 1000), "absolute expiry is exclusive");
  Recovery extended("a:s", "live::1", 1000);
  require(extended.admit("a:s", "live::1", 10000, 900), "same source extension accepted");
  require(extended.claim("a:s", "live::1", 2000), "extended access remains eligible");

  Episode current{"a:s", "11", "21", 1, 10};
  Episode next{"a:s", "11", "22", 2, 1};
  NextEpisode countdown;
  require(countdown.begin(current, next, 100000, 1000), "next may cross seasons");
  require(countdown.remaining(1000) == 5, "countdown starts at5");
  require(!countdown.claim(5999), "do not advance before deadline");
  require(countdown.claim(6000), "advance at5s");
  require(!countdown.claim(6001), "one completion only");
  NextEpisode cancelled;
  require(cancelled.begin(current, next, 100000, 1), "second countdown begins");
  cancelled.cancel();
  require(!cancelled.claim(100000), "cancel is final");
  next.scope = "a:different";
  NextEpisode stale;
  require(!stale.begin(current, next, 100000, 0), "different-source episode denied");
  next.scope = current.scope; next.id = current.id; next.season = current.season; next.number = current.number;
  require(!stale.begin(current, next, 100000, 0), "same episode denied");

  require(!trueEnd(20000, 100000), "truncated VOD EOF isn't completed");
  require(trueEnd(99500, 100000), "near-duration native EOF is completed");
  require(!trueEnd(0, 0), "unknown duration cannot auto-advance");
  require(!watched(90000, 100000), "90percent isn't watched");
  require(watched(95000, 100000), "95percent is watched");
  require(watched(3500000, 3600000), "within100s of long episode is watched");
  require(!watched(3479999, 3600000), "more than120s of long episode remains unwatched");
  require(watched(3480000, 3600000), "long episode120s threshold");
  require(!watched(1, -1), "invalid duration ignored");
  require(!hideControls(1000, 2999, true, false, false), "hold until2s");
  require(hideControls(1000, 3000, true, false, false), "hide at2s idle");
  require(!hideControls(1000, 10000, false, false, false), "paused controls remain");
  require(!hideControls(1000, 10000, true, true, false), "drag/menu retains controls");
  require(!hideControls(1000, 10000, true, false, true), "next countdown visible");
  std::cout << "player_policy:" << checks << " checks passed\n";
}
