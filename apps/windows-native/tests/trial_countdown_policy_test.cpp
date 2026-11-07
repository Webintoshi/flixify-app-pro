#include "trial_countdown_policy.h"
#include <cstdlib>
#include <iostream>

static int checks = 0;
static void require(bool condition, const char *message) {
  ++checks;
  if (!condition) { std::cerr << message << '\n'; std::exit(1); }
}

int main() {
  using Status = TrialCountdownClock::Status;
  constexpr std::int64_t server = 1794049200000;
  TrialCountdownClock clock;
  clock.install(Status::Active, server, server + 10800000, 500);
  require(clock.status(500) == Status::Active, "server trial becomes active");
  require(clock.remainingSeconds(500) == 10800, "three hours comes from the server deadline");
  require(clock.remainingSeconds(1501) == 10799, "elapsed monotonic time reduces the countdown");
  require(clock.remainingSeconds(10800500) == 0, "deadline reaches zero");
  require(clock.status(10800500) == Status::Expired, "zero is expired");
  require(clock.remainingSeconds(10800501) == 0, "countdown never goes negative");
  clock.install(Status::Active, server + 600000, server + 10800000, 900);
  require(clock.remainingSeconds(900) == 10200, "relaunch keeps existing remaining time");
  clock.install(Status::None, server, 0, 900);
  require(clock.status(900) == Status::None && clock.remainingSeconds(900) == 0, "paid upgrade clears the trial");
  clock.install(Status::Pending, server, 0, 900);
  require(clock.status(900) == Status::Pending && clock.remainingSeconds(900) == 0, "provisioning does not start a new clock");
  clock.install(Status::Unavailable, server, 0, 900);
  require(clock.status(900) == Status::Unavailable && clock.remainingSeconds(900) == 0, "missing deadline grants no time");
  clock.install(Status::Expired, server, server - 1000, 900);
  require(clock.status(900) == Status::Expired && clock.remainingSeconds(900) == 0, "expired response remains expired");
  clock.install(Status::Active, server, server - 1, 900);
  require(clock.status(900) == Status::Unavailable, "contradictory active deadline is unavailable");
  clock.install(Status::Active, 0, server, 900);
  require(clock.status(900) == Status::Unavailable, "invalid server timestamp is unavailable");
  clock.install(Status::Active, server, server + 86400000, 900);
  require(clock.remainingSeconds(900) == 86400, "legacy trial follows its actual deadline");
  clock.clear();
  require(clock.status(900) == Status::None, "logout clears the snapshot");
  std::cout << "trial_countdown_policy: " << checks << " checks passed\n";
}
