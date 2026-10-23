import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/flixify_test";
  process.env.APP_JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
  process.env.ADMIN_EMAILS = "admin@example.test";
  process.env.SUPABASE_URL = "https://example.test";
  process.env.SUPABASE_JWKS_URL = "https://example.test/auth/v1/.well-known/jwks.json";
  process.env.APP_DEMO_MODE = "false";
  process.env.VOD_PROXY_URLS = "";
});

const probe = vi.hoisted(() => ({ vod: vi.fn() }));

vi.mock("./vod.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vod.js")>();
  return {
    ...actual,
    probeVodStream: probe.vod,
    createVodPlaybackManager: (...args: Parameters<typeof actual.createVodPlaybackManager>) => ({
      ...actual.createVodPlaybackManager(...args),
      createPlayback: async () => ({ canPlay: false, url: null, errorMessage: "relay unavailable" })
    })
  };
});

import * as repository from "./repository.js";
import { signAccessToken } from "./security.js";
import { buildServer } from "./server.js";

function context(trial: boolean, playbackBaseUrl = "https://provider.example.test", accessOffsetMs = 60_000) {
  return {
    summary: { id: "episode-user", status: "active" },
    snapshotVersion: 1,
    canViewCatalog: true,
    canPlay: true,
    accessUntil: new Date(Date.now() + accessOffsetMs).toISOString(),
    isThreeHourTrial: trial,
    sourceStatus: "ready",
    playbackBaseUrl,
    iptvCredentials: { username: "trial-line", password: "trial-pass" },
    sharedReferenceCredentials: { username: "shared-line", password: "shared-pass" }
  } as never;
}

describe("candidate API episode direct playback", () => {
  const app = buildServer();
  let authorization = "";

  beforeAll(async () => {
    await app.ready();
    authorization = `Bearer ${await signAccessToken({ userId: "episode-user", sessionId: "episode-session" })}`;
  });

  beforeEach(() => {
    vi.spyOn(repository, "getUserStatus").mockResolvedValue("active");
    vi.spyOn(repository, "getSessionById").mockResolvedValue({
      id: "episode-session",
      user_id: "episode-user",
      refresh_token_hash: "unused",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      device_name: null,
      platform: null,
      revoked_at: null
    });
    vi.spyOn(repository, "touchDeviceSession").mockResolvedValue(undefined);
    vi.spyOn(repository, "getUserContext").mockResolvedValue(context(false));
    vi.spyOn(repository, "getEpisodeForPlayback").mockResolvedValue({
      id: "episode-1",
      snapshot_version: 1,
      title: "Test Episode",
      stream_path: "series/__IPTV_USERNAME__/__IPTV_PASSWORD__/1.mp4"
    } as never);
    probe.vod.mockResolvedValue({
      ok: true,
      statusCode: 200,
      finalUrl: "https://provider.example.test/series/1.mp4",
      transport: "mp4",
      cookie: null,
      errorMessage: null
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    probe.vod.mockReset();
  });

  afterAll(async () => { await app.close(); });

  const route = "/me/vod/episode/episode-1/playback?clientRuntime=browser&vodDirect=1";

  it("gives a paid browser the HTTPS source before the blocked server probe", async () => {
    probe.vod.mockRejectedValue(new Error("provider forbids this server country"));
    const response = await app.inject({ method: "GET", url: route, headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      canPlay: true,
      deliveryMode: "direct_provider",
      transport: "mp4",
      url: "https://provider.example.test/series/trial-line/trial-pass/1.mp4"
    });
    expect(probe.vod).not.toHaveBeenCalled();
  });

  it("never exposes the provider URL to a three hour trial", async () => {
    vi.spyOn(repository, "getUserContext").mockResolvedValue(context(true));
    const response = await app.inject({ method: "GET", url: route, headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ canPlay: false, url: null });
    expect(response.body).not.toContain("/trial-line/trial-pass/");
  });

  it.each([
    ["no personal line", null],
    ["shared line assigned as primary", { username: "shared-line", password: "shared-pass" }]
  ])("never exposes shared reference credentials with %s", async (_case, credentials) => {
    vi.spyOn(repository, "getUserContext").mockResolvedValue({
      ...(context(false) as Record<string, unknown>),
      iptvCredentials: credentials
    } as never);
    const response = await app.inject({ method: "GET", url: route, headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ canPlay: false, url: null });
    expect(response.body).not.toContain("/shared-line/shared-pass/");
  });

  it("does not start direct playback after access expires", async () => {
    vi.spyOn(repository, "getUserContext").mockResolvedValue(context(false, "https://provider.example.test", -60_000));
    const response = await app.inject({ method: "GET", url: route, headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ canPlay: false, url: null });
  });

  it("keeps direct=0 and HTTP sources on the relay path", async () => {
    const fallback = await app.inject({ method: "GET", url: `${route}&direct=0`, headers: { authorization } });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json()).toMatchObject({ canPlay: false, url: null });
    vi.spyOn(repository, "getUserContext").mockResolvedValue(context(false, "http://provider.example.test"));
    const insecure = await app.inject({ method: "GET", url: route, headers: { authorization } });
    expect(insecure.statusCode).toBe(200);
    expect(insecure.json()).toMatchObject({ canPlay: false, url: null });
    expect(insecure.body).not.toContain("http://provider.example.test/");
  });
});
