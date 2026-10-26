"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "../../lib/api";
import { createPersonalProviderClient, validatePersonalBootstrap, type PersonalProviderBootstrap, type PersonalRef } from "./personal-provider";
import { sessionIdentity, hydratePersonalFavorites, createScopedBootstrapLoader } from "./personal-integration";
import { createDirectPlaybackDeadline } from "./direct-playback-deadline";
import { itemKey, sessionKey, type MediaItem, type Session } from "./types";

type Value = { providerExpiresAt: string | null | undefined; providerRevision: number; personalProvider: ReturnType<typeof createPersonalProviderClient> | null; providerMode: "loading" | "personal" | "legacy"; providerError: string; providerScope: string; session: Session | null; ready: boolean; favorites: MediaItem[]; favoritesReady: boolean; favoritesLoading: boolean; favoritesError: string; error: string; pending: Set<string>; toggle: (item: MediaItem) => Promise<void>; reload: () => void; refreshProvider: () => void; invalidateFavorites: () => void; dismissError: () => void; saveSession: (s: Session) => void; logout: () => void };
type BootstrapRequest = { identity: string; controller?: AbortController; retryRequested: boolean };
const Context = createContext<Value | null>(null);
export function readSession(): Session | null {
  try { const s = JSON.parse(localStorage.getItem(sessionKey) ?? "null"); return typeof s?.accessToken === "string" ? s : null; } catch { return null; }
}
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [providerExpiresAt, setProviderExpiresAt] = useState<string | null | undefined>(undefined);
  const [providerRevision, setProviderRevision] = useState(0);
  const metadataRefresh = useRef<(() => void) | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [personalProvider, setPersonalProvider] = useState<ReturnType<typeof createPersonalProviderClient> | null>(null);
  const providerRef = useRef<ReturnType<typeof createPersonalProviderClient> | null>(null);
  const bootstrapRef = useRef<BootstrapRequest | null>(null);
  const identityRef = useRef("");
  const sourceRef = useRef("");
  const [providerMode, setProviderMode] = useState<"loading" | "personal" | "legacy">("loading");
  const [providerError, setProviderError] = useState("");
  const [providerScope, setProviderScope] = useState("");
  const [providerRetry, setProviderRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const [favorites, setFavorites] = useState<MediaItem[]>([]);
  const [favoritesReady, setFavoritesReady] = useState(false);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesError, setFavoritesError] = useState("");
  const loadingGeneration = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(new Set<string>());
  const pendingRef = useRef(new Set<string>());
  const generation = useRef(0);
  const refreshProvider = useCallback(() => {
    const identity = identityRef.current;
    if (!identity) return;
    if (bootstrapRef.current?.identity === identity) { bootstrapRef.current.retryRequested = true; return; }
    if (metadataRefresh.current) { metadataRefresh.current(); return; }
    bootstrapRef.current = { identity, retryRequested: false };
    setProviderRetry(value => value + 1);
  }, []);
  const saveSession = useCallback((s: Session) => { localStorage.setItem(sessionKey, JSON.stringify(s)); window.dispatchEvent(new Event("flixify-session")); }, []);
  const logout = useCallback(() => { providerRef.current?.clear(); providerRef.current = null; localStorage.removeItem(sessionKey); sessionStorage.removeItem("flixify-search-intent"); window.dispatchEvent(new Event("flixify-session")); }, []);
  useEffect(() => {
    let lastStored: string | null | undefined;
    const sync = () => {
      let stored: string | null = null;
      try { stored = localStorage.getItem(sessionKey); } catch { /* Restricted storage: remain signed out. */ }
      if (stored === lastStored) return;
      lastStored = stored;
      const next = readSession(); const identity = sessionIdentity(next);
      setSession(next); setReady(true);
      if (identity === identityRef.current) return;
      identityRef.current = identity; sourceRef.current = ""; setProviderExpiresAt(undefined);
      bootstrapRef.current?.controller?.abort(); bootstrapRef.current = null;
      providerRef.current?.clear(); providerRef.current = null; setPersonalProvider(null); setProviderMode(next ? "loading" : "legacy"); setProviderScope(""); setProviderError("");
      pendingRef.current.clear(); setPending(new Set());
      generation.current++; setFavorites([]); setFavoritesReady(false); setFavoritesLoading(false); setFavoritesError(""); setReady(true); setError("");
    };
    sync();
    const onStorage = (e: StorageEvent) => { if (e.key === sessionKey || e.key === null) sync(); };
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("storage", onStorage); window.addEventListener("flixify-session", sync);
    window.addEventListener("pageshow", sync); window.addEventListener("focus", sync); document.addEventListener("visibilitychange", onVisible);
    return () => {
      generation.current++; providerRef.current?.clear(); providerRef.current = null;
      window.removeEventListener("storage", onStorage); window.removeEventListener("flixify-session", sync);
      window.removeEventListener("pageshow", sync); window.removeEventListener("focus", sync); document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const identity = sessionIdentity(session);
  useEffect(() => {
    if (!identity) return;
    const controller = new AbortController(); let disposed = false; let deadline: ReturnType<typeof createDirectPlaybackDeadline> | undefined;
    const bootstrapRequest: BootstrapRequest = { identity, controller, retryRequested: false };
    bootstrapRef.current = bootstrapRequest;
    const g = generation.current;
    const publish = (bootstrap: PersonalProviderBootstrap) => {
      if (disposed || identityRef.current !== identity) throw new Error("Session changed");
      if(sourceRef.current !== bootstrap.sourceVersion) {
        generation.current++; loadingGeneration.current = null; pendingRef.current.clear(); setPending(new Set()); setFavorites([]); setFavoritesReady(false); setFavoritesError("");
      }
      sourceRef.current = bootstrap.sourceVersion;
      setProviderScope(bootstrap.sourceVersion);
      setProviderExpiresAt(bootstrap.expiresAt); setProviderRevision(value => value + 1);
      deadline?.dispose();
      deadline = createDirectPlaybackDeadline(bootstrap.expiresAt, () => { setProviderExpiresAt(null); generation.current++; loadingGeneration.current = null; pendingRef.current.clear(); setPending(new Set()); providerRef.current?.clear(); providerRef.current = null; setPersonalProvider(null); setProviderMode("loading"); setProviderScope(""); setProviderError("İzleme süren doldu."); setFavorites([]); setFavoritesReady(false); });
      return bootstrap;
    };
    let refreshing = false;
    const refreshMetadata = () => {
      if (disposed || refreshing || identityRef.current !== identity) return;
      const client = providerRef.current;
      if (!client) { refreshProviderAfterInitial(); return; }
      refreshing = true;
      void client.refreshMetadata().catch(cause => {
        if (disposed || identityRef.current !== identity) return;
        if (cause instanceof Error && cause.message === "Kisisel yayin erisimi kullanilamiyor.") revoke();
      }).finally(()=>{refreshing=false;});
    };
    const revoke = () => { deadline?.dispose(); if (providerRef.current) { generation.current++; loadingGeneration.current = null; pendingRef.current.clear(); setPending(new Set()); setFavorites([]); setFavoritesReady(false); } providerRef.current?.clear(); providerRef.current = null; setPersonalProvider(null); setProviderExpiresAt(null); setProviderScope(""); setProviderMode("legacy"); setProviderRevision(value=>value+1); };
    const refreshProviderAfterInitial = () => {
      if (bootstrapRef.current) return;
      setProviderRetry(value=>value+1);
    };
    metadataRefresh.current = refreshMetadata;
    const interval = window.setInterval(refreshMetadata, 60_000);

    apiRequest<PersonalProviderBootstrap>("/me/provider-session", {signal:AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])}).then(async value => {
      if (disposed || g !== generation.current) return;
      const initial = publish(validatePersonalBootstrap(value));
      let seed: PersonalProviderBootstrap | null = initial;
      const loadBootstrap = createScopedBootstrapLoader(async signal => {
        if (seed) { const value = seed; seed = null; return value; }
        return apiRequest("/me/provider-session", {signal:AbortSignal.any([signal, AbortSignal.timeout(15000)])}).catch(cause => { if (!disposed && identityRef.current === identity && cause instanceof Error && cause.message === "Kisisel yayin erisimi kullanilamiyor.") revoke(); throw cause; });
      }, publish, () => !disposed && identityRef.current === identity);
      const client = createPersonalProviderClient({loadBootstrap});
      await client.refreshMetadata();
      if (disposed || identityRef.current !== identity) { client.clear(); return; }
      providerRef.current = client; setPersonalProvider(client); setProviderMode("personal"); setProviderError("");
    }).catch(cause => {
      if (disposed || g !== generation.current) return;
      // This endpoint's fixed ineligible response is the only permitted legacy fallback.
      if (cause instanceof Error && cause.message === "Kisisel yayin erisimi kullanilamiyor.") revoke();
      else setProviderError("Kişisel yayın erişimi doğrulanamadı. Tekrar deneyebilirsin.");
    }).finally(() => {
      if (bootstrapRef.current !== bootstrapRequest) return;
      bootstrapRef.current = null;
      // An activation received during an older request must survive its ineligible response.
      if (!disposed && !providerRef.current && bootstrapRequest.retryRequested && identityRef.current === identity) refreshProvider();
    });
    return () => { disposed = true; window.clearInterval(interval);  if (metadataRefresh.current === refreshMetadata) metadataRefresh.current = null; controller.abort(); if (bootstrapRef.current === bootstrapRequest) bootstrapRef.current = null; deadline?.dispose(); providerRef.current?.clear(); };
  }, [identity, providerRetry, refreshProvider]);
  const reloadFavorites = useCallback(() => {
    if (providerMode === "loading") return;
    if (!identity || pendingRef.current.size || loadingGeneration.current === generation.current) return;
    const g = generation.current;
    loadingGeneration.current = g; setFavoritesLoading(true);
    const load = personalProvider && providerMode === "personal"
      ? apiRequest<{favorites:PersonalRef[]}>("/me/personal-library", {signal:AbortSignal.timeout(15000)}).then(async library => {
        const kinds = Array.from(new Set(library.favorites.filter(ref=>ref.kind !== "episode").map(ref=>ref.kind as MediaItem["kind"])));
        const rows = await Promise.all(kinds.map(kind=>personalProvider.catalog(kind)));
        return {items:hydratePersonalFavorites(library.favorites,rows.flat()),partial:false};
      })
      : apiRequest<{items:MediaItem[];partial?:boolean}>("/me/favorites", {signal:AbortSignal.timeout(60000)});
    load.then(r => {
      if (g === generation.current && !pendingRef.current.size) {
        setFavorites(r.items); setFavoritesReady(true);
        setFavoritesError(r.partial ? "Bazı favorilerin kaynağı şu anda doğrulanamıyor. Diğer favorilerini kullanabilirsin." : "");
      }
    }).catch(() => {
      if (g === generation.current) setFavoritesError("Favoriler güncellenemedi. Kayıtlı favorilerin silinmedi; tekrar deneyebilirsin.");
    }).finally(() => {
      if (loadingGeneration.current === g) loadingGeneration.current = null;
      if (g === generation.current) setFavoritesLoading(false);
    });
  }, [identity, personalProvider, providerMode, providerScope]);
  const reload = useCallback(() => { refreshProvider(); reloadFavorites(); }, [refreshProvider, reloadFavorites]);
  const invalidateFavorites = useCallback(() => {
    generation.current++;
    loadingGeneration.current = null;
    setFavorites([]);
    setFavoritesReady(false);
    setFavoritesError("");
    reload();
  }, [reload, providerMode]);
  useEffect(() => { reloadFavorites(); window.addEventListener("focus", reload); return () => window.removeEventListener("focus", reload); }, [reload, reloadFavorites]);
  const toggle = async (item: MediaItem) => {
    const key = itemKey(item);
    if (!session || pendingRef.current.has(key) || !favoritesReady) return;
    const existing = favorites.find(f => itemKey(f) === key);
    const g = generation.current;
    pendingRef.current.add(key); setPending(new Set(pendingRef.current)); setError("");
    setFavorites(list => existing ? list.filter(f => itemKey(f) !== key) : [{ ...item, available: true }, ...list]);
    try {
      if (providerMode === "personal") {
        if (!item.personalRef) throw new Error("Unavailable reference");
        await apiRequest("/me/personal-library/favorites", {method:existing ? "DELETE" : "PUT",body:{ref:item.personalRef}});
      } else if(providerMode === "legacy") await apiRequest(`/me/favorites/${item.kind}/${encodeURIComponent(item.id)}`, { method: existing ? "DELETE" : "PUT" });
      else throw new Error("Unavailable session");
    }
    catch { if (g === generation.current) { setFavorites(list => existing ? [existing, ...list.filter(f => itemKey(f) !== key)] : list.filter(f => itemKey(f) !== key)); setError("Favori değişikliği kaydedilemedi. Lütfen tekrar dene."); } }
    finally { if(g === generation.current) {pendingRef.current.delete(key); setPending(new Set(pendingRef.current));} }
  };
  return <Context.Provider value={{ providerExpiresAt, providerRevision, personalProvider, providerMode, providerError, providerScope, session, ready, favorites, favoritesReady, favoritesLoading, favoritesError, error, pending, toggle, reload, refreshProvider, invalidateFavorites, dismissError: () => setError(""), saveSession, logout }}>{children}</Context.Provider>;
}
export function usePlatform() { const value = useContext(Context); if (!value) throw new Error("PlatformProvider missing"); return value; }

export function useProviderExpiry() { return useContext(Context)?.providerExpiresAt; }
