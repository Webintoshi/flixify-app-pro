import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("automatic trial capacity environment", () => {
  it("defaults to two successful registrations per actual IP for its permanent ledger", async () => {
    vi.stubEnv("AUTO_TRIAL_DAILY_IP_LIMIT", undefined);
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.AUTO_TRIAL_DAILY_IP_LIMIT).toBe(2);
  });
  it.each(["1", "2"])("accepts the bounded integer override %s", async (value) => {
    vi.stubEnv("AUTO_TRIAL_DAILY_IP_LIMIT", value); vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.AUTO_TRIAL_DAILY_IP_LIMIT).toBe(Number(value));
  });
  it.each(["0", "-1", "3", "1000", "10001", "1000.5", "unlimited", ""])("fails closed for an invalid capacity %s", async (value) => {
    vi.stubEnv("AUTO_TRIAL_DAILY_IP_LIMIT", value); vi.resetModules();
    await expect(import("./env.js")).rejects.toThrow();
  });
  it("defaults to loopback trust rather than every proxy or private network", async () => {
    vi.stubEnv("TRUSTED_PROXY_CIDRS", undefined); vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.TRUSTED_PROXY_CIDRS).toEqual(["127.0.0.1/32", "::1/128"]);
  });
  it("does not silently accept an unrestricted trust configuration", async () => {
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "0.0.0.0/0"); vi.resetModules();
    await expect(import("./env.js")).rejects.toThrow();
  });
  it("requires a stable registration guard secret rather than silently following the JWT secret", async () => {
    vi.stubEnv("REGISTRATION_GUARD_SECRET", undefined); vi.resetModules();
    await expect(import("./env.js")).rejects.toThrow();
  });
  it("keeps registration identity hashes stable when only the JWT secret changes", async () => {
    const stable = "fixture-stable-registration-secret-at-least-32";
    vi.stubEnv("REGISTRATION_GUARD_SECRET", stable);
    vi.stubEnv("APP_JWT_SECRET", "fixture-old-jwt-secret-at-least-thirty-two"); vi.resetModules();
    const first = (await import("./env.js")).env;
    vi.stubEnv("APP_JWT_SECRET", "fixture-new-jwt-secret-at-least-thirty-two"); vi.resetModules();
    const second = (await import("./env.js")).env;
    const { registrationIpHash, registrationInstallationHash } = await import("./registration-limits.js");
    expect(first.REGISTRATION_GUARD_SECRET).toBe(stable);
    expect(second.REGISTRATION_GUARD_SECRET).toBe(stable);
    expect(registrationIpHash("203.0.113.7", first.REGISTRATION_GUARD_SECRET)).toBe(registrationIpHash("203.0.113.7", second.REGISTRATION_GUARD_SECRET));
    expect(registrationInstallationHash("installation-1234567890", first.REGISTRATION_GUARD_SECRET)).toBe(registrationInstallationHash("installation-1234567890", second.REGISTRATION_GUARD_SECRET));
  });
});
