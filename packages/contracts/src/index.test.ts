import { describe, expect, it } from "vitest";
import { buildLiveVariantMetadata } from "./live-variants";
import { loginByCodeInputSchema, nativeLivePlaybackResponseSchema, paginationQuerySchema } from "./schemas";

describe("contracts", () => {
  it("accepts valid kryptonite code payloads", () => {
    const payload = loginByCodeInputSchema.parse({
      code: "ABCD1234EFGH5678",
      deviceName: "Apple TV",
      platform: "tvos"
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
});
