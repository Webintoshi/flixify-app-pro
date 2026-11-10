"use client";

function normalizeApiBaseUrl(value: string | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

const productionApiBaseUrl = normalizeApiBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.PUBLIC_API_BASE_URL
);

const developmentApiBaseUrl =
  normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.PUBLIC_API_BASE_URL) ??
  "http://localhost:4000";

const resolvedApiBaseUrl =
  process.env.NODE_ENV === "production" ? productionApiBaseUrl : developmentApiBaseUrl;

if (process.env.NODE_ENV === "production" && !resolvedApiBaseUrl) {
  throw new Error(
    "NEXT_PUBLIC_API_BASE_URL veya PUBLIC_API_BASE_URL production ortaminda zorunludur."
  );
}

export const API_BASE_URL = resolvedApiBaseUrl as string;

export const isDemoMode = (process.env.NEXT_PUBLIC_APP_DEMO_MODE ?? "false") === "true";
const publicSessionKey = "flixify-public-session";
type PublicSession = { accessToken: string; refreshToken?: string; kryptoniteCode?: string | null; user?: { id?: string; kryptoniteCode?: string | null }; [field: string]: unknown };
type PublicSessionSnapshot = { session: PublicSession };
const refreshInFlight = new Map<string, Promise<string | null>>();

function readPublicSessionSnapshot(): PublicSessionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(publicSessionKey) ?? "null");
    return value && typeof value.accessToken === "string" && value.accessToken ? { session: value } : null;
  } catch { return null; }
}

function publicTokenClaims(token: string): { sub?: string; exp?: number } | null {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { return null; }
}

function sameCredentials(left: PublicSession, right: PublicSession) {
  return left.accessToken === right.accessToken && left.refreshToken === right.refreshToken;
}

function accountIdentity(session: PublicSession) {
  return publicTokenClaims(session.accessToken)?.sub || session.user?.id || null;
}

function sameAccount(left: PublicSession, right: PublicSession) {
  const identity = accountIdentity(left);
  const hasCode = (value: PublicSession) => Boolean(value.kryptoniteCode ?? value.user?.kryptoniteCode);
  return Boolean(identity && identity === accountIdentity(right) && hasCode(left) === hasCode(right));
}

export function publicSessionRefreshDelay(now = Date.now()): number | null {
  const snapshot = readPublicSessionSnapshot();
  if (!snapshot?.session.refreshToken) return null;
  const expiry = publicTokenClaims(snapshot.session.accessToken)?.exp;
  return typeof expiry === "number" && Number.isFinite(expiry) ? Math.max(0, expiry * 1000 - now - 60_000) : null;
}

async function performPublicSessionRefresh(snapshot: PublicSessionSnapshot): Promise<string | null> {
  const current = readPublicSessionSnapshot();
  if (!current) return null;
  if (!sameCredentials(snapshot.session, current.session)) return sameAccount(snapshot.session, current.session) ? current.session.accessToken : null;
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: current.session.refreshToken }), cache: "no-store", signal: AbortSignal.timeout(15000) });
  const value = parseJsonValue(await response.text());
  const payload = value && typeof value === "object" ? value as Partial<PublicSession> & { reason?: string } : null;
  if (!response.ok) {
    const definitive = response.status === 401 && ["invalid-refresh", "revoked", "expired"].includes(payload?.reason ?? "")
      || response.status === 403 && ["account-blocked", "account-deleted"].includes(payload?.reason ?? "");
    const latest = readPublicSessionSnapshot();
    if (latest && !sameCredentials(snapshot.session, latest.session) && sameAccount(snapshot.session, latest.session)) return latest.session.accessToken;
    if (definitive && latest && sameCredentials(snapshot.session, latest.session)) {
      localStorage.removeItem(publicSessionKey); window.dispatchEvent(new Event("flixify-session"));
    }
    return null;
  }
  if (!payload || typeof payload.accessToken !== "string" || !payload.accessToken || typeof payload.refreshToken !== "string" || !payload.refreshToken || typeof payload.user?.id !== "string" || !payload.user.id) return null;
  const nextIdentity = accountIdentity(payload as PublicSession), previousIdentity = accountIdentity(snapshot.session);
  if (previousIdentity && nextIdentity !== previousIdentity) return null;
  const latest = readPublicSessionSnapshot();
  if (!latest) return null;
  if (!sameCredentials(snapshot.session, latest.session)) return sameAccount(snapshot.session, latest.session) ? latest.session.accessToken : null;
  const next = { ...latest.session, ...payload };
  localStorage.setItem(publicSessionKey, JSON.stringify(next)); window.dispatchEvent(new Event("flixify-session"));
  return next.accessToken!;
}

