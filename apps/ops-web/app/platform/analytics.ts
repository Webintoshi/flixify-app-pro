"use client";
import { API_BASE_URL, apiRequest, getUserToken } from "../../lib/api";
import { createAnalyticsRuntime, type AnalyticsTag } from "./analytics-policy";

type GoogleWindow = Window & { flixifyAnalyticsLayer?: IArguments[] };
let runtime: ReturnType<typeof createAnalyticsRuntime> | null = null;
let tagPromise: Promise<AnalyticsTag> | null = null;

function loadTag(measurementId: string): Promise<AnalyticsTag> {
  if (tagPromise) return tagPromise;
  const target = window as GoogleWindow;
  target.flixifyAnalyticsLayer ??= [];
  const tag: AnalyticsTag = function () { target.flixifyAnalyticsLayer!.push(arguments); };
  tagPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}&l=flixifyAnalyticsLayer`;
    script.referrerPolicy = "no-referrer";
    const timeout = window.setTimeout(() => { script.remove(); tagPromise = null; reject(new Error("analytics_unavailable")); }, 8000);
    script.onload = () => { window.clearTimeout(timeout); resolve(tag); };
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); tagPromise = null; reject(new Error("analytics_unavailable")); };
    document.head.appendChild(script);
  });
  return tagPromise;
}

export function webAnalytics() {
  if (typeof window === "undefined") return null;
  if (runtime) return runtime;
  runtime = createAnalyticsRuntime({
    storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
    loadConfig: async () => {
      const response = await fetch(`${API_BASE_URL}/analytics/config`, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(4000), referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("analytics_unavailable");
      return response.json();
    },
    loadTag,
    disableTag: (id, disabled) => { Object.assign(window, { [`ga-disable-${id}`]: disabled }); },
    clearIdentity: id => {
      const names = ["_ga", `_ga_${id.slice(2).replace(/-/g, "_")}`];
      const domains = ["", window.location.hostname, ".flixify.vip"];
      for (const name of names) for (const domain of domains) { try { document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`; } catch {} }
      (window as GoogleWindow).flixifyAnalyticsLayer?.splice(0);
    },
    relayConsent: async (clientId, consent) => {
      if (!getUserToken()) return;
      await apiRequest("/me/analytics/consent", { method: "POST", body: { schema: 1, consentVersion: 1, clientId, consent }, signal: AbortSignal.timeout(2500), skipAuthRefresh: true });
    },
    platform: () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true ? "pwa" : "web",
    now: Date.now,
    newClientId: () => crypto.randomUUID(),
    debug: () => ["localhost", "127.0.0.1"].includes(window.location.hostname) || new URLSearchParams(window.location.search).get("analytics_debug") === "1"
  });
  return runtime;
}

export function trackAnalytics(name: string, params: Record<string, unknown> = {}) {
  try {
    const analytics = webAnalytics();
    if (!analytics || analytics.consent() !== "accepted") return;
    if (!Object.values(params).some(value => value instanceof Promise)) { analytics.track(name, params); return; }
    const generation = analytics.generation();
    void Promise.all(Object.entries(params).map(async ([key, value]) => [key, await value] as const)).then(entries => {
      if (analytics.generation() === generation) analytics.track(name, Object.fromEntries(entries));
    }).catch(() => {});
  } catch {}
}

export function analyticsCheckoutAttribution() {
  try {
    const attribution = webAnalytics()?.attribution();
    if (!attribution) return undefined;
    const sourcePlatform = new URLSearchParams(window.location.search).get("from");
    return { ...attribution, ...(["android_tv", "macos", "windows"].includes(sourcePlatform ?? "") ? { sourcePlatform } : {}) };
  } catch { return undefined; }
}

export function analyticsContent(item: { id?: string; kind?: string; title?: string; personalRef?: { id: string } } | null | undefined): { content_type?: string; content_id?: Promise<string | undefined>; content_name?: string } {
  if (!item?.id || !item.kind || !["live", "movie", "series", "episode"].includes(item.kind)) return {};
  const catalogId = item.personalRef?.id ?? (!item.id.startsWith("personal:") ? item.id : undefined);
  return { content_type: item.kind, ...(catalogId ? { content_id: analyticsDigest(`${item.kind.toLowerCase()}:${catalogId}`), content_name: item.title } : {}) };
}

export function analyticsCategoryId(value: string) {
  return analyticsDigest(value || "all");
}

export function analyticsMeasurementGuard() {
  const analytics = webAnalytics();
  const generation = analytics?.generation();
  const granted = analytics?.consent() === "accepted";
  return () => Boolean(granted && analytics?.consent() === "accepted" && analytics.generation() === generation);
}

async function analyticsDigest(value: string) {
  try { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 24); }
  catch { return undefined; }
}

export function openAnalyticsPreferences() { window.dispatchEvent(new Event("flixify-analytics-preferences")); }

export function trackAnalyticsDownload(platform: "android_tv" | "macos" | "windows", download: { filename: string; version: string }) {
  trackAnalytics("file_download", { download_platform: platform, target_version: download.version.match(/^\d+\.\d+\.\d+/)?.[0], file_extension: ({ android_tv: "apk", macos: "dmg", windows: "exe" })[platform], file_name: download.filename });
}
