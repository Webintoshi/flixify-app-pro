import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/flixify_test";
  process.env.APP_JWT_SECRET = "test-only-secret-with-at-least-thirty-two-characters";
  process.env.ADMIN_EMAILS = "admin@example.test";
  process.env.SUPABASE_URL = "http://localhost";
  process.env.SUPABASE_JWKS_URL = "http://localhost/auth/v1/.well-known/jwks.json";
  process.env.APP_DEMO_MODE = "false";
});
import * as repository from "./repository.js";
import { signAccessToken } from "./security.js";
import { buildServer } from "./server.js";

describe("GET /me/provider-session", () => {
  const app = buildServer();
  const deadline = new Date(Date.now() + 600_000).toISOString();
  let authorization: string;
  let context: any;
  beforeAll(async () => {
    await app.ready();
    authorization = `Bearer ${await signAccessToken({ userId: "user-a", sessionId: "session-a" })}`;
  });
  beforeEach(() => {
    context = { summary: { id: "user-a", status: "active" }, canPlay: true, accessUntil: deadline,
      isThreeHourTrial: false, trialProviderExpiresAt: null, playbackBaseUrl: "https://provider.example/",
      iptvCredentials: { username: "personal", password: "personal-secret" },
      sharedReferenceCredentials: { username: "shared", password: "shared-secret" } };
    vi.spyOn(repository, "getUserStatus").mockResolvedValue("active");
    vi.spyOn(repository, "getSessionById").mockResolvedValue({ id: "session-a", user_id: "user-a", expires_at: deadline, revoked_at: null } as never);
    vi.spyOn(repository, "touchDeviceSession").mockResolvedValue(undefined);
    vi.spyOn(repository, "getUserContext").mockImplementation(async () => context);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Forbidden server fetch"); }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterAll(async () => { await app.close(); });
  const request = (auth: string | undefined = authorization) => app.inject({ method: "GET", url: "/me/provider-session", headers: auth ? { authorization: auth } : {} });
  const privateResponse = (response: any) => {
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers.vary).toContain("Authorization");
    expect(response.headers.vary).toContain("Origin");
    expect(fetch).not.toHaveBeenCalled();
  };
  it("returns exactly personal data without upstream calls and remains stable across token refresh", async () => {
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accountId: "user-a", sourceVersion: expect.any(String), providerOrigin: "https://provider.example",
      username: "personal", password: "personal-secret", expiresAt: deadline, moviePolicy: "general-audience-only" });
    expect(response.body).not.toContain("shared");
    privateResponse(response);
    const nextToken = await signAccessToken({ userId: "user-a", sessionId: "session-b" });
    expect((await request(`Bearer ${nextToken}`)).json().sourceVersion).toBe(response.json().sourceVersion);
    expect(repository.getUserContext).toHaveBeenCalledWith("user-a");
  });
  it.each(["identity", "shared", "missing", "deadline", "expired", "denied", "unverified-trial", "overlong-trial", "http", "path"])("denies %s with private generic error", async variant => {
    if (variant === "identity") context.summary.id = "other-user";
    if (variant === "shared") context.iptvCredentials = context.sharedReferenceCredentials;
    if (variant === "missing") context.iptvCredentials = null;
    if (variant === "deadline") context.accessUntil = null;
    if (variant === "expired") context.accessUntil = new Date(Date.now() - 1).toISOString();
    if (variant === "denied") context.canPlay = false;
    if (variant === "unverified-trial") context.isThreeHourTrial = true;
    if (variant === "overlong-trial") { context.isThreeHourTrial = true; context.trialProviderExpiresAt = new Date(Date.parse(deadline) + 1).toISOString(); }
    if (variant === "http") context.playbackBaseUrl = "http://provider.example";
    if (variant === "path") context.playbackBaseUrl = "https://provider.example/api";
    const response = await request();
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toMatch(/personal|shared|provider\.example|other-user/);
    privateResponse(response);
  });
  it("returns the earlier verified trial expiry", async () => {
    context.isThreeHourTrial = true;
    context.trialProviderExpiresAt = new Date(Date.now() + 300_000).toISOString();
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(response.json().expiresAt).toBe(context.trialProviderExpiresAt);
    privateResponse(response);
  });
  it.each(["missing", "blocked", "revoked", "wrong-session-owner"])("denies %s authentication before retrieving credentials", async variant => {
    if (variant === "blocked") vi.mocked(repository.getUserStatus).mockResolvedValue("blocked");
    if (variant === "revoked") vi.mocked(repository.getSessionById).mockResolvedValue({ user_id: "user-a", revoked_at: deadline } as never);
    if (variant === "wrong-session-owner") vi.mocked(repository.getSessionById).mockResolvedValue({ user_id: "other", revoked_at: null } as never);
    const response = await request(variant === "missing" ? "" : authorization);
    expect(response.statusCode).toBe(variant === "blocked" ? 403 : 401);
    expect(repository.getUserContext).not.toHaveBeenCalled();
    privateResponse(response);
  });
  it("does not expose or log repository exception secrets", async () => {
    vi.mocked(repository.getUserContext).mockRejectedValue(new Error("personal-secret shared-secret"));
    vi.spyOn(app.log, "child").mockReturnValue(app.log);
    const logger = vi.spyOn(app.log, "warn");
    const response = await request();
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret");
    expect(logger).toHaveBeenCalledWith({ statusClass: "runtime-error" }, "Personal provider session unavailable");
    expect(JSON.stringify(logger.mock.calls)).not.toContain("secret");
    privateResponse(response);
  });
});

describe("demo provider bootstrap privacy", () => {
  it("never retrieves real provider credentials for an authenticated demo session", async () => {
    vi.resetModules();
    process.env.APP_DEMO_MODE = "true";
    const demo = await import("./demo-store.js");
    const repo = await import("./repository.js");
    const security = await import("./security.js");
    const server = await import("./server.js");
    vi.spyOn(demo, "getDemoMe").mockReturnValue({ user: { id: "demo-user", status: "active" } } as never);
    vi.spyOn(demo, "getDemoSession").mockReturnValue({ sessionId: "demo-session", userId: "demo-user" } as never);
    const contextLookup = vi.spyOn(repo, "getUserContext");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Forbidden server fetch"); }));
    const app = server.buildServer();
    try {
      const token = await security.signAccessToken({ userId: "demo-user", sessionId: "demo-session" });
      const response = await app.inject({ method: "GET", url: "/me/provider-session", headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(403);
      expect(response.headers["cache-control"]).toContain("private, no-store");
      expect(response.json()).toEqual({ message: "Kisisel yayin erisimi kullanilamiyor." });
      expect(contextLookup).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await app.close();
      process.env.APP_DEMO_MODE = "false";
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
