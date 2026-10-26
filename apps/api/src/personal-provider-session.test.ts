import { describe, expect, it } from "vitest";
import { derivePersonalProviderSession } from "./personal-provider-session.js";

const now = Date.parse("2026-10-26T12:00:00Z");
const context = () => ({ summary: { id: "user-a" }, canPlay: true, accessUntil: "2026-10-26T14:00:00Z",
  isThreeHourTrial: false, trialProviderExpiresAt: null as string | null, playbackBaseUrl: "https://provider.example/",
  iptvCredentials: { username: "personal", password: "personal-secret" }, sharedReferenceCredentials: { username: "shared", password: "shared-secret" } });
const derive = (c: any = context(), user = "user-a", secret = "hmac-secret") => derivePersonalProviderSession(user, c, secret, now);

describe("personal provider bootstrap derivation", () => {
  it("returns only the frozen contract with canonical origin and finite deadline", () => {
    expect(derive()).toEqual({ accountId: "user-a", sourceVersion: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      providerOrigin: "https://provider.example", username: "personal", password: "personal-secret",
      expiresAt: "2026-10-26T14:00:00.000Z", moviePolicy: "general-audience-only" });
  });
  it("binds the opaque version to user, origin, credentials and secret, independent of access expiry", () => {
    const original = derive()!.sourceVersion;
    expect(derive()!.sourceVersion).toBe(original);
    const renewed = context(); renewed.accessUntil = "2026-10-26T15:00:00Z";
    expect(derive(renewed)!.sourceVersion).toBe(original);
    for (const change of [ { playbackBaseUrl: "https://other.example" }, { iptvCredentials: { username: "new", password: "personal-secret" } },
      { iptvCredentials: { username: "personal", password: "new-secret" } } ]) expect(derive({ ...context(), ...change })!.sourceVersion).not.toBe(original);
    expect(derive({ ...context(), summary: { id: "user-b" } }, "user-b")!.sourceVersion).not.toBe(original);
    expect(derive(context(), "user-a", "other-secret")!.sourceVersion).not.toBe(original);
    expect(original).not.toContain("personal");
  });
  it.each(["http://provider.example", "https://name:secret@provider.example", "https://provider.example/path", "https://provider.example/?x=1",
    "https://provider.example/#x", "https://@provider.example", "https://provider.example/a/..", "https://provider.example/\\", "https://provider.example/?", "https://provider.example/#", "invalid", null])("rejects unsafe origin %s", playbackBaseUrl => {
    expect(derive({ ...context(), playbackBaseUrl })).toBeNull();
  });
  it.each([null, { username: "", password: "p" }, { username: "u", password: "" }, { username: "shared", password: "shared-secret" }])("rejects missing/shared credentials %j", iptvCredentials => {
    expect(derive({ ...context(), iptvCredentials })).toBeNull();
  });
  it.each([null, "invalid", "2026-10-26T11:59:59Z", "2026-10-26T12:00:00Z"])("rejects nonfuture deadline %s", accessUntil => {
    expect(derive({ ...context(), accessUntil })).toBeNull();
  });
  it("rejects wrong identity, denied access, missing identity or secret", () => {
    expect(derive(context(), "other")).toBeNull();
    expect(derive({ ...context(), canPlay: false })).toBeNull();
    expect(derive({ ...context(), summary: { id: "" } }, "")).toBeNull();
    expect(derive(context(), "user-a", "")).toBeNull();
  });
  it.each([null, "invalid", "2026-10-26T11:59:59Z", "2026-10-26T14:00:01Z"])("rejects unverified/invalid trial expiry %s", trialProviderExpiresAt => {
    expect(derive({ ...context(), isThreeHourTrial: true, trialProviderExpiresAt })).toBeNull();
  });
  it("caps trial credentials at verified provider expiry", () => {
    expect(derive({ ...context(), isThreeHourTrial: true, trialProviderExpiresAt: "2026-10-26T13:00:00Z" })!.expiresAt).toBe("2026-10-26T13:00:00.000Z");
  });
});
