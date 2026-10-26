import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/flixify_test";
  process.env.APP_JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
  process.env.ADMIN_EMAILS = "admin@example.test";
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_JWKS_URL = "http://localhost/auth/v1/.well-known/jwks.json";
  process.env.APP_DEMO_MODE = "false";
});

import * as live from "./live.js";
import * as vod from "./vod.js";
import * as repository from "./repository.js";
import { signAccessToken } from "./security.js";
import { buildServer } from "./server.js";

describe("viewer IP browser playback", () => {
  const app = buildServer();
  let authorization = "";
  let context: any;
  const deadline = new Date(Date.now() + 600_000).toISOString();
  beforeAll(async () => { await app.ready(); authorization = `Bearer ${await signAccessToken({ userId: "trial-user", sessionId: "trial-session" })}`; });
  beforeEach(() => {
    context = { summary: { id: "trial-user", status: "active" }, snapshotVersion: 1, canViewCatalog: true, canPlay: true,
      accessUntil: deadline, isThreeHourTrial: true, trialProviderExpiresAt: deadline, sourceStatus: "ready",
      playbackBaseUrl: "https://provider.example.test", iptvCredentials: { username: "personal", password: "secret" },
      sharedReferenceCredentials: { username: "shared", password: "shared-secret" } };
    vi.spyOn(repository, "getUserStatus").mockResolvedValue("active");
    vi.spyOn(repository, "getSessionById").mockResolvedValue({ id: "trial-session", user_id: "trial-user", expires_at: deadline, revoked_at: null } as never);
    vi.spyOn(repository, "touchDeviceSession").mockResolvedValue(undefined);
    vi.spyOn(repository, "getUserContext").mockImplementation(async () => context);
    vi.spyOn(repository, "getLiveChannelForPlayback").mockResolvedValue({ id: "1", snapshot_version: 1, title: "Channel", stream_path: "live/__IPTV_USERNAME__/__IPTV_PASSWORD__/1.m3u8", transport: "hls", health_status: "broken", last_error: "upstream 404", last_checked_at: new Date().toISOString() } as never);
    vi.spyOn(repository, "getEpisodeForPlayback").mockResolvedValue({ id: "1", snapshot_version: 1, stream_path: "series/__IPTV_USERNAME__/__IPTV_PASSWORD__/1.mp4" } as never);
    vi.spyOn(repository, "updateLiveChannelHealth").mockResolvedValue(undefined);
    vi.spyOn(repository, "reportVodPlaybackEvent").mockResolvedValue(undefined);
    vi.spyOn(repository, "insertLivePlaybackDiagnostic").mockResolvedValue(undefined);
    vi.spyOn(live, "probeLiveStream").mockResolvedValue({ ok: false, transport: "unknown", statusCode: 403, errorMessage: "upstream 403" } as never);
    vi.spyOn(vod, "probeVodStream").mockResolvedValue({ ok: false, transport: "unknown", statusCode: 403, errorMessage: "upstream 403" } as never);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("server network forbidden"); }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterAll(async () => { await app.close(); });
  const request = (path: string) => app.inject({ method: "GET", url: path, headers: { authorization } });
  for (const trial of [true, false]) {
    for (const extension of ["mp4", "mkv", "m3u8"]) {
      it(`returns exact personal ${extension} for ${trial ? "trial" : "paid"} without server probe`, async () => {
        context.isThreeHourTrial = trial;
        vi.mocked(repository.getEpisodeForPlayback).mockResolvedValue({ id: "1", snapshot_version: 1, stream_path: `series/__IPTV_USERNAME__/__IPTV_PASSWORD__/1.${extension}` } as never);
        const response = await request("/me/vod/episode/1/playback?clientRuntime=browser&direct=1");
        expect(response.json()).toMatchObject({ deliveryMode: "direct_provider", expiresAt: deadline, canPlay: true, url: `https://provider.example.test/series/personal/secret/1.${extension}` });
        expect(fetch).not.toHaveBeenCalled();
        expect(vod.probeVodStream).not.toHaveBeenCalled();
        expect(live.probeLiveStream).not.toHaveBeenCalled();
      });
    }
    it(`returns personal live for ${trial ? "trial" : "paid"} before shared health and probes`, async () => {
      context.isThreeHourTrial = trial;
      const response = await request("/me/live/1/playback?clientRuntime=browser");
      expect(response.json()).toMatchObject({ deliveryMode: "direct_provider", expiresAt: deadline, canPlay: true, url: "https://provider.example.test/live/personal/secret/1.m3u8" });
      expect(fetch).not.toHaveBeenCalled();
        expect(vod.probeVodStream).not.toHaveBeenCalled();
        expect(live.probeLiveStream).not.toHaveBeenCalled();
      expect(repository.updateLiveChannelHealth).not.toHaveBeenCalled();
    });
  }
  for (const variant of ["shared", "missing", "overlong", "malformed", "expired", "currentExpired", "missingDeadline", "http", "unsupported"]) {
    it(`does not issue direct playback for ${variant}`, async () => {
      if (variant === "shared") context.iptvCredentials = context.sharedReferenceCredentials;
      if (variant === "missing") context.iptvCredentials = null;
      if (variant === "overlong") context.trialProviderExpiresAt = new Date(Date.parse(deadline) + 1).toISOString();
      if (variant === "malformed") context.trialProviderExpiresAt = "invalid";
      if (variant === "expired") context.accessUntil = new Date(Date.now() - 1).toISOString();
      if (variant === "currentExpired") { const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now); context.accessUntil = new Date(now).toISOString(); }
      if (variant === "missingDeadline") { context.accessUntil = null; context.isThreeHourTrial = false; }
      if (variant === "http") context.playbackBaseUrl = "http://provider.example.test";
      if (variant === "unsupported") vi.mocked(repository.getEpisodeForPlayback).mockResolvedValue({ stream_path: "series/1.avi" } as never);
      const response = await request("/me/vod/episode/1/playback?clientRuntime=browser&vodDirect=1");
      expect(response.json().deliveryMode).not.toBe("direct_provider");
      expect(response.body).not.toContain("shared-secret");
      if (variant === "unsupported") vi.mocked(repository.getLiveChannelForPlayback).mockResolvedValue({ id: "1", snapshot_version: 1, stream_path: "live/__IPTV_USERNAME__/__IPTV_PASSWORD__/1.avi", transport: "unknown" } as never);
      const liveResponse = await request("/me/live/1/playback?clientRuntime=browser");
      expect(liveResponse.json().deliveryMode).not.toBe("direct_provider");
      expect(liveResponse.body).not.toContain("shared-secret");
    });
  }
});
