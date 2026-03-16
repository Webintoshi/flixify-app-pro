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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    if (options.useAdminToken && response.status === 401) {
      clearAdminToken();
      if (typeof window !== "undefined") {
        window.location.href = "/admin";
      }
    }
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}
