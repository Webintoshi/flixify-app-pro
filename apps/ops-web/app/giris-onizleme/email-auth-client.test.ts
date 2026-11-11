import { afterEach, expect, it, vi } from "vitest";
import type { apiRequest } from "../../lib/api";
import { createEmailAuthClient, emailAuthError } from "./email-auth-client";

const input = { email: "fixture@example.invalid", intent: "login" as const, installationId: "fixture-installation", platform: "web" as const, deviceName: "Flixify Web" };
const challenge = { challengeId: "email-challenge", challengeSecret: "email-proof", expiresInSeconds: 300, resendAfterSeconds: 60, maskedEmail: "f•••@example.invalid", delivery: "accepted" };
const verification = { challengeId: challenge.challengeId, challengeSecret: challenge.challengeSecret, code: "012345", installationId: input.installationId };
const session = { accessToken: "fixture-access", refreshToken: "fixture-refresh", user: { id: "fixture-account" }, kryptoniteCode: null };

afterEach(() => vi.unstubAllGlobals());

it("sends the stored owner credential only on an explicit authenticated binding", async () => {
  vi.stubGlobal("window", { localStorage: { getItem: () => JSON.stringify({ accessToken: "stored-bearer" }) } });
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ enabled: true, deliveryChannel: "email" }))
    .mockResolvedValueOnce(Response.json(challenge))
    .mockResolvedValueOnce(Response.json(challenge))
    .mockResolvedValueOnce(Response.json(challenge))
    .mockResolvedValueOnce(Response.json(session));
  vi.stubGlobal("fetch", fetch);
  const client = createEmailAuthClient(), signal = new AbortController().signal;
  await client.status(signal);
  await client.request(input, signal, "owner-bearer");
  await client.request({ ...input, intent: "register" }, signal, "owner-bearer");
  await client.request({ ...input, intent: "register", existingCode: "AB12CD34EF56GH78" }, signal, "owner-bearer");
  await expect(client.verify(verification, signal)).resolves.toEqual(session);
  expect(fetch.mock.calls.map(([, options]) => options.headers.authorization)).toEqual([undefined, undefined, "Bearer owner-bearer", undefined, undefined]);
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/auth/email/status", "/auth/email/request", "/auth/email/request", "/auth/email/request", "/auth/email/verify"]);
  expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual(verification);
});

it("rejects unacknowledged deliveries and sessions without renewable credentials", async () => {
  const transport = vi.fn().mockResolvedValueOnce({ ...challenge, delivery: "failed" }).mockResolvedValueOnce({ ...session, refreshToken: "" });
  const client = createEmailAuthClient(transport as typeof apiRequest), signal = new AbortController().signal;
  await expect(client.request(input, signal)).rejects.toThrow("Invalid email challenge");
  await expect(client.verify(verification, signal)).rejects.toThrow("Invalid email session");
  expect(transport).toHaveBeenCalledTimes(2);
});

it("uses email-specific recovery copy without displaying provider details", () => {
  expect(emailAuthError(Object.assign(new Error("private user@example.invalid"), { status: 409, reason: "registration_required" }))).toContain("Bu e-posta adresi henüz bir hesaba bağlı değil.");
  expect(emailAuthError(Object.assign(new Error("private user@example.invalid"), { status: 503, reason: "unrecognized" }))).not.toContain("example.invalid");
});
