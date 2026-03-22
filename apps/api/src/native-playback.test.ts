import { describe, expect, it } from "vitest";
import { buildNativePlaybackSource, NATIVE_PLAYBACK_USER_AGENT } from "./native-playback.js";

describe("native playback helpers", () => {
  it("marks insecure playback sources for direct http streams", () => {
    const payload = buildNativePlaybackSource({
      url: "http://example.com/live/1.ts",
      transport: "ts",
      isVerified: true
    });

    expect(payload.allowInsecureHttp).toBe(true);
    expect(payload.userAgent).toBe(NATIVE_PLAYBACK_USER_AGENT);
  });

  it("preserves variant metadata for sibling fallback capable sources", () => {
    const payload = buildNativePlaybackSource({
      url: "https://example.com/live/1.m3u8",
      transport: "hls",
      variantGroupKey: "star tv",
      qualityRank: 300,
      isVerified: false,
      lastCheckedAt: "2026-03-22T19:00:00.000Z"
    });

    expect(payload.variantGroupKey).toBe("star tv");
    expect(payload.qualityRank).toBe(300);
    expect(payload.isVerified).toBe(false);
  });
});
