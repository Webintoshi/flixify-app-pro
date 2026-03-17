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
const ADMIN_COOKIE_NAME = "flixify-admin-token";

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

export async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    useAdminToken?: boolean;
    accessToken?: string;
  } = {}
) {
  const token = options.accessToken ?? (options.useAdminToken ? getAdminToken() : null);
  const hasBody = options.body !== undefined;
  const headers: Record<string, string> = {
    ...(token ? { authorization: `Bearer ${token}` } : {})
  };

  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  const responseText = await response.text();

  if (!response.ok) {
    if (options.useAdminToken && response.status === 401) {
      clearAdminToken();
      if (typeof window !== "undefined") {
        window.location.href = "/admin";
      }
    }

    throw new Error(normalizeErrorMessage(responseText, response.status));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return parseSuccessBody(responseText) as T;
}
