import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as repository from "./repository.js";
import { pool } from "./db.js";
import { buildServer } from "./server.js";

const createUserArgumentCount = repository.createUser.length;

describe("POST /auth/register-anon", () => {
  const app = buildServer();

  beforeAll(async () => {
    expect([6, 7]).toContain(createUserArgumentCount);
    await app.ready();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it("blocks creating a second active account for the same installation", async () => {
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue({
      id: "existing-user",
      status: "active",
      deleted_at: null
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register-anon",
      payload: {
        deviceName: "Flixify Native Qt",
        platform: "windows-native-qt",
        installationId: "install-1234567890abcd"
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      message:
        "Bu cihazda zaten bir hesabınız bulunmaktadır. Yeni hesap oluşturmak için mevcut hesabın sistemden silinmesi gerekir."
    });
  });

  it("returns 429 when the durable daily trial quota is exhausted", async () => {
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue(null);
    vi.spyOn(repository, "findUserByCodeLookup").mockResolvedValue(null);
    vi.spyOn(repository, "createUser")
      .mockRejectedValue(new repository.AutoTrialRegistrationRateLimitError("Daily trial registration limit reached."));

    const response = await app.inject({
      method: "POST",
      url: "/auth/register-anon",
      headers: { "x-forwarded-for": "198.51.100.77, 203.0.113.99" },
      payload: {
        deviceName: "Flixify Native Qt",
        platform: "windows-native-qt",
        installationId: "install-daily-quota-abc123"
      }
    });

    expect(response.statusCode).toBe(429);
    const identity = [
      expect.any(String), expect.any(String), expect.any(String), expect.any(String),
      "install-daily-quota-abc123"
    ];
    const expected = createUserArgumentCount === 7 ? [...identity, null, "203.0.113.99"] : [...identity, "203.0.113.99"];
    expect(repository.createUser).toHaveBeenCalledTimes(1);
    expect(repository.createUser).toHaveBeenCalledWith(...expected);
  });

  it("keeps the API unhealthy until trial schema migration exists", async () => {
    vi.spyOn(pool, "query").mockResolvedValue({ rows: [{ trial_jobs: null, trial_ip_quota: null }], rowCount: 1 } as never);
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
  });
});
