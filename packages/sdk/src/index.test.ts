import { afterEach, describe, expect, it, vi } from "vitest";
import { FlixifyClient } from "./index.js";

describe("FlixifyClient.resolveVodPlayback", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends platform together with clientRuntime for installed-app VOD resolves", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        itemId: "movie-1",
        kind: "movie",
        url: "https://example.com/vod.mp4",
        transport: "mp4",
        deliveryMode: "file_proxy",
        audioTracks: [],
        defaultAudioTrackId: null,
        selectedAudioTrackId: null,
        expiresAt: null,
        canPlay: true,
        isVerified: true,
        errorMessage: null
      })
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new FlixifyClient({
      baseUrl: "https://api.example.com",
      getAccessToken: () => "access-token"
    });

    await client.resolveVodPlayback("movie", "movie-1", {
      clientRuntime: "app",
      platform: "windows-desktop",
      audioTrackId: "a1"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(requestUrl);

    expect(parsedUrl.pathname).toBe("/me/vod/movie/movie-1/playback");
    expect(parsedUrl.searchParams.get("clientRuntime")).toBe("app");
    expect(parsedUrl.searchParams.get("platform")).toBe("windows-desktop");
    expect(parsedUrl.searchParams.get("audioTrackId")).toBe("a1");
    expect(requestInit.headers).toMatchObject({
      authorization: "Bearer access-token"
    });
  });

  it("sends platform and audioTrackId for native VOD resolves", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: "https://example.com/vod.m3u8",
        transport: "hls",
        headers: {},
        cookie: null,
        userAgent: "VLC/3.0.4 LibVLC/3.0.4",
        allowInsecureHttp: false,
        diagnosticsSessionId: "019d1643-7703-7a21-9311-823c383bc8e6",
        variantGroupKey: null,
        qualityRank: null,
        isVerified: true,
        lastCheckedAt: null,
        deliveryMode: "direct",
        audioTracks: [],
        defaultAudioTrackId: null,
        selectedAudioTrackId: null
      })
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new FlixifyClient({
      baseUrl: "https://api.example.com",
      getAccessToken: () => "access-token"
    });

    await client.resolveNativeVodPlayback("episode", "episode-1", {
      platform: "windows-native-qt",
      audioTrackId: "a2"
    });

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(requestUrl);
    expect(parsedUrl.pathname).toBe("/me/native/vod/episode/episode-1/playback");
    expect(parsedUrl.searchParams.get("platform")).toBe("windows-native-qt");
    expect(parsedUrl.searchParams.get("audioTrackId")).toBe("a2");
  });
});
