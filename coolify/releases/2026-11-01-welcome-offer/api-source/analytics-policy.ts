export const ANALYTICS_SCHEMA = 1;
export const ANALYTICS_CONSENT_VERSION = 1;
export const ANALYTICS_BATCH_BYTES = 32 * 1024;
export const ANALYTICS_BATCH_EVENTS = 20;
export type AnalyticsAttribution = { consentVersion: 1; clientId: string; sessionId: number; clientPlatform: 'web' | 'pwa'; sourcePlatform?: 'android_tv' | 'macos' | 'windows' };
export type AnalyticsParams = Record<string, string | number>;
export type AnalyticsEvent = { id: string; name: string; eventTimestampMs: number; params: AnalyticsParams };
export type WindowsAnalyticsBatch = { schema: 1; consentVersion: 1; clientPlatform: 'windows'; clientId: string; sessionId: number; events: AnalyticsEvent[] };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const gaClientId = /^\d{1,20}\.\d{1,20}$/;
const contentId = /^[a-f0-9]{16,64}$/;
const semver = /^\d{1,3}\.\d{1,3}\.\d{1,6}(?:[-+][a-zA-Z0-9.-]{1,20})?$/;
const eventNames = new Set(['app_screen_view', 'sign_up', 'login', 'logout', 'search', 'select_content', 'category_select', 'catalog_page_loaded', 'add_to_wishlist', 'remove_from_wishlist', 'trial_select', 'welcome_offer_select', 'view_item_list', 'select_item', 'begin_checkout', 'package_open', 'file_download', 'update_offered', 'update_selected', 'update_downloaded', 'update_completed', 'playback_request', 'video_start', 'video_progress', 'video_complete', 'playback_buffer', 'playback_error', 'playback_end']);
const enumRule = (...values: string[]) => (value: unknown): value is string => typeof value === 'string' && values.includes(value);
const intRule = (maximum: number, minimum = 0) => (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const numericRule = (maximum: number) => (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
const stringRule = (pattern: RegExp) => (value: unknown): value is string => typeof value === 'string' && pattern.test(value);
const catalogLabel = (maximum: number) => (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum &&
  !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) && !/:\/\/|www\.|\b(?:https?|ftp|file|data|javascript):|@|%[a-f0-9]{2}/i.test(value) && !/\b(?:username|password|token|secret|session(?:_id)?)\s*[=:]/i.test(value) &&
  !/(?:^|[^\p{L}\p{N}])[A-Z0-9]{16}(?=$|[^\p{L}\p{N}])/u.test(value);
const packageIds = ['1-ay', '6-ay', '12-ay', '1-ay-2-kullanici', '6-ay-2-kullanici', '12-ay-2-kullanici'];
const params: Record<string, (value: unknown) => boolean> = {
  client_platform: enumRule('windows'), app_version: stringRule(semver), update_version: stringRule(semver),
  screen_name: enumRule('home', 'live', 'movies', 'series', 'favorites', 'account', 'login', 'register', 'search', 'categories', 'details', 'player', 'packages', 'downloads', 'settings', 'support'),
  content_type: enumRule('live', 'movie', 'series', 'episode'), content_id: stringRule(contentId), category_id: stringRule(contentId),
  content_name: catalogLabel(100), category_name: catalogLabel(80),
  reason: enumRule('unknown', 'network', 'timeout', 'unsupported', 'decode', 'source_unavailable', 'access_denied', 'user_exit', 'replaced', 'ended', 'error', 'startup', 'buffering', 'requested', 'canceled', 'unavailable', 'failed', 'manual', 'automatic', 'startup_timeout', 'access', 'user', 'completed', 'logout'),
  status: enumRule('requested', 'playing', 'ended', 'error', 'canceled', 'closed', 'available', 'completed', 'failed'),
  method: enumRule('code'), source_platform: enumRule('web', 'pwa', 'android_tv', 'macos', 'windows'),
  package_id: enumRule(...packageIds), package_months: value => value === 1 || value === 6 || value === 12,
  package_users: value => value === 1 || value === 2,
  offer_id: enumRule('welcome-monthly-50', 'welcome-monthly-50-v1'),
  item_list_id: enumRule('packages', 'home', 'movies', 'series', 'live', 'favorites', 'search'),
  file_extension: enumRule('exe', 'apk', 'dmg'), download_platform: enumRule('android_tv', 'macos', 'windows'),
  query_length: intRule(1000), result_count: intRule(1_000_000), page_number: intRule(100_000, 1),
  startup_ms: intRule(600_000), buffer_ms: intRule(86_400_000), watch_ms: intRule(86_400_000),
  progress_percent: numericRule(100), buffer_count: intRule(10_000), duration_ms: intRule(86_400_000),
  session_id: intRule(Number.MAX_SAFE_INTEGER, 1), engagement_time_msec: intRule(3_600_000)
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)); }
export function validAnalyticsClientId(value: unknown): value is string { return typeof value === 'string' && (uuid.test(value) || gaClientId.test(value)); }
export function validAnalyticsSessionId(value: unknown): value is number { return intRule(Number.MAX_SAFE_INTEGER, 1)(value); }

export function validateAnalyticsAttribution(value: unknown): AnalyticsAttribution | null {
  if (!object(value) || !exactKeys(value, ['consentVersion', 'clientId', 'sessionId', 'clientPlatform', ...(Object.prototype.hasOwnProperty.call(value,'sourcePlatform') ? ['sourcePlatform'] : [])]) || value.consentVersion !== 1 ||
      !validAnalyticsClientId(value.clientId) || !validAnalyticsSessionId(value.sessionId) || value.clientPlatform !== 'web' && value.clientPlatform !== 'pwa') return null;
  if (value.sourcePlatform !== undefined && !enumRule('android_tv','macos','windows')(value.sourcePlatform)) return null;
  return { consentVersion: 1, clientId: value.clientId, sessionId: value.sessionId, clientPlatform: value.clientPlatform, ...(value.sourcePlatform ? { sourcePlatform: value.sourcePlatform as AnalyticsAttribution['sourcePlatform'] } : {}) };
}

export function validateWindowsAnalyticsBatch(value: unknown, now = Date.now()): WindowsAnalyticsBatch | null {
  if (!object(value) || !exactKeys(value, ['schema', 'consentVersion', 'clientPlatform', 'clientId', 'sessionId', 'events']) || value.schema !== 1 || value.consentVersion !== 1 || value.clientPlatform !== 'windows' ||
      typeof value.clientId !== 'string' || !uuid.test(value.clientId) || !validAnalyticsSessionId(value.sessionId) || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > ANALYTICS_BATCH_EVENTS) return null;
  try { if (Buffer.byteLength(JSON.stringify(value), 'utf8') > ANALYTICS_BATCH_BYTES) return null; } catch { return null; }
  const ids = new Set<string>();
  for (const event of value.events) {
    if (!object(event) || !exactKeys(event, ['id', 'name', 'eventTimestampMs', 'params']) || typeof event.id !== 'string' || !uuid.test(event.id) || ids.has(event.id) ||
        typeof event.name !== 'string' || !eventNames.has(event.name) || !Number.isSafeInteger(event.eventTimestampMs) || Number(event.eventTimestampMs) < now - 72 * 3_600_000 || Number(event.eventTimestampMs) > now + 5 * 60_000 ||
        !object(event.params) || Object.keys(event.params).length > 20) return null;
    ids.add(event.id);
    for (const [key, param] of Object.entries(event.params)) if (!params[key]?.(param)) return null;
  }
  return value as WindowsAnalyticsBatch;
}
