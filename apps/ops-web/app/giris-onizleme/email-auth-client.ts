import { apiRequest } from "../../lib/api";
import type { Session } from "../platform/types";
import { phoneAuthError, phoneAuthRecoveryReason, type PhoneChallenge, type PhoneRequest, type PhoneVerification } from "./phone-auth-client";

type EmailStatus = { enabled: boolean; deliveryChannel: "email" };
export type EmailChallenge = Omit<PhoneChallenge, "maskedPhone"> & { maskedEmail: string };
type EmailRequest = Omit<PhoneRequest, "phone"> & { email: string };
export type EmailAuthClient = {
  status(signal: AbortSignal): Promise<EmailStatus>;
  request(input: EmailRequest, signal: AbortSignal, ownerToken?: string): Promise<EmailChallenge>;
  verify(input: PhoneVerification, signal: AbortSignal): Promise<Session>;
};

export function normalizeEmail(value: string): string | null {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function emailAuthError(error: unknown): string {
  const recovery = phoneAuthRecoveryReason(error);
  if (recovery === "registration_required") return "Bu e-posta adresi henüz bir hesaba bağlı değil. Hesap oluşturabilir veya mevcut hesabını bağlayabilirsin.";
  if (recovery === "account_conflict") return "Bu e-posta adresi başka bir hesaba bağlı. Kullanıcı kodunla giriş yap veya destekle iletişime geç.";
  if (recovery === "reauthentication_required") return "Mevcut hesabına giriş yapıp e-posta adresini yeniden bağla.";
  if (recovery) return phoneAuthError(error);
  const reason = typeof error === "object" && error !== null && "reason" in error ? error.reason : undefined;
  if (reason === "invalid_or_expired") return phoneAuthError(error);
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  if (reason === "invalid_email") return "E-posta adresini kontrol et.";
  if (status === 400 || status === 422) return "E-posta adresini ve doğrulama kodunu kontrol et.";
  return phoneAuthError(error);
}

export function createEmailAuthClient(request = apiRequest): EmailAuthClient {
  async function send<T>(path: string, options: Parameters<typeof apiRequest>[1], signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    try {
      return await request<T>(path, { accessToken: "", ...options, signal: controller.signal });
    } catch (error) {
      if (timedOut) throw Object.assign(new Error("Email authentication timeout"), { status: 504 });
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  return {
    async status(signal) {
      const value = await send<EmailStatus>("/auth/email/status", {}, signal);
      if (!value || typeof value.enabled !== "boolean" || value.deliveryChannel !== "email") throw new Error("Invalid email authentication status");
      return value;
    },
    async request(input, signal, ownerToken = "") {
      const accessToken = input.intent === "register" && !input.existingCode ? ownerToken : "";
      const value = await send<EmailChallenge>("/auth/email/request", { method: "POST", body: input, accessToken }, signal);
      if (!value || value.delivery !== "accepted" ||
          typeof value.challengeId !== "string" || !value.challengeId ||
          typeof value.challengeSecret !== "string" || !value.challengeSecret ||
          typeof value.maskedEmail !== "string" || !value.maskedEmail.includes("@") || value.maskedEmail.length > 254 ||
          !Number.isFinite(value.expiresInSeconds) || value.expiresInSeconds <= 0 || value.expiresInSeconds > 900 ||
          !Number.isFinite(value.resendAfterSeconds) || value.resendAfterSeconds < 0 || value.resendAfterSeconds > value.expiresInSeconds) {
        throw new Error("Invalid email challenge");
      }
      return value;
    },
    async verify(input, signal) {
      const value = await send<Session>("/auth/email/verify", { method: "POST", body: input }, signal);
      if (!value || typeof value.accessToken !== "string" || !value.accessToken ||
          typeof value.refreshToken !== "string" || !value.refreshToken ||
          typeof value.user?.id !== "string" || !value.user.id) {
        throw new Error("Invalid email session");
      }
      return value;
    }
  };
}
