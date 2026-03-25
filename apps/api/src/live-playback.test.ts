import { describe, expect, it } from "vitest";
import {
  createLivePlaybackManager,
  getContentLengthFromContentRange,
  parseManifestState
} from "./live-playback.js";

describe("live-playback helpers", () => {
  it("parses media sequence and segment count from manifest", () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:42
#EXTINF:6.0,
segment-00042.ts
#EXTINF:6.0,
segment-00043.ts
`;

    expect(parseManifestState(manifest)).toEqual({
      mediaSequence: 42,
      segmentCount: 2
    });
  });

  it("derives content length from content-range", () => {
    expect(getContentLengthFromContentRange("bytes 0-65535/200000")).toBe("65536");
    expect(getContentLengthFromContentRange("bytes 500-999/1000")).toBe("500");
  });

  it("returns null for malformed content-range", () => {
    expect(getContentLengthFromContentRange(null)).toBeNull();
    expect(getContentLengthFromContentRange("items 0-10/20")).toBeNull();
    expect(getContentLengthFromContentRange("bytes 10-5/20")).toBeNull();
  });

  it("reuses sessions per cache profile and creates a new session for safe mode", async () => {
    const manager = createLivePlaybackManager({
      ffmpegBinary: process.execPath,
      sessionTtlMs: 60_000
    });

    const baseInput = {
      channelId: "channel-1",
      snapshotVersion: 1,
      sourceUrl: "https://example.com/live/master.m3u8",
      cookie: null,
      baseOrigin: "https://flixify.test",
      sourceTransport: "hls" as const,
      healthStatus: "healthy" as const,
      lastCheckedAt: new Date("2026-03-25T00:00:00.000Z").toISOString(),
      canPlay: true,
      isVerified: true,
      errorMessage: null,
      preferDirectProxy: false,
      preferTranscode: false
    };

    try {
      const fastPlaybackA = await manager.createPlayback({
        ...baseInput,
        cacheProfile: "fast"
      });
      const fastPlaybackB = await manager.createPlayback({
        ...baseInput,
        cacheProfile: "fast"
      });
      const safePlayback = await manager.createPlayback({
        ...baseInput,
        cacheProfile: "safe"
      });

      const fastSessionA = /\/live\/playback\/([^/]+)\//.exec(fastPlaybackA.url ?? "")?.[1] ?? null;
      const fastSessionB = /\/live\/playback\/([^/]+)\//.exec(fastPlaybackB.url ?? "")?.[1] ?? null;
      const safeSession = /\/live\/playback\/([^/]+)\//.exec(safePlayback.url ?? "")?.[1] ?? null;

      expect(fastSessionA).toBeTruthy();
      expect(fastSessionA).toBe(fastSessionB);
      expect(safeSession).toBeTruthy();
      expect(safeSession).not.toBe(fastSessionA);
    } finally {
      await manager.dispose();
    }
  });

  it("falls back to file_proxy when relay startup fails for native playback", async () => {
    const manager = createLivePlaybackManager({
      ffmpegBinary: process.execPath,
      sessionTtlMs: 60_000
    });

    try {
      const playback = await manager.createPlayback({
        channelId: "channel-ts-fallback",
        snapshotVersion: 1,
        sourceUrl: "https://example.com/live/channel.ts",
        cookie: null,
        baseOrigin: "https://flixify.test",
        sourceTransport: "ts",
        healthStatus: "healthy",
        lastCheckedAt: new Date("2026-03-25T00:00:00.000Z").toISOString(),
        canPlay: true,
        isVerified: true,
        errorMessage: null,
        preferDirectProxy: false,
        allowFileProxyFallback: true,
        preferTranscode: false,
        cacheProfile: "fast"
      });

      expect(playback.canPlay).toBe(true);
      expect(playback.deliveryMode).toBe("file_proxy");
      expect(playback.transport).toBe("ts");
      expect(playback.url).toMatch(/^https:\/\/flixify\.test\/live\/playback\/[^/]+\/file\?token=/);
    } finally {
      await manager.dispose();
    }
  });

  it("reuses file_proxy fallback sessions for native playback after relay failure", async () => {
    const manager = createLivePlaybackManager({
      ffmpegBinary: process.execPath,
      sessionTtlMs: 60_000
    });

    const input = {
      channelId: "channel-ts-reuse",
      snapshotVersion: 1,
      sourceUrl: "https://example.com/live/channel.ts",
      cookie: null,
      baseOrigin: "https://flixify.test",
      sourceTransport: "ts" as const,
      healthStatus: "healthy" as const,
      lastCheckedAt: new Date("2026-03-25T00:00:00.000Z").toISOString(),
      canPlay: true,
      isVerified: true,
      errorMessage: null,
      preferDirectProxy: false,
      allowFileProxyFallback: true,
      preferTranscode: false,
      cacheProfile: "fast" as const
    };

    try {
      const playbackA = await manager.createPlayback(input);
      const playbackB = await manager.createPlayback(input);
      const sessionA = /\/live\/playback\/([^/]+)\//.exec(playbackA.url ?? "")?.[1] ?? null;
      const sessionB = /\/live\/playback\/([^/]+)\//.exec(playbackB.url ?? "")?.[1] ?? null;

      expect(playbackA.deliveryMode).toBe("file_proxy");
      expect(playbackB.deliveryMode).toBe("file_proxy");
      expect(sessionA).toBeTruthy();
      expect(sessionA).toBe(sessionB);
    } finally {
      await manager.dispose();
    }
  });
});
