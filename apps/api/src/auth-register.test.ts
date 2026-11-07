import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAnonInputSchema } from "@flixify/contracts";
import * as repository from "./repository.js";
import * as security from "./security.js";
import { pool } from "./db.js";
import { buildServer } from "./server.js";

const rejection = {
  reason: "phone_verification_required",
  message: "Yeni hesap oluşturmak için WhatsApp doğrulamasını kullanın."
};
const existingUserId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

const app = buildServer();
beforeAll(async () => app.ready());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => app.close());

describe("retired account-code registration", () => {
  beforeEach(() => {
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue(null);
    vi.spyOn(repository, "findUserByCodeLookup").mockResolvedValue(null);
    vi.spyOn(repository, "createUser").mockResolvedValue(existingUserId);
    vi.spyOn(repository, "updateUserLogin").mockResolvedValue(undefined);
    vi.spyOn(repository, "createDeviceSession").mockResolvedValue(sessionId);
    vi.spyOn(repository, "getUserContext").mockResolvedValue({ summary: { id: existingUserId } } as never);
    vi.spyOn(security, "hashSecret").mockResolvedValue("fixture-hash");
  });

  it("rejects old clients before parsing input or creating accounts, trials or sessions", async () => {
    const parse = vi.spyOn(registerAnonInputSchema, "parse");
    const database = vi.spyOn(pool, "query");
    const response = await app.inject({
      method: "POST", url: "/auth/register-anon",
      payload: { deviceName: "Old TV", platform: "android_tv", installationId: "fixture-old-installation" }
    });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual(rejection);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(parse).not.toHaveBeenCalled();
    expect(database).not.toHaveBeenCalled();
    expect(repository.findActiveUserByInstallationId).not.toHaveBeenCalled();
    expect(repository.findUserByCodeLookup).not.toHaveBeenCalled();
    expect(repository.createUser).not.toHaveBeenCalled();
    expect(repository.updateUserLogin).not.toHaveBeenCalled();
    expect(repository.createDeviceSession).not.toHaveBeenCalled();
  });

  it.each([
    { name: "malformed JSON", headers: { "content-type": "application/json" }, payload: "{" },
    { name: "unsupported body", headers: { "content-type": "application/octet-stream" }, payload: "old-client" },
    { name: "oversized JSON", headers: { "content-type": "application/json" }, payload: JSON.stringify({ value: "x".repeat(1_048_577) }) },
    { name: "missing body", headers: {}, payload: undefined }
  ])("returns the same retirement response before parsing $name", async ({ headers, payload }) => {
    const response = await app.inject({ method: "POST", url: "/auth/register-anon", headers, payload });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual(rejection);
    expect(repository.createUser).not.toHaveBeenCalled();
  });

  it("does not run the legacy registration rate limit even for repeated requests", async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await app.inject({ method: "POST", url: "/auth/register-anon", remoteAddress: "198.51.100.190", payload: { installationId: "fixture-repeat-installation" } });
      expect(response.statusCode).toBe(410);
      expect(response.json()).toEqual(rejection);
    }
    expect(repository.createUser).not.toHaveBeenCalled();
  });

  it("still signs an existing account in with its user code without granting a trial", async () => {
    const code = "TESTEXISTING1234";
    vi.mocked(repository.findUserByCodeLookup).mockResolvedValue({ id: existingUserId, status: "active", code_hash: "fixture-hash", kryptonite_code: code } as never);
    vi.spyOn(security, "verifySecret").mockResolvedValue(true);
    const response = await app.inject({ method: "POST", url: "/auth/login-by-code", payload: { code, platform: "web", deviceName: "Existing browser" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { id: existingUserId }, kryptoniteCode: code });
    expect(response.json().accessToken).toEqual(expect.any(String));
    expect(repository.createDeviceSession).toHaveBeenCalledOnce();
    expect(repository.createUser).not.toHaveBeenCalled();
  });
});

describe("registration database health", () => {
  it.each(["lifetime_ip", "lifetime_installations"])("keeps the API unhealthy without %s", async (missing) => {
    vi.spyOn(pool, "query").mockResolvedValue({ rows: [{ trial_jobs: "jobs", trial_ip_quota: "old", lifetime_ip: "ip", lifetime_installations: "installation", [missing]: null }], rowCount: 1 } as never);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(503);
  });

  it("keeps the API unhealthy until trial schema migration exists", async () => {
    vi.spyOn(pool, "query").mockResolvedValue({ rows: [{ trial_jobs: null, trial_ip_quota: null }], rowCount: 1 } as never);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
  });
});
