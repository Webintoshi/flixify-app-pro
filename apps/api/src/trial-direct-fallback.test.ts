import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/flixify_test";
  process.env.APP_JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
  process.env.ADMIN_EMAILS = "admin@example.test";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_JWKS_URL = "https://example.test/auth/v1/.well-known/jwks.json";
  process.env.APP_DEMO_MODE = "false";
});

const probe = vi.hoisted(() => ({
  live: vi.fn(),
  vod: vi.fn()
}));

vi.mock("./live.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./live.js")>();
  return { ...actual, probeLiveStream: probe.live };
});

vi.mock("./live-playback.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./live-playback.js")>();
  return {
    ...actual,
    createLivePlaybackManager: (...args: Parameters<typeof actual.createLivePlaybackManager>) => ({
      ...actual.createLivePlaybackManager(...args),
      createPlayback: async () => ({ canPlay: false, url: null, errorMessage: "relay unavailable" })
    })
  };
});

vi.mock("./vod.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vod.js")>();
  return {
    ...actual,
    probeVodStream: probe.vod,
    createVodPlaybackManager: (...args: Parameters<typeof actual.createVodPlaybackManager>) => ({
      ...actual.createVodPlaybackManager(...args),
      createPlayback: async () => ({ canPlay: false, url: null, errorMessage: "status 403" })
    })
  };
});

import * as repository from "./repository.js";
import { signAccessToken } from "./security.js";
import { buildServer } from "./server.js";

const PROVIDER_URL_MARKER = "/trial-line/trial-pass/";

function userContext(isThreeHourTrial: boolean) {
  return {
    summary: { id: "trial-user", status: "active" },
    snapshotVersion: 1,
    canViewCatalog: true,
    canPlay: true,
    accessUntil: new Date(Date.now() + 60_000).toISOString(),
    isThreeHourTrial,
    sourceStatus: "ready",
    playbackBaseUrl: "https://provider.example.test",
    iptvCredentials: { username: "trial-line", password: "trial-pass" },
    sharedReferenceCredentials: { username: "shared-line", password: "shared-pass" }
  } as never;
}

describe("three-hour trial direct source fallback", () => {
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
    vi.spyOn(repository, "getUserContext").mockResolvedValue(userContext(true));
    vi.spyOn(repository, "getLiveChannelForPlayback").mockResolvedValue({
      id: "channel-1",
      snapshot_version: 1,
      title: "Test Channel",
      stream_path: "live/1.ts",
      transport: "ts",
      health_status: "healthy",
      last_checked_at: null,
      failure_count: 0,
      last_error: null
    } as never);
    vi.spyOn(repository, "updateLiveChannelHealth").mockResolvedValue(undefined);
    vi.spyOn(repository, "getMovieForPlayback").mockResolvedValue({
      id: "movie-1",
      snapshot_version: 1,
      title: "Test Movie",
      poster_url: null,
      group_title: "Test",
      stream_path: "movie/1.m3u8",
      order_index: 1
    });
    probe.live.mockResolvedValue({
      ok: false,
      statusCode: 403,
      finalUrl: "https://provider.example.test/live/1.ts",
      transport: "ts",
      cookie: null,
      errorMessage: "Access denied"
    });
    probe.vod.mockResolvedValue({
      ok: true,
      statusCode: 200,
      finalUrl: "https://provider.example.test/movie/1.m3u8",
      transport: "hls",
      cookie: null,
      errorMessage: null
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    probe.live.mockReset();
    probe.vod.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    "/me/live/channel-1/playback?clientRuntime=browser",
    "/me/live/channel-1/playback?clientRuntime=app",
    "/me/native/live/channel-1/playback"
  ])("does not expose the live provider URL to a trial on %s", async (url) => {
    const response = await app.inject({ method: "GET", url, headers: { authorization } });
    expect(response.body).not.toContain(PROVIDER_URL_MARKER);
    if (url.includes("/native/")) {
      expect(response.statusCode).toBe(503);
    } else {
      expect(response.json().canPlay).toBe(false);
      expect(response.json().url).toBeNull();
    }
  });

  it.each([
    "/me/vod/movie/movie-1/playback?clientRuntime=app&platform=android",
    "/me/native/vod/movie/movie-1/playback?platform=windows-native-qt"
  ])("does not expose the VOD provider URL to a trial on %s", async (url) => {
    const response = await app.inject({ method: "GET", url, headers: { authorization } });
    expect(response.body).not.toContain(PROVIDER_URL_MARKER);
    if (url.includes("/native/")) {
      expect(response.statusCode).toBe(503);
    } else {
      expect(response.json().canPlay).toBe(false);
      expect(response.json().url).toBeNull();
    }
  });

  it("does not expose the VOD provider URL if source preparation throws", async () => {
    probe.vod.mockRejectedValue(new Error("upstream unavailable"));
    const response = await app.inject({
      method: "GET",
      url: "/me/vod/movie/movie-1/playback?clientRuntime=app&platform=android",
      headers: { authorization }
    });
    expect(response.json()).toMatchObject({ canPlay: false, url: null });
    expect(response.body).not.toContain(PROVIDER_URL_MARKER);
  });

  it("does not expose the native VOD URL when the source probe fails", async () => {
    probe.vod.mockResolvedValue({
      ok: false,
      statusCode: 500,
      finalUrl: "https://provider.example.test/movie/1.m3u8",
      transport: "hls",
      cookie: null,
      errorMessage: "Upstream 500"
    });
    const response = await app.inject({
      method: "GET",
      url: "/me/native/vod/movie/movie-1/playback?platform=windows-native-qt",
      headers: { authorization }
    });
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain(PROVIDER_URL_MARKER);
  });

  it("keeps direct fallback for a non-trial subscriber", async () => {
    vi.spyOn(repository, "getUserContext").mockResolvedValue(userContext(false));
    const response = await app.inject({
      method: "GET",
      url: "/me/native/live/channel-1/playback",
      headers: { authorization }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().url).toContain(PROVIDER_URL_MARKER);
  });

  it("keeps VOD direct fallback for a non-trial subscriber", async () => {
    vi.spyOn(repository, "getUserContext").mockResolvedValue(userContext(false));
    const response = await app.inject({
      method: "GET",
      url: "/me/native/vod/movie/movie-1/playback?platform=windows-native-qt",
      headers: { authorization }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().url).toContain(PROVIDER_URL_MARKER);
  });
});
