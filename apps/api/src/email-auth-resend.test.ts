import { describe, expect, it, vi } from "vitest";
import { resolveEmailAuthConfiguration } from "./email-auth-config.js";
import { ResendEmailSender } from "./email-auth-resend.js";

const config = {
  EMAIL_AUTH_ENABLED: true,
  APP_DEMO_MODE: false,
  EMAIL_AUTH_SECRET: "e".repeat(32),
  EMAIL_AUTH_FROM: "verify@example.com",
  RESEND_API_KEY: "re_fixture_key",
  APP_JWT_SECRET: "j".repeat(32),
  REGISTRATION_GUARD_SECRET: "r".repeat(32),
  PHONE_AUTH_SECRET: "p".repeat(32)
};

describe("email sender configuration", () => {
  it("requires a valid sender, server credential and independent secret", () => {
    expect(resolveEmailAuthConfiguration(config)).toEqual({ secret: config.EMAIL_AUTH_SECRET, from: config.EMAIL_AUTH_FROM, apiKey: config.RESEND_API_KEY });
    expect(resolveEmailAuthConfiguration({ ...config, RESEND_API_KEY: undefined })).toBeNull();
    expect(resolveEmailAuthConfiguration({ ...config, EMAIL_AUTH_FROM: "invalid sender\r\n" })).toBeNull();
    expect(resolveEmailAuthConfiguration({ ...config, EMAIL_AUTH_SECRET: config.PHONE_AUTH_SECRET })).toBeNull();
  });

  it("does not configure delivery when disabled or in demo mode", () => {
    expect(resolveEmailAuthConfiguration({ ...config, EMAIL_AUTH_ENABLED: false })).toBeNull();
    expect(resolveEmailAuthConfiguration({ ...config, APP_DEMO_MODE: true })).toBeNull();
  });
});

describe("Resend OTP delivery", () => {
  it("sends plain text with the original six digits to the fixed HTTPS endpoint", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "fixture-accepted-id" }));
    const sender = new ResendEmailSender({ from: config.EMAIL_AUTH_FROM, apiKey: config.RESEND_API_KEY }, request);
    await sender.send("viewer@example.com", "012345");
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: `Bearer ${config.RESEND_API_KEY}` } });
    expect(JSON.parse(String(options?.body))).toEqual({
      from: "Flixify <verify@example.com>",
      to: ["viewer@example.com"],
      subject: "Doğrulama kodunuz",
      text: "Doğrulama kodunuz: 012345. Kod 5 dakika geçerlidir."
    });
  });

  it("does not accept malformed, unacknowledged, oversized or rejected provider responses", async () => {
    const request = vi.fn<typeof fetch>();
    const sender = new ResendEmailSender({ from: config.EMAIL_AUTH_FROM, apiKey: config.RESEND_API_KEY }, request);
    for (const response of [
      Response.json({ message: "private provider error" }, { status: 403 }),
      Response.json({ success: true }),
      new Response("x".repeat(16_385)),
      new Response("not json")
    ]) {
      request.mockResolvedValueOnce(response);
      await expect(sender.send("viewer@example.com", "012345")).rejects.toMatchObject({ statusCode: 503, reason: "delivery_unavailable", message: "delivery_unavailable" });
    }
  });

  it("does not call the sender for invalid credentials input", async () => {
    const request = vi.fn<typeof fetch>();
    const sender = new ResendEmailSender({ from: config.EMAIL_AUTH_FROM, apiKey: config.RESEND_API_KEY }, request);
    await expect(sender.send("viewer@example.com", "12345")).rejects.toMatchObject({ reason: "delivery_unavailable" });
    await expect(sender.send("not an email address", "012345")).rejects.toMatchObject({ reason: "delivery_unavailable" });
    expect(request).not.toHaveBeenCalled();
  });
});
