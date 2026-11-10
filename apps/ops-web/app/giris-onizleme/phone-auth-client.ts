import { apiRequest } from "../../lib/api";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import type { Session } from "../platform/types";

export type PhoneIntent = "login" | "register";
export type PhoneChallenge = { challengeId: string; challengeSecret: string; expiresInSeconds: number; resendAfterSeconds: number; maskedPhone: string; delivery: "accepted" };
export type PhoneAuthStatus = { enabled: boolean; deliveryChannel: "whatsapp"; reason?: "not_configured" };
export type PhoneRequest = { phone: string; intent: PhoneIntent; platform: "web"; deviceName: string; installationId: string; existingCode?: string; referralCode?: string };
export type PhoneVerification = { challengeId: string; challengeSecret: string; code: string; installationId: string };
export type PhoneAuthClient = { status: (signal: AbortSignal) => Promise<PhoneAuthStatus>; request: (input: PhoneRequest, signal: AbortSignal) => Promise<PhoneChallenge>; verify: (input: PhoneVerification, signal: AbortSignal) => Promise<Session> };

export function hasTurkishTrunkPrefix(value: string, country: CountryCode | undefined) {
  const compact = value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  return compact.startsWith("+900") || country === "TR" && !compact.startsWith("+") && compact.startsWith("0");
}

export function normalizePhone(value: string, country: CountryCode | undefined): string | null {
  let cleaned = value.trim();
  if (!/^[+\d\s().-]+$/.test(cleaned) || hasTurkishTrunkPrefix(cleaned, country)) return null;
  if (cleaned.startsWith("00")) cleaned = `+${cleaned.slice(2)}`;
  const parsed = parsePhoneNumberFromString(cleaned, { defaultCountry: country, extract: false });
  return parsed?.isPossible() && !parsed.ext ? parsed.number : null;
}

const terminalPhoneAuthErrors = {
  registration_required: "Bu numarayla henüz hesap oluşturulmamış. Hesap oluşturabilir veya mevcut hesabını telefonuna bağlayabilirsin.",
  installation_limit: "Bu cihazda daha önce hesap oluşturulmuş. Yeni hesap yerine mevcut kullanıcı kodunla giriş yap.",
  registration_ip_limit: "Bu internet bağlantısından toplam iki hesap oluşturulabilir. Mevcut kullanıcı kodunla giriş yap.",
  account_conflict: "Bu telefon numarası ile mevcut hesap eşleşmiyor. Kullanıcı kodunla giriş yap veya destekle iletişime geç.",
  reauthentication_required: "Mevcut hesabına kullanıcı kodunla giriş yapıp telefonunu yeniden bağla.",
  account_unavailable: "Bu hesaba şu anda giriş yapılamıyor. Destekle iletişime geç.",
  invalid_referral_code: "Davet kodu geçersiz. Davet bağlantısını kontrol et veya destekle iletişime geç."
} as const;
export type PhoneAuthRecoveryReason = keyof typeof terminalPhoneAuthErrors;
export function phoneAuthRecoveryReason(error: unknown): PhoneAuthRecoveryReason | null {
  const reason = typeof error === "object" && error !== null && "reason" in error ? error.reason : undefined;
  return typeof reason === "string" && Object.prototype.hasOwnProperty.call(terminalPhoneAuthErrors, reason) ? reason as PhoneAuthRecoveryReason : null;
}

export function phoneAuthError(error: unknown): string {
  const recovery = phoneAuthRecoveryReason(error);
  if (recovery) return terminalPhoneAuthErrors[recovery];
  if (typeof error === "object" && error !== null && "reason" in error && error.reason === "invalid_or_expired") return "Kod geçersiz veya süresi dolmuş. Son gelen kodu kontrol et; gerekirse yeni kod iste.";
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined;
  if (status === 429) return "Çok fazla kod istendi. Biraz bekleyip tekrar dene.";
  if (status === 503) return "Doğrulama hizmeti şu anda kullanılamıyor. Lütfen biraz sonra tekrar dene.";
  if (status === 504) return "Bağlantı beklenenden uzun sürdü. Lütfen tekrar dene.";
  if (status === 401) return "Doğrulama kodunu kontrol edip tekrar dene.";
  if (status === 409) return "Bu işlem tamamlanamadı. Mevcut hesabınla giriş yapıp tekrar deneyebilirsin.";
  if (status === 400 || status === 422) return "Telefon numaranı ve doğrulama kodunu kontrol et.";
  return "İşlem tamamlanamadı. Lütfen tekrar dene.";
}

export function createPhoneAuthClient(request = apiRequest): PhoneAuthClient {
  async function send<T>(path: string, options: Parameters<typeof apiRequest>[1], signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try { return await request<T>(path, { ...options, signal: controller.signal }); }
    catch (error) { if (timedOut) throw Object.assign(new Error("Phone authentication timeout"), { status: 504 }); throw error; }
    finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  }
  return {
    async status(signal) {
      const value = await send<PhoneAuthStatus>("/auth/phone/status", {}, signal);
      if (!value || typeof value.enabled !== "boolean" || value.deliveryChannel !== "whatsapp") throw new Error("Invalid phone authentication status");
      return value;
    },
    async request(input, signal) {
      const value = await send<PhoneChallenge>("/auth/phone/request", { method: "POST", body: input }, signal);
      if (!value || value.delivery !== "accepted" || typeof value.challengeId !== "string" || !value.challengeId || typeof value.challengeSecret !== "string" || !value.challengeSecret || typeof value.maskedPhone !== "string" || !value.maskedPhone || !Number.isFinite(value.expiresInSeconds) || value.expiresInSeconds <= 0 || value.expiresInSeconds > 900 || !Number.isFinite(value.resendAfterSeconds) || value.resendAfterSeconds < 0 || value.resendAfterSeconds > value.expiresInSeconds) throw new Error("Invalid phone challenge");
      return value;
    },
    async verify(input, signal) {
      const value = await send<Session>("/auth/phone/verify", { method: "POST", body: input }, signal);
      if (!value || typeof value.accessToken !== "string" || !value.accessToken || typeof value.refreshToken !== "string" || !value.refreshToken || typeof value.user?.id !== "string" || !value.user.id) throw new Error("Invalid phone session");
      return value;
    }
  };
}
