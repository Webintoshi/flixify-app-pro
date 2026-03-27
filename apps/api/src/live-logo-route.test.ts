import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { buildServer } from "./server.js";
import { createSignedLiveLogoUrl } from "./live-logo.js";

describe("live logo proxy route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildServer();
    await app.ready();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves proxied image content for valid signed requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            etag: "\"live-logo\"",
            "last-modified": "Tue, 24 Mar 2026 12:00:00 GMT"
          }
        })
      )
    );

    const nowMs = Date.now();
    const signedUrl = createSignedLiveLogoUrl("http://example.com/logo.png", "https://api.flixify.test", {
      nowMs,
      ttlSeconds: 300
    });
    const target = new URL(signedUrl ?? "");
    const response = await app.inject({
      method: "GET",
      url: `${target.pathname}${target.search}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["cache-control"]).toBe("public, max-age=86400, stale-while-revalidate=604800");
    expect(response.headers.etag).toBe("\"live-logo\"");
    expect(response.headers["last-modified"]).toBe("Tue, 24 Mar 2026 12:00:00 GMT");
    expect(response.rawPayload).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("rejects invalid signatures", async () => {
    const signedUrl = createSignedLiveLogoUrl("http://example.com/logo.png", "https://api.flixify.test");
    const target = new URL(signedUrl ?? "");
    target.searchParams.set("sig", "0".repeat(64));

    const response = await app.inject({
      method: "GET",
      url: `${target.pathname}${target.search}`
    });

    expect(response.statusCode).toBe(403);
  });

  it("rejects malformed query parameters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/artwork/live-logo?u=%%%&exp=nope&sig=abc"
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 502 when upstream does not return an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("not-an-image", {
          status: 200,
          headers: {
            "content-type": "text/plain"
          }
        })
      )
    );

    const signedUrl = createSignedLiveLogoUrl("http://example.com/logo.txt", "https://api.flixify.test");
    const target = new URL(signedUrl ?? "");
    const response = await app.inject({
      method: "GET",
      url: `${target.pathname}${target.search}`
    });

    expect(response.statusCode).toBe(502);
  });

  it("normalizes avif artwork responses to png", async () => {
    const avifBuffer = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 128, b: 255, alpha: 1 }
      }
    })
      .avif()
      .toBuffer();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(avifBuffer, {
          status: 200,
          headers: {
            "content-type": "image/avif",
            etag: "\"avif\"",
            "last-modified": "Tue, 24 Mar 2026 12:00:00 GMT"
          }
        })
      )
    );

    const signedUrl = createSignedLiveLogoUrl("https://example.com/poster.avif", "https://api.flixify.test");
    const target = new URL(signedUrl ?? "");
    const response = await app.inject({
      method: "GET",
      url: `${target.pathname}${target.search}`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["last-modified"]).toBeUndefined();
    expect(response.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});
