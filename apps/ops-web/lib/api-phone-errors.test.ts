import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); vi.stubGlobal("window", undefined); });
afterEach(() => vi.unstubAllGlobals());

it.each(["registration_required", "installation_limit", "registration_ip_limit", "account_conflict", "invalid_or_expired", "reauthentication_required", "account_unavailable", "invalid_referral_code"])("preserves the structured phone-auth reason %s without changing request bodies or retrying", async reason => {
  const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ reason, message: "Fixture response" }), { status: 409 }));
  vi.stubGlobal("fetch", transport); const { apiRequest } = await import("./api");
  await expect(apiRequest("/auth/phone/verify", { method: "POST", body: { code: "fixture" } })).rejects.toMatchObject({ status: 409, reason });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({ code: "fixture" });
});

it.each([
  ["/auth/phone/verify", { reason: "private-provider-secret", message: "Fixture" }],
  ["/auth/phone/verify", { reason: { private: "secret" }, message: "Fixture" }],
  ["/auth/phone/verify", { message: "Fixture" }],
  ["/auth/phone/request", { reason: "invalid_email", message: "Fixture" }],
  ["/auth/email/request", { reason: "invalid_phone", message: "Fixture" }],
  ["/auth/email/verify", { reason: "private-provider-secret", message: "Fixture" }],
  ["/me", { reason: "registration_required", message: "Fixture" }]
])("does not attach an unclassified or unrelated reason from %s", async (path, body) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })));
  const { apiRequest } = await import("./api");
  const error = await apiRequest(path as string).catch(error => error) as { status: number; reason?: unknown };
  expect(error.status).toBe(409); expect(error.reason).toBeUndefined();
});

it.each(["invalid_email", "registration_required", "invalid_or_expired"])("preserves a recognized email-auth reason %s", async reason => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ reason }, { status: 400 })));
  const { apiRequest } = await import("./api");
  await expect(apiRequest("/auth/email/verify", { method: "POST", body: { code: "fixture" } })).rejects.toMatchObject({ status: 400, reason });
});