export function refreshPublicSession(snapshot = readPublicSessionSnapshot()): Promise<string | null> {
  const credential = snapshot?.session.refreshToken;
  if (!snapshot || typeof credential !== "string" || !credential) return Promise.resolve(null);
  const existing = refreshInFlight.get(credential);
  if (existing) return existing;
  const pending = Promise.resolve().then(async () => {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    return locks
      ? await locks.request("flixify-public-session-refresh", { mode: "exclusive", signal: AbortSignal.timeout(20000) }, () => performPublicSessionRefresh(snapshot))
      : await performPublicSessionRefresh(snapshot);
  }).catch(() => null).finally(() => { if (refreshInFlight.get(credential) === pending) refreshInFlight.delete(credential); });
  refreshInFlight.set(credential, pending);
  return pending;
}
const ADMIN_COOKIE_NAME = "flixify-admin-token";

async function waitForRefresh(snapshot: PublicSessionSnapshot, signal?: AbortSignal) {
  if (!signal) return refreshPublicSession(snapshot);
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new Error("Request aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([refreshPublicSession(snapshot), cancelled]); }
  finally { signal.removeEventListener("abort", abort); }
}

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }

  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document !== "undefined") {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
  }
}

function clearCookie(name: string) {
  if (typeof document !== "undefined") {
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  }
}

function parseJsonValue(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeErrorMessage(rawBody: string, status: number) {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return `HTTP ${status}`;
  }

  const parsed = parseJsonValue(trimmed);
  if (parsed && typeof parsed === "object" && "message" in parsed) {
    const message = (parsed as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  if (typeof parsed === "string" && parsed.trim().length > 0) {
    return parsed;
  }

  return trimmed;
}

function parseSuccessBody(rawBody: string) {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = parseJsonValue(trimmed);
  return parsed ?? trimmed;
}

export function getAdminToken() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem("flixify-admin-token") ?? readCookie(ADMIN_COOKIE_NAME);
}

export function setAdminToken(token: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("flixify-admin-token", token);
  }
  writeCookie(ADMIN_COOKIE_NAME, token);
}

export function clearAdminToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("flixify-admin-token");
  }
  clearCookie(ADMIN_COOKIE_NAME);
}

export function getUserToken() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem("flixify-public-session");
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.accessToken ?? null;
    }
  } catch {}
  return null;
}

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly reason?: string) { super(message); this.name = 'ApiRequestError'; }
}


const phoneAuthErrorReasons = new Set([
  "invalid_phone", "invalid_input", "invalid_referral_code", "delivery_unavailable", "temporarily_unavailable",
  "rate_limited", "resend_cooldown", "invalid_or_expired", "registration_required", "account_conflict",
  "existing_account_unverified", "reauthentication_required", "account_unavailable", "installation_limit",
  "registration_ip_limit", "origin_forbidden"
]);
function phoneAuthResponseReason(path: string, rawBody: string): string | undefined {
  if (!path.startsWith("/auth/phone/")) return undefined;
  const payload = parseJsonValue(rawBody);
  const reason = payload && typeof payload === "object" && "reason" in payload ? payload.reason : undefined;
  return typeof reason === "string" && phoneAuthErrorReasons.has(reason) ? reason : undefined;
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    useAdminToken?: boolean;
    accessToken?: string;
    refreshed?: boolean;
    skipAuthRefresh?: boolean;
    signal?: AbortSignal;
  } = {}
) {
  const publicSnapshot = options.useAdminToken ? null : readPublicSessionSnapshot();
  const token = options.accessToken ?? (options.useAdminToken ? getAdminToken() : getUserToken());
  const hasBody = options.body !== undefined;
  const headers: Record<string, string> = {
    "x-flixify-client-runtime": "browser",
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };

  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: options.signal
  });

  const responseText = await response.text();

  if (response.status === 401 && token && !options.useAdminToken && !options.refreshed && !options.skipAuthRefresh && !path.startsWith("/auth/")) {
    const refreshedToken = publicSnapshot && publicSnapshot.session.accessToken === token ? await waitForRefresh(publicSnapshot, options.signal) : null;
    if (refreshedToken) return apiRequest<T>(path, { ...options, accessToken: refreshedToken, refreshed: true });
  }

  if (!response.ok) {
    if (options.useAdminToken && response.status === 401) {
      clearAdminToken();
      if (typeof window !== "undefined") {
        window.location.href = "/admin";
      }
    }

    throw new ApiRequestError(normalizeErrorMessage(responseText, response.status), response.status, phoneAuthResponseReason(path, responseText));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return parseSuccessBody(responseText) as T;
}
