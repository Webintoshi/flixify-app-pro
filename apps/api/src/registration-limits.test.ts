import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AutoTrialRegistrationRateLimitError, RegistrationInstallationLimitError,
  claimRegistrationSlots, registrationIpHash, registrationInstallationHash,
  CLAIM_IP_SQL, CLAIM_INSTALLATION_SQL, PERMANENT_IP_LIMIT
} from "./registration-limits.js";

const secret = "fixture-registration-guard-secret-at-least-32";
const identity = { installationId: "installation-1234567890", requestIp: "203.0.113.7", guardSecret: secret };

describe("permanent registration claims", () => {
  it("claims one installation and one of exactly two permanent IP slots on the supplied transaction", async () => {
    const client = { query: vi.fn(async () => ({ rowCount: 1 })) };
    await claimRegistrationSlots(client, identity);
    expect(PERMANENT_IP_LIMIT).toBe(2);
    expect(client.query.mock.calls).toEqual([
      [CLAIM_INSTALLATION_SQL, [registrationInstallationHash(identity.installationId, secret)]],
      [CLAIM_IP_SQL, [registrationIpHash(identity.requestIp, secret), 2]]
    ]);
    expect(CLAIM_INSTALLATION_SQL).toMatch(/on conflict\s*\(installation_hash\)\s*do nothing/i);
    expect(CLAIM_IP_SQL).toMatch(/count\s*<\s*\$2::integer/);
    expect(CLAIM_IP_SQL).not.toMatch(/interval|window_started_at|24 hours/i);
  });
  it("rejects a previously claimed installation before taking an IP slot", async () => {
    const client = { query: vi.fn(async () => ({ rowCount: 0 })) };
    await expect(claimRegistrationSlots(client, identity)).rejects.toBeInstanceOf(RegistrationInstallationLimitError);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it("rejects an exhausted IP so the surrounding account transaction can roll back its installation claim", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 }) };
    await expect(claimRegistrationSlots(client, identity)).rejects.toBeInstanceOf(AutoTrialRegistrationRateLimitError);
    expect(client.query).toHaveBeenCalledTimes(2);
  });
  it("hashes the exact normalized identities with a stable dedicated secret and the compatible IP namespace", () => {
    expect(registrationIpHash(" 203.0.113.7 ", secret)).toBe(createHmac("sha256", secret).update("auto-trial-registration-ip:v1:203.0.113.7").digest("hex"));
    expect(registrationInstallationHash(" installation-1234567890 ", secret)).toBe(createHmac("sha256", secret).update("auto-registration-installation:v1:installation-1234567890").digest("hex"));
    expect(registrationInstallationHash(identity.installationId, secret)).not.toContain(identity.installationId);
  });
  it.each([undefined, null, "", "   "])("fails closed without an installation identity: %s", async (installationId) => {
    const client = { query: vi.fn() };
    await expect(claimRegistrationSlots(client, { ...identity, installationId })).rejects.toThrow();
    expect(client.query).not.toHaveBeenCalled();
  });
  it.each(["", "unknown", "unverified-client"])("fails closed without a verified IP: %s", async (requestIp) => {
    const client = { query: vi.fn() };
    await expect(claimRegistrationSlots(client, { ...identity, requestIp })).rejects.toThrow();
    expect(client.query).not.toHaveBeenCalled();
  });
  it.each([0, 3, 1000, 2.5])("cannot widen the permanent IP bound with a bad configured limit: %s", async (ipLimit) => {
    const client = { query: vi.fn() };
    await expect(claimRegistrationSlots(client, { ...identity, ipLimit })).rejects.toThrow();
    expect(client.query).not.toHaveBeenCalled();
  });
});
