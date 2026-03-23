import { describe, expect, it } from "vitest";
import { canUseAppDirectPlaybackFallback } from "./app-direct-fallback.js";

describe("app direct playback fallback", () => {
  it("allows direct playback fallback for app clients with a source url", () => {
    expect(
      canUseAppDirectPlaybackFallback("app", "http://example.com/live/stream.ts")
    ).toBe(true);
  });

  it("allows direct playback fallback for native clients with a source url", () => {
    expect(
      canUseAppDirectPlaybackFallback("native", "http://example.com/vod/movie.mkv")
    ).toBe(true);
  });

  it("blocks direct playback fallback when there is no source url", () => {
    expect(canUseAppDirectPlaybackFallback("app", null)).toBe(false);
    expect(canUseAppDirectPlaybackFallback("app", "")).toBe(false);
  });

  it("keeps browser clients on the existing proxy-only path", () => {
    expect(
      canUseAppDirectPlaybackFallback("browser", "http://example.com/live/stream.ts")
    ).toBe(false);
  });
});
