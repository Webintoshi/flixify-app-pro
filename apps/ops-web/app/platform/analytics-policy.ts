export const ANALYTICS_CONSENT_KEY = "flixify-analytics-consent-v1";
export type AnalyticsConsent = "unknown" | "accepted" | "rejected";
export type AnalyticsPlatform = "web" | "pwa";
export type AnalyticsAttribution = { consentVersion: 1; clientId: string; sessionId: number; clientPlatform: AnalyticsPlatform };
export type AnalyticsTag = (...args: unknown[]) => void;
export type AnalyticsConfig = { schema: number; consentVersion: number; web: { enabled: boolean; measurementId: string | null } };
export type AnalyticsDependencies = {
  storage: Pick<Storage, "getItem" | "setItem">;
  loadConfig: () => Promise<AnalyticsConfig>;
  loadTag: (measurementId: string) => Promise<AnalyticsTag>;
  disableTag: (measurementId: string, disabled: boolean) => void;
  clearIdentity: (measurementId: string) => void;
  relayConsent: (clientId: string, choice: "accepted" | "rejected") => Promise<void>;
  platform: () => AnalyticsPlatform;
  now: () => number;
  newClientId?: () => string;
  debug?: () => boolean;
};

const routes: Record<string, string> = {
  "/": "Ana Sayfa", "/filmler": "Filmler", "/diziler": "Diziler", "/canli-tv": "Canlı TV",
  "/favoriler": "Favoriler", "/listem": "Listem", "/ayarlar": "Hesabım", "/paketler": "Paketler",
  "/kayit-ol": "Hesap oluştur", "/register": "Hesap oluştur", "/giris-yap": "Giriş", "/giris": "Giriş",
  "/indir": "Uygulamalar", "/iletisim": "Destek", "/davet": "Davet", "/odeme-sonucu": "Ödeme sonucu",
  "/odeme-bildirimi": "Ödeme bildirimi"
};
const screenNames: Record<string, string> = {
  "/": "home", "/filmler": "movies", "/diziler": "series", "/canli-tv": "live", "/favoriler": "favorites", "/listem": "favorites",
  "/ayarlar": "account", "/paketler": "packages", "/kayit-ol": "register", "/register": "register", "/giris-yap": "login", "/giris": "login",
  "/indir": "downloads", "/iletisim": "support", "/davet": "referrals", "/odeme-sonucu": "payment_result", "/odeme-bildirimi": "payment_notice"
};
const eventNames = new Set([
  "sign_up", "login", "logout", "search", "select_content", "category_select", "catalog_page_loaded",
  "add_to_wishlist", "remove_from_wishlist", "trial_select", "welcome_offer_select", "view_item_list",
  "select_item", "package_select", "package_open", "begin_checkout", "file_download", "playback_request", "video_start",
  "video_progress", "video_complete", "playback_buffer", "playback_error", "playback_end",
  "update_offered", "update_selected", "update_completed", "update_downloaded", "pwa_install_prompt", "pwa_install_choice", "pwa_installed"
]);
const numberLimits: Record<string, number> = {
  query_length: 512, result_count: 1_000_000, page_number: 100_000, startup_ms: 300_000, buffer_ms: 3_600_000,
  watch_ms: 86_400_000, progress_percent: 100, buffer_count: 10_000, package_months: 12, package_users: 2,
  value: 1_000_000, quantity: 6, engagement_time_msec: 3_600_000
};
const enums: Record<string, Set<string>> = {
  content_type: new Set(["live", "movie", "series", "episode"]), method: new Set(["account_code", "whatsapp", "email"]),
  reason: new Set(["media", "network", "startup", "expired", "unsupported", "gesture", "unknown", "closed", "ended", "replaced", "aborted", "unavailable", "recovery"]),
  timing_method: new Set(["requestVideoFrameCallback", "loadeddata-fallback", "playing-fallback"]),
  source_platform: new Set(["android_tv", "macos", "windows"]), download_platform: new Set(["android_phone", "android_tv", "macos", "windows"]),
  file_extension: new Set(["apk", "dmg", "exe"]), currency: new Set(["TRY"]),
  screen_name: new Set(Object.values(screenNames)),
  item_list_id: new Set(["packages", "catalog", "search", "favorites", "home"]),
  install_outcome: new Set(["accepted", "dismissed"])
};
const tokenKeys = new Set(["package_id", "offer_id", "app_version", "target_version", "file_name"]);
const safeToken = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(value);
const safeClientId = (value: unknown): value is string => typeof value === "string" && (/^\d{1,20}\.\d{1,20}$/.test(value) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value));
function publicCatalogLabel(value: unknown, limit: number) {
  if (typeof value !== "string" || value.length > 1024 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) || /:\/\/|www\.|\b(?:https?|ftp|file|data|javascript):|@|%[a-f0-9]{2}/i.test(value) || /\b(?:username|password|token|secret|session(?:_id)?)\s*[=:]/i.test(value) || /(?:^|[^\p{L}\p{N}])[A-Z0-9]{16}(?=$|[^\p{L}\p{N}])/u.test(value)) return undefined;
  const label = Array.from(value.trim()).slice(0, limit).join("");
  return label || undefined;
}

