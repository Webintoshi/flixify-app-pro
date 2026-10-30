import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("automatic trial capacity environment", () => {
  it("defaults to 1000 successful registrations per actual IP in a rolling day", async () => {
    vi.stubEnv("AUTO_TRIAL_DAILY_IP_LIMIT", undefined);
    vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.AUTO_TRIAL_DAILY_IP_LIMIT).toBe(1000);
  });
  it.each(["1", "2500", "10000"])("accepts the bounded integer override %s", async (value) => {
    vi.stubEnv("AUTO_TRIAL_DAILY_IP_LIMIT", value); vi.resetModules();
    const { env } = await import("./env.js");
    expect(env.AUTO_TRIAL_DAILY_IP_LIMIT).toBe(Number(value));
  });
  it.each(["0", "-1", "10001", "1000.5", "unlimited", ""])("fails closed for an invalid capacity %s", async (value) => {
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
});
