import { apiRequest } from "../../lib/api";
import type { Session } from "../platform/types";

export type AccountCodeInput = { code: string; platform: "web"; deviceName: string; installationId: string };
export type AccountCodeClient = { login: (input: AccountCodeInput, signal: AbortSignal) => Promise<Session> };
export const normalizeAccountCode = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);

export function accountCodeError(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status: unknown }).status : undefined;
  if (status === 400 || status === 401 || status === 404) return "Kullanıcı kodunu kontrol edip tekrar dene.";
  if (status === 403) return "Bu hesaba şu anda giriş yapılamıyor.";
  if (status === 429) return "Çok fazla giriş denemesi yapıldı. Biraz bekleyip tekrar dene.";
  if (status === 504) return "Bağlantı beklenenden uzun sürdü. Lütfen tekrar dene.";
  return "Giriş tamamlanamadı. Lütfen tekrar dene.";
}

export function createAccountCodeClient(request = apiRequest): AccountCodeClient {
  return { async login(input, signal) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (!/^[A-Z0-9]{16}$/.test(input.code)) throw Object.assign(new Error("Invalid account code"), { status: 400 });
    const controller = new AbortController(); let timedOut = false;
    const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      const value = await request<Session>("/auth/login-by-code", { method: "POST", body: input, signal: controller.signal, skipAuthRefresh: true });
      if (!value || typeof value.accessToken !== "string" || !value.accessToken || typeof value.refreshToken !== "string" || !value.refreshToken || typeof value.user?.id !== "string" || !value.user.id) throw new Error("Invalid account session");
      return value;
    } catch (error) { if (timedOut) throw Object.assign(new Error("Account login timeout"), { status: 504 }); throw error; }
    finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  } };
}