export function analyticsPage(input: string): { path: string; title: string } | null {
  const path = input.split(/[?#]/, 1)[0];
  return Object.hasOwn(routes, path) ? { path, title: routes[path] } : null;
}

export function sanitizeAnalyticsEvent(name: string, input: Record<string, unknown> = {}): { name: string; params: Record<string, unknown> } | null {
  if (!eventNames.has(name)) return null;
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.hasOwn(numberLimits, key) && typeof value === "number" && Number.isFinite(value) && value >= 0) params[key] = Math.min(value, numberLimits[key]);
    else if (enums[key]?.has(value as string)) params[key] = value;
    else if ((key === "content_id" || key === "category_id") && typeof value === "string" && /^[a-f0-9]{24}$/.test(value)) params[key] = value;
    else if (key === "content_name" || key === "category_name") { const label = publicCatalogLabel(value, key === "content_name" ? 100 : 80); if (label) params[key] = label; }
    else if (tokenKeys.has(key) && safeToken(value)) params[key] = value;
    else if (key === "items" && Array.isArray(value)) {
      const items = value.slice(0, 6).flatMap(item => {
        if (!item || typeof item !== "object" || !safeToken(item.item_id)) return [];
        return [{ item_id: item.item_id, ...(typeof item.price === "number" && item.price >= 0 && item.price <= 1_000_000 ? { price: item.price } : {}), quantity: 1 }];
      });
      if (items.length) params.items = items;
    }
  }
  return { name, params };
}

