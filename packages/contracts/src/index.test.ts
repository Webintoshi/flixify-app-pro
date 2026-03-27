import { describe, expect, it } from "vitest";
import { buildLiveVariantMetadata } from "./live-variants";
import {
  registerAnonInputSchema,
  loginByCodeInputSchema,
  nativeLivePlaybackResponseSchema,
  nativeVodPlaybackResponseSchema,
  paginationQuerySchema
} from "./schemas";

describe("contracts", () => {
  it("requires installation id when creating anonymous accounts", () => {
    const payload = registerAnonInputSchema.parse({
      deviceName: "Apple TV",
      platform: "tvos",
      installationId: "install-1234567890abcd"
    });

    expect(payload.installationId).toBe("install-1234567890abcd");
  });

  it("accepts valid kryptonite code payloads", () => {
    const payload = loginByCodeInputSchema.parse({
      code: "ABCD1234EFGH5678",
      deviceName: "Apple TV",
      platform: "tvos",
      installationId: "install-1234567890abcd"
    });

    expect(payload.code).toBe("ABCD1234EFGH5678");
  });

  it("rejects malformed codes", () => {
    expect(() =>
      loginByCodeInputSchema.parse({
        code: "short"
      })
    ).toThrow();
  });

  it("accepts viewer catalog page sizes up to 300", () => {
    const payload = paginationQuerySchema.parse({
      page: "1",
      pageSize: "300"
    });

    expect(payload.pageSize).toBe(300);
  });

  it("derives stable live variant metadata from channel titles", () => {
    expect(buildLiveVariantMetadata("TR • STAR TV 4K")).toEqual({
      variantGroupKey: "star tv",
      qualityRank: 50
    });
    expect(buildLiveVariantMetadata("TR • Star Tv FHD")).toEqual({
      variantGroupKey: "star tv",
      qualityRank: 300
    });
  });

  it("accepts native playback source payloads", () => {
    const payload = nativeLivePlaybackResponseSchema.parse({
      url: "http://example.com/live/1.ts",
      transport: "ts",
      headers: {
        Accept: "*/*"
      },
      cookie: "sid=abc",
      userAgent: "VLC/3.0.4 LibVLC/3.0.4",
      allowInsecureHttp: true,
      diagnosticsSessionId: "019d1643-7703-7a21-9311-823c383bc8e6",
      variantGroupKey: "star tv",
      qualityRank: 300,
      isVerified: true,
      lastCheckedAt: "2026-03-22T19:00:00.000Z"
    });

    expect(payload.transport).toBe("ts");
    expect(payload.variantGroupKey).toBe("star tv");
  });

  it("accepts native VOD playback payloads with audio metadata", () => {
    const payload = nativeVodPlaybackResponseSchema.parse({
      url: "https://example.com/vod/movie.m3u8",
      transport: "hls",
      headers: {},
      cookie: null,
      userAgent: "VLC/3.0.4 LibVLC/3.0.4",
      allowInsecureHttp: false,
      diagnosticsSessionId: "019d1643-7703-7a21-9311-823c383bc8e6",
      variantGroupKey: null,
      qualityRank: null,
      isVerified: true,
      lastCheckedAt: "2026-03-22T19:00:00.000Z",
      deliveryMode: "hls_transcoded",
      audioTracks: [
        {
          id: "a1",
          language: "tr",
          title: "Turkce",
          channels: 2,
          isDefault: true
        }
      ],
      defaultAudioTrackId: "a1",
      selectedAudioTrackId: "a1"
    });

    expect(payload.deliveryMode).toBe("hls_transcoded");
    expect(payload.audioTracks).toHaveLength(1);
  });
});
