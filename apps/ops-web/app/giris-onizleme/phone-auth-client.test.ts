import { afterEach, describe, expect, it, vi } from "vitest";
import { createPhoneAuthClient, normalizePhone, phoneAuthError } from "./phone-auth-client";
import type { apiRequest } from "../../lib/api";
import type { CountryCode } from "libphonenumber-js/min";

const challenge = { challengeId: "opaque-challenge", challengeSecret: "opaque-secret", expiresInSeconds: 300, resendAfterSeconds: 60, maskedPhone: "+90 ••• ••• 1234", delivery: "accepted" };
const input = { phone: "+905551231234", intent: "login" as const, platform: "web" as const, deviceName: "Flixify Web", installationId: "installation-fixture" };
afterEach(() => vi.useRealTimers());

describe("phone input", () => {
  it.each([
    ["0555 123 12 34", "TR", null],
    ["5551231234", "TR", "+905551231234"],
    ["+90 0555 123 12 34", "TR", null],
    ["0090 0555 123 12 34", "TR", null],
    ["(555) 123-12-34", "TR", "+905551231234"],
    ["+44 7510 123456", "TR", "+447510123456"],
    ["0044 7510 123456", "TR", "+447510123456"],
    ["07510 123456", "GB", "+447510123456"],
    ["+49 151 23456789", undefined, "+4915123456789"],
    ["02 1234 5678", "IT", "+390212345678"],
    ["0549 888888", "SM", "+3780549888888"],
    ["(213) 373-4253", "US", "+12133734253"],
    ["abc5551231234", "TR", null],
    ["+90<script>", "TR", null],
    ["5551231234", undefined, null],
    ["+1234567890123456", "TR", null],
    ["+0012345678", "TR", null],
    ["5551231234 ext 2", "TR", null],
    ["123", "TR", null],
    ["", "TR", null]
  ])("normalizes %s with selected country %s", (value, country, expected) => expect(normalizePhone(value!, country as CountryCode | undefined)).toBe(expected));
});

it("keeps the server challenge secret out of the verification code and preserves the installation binding", async () => {
  const transport = vi.fn().mockResolvedValueOnce(challenge).mockResolvedValueOnce({ accessToken: "fixture-token", refreshToken: "fixture-refresh", user: { id: "existing-account" } });
  const client = createPhoneAuthClient(transport as typeof apiRequest), signal = new AbortController().signal;
  const result = await client.request(input, signal);
  expect(result).toEqual(challenge);
  expect(transport.mock.calls[0][0]).toBe("/auth/phone/request");
  expect(transport.mock.calls[0][1].body).toEqual(input);
  const verification = { challengeId: result.challengeId, challengeSecret: result.challengeSecret, code: "123456", installationId: input.installationId };
  await client.verify(verification, signal);
  expect(transport.mock.calls[1][0]).toBe("/auth/phone/verify");
  expect(transport.mock.calls[1][1].body).toEqual(verification);
});

it.each([{ ...challenge, challengeSecret: "" }, { ...challenge, delivery: "delivered" }, { ...challenge, expiresInSeconds: 0 }, { ...challenge, resendAfterSeconds: 999 }, { ...challenge, maskedPhone: "" }])("rejects malformed delivery acknowledgments", async response => {
  const transport = vi.fn().mockResolvedValue(response), client = createPhoneAuthClient(transport as typeof apiRequest);
  await expect(client.request(input, new AbortController().signal)).rejects.toThrow("Invalid phone challenge");
});

it("does not adopt a success-shaped response without its account identity", async () => {
  const client = createPhoneAuthClient(vi.fn().mockResolvedValue({ accessToken: "fixture-token" }) as typeof apiRequest);
  await expect(client.verify({ challengeId: "opaque", challengeSecret: "secret", code: "123456", installationId: "fixture" }, new AbortController().signal)).rejects.toThrow("Invalid phone session");
});

it("rejects an unavailable or malformed status without claiming the channel is ready", async () => {
  const client = createPhoneAuthClient(vi.fn().mockResolvedValue({ enabled: "true", deliveryChannel: "whatsapp" }) as typeof apiRequest);
  await expect(client.status(new AbortController().signal)).rejects.toThrow("Invalid phone authentication status");
});

it("cancels a stalled transport after twenty seconds without retrying or sending another code", async () => {
  vi.useFakeTimers(); let sentSignal: AbortSignal | undefined;
  const transport = vi.fn((_path, options) => new Promise((_resolve, reject) => { sentSignal = options.signal; options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); }));
  const client = createPhoneAuthClient(transport as typeof apiRequest);
  const pending = expect(client.request(input, new AbortController().signal)).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(20000); await pending;
  expect(sentSignal?.aborted).toBe(true); expect(transport).toHaveBeenCalledTimes(1);
});

it("aborts the underlying request when the view cancels it", async () => {
  const outer = new AbortController(); let inner: AbortSignal | undefined;
  const transport = vi.fn((_path, options) => new Promise((_resolve, reject) => { inner = options.signal; options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); }));
  const client = createPhoneAuthClient(transport as typeof apiRequest), pending = expect(client.status(outer.signal)).rejects.toMatchObject({ name: "AbortError" });
  outer.abort(); await pending; expect(inner?.aborted).toBe(true);
});

it("does not echo provider or personal information through UI errors", () => {
  const secret = "provider key and personal account name";
  expect(phoneAuthError(Object.assign(new Error(secret), { status: 503 }))).not.toContain(secret);
  expect(phoneAuthError(new Error(secret))).toBe("İşlem tamamlanamadı. Lütfen tekrar dene.");
});


it("rejects a verified response without renewable credentials", async () => {
  const client = createPhoneAuthClient(vi.fn().mockResolvedValue({ accessToken: "fixture-token", user: { id: "existing-account" } }) as typeof apiRequest);
  await expect(client.verify({ challengeId: "opaque", challengeSecret: "secret", code: "123456", installationId: "fixture" }, new AbortController().signal)).rejects.toThrow("Invalid phone session");
});


it.each([
  [409, "registration_required", "Bu numarayla henüz hesap oluşturulmamış. Hesap oluşturabilir veya mevcut hesabını telefonuna bağlayabilirsin."],
  [409, "installation_limit", "Bu cihazda daha önce hesap oluşturulmuş. Yeni hesap yerine mevcut kullanıcı kodunla giriş yap."],
  [429, "registration_ip_limit", "Bu internet bağlantısından toplam iki hesap oluşturulabilir. Mevcut kullanıcı kodunla giriş yap."],
  [409, "account_conflict", "Bu telefon numarası ile mevcut hesap eşleşmiyor. Kullanıcı kodunla giriş yap veya destekle iletişime geç."],
  [400, "invalid_or_expired", "Kod geçersiz veya süresi dolmuş. Son gelen kodu kontrol et; gerekirse yeni kod iste."],
  [403, "reauthentication_required", "Mevcut hesabına kullanıcı kodunla giriş yapıp telefonunu yeniden bağla."],
  [403, "account_unavailable", "Bu hesaba şu anda giriş yapılamıyor. Destekle iletişime geç."],
  [400, "invalid_referral_code", "Davet kodu geçersiz. Davet bağlantısını kontrol et veya destekle iletişime geç."]
])("explains HTTP %s %s without echoing the response's private message", (status, reason, expected) => {
  expect(phoneAuthError(Object.assign(new Error("private-provider-token-and-phone"), { status, reason }))).toBe(expected);
});
