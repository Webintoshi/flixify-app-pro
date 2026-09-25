"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "../../lib/api";
import { itemKey, sessionKey, type MediaItem, type Session } from "./types";

type Value = { session: Session | null; ready: boolean; favorites: MediaItem[]; favoritesReady: boolean; favoritesLoading: boolean; favoritesError: string; error: string; pending: Set<string>; toggle: (item: MediaItem) => Promise<void>; reload: () => void; invalidateFavorites: () => void; dismissError: () => void; saveSession: (s: Session) => void; logout: () => void };
const Context = createContext<Value | null>(null);
export function readSession(): Session | null {
  try { const s = JSON.parse(localStorage.getItem(sessionKey) ?? "null"); return typeof s?.accessToken === "string" ? s : null; } catch { return null; }
}
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
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
  const saveSession = useCallback((s: Session) => { localStorage.setItem(sessionKey, JSON.stringify(s)); window.dispatchEvent(new Event("flixify-session")); }, []);
  const logout = useCallback(() => { localStorage.removeItem(sessionKey); sessionStorage.removeItem("flixify-search-intent"); window.dispatchEvent(new Event("flixify-session")); }, []);
  useEffect(() => {
    let lastStored: string | null | undefined;
    const sync = () => {
      let stored: string | null = null;
      try { stored = localStorage.getItem(sessionKey); } catch { /* Restricted storage: remain signed out. */ }
      if (stored === lastStored) return;
      lastStored = stored;
      generation.current++; setSession(readSession()); setFavorites([]); setFavoritesReady(false); setFavoritesLoading(false); setFavoritesError(""); setReady(true); setError("");
    };
    sync();
    const onStorage = (e: StorageEvent) => { if (e.key === sessionKey || e.key === null) sync(); };
    const onVisible = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("storage", onStorage); window.addEventListener("flixify-session", sync);
    window.addEventListener("pageshow", sync); window.addEventListener("focus", sync); document.addEventListener("visibilitychange", onVisible);
    return () => {
      generation.current++;
      window.removeEventListener("storage", onStorage); window.removeEventListener("flixify-session", sync);
      window.removeEventListener("pageshow", sync); window.removeEventListener("focus", sync); document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const reload = useCallback(() => {
    if (!session || pendingRef.current.size || loadingGeneration.current === generation.current) return;
    const g = generation.current;
    loadingGeneration.current = g; setFavoritesLoading(true);
    apiRequest<{ items: MediaItem[]; partial?: boolean }>("/me/favorites", { signal: AbortSignal.timeout(60000) }).then(r => {
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
  }, [session]);
  const invalidateFavorites = useCallback(() => {
    generation.current++;
    loadingGeneration.current = null;
    setFavorites([]);
    setFavoritesReady(false);
    setFavoritesError("");
    reload();
  }, [reload]);
  useEffect(() => { reload(); window.addEventListener("focus", reload); return () => window.removeEventListener("focus", reload); }, [reload]);
  const toggle = async (item: MediaItem) => {
    const key = itemKey(item);
    if (!session || pendingRef.current.has(key) || !favoritesReady) return;
    const existing = favorites.find(f => itemKey(f) === key);
    const g = generation.current;
    pendingRef.current.add(key); setPending(new Set(pendingRef.current)); setError("");
    setFavorites(list => existing ? list.filter(f => itemKey(f) !== key) : [{ ...item, available: true }, ...list]);
    try { await apiRequest(`/me/favorites/${item.kind}/${encodeURIComponent(item.id)}`, { method: existing ? "DELETE" : "PUT" }); }
    catch { if (g === generation.current) { setFavorites(list => existing ? [existing, ...list.filter(f => itemKey(f) !== key)] : list.filter(f => itemKey(f) !== key)); setError("Favori değişikliği kaydedilemedi. Lütfen tekrar dene."); } }
    finally { pendingRef.current.delete(key); setPending(new Set(pendingRef.current)); }
  };
  return <Context.Provider value={{ session, ready, favorites, favoritesReady, favoritesLoading, favoritesError, error, pending, toggle, reload, invalidateFavorites, dismissError: () => setError(""), saveSession, logout }}>{children}</Context.Provider>;
}
export function usePlatform() { const value = useContext(Context); if (!value) throw new Error("PlatformProvider missing"); return value; }
