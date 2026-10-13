import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/flixify_test";
  process.env.APP_JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
  process.env.ADMIN_EMAILS = "admin@example.test";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_JWKS_URL = "https://example.test/auth/v1/.well-known/jwks.json";
  process.env.APP_DEMO_MODE = "false";
});

import * as repository from "./repository.js";
import { signAccessToken } from "./security.js";
import { buildServer } from "./server.js";

describe("three-hour trial playback routes", () => {
  const app = buildServer();
  let authorization = "";

  beforeAll(async () => {
    await app.ready();
    authorization = `Bearer ${await signAccessToken({ userId: "trial-user", sessionId: "trial-session" })}`;
  });

  beforeEach(() => {
    vi.spyOn(repository, "getUserStatus").mockResolvedValue("active");
    vi.spyOn(repository, "getSessionById").mockResolvedValue({
      id: "trial-session",
      user_id: "trial-user",
      refresh_token_hash: "unused",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      device_name: null,
      platform: null,
      revoked_at: null
    });
    vi.spyOn(repository, "touchDeviceSession").mockResolvedValue(undefined);
    vi.spyOn(repository, "getUserContext").mockResolvedValue({
      summary: { id: "trial-user", status: "active" },
      snapshotVersion: 1,
      canViewCatalog: true,
      canPlay: true,
      accessUntil: new Date(Date.now() + 60_000).toISOString(),
      isThreeHourTrial: true,
      sourceStatus: "ready",
      playbackBaseUrl: "https://provider.example.test",
      iptvCredentials: { username: "trial-line", password: "trial-pass" },
      sharedReferenceCredentials: { username: "shared-line", password: "shared-pass" }
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await app.close();
  });

  it("does not disclose a provider credential URL in the trial live catalog", async () => {
    vi.spyOn(repository, "listLiveCatalog").mockResolvedValue({
      items: [{
        id: "channel-1",
        title: "Test Channel",
        groupTitle: "Test",
        logoUrl: null,
        streamUrl: "https://provider.example.test/live/trial-line/trial-pass/1.ts",
        playbackAllowed: true,
        transport: "ts",
        healthStatus: "healthy",
        isVerified: true,
        lastCheckedAt: null,
        variantGroupKey: null,
        qualityRank: null
      }],
      page: 1,
      pageSize: 20,
      total: 1,
      groups: []
    } as never);

    const response = await app.inject({ method: "GET", url: "/me/catalog/live", headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].streamUrl).toBeNull();
  });

  it("rejects trial native VOD when only shared provider credentials remain", async () => {
    vi.spyOn(repository, "getUserContext").mockResolvedValue({
      summary: { id: "trial-user", status: "active" },
      snapshotVersion: 1,
      canViewCatalog: true,
      canPlay: true,
      accessUntil: new Date(Date.now() + 60_000).toISOString(),
      isThreeHourTrial: true,
      sourceStatus: "ready",
      playbackBaseUrl: "https://provider.example.test",
      iptvCredentials: null,
      sharedReferenceCredentials: { username: "shared-line", password: "shared-pass" }
    } as never);
    vi.spyOn(repository, "getMovieForPlayback").mockResolvedValue({
      id: "movie-1",
      snapshot_version: 1,
      title: "Test Movie",
      poster_url: null,
      group_title: "Test",
      stream_path: "movie/1.m3u8",
      order_index: 1
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("#EXTM3U\n#EXTINF:4,\nsegment-0.ts\n", {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" }
    })));

    const response = await app.inject({
      method: "GET",
      url: "/me/native/vod/movie/movie-1/playback?platform=windows-native-qt",
      headers: { authorization }
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("shared-line");
  });

  it("rejects a trial line that aliases the shared provider credentials", async () => {
    vi.spyOn(repository, "getUserContext").mockResolvedValue({
      summary: { id: "trial-user", status: "active" },
      snapshotVersion: 1,
      canViewCatalog: true,
      canPlay: true,
      accessUntil: new Date(Date.now() + 60_000).toISOString(),
      isThreeHourTrial: true,
      sourceStatus: "ready",
      playbackBaseUrl: "https://provider.example.test",
      iptvCredentials: { username: "shared-line", password: "shared-pass" },
      sharedReferenceCredentials: { username: "shared-line", password: "shared-pass" }
    } as never);
    vi.spyOn(repository, "getMovieForPlayback").mockResolvedValue({
      id: "movie-1",
      snapshot_version: 1,
      title: "Test Movie",
      poster_url: null,
      group_title: "Test",
      stream_path: "movie/1.m3u8",
      order_index: 1
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("#EXTM3U\n#EXTINF:4,\nsegment-0.ts\n", {
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl" }
    })));

    const response = await app.inject({
      method: "GET",
      url: "/me/native/vod/movie/movie-1/playback?platform=windows-native-qt",
      headers: { authorization }
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("shared-line");
  });

  it("does not hand out a direct VOD URL when the trial ends during source preparation", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.spyOn(repository, "getUserContext").mockResolvedValue({
      summary: { id: "trial-user", status: "active" },
      snapshotVersion: 1,
      canViewCatalog: true,
      canPlay: true,
      accessUntil: new Date(now + 100).toISOString(),
      isThreeHourTrial: true,
      sourceStatus: "ready",
      playbackBaseUrl: "https://provider.example.test",
      iptvCredentials: { username: "trial-line", password: "trial-pass" },
      sharedReferenceCredentials: { username: "shared-line", password: "shared-pass" }
    } as never);
    vi.spyOn(repository, "getMovieForPlayback").mockResolvedValue({
      id: "movie-1",
      snapshot_version: 1,
      title: "Test Movie",
      poster_url: null,
      group_title: "Test",
      stream_path: "movie/1.m3u8",
      order_index: 1
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      now += 101;
      return new Response("#EXTM3U\n#EXTINF:4,\nsegment-0.ts\n", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" }
      });
    }));

    const response = await app.inject({
      method: "GET",
      url: "/me/vod/movie/movie-1/playback?clientRuntime=app&platform=android",
      headers: { authorization }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ canPlay: false, url: null });
  });
});
