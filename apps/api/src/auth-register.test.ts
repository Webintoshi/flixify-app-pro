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
        "Bu cihaz veya tarayıcıda yalnızca bir kez hesap oluşturabilirsiniz. Mevcut hesabınızla giriş yapın veya destekle iletişime geçin."
    });
  });

  it("returns 429 when the durable permanent IP quota is exhausted", async () => {
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue(null);
    vi.spyOn(repository, "findUserByCodeLookup").mockResolvedValue(null);
    vi.spyOn(repository, "createUser")
      .mockRejectedValue(new repository.AutoTrialRegistrationRateLimitError("Permanent IP account limit reached."));

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
    expect(response.json().message).toBe("Bu internet bağlantısı üzerinden en fazla 2 hesap oluşturulabilir.");
    const identity = [
      expect.any(String), expect.any(String), expect.any(String), expect.any(String),
      "install-daily-quota-abc123"
    ];
    const expected = createUserArgumentCount === 7 ? [...identity, null, "203.0.113.99"] : [...identity, "203.0.113.99"];
    expect(repository.createUser).toHaveBeenCalledTimes(1);
    expect(repository.createUser).toHaveBeenCalledWith(...expected);
  });

  it("rejects a retained installation claim after a deletion or a concurrent registration precheck", async () => {
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue(null);
    vi.spyOn(repository, "findUserByCodeLookup").mockResolvedValue(null);
    const create = vi.spyOn(repository, "createUser").mockRejectedValue(new repository.RegistrationInstallationLimitError("Already claimed"));
    const response = await app.inject({
      method: "POST", url: "/auth/register-anon", remoteAddress: "198.51.100.88",
      payload: { installationId: "installation-permanent-1234", platform: "web" }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("yalnızca bir kez");
    expect(response.json().message).not.toContain("silinmesi gerekir");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps the database uniqueness conflict protected when concurrent registration wins first", async () => {
    vi.spyOn(repository, "findActiveUserByInstallationId").mockResolvedValue(null);
    vi.spyOn(repository, "findUserByCodeLookup").mockResolvedValue(null);
    vi.spyOn(repository, "createUser").mockRejectedValue(Object.assign(new Error("Concurrent installation"), { code: "23505", constraint: "idx_users_registration_installation_active_unique" }));
    const response = await app.inject({
      method: "POST", url: "/auth/register-anon", remoteAddress: "198.51.100.89",
      payload: { installationId: "installation-concurrent-1234", platform: "web" }
    });
    expect(response.statusCode).toBe(409);
  });

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
