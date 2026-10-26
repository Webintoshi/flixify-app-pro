import { describe, expect, it } from "vitest";
import { canUseClientIpPlayback, getVerifiedTrialProviderExpiry } from "./client-playback-access.js";

const now = Date.parse("2026-10-26T10:00:00Z");
const deadline = "2026-10-26T13:00:00.000Z";
const access = { canPlay: true, accessUntil: deadline, isThreeHourTrial: true, trialProviderExpiresAt: deadline };

describe("client IP playback access", () => {
  it("allows a verified trial only while both deadlines remain future", () => {
    expect(canUseClientIpPlayback(access, now)).toBe(true);
    expect(canUseClientIpPlayback(access, Date.parse(deadline))).toBe(false);
    expect(canUseClientIpPlayback({ ...access, trialProviderExpiresAt: "2026-10-26T10:00:00Z" }, now)).toBe(false);
  });
  it("rejects missing, malformed or overlong provider expiry including one millisecond", () => {
    for (const trialProviderExpiresAt of [undefined, null, "invalid", "2026-10-26T13:00:00.001Z"]) {
      expect(canUseClientIpPlayback({ ...access, trialProviderExpiresAt }, now)).toBe(false);
    }
  });
  it("requires valid future app access and playback permission for paid users too", () => {
    expect(canUseClientIpPlayback({ ...access, isThreeHourTrial: false, trialProviderExpiresAt: null }, now)).toBe(true);
    for (const accessUntil of [null, "invalid", "2026-10-26T10:00:00Z"]) {
      expect(canUseClientIpPlayback({ ...access, accessUntil, isThreeHourTrial: false }, now)).toBe(false);
    }
    expect(canUseClientIpPlayback({ ...access, canPlay: false }, now)).toBe(false);
  });
});

const identity = {
  userId: "user-1", jobUserId: "user-1", status: "completed", providerLineId: "421",
  providerExpiresAt: deadline, jobUsername: "personal", jobPassword: "secret",
  username: "personal", password: "secret", sharedUsername: "catalog", sharedPassword: "catalog-secret"
};

describe("verified trial identity", () => {
  it("returns expiry for a completed job bound to the current personal line", () => {
    expect(getVerifiedTrialProviderExpiry(identity)).toBe(deadline);
    expect(getVerifiedTrialProviderExpiry({ ...identity, providerExpiresAt: new Date(deadline) })).toBe(deadline);
  });
  it("rejects incomplete verification and stale or foreign credentials", () => {
    for (const patch of [
      { status: "verified" }, { providerLineId: null }, { providerLineId: " " },
      { jobUserId: "other" }, { jobUsername: "old" }, { jobPassword: "old" },
      { username: null }, { password: null }, { providerExpiresAt: "bad" },
      { sharedUsername: "personal", sharedPassword: "secret" }
    ]) {
      expect(getVerifiedTrialProviderExpiry({ ...identity, ...patch })).toBeNull();
    }
  });
});
