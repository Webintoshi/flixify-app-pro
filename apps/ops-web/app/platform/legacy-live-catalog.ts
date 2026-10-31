import { apiRequest } from "../../lib/api";
import { createCatalogMemoryCache, loadCatalogWithCache, type CatalogSnapshot } from "../canli-tv/live-channel-catalog";
import { curateLiveChannels } from "./live-channel-presentation";
import type { MediaItem } from "./types";

export type LegacyLiveItem = MediaItem & {
  transport?: "hls" | "ts" | "mp4" | "mkv" | "unknown";
  healthStatus?: "healthy" | "degraded" | "broken" | "unknown";
  isVerified?: boolean;
  lastCheckedAt?: string | null;
  variantGroupKey?: string | null;
  qualityRank?: number;
  streamUrl?: string;
  providerId?: string;
};
export type LegacyLiveCatalog = { items: Array<LegacyLiveItem & { sourceTitle: string }>; rawItems: LegacyLiveItem[]; canonicalById: Map<string, string>; total: number; groups: Array<{ title: string; count: number }> };
type LegacyLivePage = { items: LegacyLiveItem[]; total?: number; groups?: Array<{ title: string; count: number }> };
type LegacyLiveRequest = { signal: AbortSignal; accessToken: string; skipAuthRefresh: true };
export type LegacyLiveLoad = {
  accountId: string;
  accessToken: string;
  sourceScope?: string;
  signal?: AbortSignal;
  excludedIds?: ReadonlySet<string>;
  onPage?: (snapshot: LegacyLiveCatalog) => void;
  onProgress?: (loaded: number, total: number | null) => void;
};
export function createLegacyLiveCatalogLoader(options: {
  request?: (path: string, request: LegacyLiveRequest) => Promise<LegacyLivePage>;
  pageSize?: number;
  now?: () => number;
} = {}) {
  const request = options.request ?? ((path, init) => apiRequest<LegacyLivePage>(path, init));
  const cache = createCatalogMemoryCache<CatalogSnapshot<LegacyLiveItem>>({ now: options.now, maxEntries: 4 });
  return async (input: LegacyLiveLoad): Promise<LegacyLiveCatalog> => {
    const { accountId, accessToken, signal: ownerSignal, onPage, onProgress } = input;
    ownerSignal?.throwIfAborted();
    const scope = `legacy-live:${input.sourceScope ?? "default"}`;
    const excludedIds = input.excludedIds ? new Set(input.excludedIds) : undefined;
    const pageSize = options.pageSize ?? 300;
    const controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort(ownerSignal?.reason);
    ownerSignal?.addEventListener("abort", abort, { once: true });
    const project = (snapshot: CatalogSnapshot<LegacyLiveItem>): LegacyLiveCatalog => {
      signal.throwIfAborted();
      const { items, canonicalById } = curateLiveChannels(snapshot.items, excludedIds);
      const groups = new Map<string, number>();
      for (const item of items) if (item.groupTitle) groups.set(item.groupTitle, (groups.get(item.groupTitle) ?? 0) + 1);
      const rawItems = snapshot.items.filter(item => !excludedIds?.has(item.id) && !(item.providerId && excludedIds?.has(item.providerId)));
      return { items, rawItems, canonicalById, total: items.length, groups: [...groups].map(([title, count]) => ({ title, count })) };
    };
    try {
      const cached = cache.get(accountId, scope);
      const cachedProjection = cached ? project(cached.snapshot) : null;
      if (cachedProjection) onPage?.(cachedProjection);
      const snapshot = await loadCatalogWithCache({
        cache: {
          get: cache.get,
          set: (account, source, value) => { signal.throwIfAborted(); cache.set(account, source, value); }
        },
        account: accountId, scope, pageSize, signal,
        fetchPage: async ({ page }) => {
          signal.throwIfAborted();
          const response = await request(`/me/catalog/live?page=${page}&pageSize=${pageSize}`, { signal, accessToken, skipAuthRefresh: true });
          signal.throwIfAborted();
          return { ...response, items: response.items.map(item => ({ ...item, kind: "live" as const })) };
        },
        onPage: () => {},
        onProgress: (loaded, total) => { signal.throwIfAborted(); onProgress?.(loaded, total); }
      });
      signal.throwIfAborted();
      if (cached && snapshot === cached.snapshot && cachedProjection) return cachedProjection;
      const result = project(snapshot);
      onPage?.(result);
      return result;
    } finally {
      ownerSignal?.removeEventListener("abort", abort);
    }
  };
}
export const loadLegacyLiveCatalog = createLegacyLiveCatalogLoader();
