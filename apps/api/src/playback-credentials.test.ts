import { describe, expect, it } from "vitest";
import {
  samePlaybackCredentials,
  shouldHonorSharedLive404Cooldown
} from "./playback-credentials.js";

describe("playback credential helpers", () => {
  it("matches identical credentials", () => {
    expect(
      samePlaybackCredentials(
        { username: "alice", password: "secret" },
        { username: "alice", password: "secret" }
      )
    ).toBe(true);
  });

  it("rejects different credentials", () => {
    expect(
      samePlaybackCredentials(
        { username: "alice", password: "secret" },
        { username: "bob", password: "secret" }
      )
    ).toBe(false);
  });

  it("honors shared 404 cooldown when the user has no distinct primary credentials", () => {
    expect(shouldHonorSharedLive404Cooldown(null, null)).toBe(true);
    expect(
      shouldHonorSharedLive404Cooldown(
        { username: "alice", password: "secret" },
        null
      )
    ).toBe(true);
    expect(
      shouldHonorSharedLive404Cooldown(
        { username: "alice", password: "secret" },
        { username: "alice", password: "secret" }
      )
    ).toBe(true);
  });

  it("bypasses shared 404 cooldown for users with their own working credentials", () => {
    expect(
      shouldHonorSharedLive404Cooldown(
        { username: "alice", password: "secret" },
        { username: "shared", password: "shared" }
      )
    ).toBe(false);
  });
});
