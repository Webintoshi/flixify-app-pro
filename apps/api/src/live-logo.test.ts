import { describe, expect, it } from "vitest";
import {
  createCatalogArtworkUrl,
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
});
