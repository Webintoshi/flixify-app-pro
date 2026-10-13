import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLivePlaybackManager,
  getContentLengthFromContentRange,
  parseManifestState
} from "./live-playback.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function captureReply() {
  const state: { statusCode: number; body: unknown } = { statusCode: 200, body: null };
  const reply = {
    status(statusCode: number) {
      state.statusCode = statusCode;
      return this;
    },
    type() { return this; },
    header() { return this; },
    send(body: unknown) {
      state.body = body;
      return this;
    }
  };
  return { reply, state };
}

describe("live-playback helpers", () => {
  it("relays live HLS tag URIs through viewer-token assets", async () => {
    const manifest = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://provider.test/keys/live.bin"
#EXT-X-PART:DURATION=0.5,URI="part-0.m4s"
#EXTINF:4,
segment-0.ts
`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(manifest, {
      status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" }
    })));
    const manager = createLivePlaybackManager({ ffmpegBinary: process.execPath, sessionTtlMs: 60_000 });

    try {
      const playback = await manager.createPlayback({
        channelId: "trial-channel", snapshotVersion: 1,
        sourceUrl: "https://provider.test/live/master.m3u8", cookie: null,
        baseOrigin: "https://flixify.test", sourceTransport: "hls",
        healthStatus: "healthy", lastCheckedAt: null,
        canPlay: true, isVerified: true, errorMessage: null,
        accessUntil: new Date(Date.now() + 60_000).toISOString()
      });
      const playbackUrl = new URL(playback.url!);
      const sessionId = playbackUrl.pathname.split("/")[3]!;
      const token = playbackUrl.searchParams.get("token")!;
      const reply = captureReply();
      await manager.sendManifest(reply.reply as never, sessionId, token);

      expect(reply.state.statusCode).toBe(200);
      const body = String(reply.state.body);
      expect(body).not.toContain("provider.test");
      const tagUrls = [...body.matchAll(/URI="([^"]+)"/g)].map((match) => new URL(match[1]!));
      expect(tagUrls).toHaveLength(2);
      for (const url of tagUrls) {
        expect(url.origin).toBe("https://flixify.test");
        expect(url.pathname).toContain(`/live/playback/${sessionId}/assets/`);
        expect(url.searchParams.get("token")).toBe(token);
      }
    } finally {
      await manager.dispose();
    }
  });

  it("rejects a live manifest with an unsupported tag URI", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="ftp://provider.test/key"\nsegment-0.ts\n', {
      status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" }
    })));
    const manager = createLivePlaybackManager({ ffmpegBinary: process.execPath, sessionTtlMs: 60_000 });

    try {
      const playback = await manager.createPlayback({
        channelId: "trial-channel", snapshotVersion: 1,
        sourceUrl: "https://provider.test/live/master.m3u8", cookie: null,
        baseOrigin: "https://flixify.test", sourceTransport: "hls",
        healthStatus: "healthy", lastCheckedAt: null,
        canPlay: true, isVerified: true, errorMessage: null,
        accessUntil: new Date(Date.now() + 60_000).toISOString()
      });
      const playbackUrl = new URL(playback.url!);
      const reply = captureReply();
      await manager.sendManifest(reply.reply as never, playbackUrl.pathname.split("/")[3]!, playbackUrl.searchParams.get("token")!);

      expect(reply.state.statusCode).toBe(502);
      expect(String(reply.state.body)).not.toContain("ftp://");
    } finally {
      await manager.dispose();
    }
  });

  it("rewrites a nested live playlist even when the provider calls it binary data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      String(url).includes("variant.m3u8")
        ? '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://provider.test/key.bin"\nsegment-0.ts\n'
        : "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvariant.m3u8\n",
      { status: 200, headers: { "content-type": String(url).includes("variant.m3u8") ? "application/octet-stream" : "application/vnd.apple.mpegurl" } }
    )));
    const manager = createLivePlaybackManager({ ffmpegBinary: process.execPath, sessionTtlMs: 60_000 });

    try {
      const playback = await manager.createPlayback({
        channelId: "trial-channel", snapshotVersion: 1,
        sourceUrl: "https://provider.test/live/master.m3u8", cookie: null,
        baseOrigin: "https://flixify.test", sourceTransport: "hls",
        healthStatus: "healthy", lastCheckedAt: null,
        canPlay: true, isVerified: true, errorMessage: null,
        accessUntil: new Date(Date.now() + 60_000).toISOString()
      });
      const playbackUrl = new URL(playback.url!);
      const sessionId = playbackUrl.pathname.split("/")[3]!;
      const token = playbackUrl.searchParams.get("token")!;
      const masterReply = captureReply();
      await manager.sendManifest(masterReply.reply as never, sessionId, token);
      const variantUrl = new URL(String(masterReply.state.body).split("\n").find((line) => line.includes("/assets/"))!);
      const variantReply = captureReply();
      await manager.sendAsset(variantReply.reply as never, sessionId, token, variantUrl.pathname.split("/")[5]!);

      expect(variantReply.state.statusCode).toBe(200);
      expect(String(variantReply.state.body)).toContain(`/live/playback/${sessionId}/assets/`);
      expect(String(variantReply.state.body)).not.toContain("provider.test");
    } finally {
      await manager.dispose();
    }
  });

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

  it("keeps separate provider lines on the same live channel from terminating each other", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("#EXTM3U\n#EXTINF:4,\nsegment-0.ts\n", {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" }
    })));
    const manager = createLivePlaybackManager({ ffmpegBinary: process.execPath, sessionTtlMs: 60_000 });
    const input = {
      channelId: "shared-channel",
      snapshotVersion: 1,
      cookie: null,
      baseOrigin: "https://flixify.test",
      sourceTransport: "hls" as const,
      healthStatus: "healthy" as const,
      lastCheckedAt: null,
      canPlay: true,
      isVerified: true,
      errorMessage: null
    };

    try {
      const first = await manager.createPlayback({ ...input, sourceUrl: "https://provider.test/line-a/master.m3u8" });
      const second = await manager.createPlayback({ ...input, sourceUrl: "https://provider.test/line-b/master.m3u8" });
      const firstUrl = new URL(first.url!);
      const secondUrl = new URL(second.url!);
      const firstSessionId = firstUrl.pathname.split("/")[3]!;
      const secondSessionId = secondUrl.pathname.split("/")[3]!;
      expect(firstSessionId).not.toBe(secondSessionId);

      const firstReply = captureReply();
      await manager.sendManifest(firstReply.reply as never, firstSessionId, firstUrl.searchParams.get("token")!);
      const secondReply = captureReply();
      await manager.sendManifest(secondReply.reply as never, secondSessionId, secondUrl.searchParams.get("token")!);
      expect(firstReply.state.statusCode).toBe(200);
      expect(secondReply.state.statusCode).toBe(200);
    } finally {
      await manager.dispose();
    }
  });

  it("stops an active live segment at the subscription deadline despite recent requests", async () => {
    const manifest = "#EXTM3U\n#EXTINF:4,\nsegment-0.ts\n";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(
      String(url).endsWith(".ts") ? "segment bytes" : manifest,
      { status: 200, headers: { "content-type": String(url).endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl" } }
    )));
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const accessUntil = new Date(now + 1_000).toISOString();
    const manager = createLivePlaybackManager({ ffmpegBinary: process.execPath, sessionTtlMs: 60_000 });

    try {
      const playback = await manager.createPlayback({
        channelId: "trial-channel",
        snapshotVersion: 1,
        sourceUrl: "https://example.com/live/master.m3u8",
        cookie: null,
        baseOrigin: "https://flixify.test",
        sourceTransport: "hls",
        healthStatus: "healthy",
        lastCheckedAt: null,
        canPlay: true,
        isVerified: true,
        errorMessage: null,
        accessUntil
      });
      expect(playback.canPlay).toBe(true);
      const playbackUrl = new URL(playback.url!);
      const sessionId = playbackUrl.pathname.split("/")[3]!;
      const token = playbackUrl.searchParams.get("token")!;
      const first = captureReply();
      await manager.sendManifest(first.reply as never, sessionId, token);
      expect(first.state.statusCode).toBe(200);
      const assetUrl = new URL(String(first.state.body).split("\n").find((line) => line.includes("/assets/"))!);
      const assetId = assetUrl.pathname.split("/")[5]!;

      now += 999;
      const beforeExpiry = captureReply();
      await manager.sendAsset(beforeExpiry.reply as never, sessionId, token, assetId);
      expect(beforeExpiry.state.statusCode).toBe(200);
      (beforeExpiry.state.body as { destroy?: () => void })?.destroy?.();

      now += 1;
      const afterExpiry = captureReply();
      await manager.sendAsset(afterExpiry.reply as never, sessionId, token, assetId);
      expect(afterExpiry.state.statusCode).toBe(403);
    } finally {
      await manager.dispose();
    }
  });

  it("closes a live file proxy stream already open when access expires", async () => {
    let upstreamCancelled = false;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first chunk"));
      },
      cancel() {
        upstreamCancelled = true;
      }
    }), { status: 200, headers: { "content-type": "video/mp2t" } })));
    const accessUntil = new Date(Date.now() + 160).toISOString();
    const manager = createLivePlaybackManager({ ffmpegBinary: process.execPath, sessionTtlMs: 60_000 });

    try {
      const playback = await manager.createPlayback({
        channelId: "trial-live-file",
        snapshotVersion: 1,
        sourceUrl: "https://example.com/live/channel.ts",
        cookie: null,
        baseOrigin: "https://flixify.test",
        sourceTransport: "ts",
        healthStatus: "healthy",
        lastCheckedAt: null,
        canPlay: true,
        isVerified: true,
        errorMessage: null,
        preferDirectProxy: true,
        accessUntil
      });
      expect(playback.deliveryMode).toBe("file_proxy");
      const playbackUrl = new URL(playback.url!);
      const sessionId = playbackUrl.pathname.split("/")[3]!;
      const token = playbackUrl.searchParams.get("token")!;
      const sent = captureReply();
      await manager.sendFile(sent.reply as never, sessionId, token);
      const stream = sent.state.body as import("node:stream").Readable;
      expect(stream.destroyed).toBe(false);
      await new Promise<void>((resolve) => stream.once("data", () => resolve()));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(stream.destroyed).toBe(true);
      expect(upstreamCancelled).toBe(true);
    } finally {
      await manager.dispose();
    }
  });
});