export function createAnalyticsRuntime(deps: AnalyticsDependencies) {
  let resetIdentity = false;
  try { const stored = JSON.parse(deps.storage.getItem(ANALYTICS_CONSENT_KEY) ?? "null"); resetIdentity = stored?.version === 1 && stored.choice === "rejected"; } catch {}
  let choice: AnalyticsConsent = "accepted";
  try { deps.storage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify({ version: 1, choice })); } catch {}
  let generation = 0;
  let measurementId = "";
  let tag: AnalyticsTag | null = null;
  let loading: Promise<void> | null = null;
  let currentPage: ReturnType<typeof analyticsPage> = null;
  let deliveredPage = "";
  let attribution: AnalyticsAttribution | undefined;
  let attributionAt = 0;
  let attributionRequestedAt = -Infinity;
  const queue: { name: string; params: Record<string, unknown>; context?: Record<string, unknown> }[] = [];
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const safePageParams = () => currentPage ? { page_location: `https://flixify.vip${currentPage.path}`, page_title: currentPage.title, page_referrer: "", screen_name: screenNames[currentPage.path] } : { page_location: "https://flixify.vip/", page_title: "Flixify Pro", page_referrer: "" };
  const deliver = (event: { name: string; params: Record<string, unknown>; context?: Record<string, unknown> }) => {
    if (choice !== "accepted" || !tag) return;
    try { tag("event", event.name, { ...event.params, ...(event.context ?? safePageParams()), client_platform: deps.platform(), app_version: "2.1.1", send_to: measurementId, ...(deps.debug?.() ? { debug_mode: true } : {}) }); } catch {}
  };
  const deliverPage = () => {
    if (!tag || choice !== "accepted" || !currentPage || deliveredPage === currentPage.path) return;
    deliveredPage = currentPage.path;
    deliver({ name: "page_view", params: {} });
  };
  const refreshAttribution = () => {
    if (!tag || choice !== "accepted" || !currentPage || deps.now() - attributionRequestedAt < 30_000) return;
    attributionRequestedAt = deps.now();
    const captured = generation;
    try { tag("get", measurementId, "client_id", (clientId: unknown) => {
      if (captured !== generation || choice !== "accepted" || !safeClientId(clientId)) return;
      try { tag?.("get", measurementId, "session_id", (sessionId: unknown) => {
        if (captured === generation && choice === "accepted") setAttribution(clientId, typeof sessionId === "string" && /^\d{1,16}$/.test(sessionId) ? Number(sessionId) : sessionId);
      }); } catch {}
    }); } catch {}
  };
  const ensure = () => {
    if (choice !== "accepted" || !currentPage) return Promise.resolve();
    if (tag) { deliverPage(); refreshAttribution(); return Promise.resolve(); }
    if (loading) return loading;
    const captured = generation;
    const pending = (async () => {
      try {
        const config = await deps.loadConfig();
        if (captured !== generation || choice !== "accepted" || !currentPage || config.schema !== 1 || config.consentVersion !== 1 || !config.web.enabled || !/^G-[A-Z0-9]{6,20}$/.test(config.web.measurementId ?? "")) return;
        measurementId = config.web.measurementId!;
        deps.disableTag(measurementId, false);
        const loaded = await deps.loadTag(measurementId);
        if (captured !== generation || choice !== "accepted" || !currentPage) { if (choice !== "accepted" || !currentPage) deps.disableTag(measurementId, true); return; }
        tag = loaded;
        tag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
        tag("js", new Date(deps.now()));
        tag("config", measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, ignore_referrer: true, ...(resetIdentity && deps.newClientId ? { client_id: deps.newClientId() } : {}), ...safePageParams() });
        resetIdentity = false;
        deliverPage();
        for (const event of queue.splice(0)) deliver(event);
        refreshAttribution();
      } catch { if (captured === generation) queue.length = 0; }
      finally { if (captured === generation) loading = null; }
    })();
    loading = pending;
    return loading;
  };
  const setAttribution = (clientId: unknown, sessionId: unknown) => {
    if (choice !== "accepted" || !tag || !safeClientId(clientId) || typeof sessionId !== "number" || !Number.isSafeInteger(sessionId) || sessionId <= 0) return;
    attribution = { consentVersion: 1, clientId, sessionId, clientPlatform: deps.platform() };
    attributionAt = deps.now();
    void deps.relayConsent(clientId, "accepted").catch(() => {});
  };
  const setConsent = async (next: "accepted" | "rejected") => {
      if (choice === next) { if (next === "accepted") await ensure(); return; }
      choice = next; generation++; queue.length = 0; deliveredPage = "";
      try { deps.storage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify({ version: 1, choice: next })); } catch {}
      if (next === "rejected") {
        resetIdentity = true;
        const oldClient = attribution?.clientId;
        if (measurementId) { try { deps.disableTag(measurementId, true); } catch {} try { deps.clearIdentity(measurementId); } catch {} }
        tag = null; attribution = undefined; loading = null; attributionAt = 0; attributionRequestedAt = -Infinity;
        if (oldClient) void deps.relayConsent(oldClient, "rejected").catch(() => {});
      }
      notify();
      if (next === "accepted") await ensure();
  };
  return {
    start: ensure,
    generation: () => generation,
    consent: () => choice,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setConsent,
    async syncStoredConsent() {
      try { deps.storage.setItem(ANALYTICS_CONSENT_KEY, JSON.stringify({ version: 1, choice: "accepted" })); } catch {}
      await setConsent("accepted");
    },
    page(path: string) {
      currentPage = analyticsPage(path);
      if (measurementId) { try { deps.disableTag(measurementId, choice !== "accepted" || !currentPage); } catch {} }
      if (!currentPage) { deliveredPage = ""; queue.length = 0; return; }
      deliverPage();
      if (choice === "accepted") void ensure();
    },
    track(name: string, input: Record<string, unknown> = {}) {
      if (choice !== "accepted" || !currentPage) return;
      const event = sanitizeAnalyticsEvent(name, input); if (!event) return;
      if (tag) deliver(event);
      else if (loading && queue.length < 30) queue.push({ ...event, context: safePageParams() });
    },
    attribution: () => { try { refreshAttribution(); } catch {} return choice === "accepted" && attribution && deps.now() - attributionAt < 25 * 60_000 ? { ...attribution } : undefined; },
    setAttribution
  };
}
