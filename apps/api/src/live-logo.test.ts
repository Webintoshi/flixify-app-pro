import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  createCatalogArtworkUrl,
  fetchLiveLogoFromUpstream,
  createSignedLiveLogoUrl,
  isBlockedArtworkHostname,
  signLiveLogoItems,
  verifySignedLiveLogoQuery
} from "./live-logo.js";

describe("live logo helpers", () => {
  it("creates signed live logo urls for catalog items", () => {
    const nowMs = Date.UTC(2026, 2, 24, 12, 0, 0);
    const [item] = signLiveLogoItems(
      [
        {
          id: "channel-1",
          logoUrl: "http://example.com/logo.png"
        }
      ],
      "https://api.flixify.test",
      { nowMs, ttlSeconds: 300 }
    );

    expect(item?.logoUrl).toBeTruthy();

    const signedUrl = new URL(item?.logoUrl ?? "");
    expect(signedUrl.origin).toBe("https://api.flixify.test");
    expect(signedUrl.pathname).toBe("/artwork/live-logo");

    const verification = verifySignedLiveLogoQuery(Object.fromEntries(signedUrl.searchParams.entries()), nowMs);
    expect(verification).toEqual({
      ok: true,
      value: {
        sourceUrl: "http://example.com/logo.png",
        expiresAt: Math.floor(nowMs / 1000) + 300
      }
    });
  });

  it("drops invalid artwork sources during catalog signing", () => {
    const [item] = signLiveLogoItems(
      [
        {
          id: "channel-1",
          logoUrl: "javascript:alert(1)"
        }
      ],
      "https://api.flixify.test"
    );

    expect(item?.logoUrl).toBeNull();
  });

  it("rejects expired and tampered signatures", () => {
    const nowMs = Date.UTC(2026, 2, 24, 12, 0, 0);
    const signedUrl = createSignedLiveLogoUrl("http://example.com/logo.png", "https://api.flixify.test", {
      nowMs,
      ttlSeconds: 60
    });

    expect(signedUrl).toBeTruthy();

    const expiredQuery = Object.fromEntries(new URL(signedUrl ?? "").searchParams.entries());
    expect(verifySignedLiveLogoQuery(expiredQuery, nowMs + 61_000)).toMatchObject({
      ok: false,
      error: {
        statusCode: 403
      }
    });

    const tamperedUrl = new URL(signedUrl ?? "");
    tamperedUrl.searchParams.set("sig", `${tamperedUrl.searchParams.get("sig")?.slice(0, -1) ?? ""}0`);
    expect(verifySignedLiveLogoQuery(Object.fromEntries(tamperedUrl.searchParams.entries()), nowMs)).toMatchObject({
      ok: false,
      error: {
        statusCode: 403
      }
    });
  });

  it("blocks localhost and private hosts", () => {
    expect(isBlockedArtworkHostname("localhost")).toBe(true);
    expect(isBlockedArtworkHostname("127.0.0.1")).toBe(true);
    expect(isBlockedArtworkHostname("192.168.1.15")).toBe(true);
    expect(isBlockedArtworkHostname("[::1]")).toBe(true);
    expect(isBlockedArtworkHostname("fe80::1")).toBe(true);
    expect(isBlockedArtworkHostname("example.com")).toBe(false);
  });

  it("falls back to direct artwork urls for native clients when proxy signing rejects private hosts", () => {
    expect(
      createCatalogArtworkUrl({
        sourceUrl: "http://192.168.1.25:8080/posters/movie.jpg",
        origin: "https://api.flixify.test",
        clientRuntime: "native"
      })
    ).toBe("http://192.168.1.25:8080/posters/movie.jpg");
  });

  it("keeps browser catalog artwork blocked when the source points to a private host", () => {
    expect(
      createCatalogArtworkUrl({
        sourceUrl: "http://192.168.1.25:8080/posters/movie.jpg",
        origin: "https://api.flixify.test",
        clientRuntime: "browser"
      })
    ).toBeNull();
  });

  it("prefers jpeg and png when proxying artwork upstream", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(Uint8Array.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: {
          "content-type": "image/jpeg"
        }
      })
    );

    await fetchLiveLogoFromUpstream("https://example.com/poster.jpg", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]?.toString()).toBe("https://example.com/poster.jpg");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        accept: "image/jpeg,image/png,image/webp,image/gif,image/apng,image/svg+xml,image/*;q=0.8,*/*;q=0.5"
      }
    });
  });

  it("converts avif artwork into png for native compatibility", async () => {
    const avifBuffer = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .avif()
      .toBuffer();

    const proxiedLogo = await fetchLiveLogoFromUpstream("https://example.com/poster.avif", {
      fetchImpl: vi.fn(async () =>
        new Response(avifBuffer, {
          status: 200,
          headers: {
            "content-type": "image/avif",
            etag: "\"upstream-avif\"",
            "last-modified": "Tue, 24 Mar 2026 12:00:00 GMT"
          }
        })
      )
    });

    expect(proxiedLogo.contentType).toBe("image/png");
    expect(proxiedLogo.etag).toBeNull();
    expect(proxiedLogo.lastModified).toBeNull();
    expect(proxiedLogo.body.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
