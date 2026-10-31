"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../../lib/api";
import { accountState, type AccountUser } from "../../lib/account-model";
import { Artwork, FavoriteButton } from "./artwork";
import { Detail } from "./detail";
import { CategorySidebar } from "./categories";
import { CatalogSearchDialog } from "./catalog-search";
import { AdultMovieToggle } from "./adult-movie-toggle";
import { emptyCatalogCopy } from "./catalog-empty";
import { Icon } from "./icons";
import { usePlatform } from "./session";
import { pagePersonalCatalog, sessionIdentity, resolvePersonalDetail } from "./personal-integration";
import { buildShowcaseRails, orderShowcaseCatalog, showcaseDayKey } from "./catalog-showcase";
import { buildHomepageShowcase, selectHomepageCatalog } from "./homepage-showcase";
import { HomepageHero } from "./homepage-hero";
import { pageLiveChannelCatalog } from "./live-channel-lineup";
import { loadLegacyLiveCatalog } from "./legacy-live-catalog";
import { itemKey, type Catalog, type Kind, type MediaItem } from "./types";
import s from "./platform.module.css";
import seriesStyles from "./series-catalog.module.css";
import panelStyles from "./catalog-panels.module.css";
import homeStyles from "./homepage.module.css";

const cache = new Map<string, { at: number; data: Catalog }>();
let cacheAccount = "";
const noPosterFailures: ReadonlySet<string> = new Set();
const routes = { live: "live", movie: "movies", series: "series" };
type CatalogRequest = { signal?: AbortSignal; accessToken?: string; skipAuthRefresh?: boolean };
function getCatalog(kind: Kind, page: number, search: string, group: string, account: string, movieRevision = 0, pageSize = 48, request?: CatalogRequest): Promise<Catalog> {
  request?.signal?.throwIfAborted();
  if (cacheAccount !== account) { cache.clear(); cacheAccount = account; }
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search, group });
  const key = `${kind}?${params}${kind === "movie" ? `&revision=${movieRevision}` : ""}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < 60000) return Promise.resolve(saved.data);
  return apiRequest<Catalog>(`/me/catalog/${routes[kind]}?${params}`, request).then(data => {
    request?.signal?.throwIfAborted();
    const normalized = { ...data, items: data.items.map(item => ({ ...item, kind })) };
    if (cacheAccount === account) { if (cache.size > 24) cache.delete(cache.keys().next().value!); cache.set(key, { at: Date.now(), data: normalized }); }
    return normalized;
  });
}
async function getHomepageCatalog(kind: Kind, account: string, movieRevision: number, accessToken: string, signal?: AbortSignal): Promise<Catalog> {
  const request = { signal, accessToken, skipAuthRefresh: true };
  const first = await getCatalog(kind, 1, "2026", "", account, movieRevision, 300, request);
  const items = [...first.items];
  const pages = Math.ceil(Math.min(first.total, 50_000) / 300);
  for (let page = 2; page <= pages && first.items.length; page++) {
    const next = await getCatalog(kind, page, "2026", "", account, movieRevision, 300, request);
    if (!next.items.length) break;
    items.push(...next.items);
  }
  return { ...first, items, total: items.length };
}
function MediaTile({ item, open }: { item: MediaItem; open: (item: MediaItem, autoPlay?: boolean) => void }) {
  const tileRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ top: number; left: number; width: number; height: number; favoriteLeft: number; favoriteTop: number } | null>(null);
  const hidePreview = () => setPreview(null);
  const cancelClose = () => { if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(hidePreview, 120); };
  const showPreview = (keyboard = false) => {
    if (item.kind === "live" || item.available === false || (!keyboard && !window.matchMedia("(hover: hover) and (pointer: fine)").matches)) return;
    const anchor = tileRef.current?.querySelector<HTMLElement>(`.${s.artwork}`);
    if (!anchor) return;
    cancelClose();
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const height = Math.min(rect.height, window.innerHeight - 96);
    const left = Math.max(12, Math.min(rect.left + width <= window.innerWidth - 12 ? rect.left : rect.right - width, window.innerWidth - width - 12));
    const top = Math.max(76, Math.min(rect.top, window.innerHeight - height - 12));
    setPreview({ top, left, width, height, favoriteLeft: Math.max(8, Math.min(rect.right - left - 40, width - 40)), favoriteTop: Math.max(8, Math.min(rect.top - top + 8, height - 40)) });
  };
  useEffect(() => {
    if (!preview) return;
    const closeOnFocus = () => { const active = document.activeElement; if (active && !tileRef.current?.contains(active) && !previewRef.current?.contains(active)) hidePreview(); };
    const closeOnKey = (event: KeyboardEvent) => { if (event.key === "Escape") hidePreview(); };
    document.addEventListener("scroll", hidePreview, true);
    document.addEventListener("focusin", closeOnFocus);
    window.addEventListener("resize", hidePreview);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      document.removeEventListener("scroll", hidePreview, true);
      document.removeEventListener("focusin", closeOnFocus);
      window.removeEventListener("resize", hidePreview);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [preview]);
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  const details = [item.kind === "series" ? "Dizi" : item.kind === "movie" ? "Film" : "Canlı TV", item.kind === "live" ? null : item.groupTitle, item.seasonCount ? `${item.seasonCount} sezon` : null, item.episodeCount ? `${item.episodeCount} bölüm` : null].filter(Boolean).join(" · ");
  return <div ref={tileRef} data-homepage-poster={itemKey(item)} className={`${s.tile} ${item.kind === "live" ? s.channelTile : ""}`} onMouseEnter={() => showPreview()} onMouseLeave={scheduleClose}>
    <button className={s.tileOpen} onFocus={event => showPreview(event.currentTarget.matches(":focus-visible"))} onClick={() => { hidePreview(); open(item); }} disabled={item.available === false} aria-label={`${item.title} oynat`}><div className={s.posterFrame}><Artwork item={item}/><span className={s.tilePlay} aria-hidden="true"><Icon name={item.kind === "live" ? "live" : "play"}/></span></div><strong>{item.title}</strong>{item.available === false ? <small>{item.lookupFailed ? "Geçici olarak doğrulanamıyor" : "Şu anda kullanılamıyor"}</small> : item.kind !== "live" ? <small>{item.groupTitle}</small> : null}</button><FavoriteButton item={item}/>
    {preview && createPortal(<div ref={previewRef} className={s.expandedPreview} data-media-preview role="group" aria-label={`${item.title} hızlı önizleme`} style={{ top: preview.top, left: preview.left, width: preview.width, height: preview.height }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      <button type="button" className={s.expandedPreviewPlay} aria-label={`${item.title} önizlemeden oynat`} onClick={() => { hidePreview(); open(item); }}/>
      <Artwork item={item}/><div className={s.expandedPreviewShade}/><div className={s.expandedPreviewQuick} style={{ left: preview.favoriteLeft, top: preview.favoriteTop }}><FavoriteButton item={item}/></div><div className={s.expandedPreviewCopy}><span className={s.expandedPreviewEyebrow}>{item.kind === "series" ? "DİZİ" : "FİLM"}</span><h3>{item.title}</h3><p>{details}</p><div className={s.expandedPreviewActions}><button type="button" className={s.expandedPreviewMore} onClick={() => { hidePreview(); open(item, false); }}>Daha Fazla <Icon name="arrow"/></button><FavoriteButton item={item} expanded/></div></div>
    </div>, document.body)}
  </div>;
}
function Skeletons() { return <div className={s.grid} aria-busy="true" aria-label="İçerikler yükleniyor">{Array.from({ length: 12 }, (_, i) => <div className={s.skeleton} key={i}/>)}</div>; }
function MediaRail({ label, row, href, open, className, landscape = false }: { label: string; row: MediaItem[]; href?: string; open: (item: MediaItem, autoPlay?: boolean) => void; className?: string; landscape?: boolean }) {
  const rail = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ start: true, end: false });
  const move = (direction: number) => {
    const element = rail.current;
    if (!element) return;
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * element.clientWidth * .8, behavior: reducedMotion ? "auto" : "smooth" });
  };
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () => setPosition({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 });
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    }
  }, [row.length]);
  return <section className={`${s.mediaSection} ${landscape ? s.landscapeRail : ""} ${className ?? ""}`} data-media-layout={landscape ? "landscape" : "poster"}>
    <div className={s.sectionHeading}><h2>{label}</h2><div className={s.railActions}>
      {href && <Link href={href}>Tümünü Gör <Icon name="arrow"/></Link>}
      <button type="button" aria-label={`${label} önceki içerikler`} disabled={position.start} onClick={() => move(-1)}><span style={{ display: "flex", transform: "rotate(180deg)" }}><Icon name="arrow"/></span></button>
      <button type="button" aria-label={`${label} sonraki içerikler`} disabled={position.end} onClick={() => move(1)}><Icon name="arrow"/></button>
    </div></div>
    <div ref={rail} className={s.horizontalRail} onScroll={() => { const element = rail.current; if (element) setPosition({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 }); }}>{row.map(item => <MediaTile key={itemKey(item)} item={item} open={open}/>)}</div>
  </section>;
}
export default function CatalogPage({ kind, overview = false, favoritesOnly = false }: { kind: Kind; overview?: boolean; favoritesOnly?: boolean }) {
  const { session, personalProvider, providerMode, providerError, providerScope, livePolicyRevision, favorites, favoritesReady, favoritesLoading, favoritesError, invalidateFavorites, reload: reloadFavorites } = usePlatform();
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [panel, setPanel] = useState<{ owner: object; type: "search" | "categories" } | null>(null);
  const [search, setSearch] = useState(query);
  const [group, setGroup] = useState("");
  const hasCategories = !favoritesOnly && !overview;
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<Catalog>({ items: [], total: 0 });
  const [catalogAccount, setCatalogAccount] = useState("");
  const [accessAccount, setAccessAccount] = useState<{ account: string; user: AccountUser } | null>(null);
  const [categoryGroups, setCategoryGroups] = useState<{ account: string; kind: Kind; groups: NonNullable<Catalog["groups"]> }>({ account: "", kind, groups: [] });
  const [otherRows, setOtherRows] = useState<{ kind: Kind; data: Catalog }[]>([]);
  const [otherRowsAccount, setOtherRowsAccount] = useState("");
  const [otherVodLoading, setOtherVodLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [movieRevision, setMovieRevision] = useState<{ account: string; revision: number }>({ account: "", revision: 0 });
  const [detail, setDetail] = useState<MediaItem | null>(null);
  const [detailAccount, setDetailAccount] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const openedHere = useRef(false);
  const identity = sessionIdentity(session);
  const account = `${identity}:${providerMode}:${providerScope}`;
  const [day, setDay] = useState(showcaseDayKey);
  // A view owns a frozen raw snapshot, even when playback refreshes provider caches.
  const personalSnapshot = useMemo(() => ({ raw: new Map<Kind, Promise<MediaItem[]>>(), daily: new Map<string, MediaItem[]>() }), [account, personalProvider]);
  const [posterFailures, setPosterFailures] = useState<{ owner: object | null; ids: ReadonlySet<string> }>({ owner: null, ids: noPosterFailures });
  const failedPosters = posterFailures.owner === personalSnapshot ? posterFailures.ids : noPosterFailures;
  const [catalogSnapshot, setCatalogSnapshot] = useState<typeof personalSnapshot | null>(null);
  const [rowsSnapshot, setRowsSnapshot] = useState<typeof personalSnapshot | null>(null);
  // Legacy day changes only re-present loaded rows; personal paging needs a new cached daily slice.
  const acquisitionDay = providerMode === "personal" ? day : "";
  const loadCatalog = useCallback((kind: Kind, page: number, search: string, group: string, account: string, revision = 0, signal?: AbortSignal): Promise<Catalog> => {
    if (personalProvider && providerMode === "personal") {
      const snapshot = personalSnapshot;
      let raw = kind === "live" ? personalProvider.catalog(kind) : snapshot.raw.get(kind);
      if (!raw) {
        raw = personalProvider.catalog(kind).then(items => [...items]);
        snapshot.raw.set(kind, raw);
        const pending = raw;
        raw.catch(() => { if (snapshot.raw.get(kind) === pending) snapshot.raw.delete(kind); });
      }
      return raw.then(items => {
        signal?.throwIfAborted();
        if (overview && kind !== "live" && !search && !group) {
          const key = `home:${kind}:${acquisitionDay}`;
          let selected = snapshot.daily.get(key);
          if (!selected) {
            selected = selectHomepageCatalog(items, kind, acquisitionDay);
            if (snapshot.daily.size >= 6) snapshot.daily.delete(snapshot.daily.keys().next().value!);
            snapshot.daily.set(key, selected);
          }
          return { items: selected, total: selected.length };
        }
        if (kind === "live") return pageLiveChannelCatalog(items,page,search,group);
        const original = pagePersonalCatalog(items, page, search, group);
        if (search || group) return original;
        const key = `${kind}:${acquisitionDay}`;
        let ordered = snapshot.daily.get(key);
        if (!ordered) {
          ordered = orderShowcaseCatalog(items, kind, acquisitionDay);
          if (snapshot.daily.size >= 6) snapshot.daily.delete(snapshot.daily.keys().next().value!);
          snapshot.daily.set(key, ordered);
        }
        return { ...original, items: ordered.slice((page - 1) * 48, page * 48) };
      });
    }
    if (providerMode !== "legacy") return Promise.reject(new Error("Provider loading"));
    if (kind === "live") return loadLegacyLiveCatalog({ accountId: identity, accessToken: session?.accessToken ?? "", sourceScope: providerScope, signal }).then(data => {
      signal?.throwIfAborted();
      return pageLiveChannelCatalog(data.items, page, search, group);
    });
    if (overview && !search && !group) return getHomepageCatalog(kind, account, revision, session?.accessToken ?? "", signal).then(data => {
      const items = selectHomepageCatalog(data.items, kind, "");
      return { ...data, items, total: items.length };
    });
    return getCatalog(kind, page, search, group, account, revision, 48, { signal });
  }, [personalProvider, providerMode, providerScope, identity, acquisitionDay, personalSnapshot, livePolicyRevision, overview, session?.accessToken]);
  const hasSession = Boolean(session);
  const currentMovieRevision = movieRevision.account === account ? movieRevision.revision : 0;
  const selectedId = params.get("item");
  const selectedKind = params.get("kind");
  const panelOwner = useMemo(() => ({ account, kind, group, query, search, filter, overview, favoritesOnly, selectedId, selectedKind, currentMovieRevision, personalSnapshot }), [account, kind, group, query, search, filter, overview, favoritesOnly, selectedId, selectedKind, currentMovieRevision, personalSnapshot]);
  const panelOwnerRef = useRef(panelOwner);
  panelOwnerRef.current = panelOwner;
  const activePanel = panel?.owner === panelOwner ? panel.type : null;
  const [categoryPreview, setCategoryPreview] = useState<{ owner: object; groups: NonNullable<Catalog["groups"]>; total: number } | null>(null);
  useEffect(() => { setPanel(null); }, [panelOwner]);
  const catalogOwner = JSON.stringify([account, kind, search, group, acquisitionDay, overview]);
  const rowsOwner = JSON.stringify([account, search, acquisitionDay]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "hidden" && page === 1 && !query && !search && !group && !selectedId && !detail && !panel) setDay(showcaseDayKey());
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.clearInterval(timer); };
  }, [account, kind, page, query, search, group, selectedId, detail, panel]);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { const q = params.get("q"); if (q !== null) setQuery(q); }, [params]);
  useEffect(() => {
    if (!hasSession) { setAccessAccount(null); return; }
    let cancelled = false;
    const refresh = () => { if (running) return; running = true; void apiRequest<{ user: AccountUser }>("/me").then(data => {
      if (!cancelled && data.user && typeof data.user.hasAssignedLink === "boolean") {
        setAccessAccount({ account, user: data.user });
      }
    }).catch(() => {}).finally(() => { running = false; }); };
    let running = false; refresh();
    const timer = window.setInterval(refresh, 60_000); window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [account, hasSession, reload]);
  useEffect(() => {
    if (accessAccount?.account !== account) return;
    const endsAt = Date.parse(accessAccount.user.activePackage?.endsAt ?? "");
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) return;
    const refreshAtDeadline = () => setReload(value => value + 1);
    const timer = setTimeout(refreshAtDeadline, Math.min(endsAt - Date.now() + 25, 2_147_483_647));
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() >= endsAt) refreshAtDeadline(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [accessAccount, account]);
  useEffect(() => { setGroup(""); }, [account, kind]);
  useEffect(() => { setPage(1); setCatalog(previous => ({ ...previous, items: [], total: 0 })); setDetail(null); }, [account, kind, group, search]);
  useEffect(() => {
    if (!session || providerMode === "loading" || favoritesOnly) { setLoading(false); return; }
    let cancelled = false; const controller = new AbortController(); setLoading(true); setError("");
    loadCatalog(kind, page, search, group, account, currentMovieRevision, controller.signal).then(data => {
      if (cancelled) return;
      setCatalog(previous => ({ ...data, items: page === 1 || catalogAccount !== catalogOwner ? data.items : Array.from(new Map([...previous.items, ...data.items].map(i => [itemKey(i), i])).values()) }));
      if (!group && data.groups?.length) setCategoryGroups({ account, kind, groups: data.groups });
      setCatalogAccount(catalogOwner);
      setCatalogSnapshot(personalSnapshot);
    }).catch(() => { if (!cancelled) setError("İçerikler yüklenemedi. Tekrar deneyebilirsin."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [session, account, kind, page, search, group, favoritesOnly, reload, currentMovieRevision, loadCatalog]);
  useEffect(() => {
    if (!overview || !session || providerMode === "loading") return;
    let cancelled = false; const controller = new AbortController(); setOtherVodLoading(true);
    setOtherRows([]); setOtherRowsAccount(rowsOwner); setRowsSnapshot(personalSnapshot);
    for (const rowKind of ["series", "live"] as Kind[]) {
      void loadCatalog(rowKind, 1, search, "", account, 0, controller.signal).then(data => {
        if (!cancelled) setOtherRows(previous => cancelled ? previous : [...previous.filter(row => row.kind !== rowKind), { kind: rowKind, data }].sort((a, b) => a.kind === b.kind ? 0 : a.kind === "series" ? -1 : 1));
      }).catch(() => { if (!cancelled) setError("Bazı içerikler yüklenemedi. Tekrar deneyebilirsin."); })
        .finally(() => { if (!cancelled && rowKind === "series") setOtherVodLoading(false); });
    }
    return () => { cancelled = true; controller.abort(); };
  }, [overview, session, account, search, reload, currentMovieRevision, loadCatalog]);
  useEffect(() => {
    if (!selectedId || !["movie", "series"].includes(selectedKind ?? "")) { setDetail(null); return; }
    let cancelled = false; setDetail(null); setDetailLoading(true); setError("");
    const loadDetail = providerMode === "personal" && personalProvider
      ? resolvePersonalDetail(personalProvider, selectedId, selectedKind as Kind)
      : providerMode === "legacy" ? apiRequest<MediaItem>(`/me/library/${selectedKind}/${encodeURIComponent(selectedId)}`) : Promise.reject(new Error("Provider loading"));
    loadDetail.then(item => { if (!cancelled) { setDetail(item); setDetailAccount(account); } }).catch(() => { if (!cancelled) setError("İçerik detayı açılamadı. Tekrar deneyebilirsin."); }).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, selectedKind, account, personalProvider, providerMode]);
  const open = (item: MediaItem, autoPlay = true) => {
    if (item.kind === "live") { router.push(`/canli-tv?channel=${encodeURIComponent(item.id)}`); return; }
    openedHere.current = true;
    const next = new URLSearchParams(params.toString()); next.set("item", item.id); next.set("kind", item.kind);
    if (autoPlay) next.set("play", "1"); else next.delete("play");
    router.push(`?${next}`, { scroll: false });
  };
  const close = () => { setDetail(null); if (openedHere.current) { openedHere.current = false; router.back(); } else { const next = new URLSearchParams(params.toString()); next.delete("item"); next.delete("kind"); next.delete("play"); router.replace(`?${next}`, { scroll: false }); } };
  const updateAdultPreference = (revision: number, visible: boolean) => {
    if (currentMovieRevision === revision) return;
    for (const key of cache.keys()) if (key.startsWith("movie?")) cache.delete(key);
    setMovieRevision({ account, revision });
    setCatalog({ items: [], total: 0 });
    setCatalogAccount(account);
    setGroup("");
    setPage(1);
    if (!visible) {
      setDetail(null);
      if (selectedKind === "movie" && selectedId) {
        const next = new URLSearchParams(params.toString());
        next.delete("item"); next.delete("kind"); next.delete("play");
        openedHere.current = false;
        router.replace(`?${next}`, { scroll: false });
      }
    }
    invalidateFavorites();
  };
  const title = favoritesOnly ? "Favorilerim" : overview ? "Senin Alanın" : kind === "movie" ? "Filmler" : "Diziler";
  const verifiedUser = accessAccount?.account === account ? accessAccount.user : null;
  const accessCopy = verifiedUser ? emptyCatalogCopy(kind, "", "", {
    status: verifiedUser.status ?? "active",
    active: accountState(verifiedUser).active,
    hasAssignedLink: Boolean(verifiedUser.hasAssignedLink),
    trialProvisionStatus: verifiedUser.trialProvisionStatus ?? null
  }) : null;
  const shownCatalog: Catalog = catalogAccount === catalogOwner && catalogSnapshot === personalSnapshot ? catalog : { items: [], total: 0, groups: [] };
  const items = useMemo(() => favoritesOnly ? favorites.filter(item => (filter === "all" || item.kind === filter) && item.title.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr"))) : shownCatalog.items, [favoritesOnly, favorites, filter, search, shownCatalog.items]);
  const emptyCopy = emptyCatalogCopy(kind, group, search);
  const currentOtherRows = useMemo(() => otherRowsAccount === rowsOwner && rowsSnapshot === personalSnapshot ? otherRows : [], [otherRowsAccount, rowsOwner, otherRows, rowsSnapshot, personalSnapshot]);
  const dailyPool = useMemo(() => {
    const movies = shownCatalog.items;
    const series = overview ? currentOtherRows.find(row => row.kind === "series")?.data.items ?? [] : [];
    return providerMode === "legacy" ? [...orderShowcaseCatalog(movies, "movie", day), ...orderShowcaseCatalog(series, "series", day)] : [...movies, ...series];
  }, [shownCatalog.items, overview, currentOtherRows, providerMode, day]);
  const homepage = useMemo(() => buildHomepageShowcase(dailyPool.filter(item => !failedPosters.has(itemKey(item))), day), [dailyPool, day, failedPosters]);
  const homeView = overview && !search;
  const homeLoading = providerMode === "loading" || loading || otherVodLoading || (catalogAccount !== catalogOwner && !error);
  const hideFailedPoster = (event: SyntheticEvent<HTMLElement>) => {
    const image = event.target as HTMLElement;
    if (image.tagName !== "IMG" || !image.isConnected) return;
    const key = image.closest<HTMLElement>("[data-homepage-poster]")?.dataset.homepagePoster;
    if (!key || key.startsWith("live:")) return;
    setPosterFailures(previous => {
      const ids = previous.owner === personalSnapshot ? previous.ids : noPosterFailures;
      return ids.has(key) ? previous : { owner: personalSnapshot, ids: new Set([...ids, key]) };
    });
  };
  const seriesCatalog = kind === "series" && !overview && !favoritesOnly;
  // Preserve the legacy provider prefix as pages append; only complete personal pools are daily-ranked.
  const discoveryRows = useMemo(() => !favoritesOnly && !overview && !group && !search && kind !== "live" ? buildShowcaseRails(items, kind) : null, [favoritesOnly, overview, group, search, kind, items]);
  const categories = useMemo(() => categoryGroups.account === account && categoryGroups.kind === kind ? categoryGroups.groups : shownCatalog.groups ?? [], [categoryGroups, account, kind, shownCatalog.groups]);
  useEffect(() => {
    if (activePanel !== "categories" || providerMode !== "personal") return;
    // Read the already-owned full snapshot; opening this panel never reacquires provider catalogs.
    const raw = personalSnapshot.raw.get(kind);
    if (!raw) return;
    let cancelled = false;
    const owner = panelOwner;
    void raw.then(rows => {
      if (cancelled || panelOwnerRef.current !== owner) return;
      const counts = new Map(categories.map(category => [category.title, 0]));
      const needle = search.toLocaleLowerCase("tr-TR");
      let total = 0;
      for (const item of rows) {
        if (!item.title.toLocaleLowerCase("tr-TR").includes(needle)) continue;
        total++;
        if (item.groupTitle) counts.set(item.groupTitle, (counts.get(item.groupTitle) ?? 0) + 1);
      }
      setCategoryPreview({ owner, total, groups: [...counts].map(([title, count]) => ({ title, count })) });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activePanel, providerMode, personalSnapshot, kind, panelOwner, categories, search]);
  const closePanel = (owner: object) => setPanel(current => current?.owner === owner ? null : current);
  const previewSearch = useCallback(async (value: string): Promise<Catalog> => {
    const owner = panelOwner;
    if (panelOwnerRef.current !== owner) throw new Error("Catalog changed");
    if (favoritesOnly) {
      const needle = value.toLocaleLowerCase("tr-TR");
      const matches = favorites.filter(item => (filter === "all" || item.kind === filter) && item.title.toLocaleLowerCase("tr-TR").includes(needle));
      return { items: matches.slice(0, 3), total: matches.length };
    }
    const kinds: Kind[] = overview ? [kind, "series", "live"] : [kind];
    const catalogs = await Promise.all(kinds.map(rowKind => loadCatalog(rowKind, 1, value, overview ? "" : group, account, currentMovieRevision)));
    if (panelOwnerRef.current !== owner) throw new Error("Catalog changed");
    return { items: catalogs.flatMap(catalog => catalog.items).slice(0, 3), total: catalogs.reduce((sum, catalog) => sum + catalog.total, 0) };
  }, [panelOwner, favoritesOnly, favorites, filter, overview, kind, loadCatalog, group, account, currentMovieRevision]);
  const submitSearch = (value: string, owner: object) => {
    if (panelOwnerRef.current !== owner) return;
    setQuery(value); setSearch(value); setPage(1); closePanel(owner);
  };
  if (accessCopy) return <main className={`${s.catalog} ${kind === "series" && !overview && !favoritesOnly ? seriesStyles.seriesPage : ""}`}>
    <div className={s.catalogContent} data-catalog-results>
      <div className={s.catalogToolbar}><div className={s.catalogHeading}><h1>{title}</h1></div></div>
      <div className={s.empty} role="status"><Icon name="settings"/><h2>{accessCopy.heading}</h2><p>{accessCopy.body}</p>{accessCopy.action && <Link className={s.primary} href={accessCopy.action.href}>{accessCopy.action.label}</Link>}</div>
    </div>
  </main>;
  return <main className={`${s.catalog} ${seriesCatalog ? seriesStyles.seriesPage : ""} ${homeView ? homeStyles.page : ""}`} onErrorCapture={homeView ? hideFailedPoster : undefined}>
    <div className={s.catalogContent} data-catalog-results>
    {homeView && <HomepageHero key={`${account}:${day}`} items={homepage.hero} onOpen={open}/>}
    <div className={`${s.catalogToolbar} ${homeView ? homeStyles.homeToolbar : ""} ${seriesCatalog ? seriesStyles.toolbar : ""}`}><div className={s.catalogHeading} id="kesfet"><h1>{title}</h1>{(!favoritesOnly || favoritesReady) && <span>{favoritesOnly ? favorites.length : shownCatalog.total.toLocaleString("tr-TR")} içerik</span>}</div>
      <div className={`${s.filters} ${panelStyles.toolbarControls}`}>
        <button type="button" className={panelStyles.trigger} data-catalog-search-trigger data-active={Boolean(search)} aria-label={`${title} içinde ara`} aria-haspopup="dialog" aria-controls="catalog-search-dialog" aria-expanded={activePanel === "search"} onClick={() => setPanel({ owner: panelOwner, type: "search" })}><Icon name="search"/><span>{search ? "Aramayı düzenle" : "Ara"}</span></button>
        {hasCategories && <button type="button" className={`${panelStyles.trigger} ${panelStyles.categoryTrigger}`} data-active={Boolean(group)} aria-haspopup="dialog" aria-controls="category-drawer" aria-expanded={activePanel === "categories"} onClick={() => setPanel({ owner: panelOwner, type: "categories" })}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h11M4 18h6"/></svg><span>Kategori: {group || "Tümü"}</span><span className={panelStyles.chevron}><Icon name="chevron"/></span></button>}
      </div>
    </div>
    {search && <div className={panelStyles.querySummary}><button type="button" aria-label="Aramayı temizle" title={search} onClick={() => { setQuery(""); setSearch(""); setPage(1); }}><span>Arama: {search}</span><Icon name="close"/></button>{!loading && <span>{shownCatalog.total.toLocaleString("tr-TR")} sonuç</span>}</div>}
    {kind === "movie" && !overview && !favoritesOnly && account && providerMode === "legacy" && <AdultMovieToggle key={account} account={account} onChanged={updateAdultPreference}/>}
    {favoritesOnly && <div className={s.chips}>{(["all","live","movie","series"] as const).map(value => <button key={value} className={filter === value ? s.selectedChip : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{({all:"Tümü",live:"Canlı TV",movie:"Filmler",series:"Diziler"})[value]}</button>)}</div>}
    {(error || providerError) && <div className={s.inlineError} role="alert">{providerError || error}<button onClick={() => { setReload(v => v+1); if(providerMode === "loading") reloadFavorites(); }}>Tekrar Dene</button></div>}
    {favoritesOnly && favoritesError && <div className={s.inlineError} role="alert">{favoritesError}<button disabled={favoritesLoading} onClick={reloadFavorites}>{favoritesLoading ? "Yükleniyor…" : "Tekrar Dene"}</button></div>}
    {homeView ? <>
      {homeLoading && !homepage.total ? <Skeletons/> : !homepage.total ? <section className={homeStyles.empty} role="status"><span>2026</span><h1>{error ? "Vitrin şu anda yüklenemiyor" : failedPosters.size ? "2026 afişleri yüklenemiyor" : "2026 seçkisi hazırlanıyor"}</h1><p>{error ? "İçerikleri yeniden yükleyebilir veya tüm kataloğa göz atabilirsin." : failedPosters.size ? "İçeriklere film ve dizi arşivlerinden ulaşabilirsin." : "Katalogda yılı doğrulanmış 2026 içerikleri burada görünecek."}</p><div><Link href="/filmler">Tüm filmler</Link><Link href="/diziler">Tüm diziler</Link></div></section> : null}
      {homepage.movies.length > 0 && <MediaRail label="2026 Filmleri" row={homepage.movies} href="/filmler?q=2026" className={homeStyles.posterRail} open={open}/>}
      {homepage.series.length > 0 && <MediaRail label="2026 Dizileri" row={homepage.series} href="/diziler?q=2026" className={homeStyles.posterRail} open={open}/>}
      {currentOtherRows.filter(row => row.kind === "live" && row.data.items.length).map(row => <MediaRail key={row.kind} label="Canlı TV" row={row.data.items.slice(0,12)} href="/canli-tv" open={open}/>)}
    </> : favoritesOnly && !favoritesReady ? (favoritesError && !favoritesLoading ? null : <Skeletons/>) : (loading && !items.length) ? <Skeletons/> : !items.length ? (favoritesOnly && favoritesError ? null : <div className={s.empty}><Icon name={favoritesOnly ? "heart" : "search"}/><h2>{emptyCopy?.heading ?? (favoritesOnly && !search ? "Henüz favori eklemediniz" : "İçerik bulunamadı")}</h2><p>{emptyCopy?.body ?? (favoritesOnly && !search ? "Beğendiğin içeriklerin kalbine dokun; hepsi burada bir araya gelsin." : "Başka bir arama veya kategori deneyebilirsin.")}</p>{favoritesOnly && <Link className={s.primary} href="/filmler">Filmlere Git</Link>}</div>) : favoritesOnly ? (["live","movie","series"] as Kind[]).map(rowKind => {
      const row = items.filter(item => item.kind === rowKind);
      return row.length ? <MediaRail key={rowKind} label={({live:"Canlı TV",movie:"Filmler",series:"Diziler"})[rowKind]} row={row} open={open}/> : null;
    }) : overview ? <>
      <MediaRail label="Filmler" row={items.slice(0,12)} href="/filmler" open={open}/>
      {currentOtherRows.filter(row => row.data.items.length).map(row => <MediaRail key={row.kind} label={row.kind === "series" ? "Diziler" : "Canlı TV"} row={row.data.items.slice(0,12)} href={row.kind === "series" ? "/diziler" : "/canli-tv"} open={open}/>)}
    </> : kind === "live" && !group && !search ? <MediaRail label="Canlı TV" row={items} open={open}/> : discoveryRows ? <>
      <MediaRail label="Günün Seçkisi" row={discoveryRows.primary} className={seriesCatalog ? seriesStyles.firstRail : undefined} open={open}/>
      {discoveryRows.categories.map(([label, row]) => <MediaRail key={label} label={label} row={row} className={seriesCatalog ? seriesStyles.categoryRail : undefined} open={open}/>)}
      {discoveryRows.other.length > 0 && <MediaRail label={kind === "series" ? "Diğer Diziler" : "Diğer Filmler"} row={discoveryRows.other} open={open}/>}
    </> : <div className={s.grid}>{items.map(item => <MediaTile key={itemKey(item)} item={item} open={open}/>)}</div>}
    {!favoritesOnly && !overview && items.length < shownCatalog.total && <button className={s.more} disabled={loading} onClick={() => setPage(p => p+1)}>{loading ? "Yükleniyor…" : "Daha Fazla Göster"}</button>}
    </div>
    {detailLoading && <div className={s.toast} role="status">İçerik hazırlanıyor…</div>}{detail && detailAccount === account && providerMode !== "loading" && <Detail key={itemKey(detail)} item={detail} autoPlay={params.get("play") === "1"} onClose={close}/>}
    {activePanel === "search" && <CatalogSearchDialog title={title} initialQuery={query} scope={favoritesOnly ? `Tür: ${({ all: "Tümü", movie: "Filmler", series: "Diziler", live: "Canlı TV" })[filter]}` : `Kategori: ${group || "Tümü"}`} preview={previewSearch} onSelect={item => { if (panelOwnerRef.current !== panelOwner) return; closePanel(panelOwner); open(item); }} onSubmit={value => submitSearch(value, panelOwner)} onClose={() => closePanel(panelOwner)}/>}
    {activePanel === "categories" && <CategorySidebar open title={title} groups={categoryPreview?.owner === panelOwner ? categoryPreview.groups : categories} total={categoryPreview?.owner === panelOwner ? categoryPreview.total : !group && !search ? shownCatalog.total : undefined} selected={group} onSelect={value => { if (panelOwnerRef.current === panelOwner) setGroup(value); }} onClose={() => closePanel(panelOwner)}/>}
  </main>;
}
