import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { EmailAuthError } from "./email-auth.js";
import { registerEmailAuthRoutes } from "./email-auth-routes.js";

const headers = { origin: "https://flixify.vip" };
const registration = {
  email: "viewer@example.com",
  intent: "register",
  installationId: "fixture-installation",
  platform: "web",
  deviceName: "Fixture"
};
const verification = {
  challengeId: "11111111-1111-4111-8111-111111111111",
  challengeSecret: "a".repeat(43),
  code: "012345",
  installationId: "fixture-installation"
} as const;

function fixture(enabled = true) {
  const app = Fastify();
  const service = {
    request: vi.fn(async () => ({
      challengeId: verification.challengeId,
      challengeSecret: verification.challengeSecret,
      maskedEmail: "v•••@example.com",
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
      delivery: "accepted" as const
    })),
    verify: vi.fn(async () => ({
      accessToken: "fixture-access-token",
      refreshToken: "fixture-refresh-token",
      kryptoniteCode: null,
      user: { id: "fixture-user", codeSuffix: null, kryptoniteCode: null }
    }))
  };
  const authenticate = vi.fn(async () => ({ userId: "fixture-user", sessionId: "fixture-session", authMethod: "account_code" }));
  registerEmailAuthRoutes(app, { service: enabled ? service : null, authenticate });
  return { app, service, authenticate };
}

describe("email authentication routes", () => {
  it("keeps disabled delivery and verification unavailable", async () => {
    const { app, service } = fixture(false);
    try {
      const status = await app.inject("/auth/email/status");
      expect(status.json()).toEqual({ enabled: false, deliveryChannel: "email", reason: "not_configured" });
      expect(status.headers["cache-control"]).toBe("no-store");
      const response = await app.inject({ method: "POST", url: "/auth/email/request", headers, payload: registration });
      expect(response.statusCode).toBe(503);
      expect(service.request).not.toHaveBeenCalled();
      expect(service.verify).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("rejects foreign origins, native callers without origin and malformed inputs before sending", async () => {
    const { app, service } = fixture();
    try {
      for (const origin of ["https://flixify.vip.evil.invalid", "http://localhost:3192", "null"]) {
        const response = await app.inject({ method: "POST", url: "/auth/email/request", headers: { origin }, payload: registration });
        expect(response.statusCode).toBe(403);
        expect(response.json().reason).toBe("origin_forbidden");
      }
      const native = await app.inject({ method: "POST", url: "/auth/email/request", headers: { "x-flixify-client-runtime": "android_phone" }, payload: registration });
      expect(native.statusCode).toBe(403);
      for (const payload of [{ ...registration, platform: "android_phone" }, { ...registration, extra: "unexpected" }]) {
        const response = await app.inject({ method: "POST", url: "/auth/email/request", headers, payload });
        expect(response.statusCode).toBe(400);
      }
      expect(service.request).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("passes an explicit binding owner and accepts a six-digit code beginning with zero", async () => {
    const { app, service, authenticate } = fixture();
    try {
      const sent = await app.inject({ method: "POST", url: "/auth/email/request", headers: { ...headers, authorization: "Bearer fixture" }, payload: registration });
      expect(sent.statusCode).toBe(200);
      expect(sent.json().maskedEmail).toBe("v•••@example.com");
      expect(sent.body).not.toContain(registration.email);
      expect(authenticate).toHaveBeenCalledWith("Bearer fixture");
      expect(service.request).toHaveBeenCalledWith(registration, "127.0.0.1", expect.objectContaining({ userId: "fixture-user" }));
      const verified = await app.inject({ method: "POST", url: "/auth/email/verify", headers: { origin: "https://www.flixify.vip" }, payload: verification });
      expect(verified.statusCode).toBe(200);
      expect(service.verify).toHaveBeenCalledWith(verification, "127.0.0.1");
      expect(verified.headers["referrer-policy"]).toBe("no-referrer");
    } finally { await app.close(); }
  });

  it("keeps login separate from account binding even when a bearer token is present", async () => {
    const { app, service, authenticate } = fixture();
    try {
      const login = { ...registration, intent: "login" };
      const requestHeaders = { ...headers, authorization: "Bearer fixture" };
      const rejected = await app.inject({ method: "POST", url: "/auth/email/request", headers: requestHeaders, payload: { ...login, existingCode: "ABCDEFGH12345678" } });
      expect(rejected.statusCode).toBe(400);
      expect(service.request).not.toHaveBeenCalled();

      const sent = await app.inject({ method: "POST", url: "/auth/email/request", headers: requestHeaders, payload: login });
      expect(sent.statusCode).toBe(200);
      expect(authenticate).not.toHaveBeenCalled();
      expect(service.request).toHaveBeenCalledWith(login, "127.0.0.1", undefined);
    } finally { await app.close(); }
  });

  it("returns known recovery reasons and keeps provider details private", async () => {
    const { app, service } = fixture();
    try {
      service.verify.mockRejectedValueOnce(new EmailAuthError(409, "registration_required"));
      const rejected = await app.inject({ method: "POST", url: "/auth/email/verify", headers, payload: verification });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().reason).toBe("registration_required");

      service.request.mockRejectedValueOnce(new EmailAuthError(429, "resend_cooldown", 60));
      const limited = await app.inject({ method: "POST", url: "/auth/email/request", headers, payload: registration });
      expect(limited.headers["retry-after"]).toBe("60");
      expect(limited.json()).toMatchObject({ reason: "resend_cooldown", retryAfterSeconds: 60 });

      service.request.mockRejectedValueOnce(new Error("private delivery response"));
      const failed = await app.inject({ method: "POST", url: "/auth/email/request", headers, payload: registration });
      expect(failed.statusCode).toBe(503);
      expect(failed.json().reason).toBe("temporarily_unavailable");
      expect(failed.body).not.toContain("private delivery response");
    } finally { await app.close(); }
  });
});
