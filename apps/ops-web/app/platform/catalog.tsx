"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../../lib/api";
import { Artwork, FavoriteButton } from "./artwork";
import { Detail } from "./detail";
import { AdultMovieToggle } from "./adult-movie-toggle";
import { emptyCatalogCopy } from "./catalog-empty";
import { Icon } from "./icons";
import { usePlatform } from "./session";
import { itemKey, type Catalog, type Kind, type MediaItem } from "./types";
import s from "./platform.module.css";
import seriesStyles from "./series-catalog.module.css";

const cache = new Map<string, { at: number; data: Catalog }>();
let cacheAccount = "";
const routes = { live: "live", movie: "movies", series: "series" };
function getCatalog(kind: Kind, page: number, search: string, group: string, account: string, movieRevision = 0): Promise<Catalog> {
  if (cacheAccount !== account) { cache.clear(); cacheAccount = account; }
  const params = new URLSearchParams({ page: String(page), pageSize: "48", search, group });
  const key = `${kind}?${params}${kind === "movie" ? `&revision=${movieRevision}` : ""}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < 60000) return Promise.resolve(saved.data);
  return apiRequest<Catalog>(`/me/catalog/${routes[kind]}?${params}`).then(data => {
    const normalized = { ...data, items: data.items.map(item => ({ ...item, kind })) };
    if (cacheAccount === account) { if (cache.size > 24) cache.delete(cache.keys().next().value!); cache.set(key, { at: Date.now(), data: normalized }); }
    return normalized;
  });
}
function MediaTile({ item, open }: { item: MediaItem; open: (item: MediaItem) => void }) {
  const tileRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ top: number; left: number; width: number; height: number; favoriteLeft: number; favoriteTop: number } | null>(null);
  const hidePreview = () => setPreview(null);
  const cancelClose = () => { if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(hidePreview, 120); };
  const showPreview = () => {
    if (item.kind === "live" || item.available === false || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
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
  const details = [item.kind === "series" ? "Dizi" : item.kind === "movie" ? "Film" : "Canlı TV", item.groupTitle, item.seasonCount ? `${item.seasonCount} sezon` : null, item.episodeCount ? `${item.episodeCount} bölüm` : null].filter(Boolean).join(" · ");
  return <div ref={tileRef} className={`${s.tile} ${item.kind === "live" ? s.channelTile : ""}`} onMouseEnter={showPreview} onMouseLeave={scheduleClose}>
    <button className={s.tileOpen} onFocus={showPreview} onClick={() => { hidePreview(); open(item); }} disabled={item.available === false} aria-label={`${item.title} detayını aç`}><div className={s.posterFrame}><Artwork item={item}/></div><strong>{item.title}</strong>{item.available === false ? <small>{item.lookupFailed ? "Geçici olarak doğrulanamıyor" : "Şu anda kullanılamıyor"}</small> : <small>{item.groupTitle}</small>}</button><FavoriteButton item={item}/>
    {preview && createPortal(<div ref={previewRef} className={s.expandedPreview} data-media-preview role="group" aria-label={`${item.title} hızlı önizleme`} style={{ top: preview.top, left: preview.left, width: preview.width, height: preview.height }} onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      <Artwork item={item}/><div className={s.expandedPreviewShade}/><div className={s.expandedPreviewQuick} style={{ left: preview.favoriteLeft, top: preview.favoriteTop }}><FavoriteButton item={item}/></div><div className={s.expandedPreviewCopy}><span className={s.expandedPreviewEyebrow}>{item.kind === "series" ? "DİZİ" : "FİLM"}</span><h3>{item.title}</h3><p>{details}</p><div className={s.expandedPreviewActions}><button type="button" className={s.expandedPreviewMore} onClick={() => { hidePreview(); open(item); }}>Daha Fazla <Icon name="arrow"/></button><FavoriteButton item={item} expanded/></div></div>
    </div>, document.body)}
  </div>;
}
function Skeletons() { return <div className={s.grid} aria-busy="true" aria-label="İçerikler yükleniyor">{Array.from({ length: 12 }, (_, i) => <div className={s.skeleton} key={i}/>)}</div>; }
function MediaRail({ label, row, href, open, className }: { label: string; row: MediaItem[]; href?: string; open: (item: MediaItem) => void; className?: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ start: true, end: false });
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
  return <section className={`${s.mediaSection} ${className ?? ""}`}><div className={s.sectionHeading}><h2>{label}</h2><div className={s.railActions}>{href && <Link href={href}>Tümünü Gör <Icon name="arrow"/></Link>}<button type="button" aria-label={`${label} önceki içerikler`} disabled={position.start} onClick={() => rail.current?.scrollBy({ left: -rail.current.clientWidth * .8, behavior: "smooth" })}>‹</button><button type="button" aria-label={`${label} sonraki içerikler`} disabled={position.end} onClick={() => rail.current?.scrollBy({ left: rail.current.clientWidth * .8, behavior: "smooth" })}>›</button></div></div><div ref={rail} className={s.horizontalRail} onScroll={() => { const element = rail.current; if (element) setPosition({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 }); }}>{row.map(item => <MediaTile key={itemKey(item)} item={item} open={open}/>)}</div></section>;
}
export default function CatalogPage({ kind, overview = false, favoritesOnly = false }: { kind: Kind; overview?: boolean; favoritesOnly?: boolean }) {
  const { session, favorites, favoritesReady, favoritesLoading, favoritesError, invalidateFavorites, reload: reloadFavorites } = usePlatform();
  const params = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [search, setSearch] = useState(query);
  const [group, setGroup] = useState("");
  const hasCategories = !favoritesOnly && !overview;
  const [heroIndex, setHeroIndex] = useState(0);
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<Catalog>({ items: [], total: 0 });
  const [catalogAccount, setCatalogAccount] = useState("");
  const [categoryGroups, setCategoryGroups] = useState<{ account: string; kind: Kind; groups: NonNullable<Catalog["groups"]> }>({ account: "", kind, groups: [] });
  const [otherRows, setOtherRows] = useState<{ kind: Kind; data: Catalog }[]>([]);
  const [otherRowsAccount, setOtherRowsAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [movieRevision, setMovieRevision] = useState<{ account: string; revision: number }>({ account: "", revision: 0 });
  const [detail, setDetail] = useState<MediaItem | null>(null);
  const [detailAccount, setDetailAccount] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const openedHere = useRef(false);
  const account = session?.kryptoniteCode ?? session?.accessToken ?? "";
  const currentMovieRevision = movieRevision.account === account ? movieRevision.revision : 0;
  const selectedId = params.get("item");
  const selectedKind = params.get("kind");
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { const q = params.get("q"); if (q !== null) setQuery(q); }, [params]);
  useEffect(() => { setPage(1); setHeroIndex(0); setCatalog(previous => ({ ...previous, items: [], total: 0 })); setDetail(null); }, [account, kind, group, search]);
  useEffect(() => {
    if (!session || favoritesOnly) { setLoading(false); return; }
    let cancelled = false; setLoading(true); setError("");
    getCatalog(kind, page, search, group, account, currentMovieRevision).then(data => {
      if (cancelled) return;
      setCatalog(previous => ({ ...data, items: page === 1 || catalogAccount !== account ? data.items : Array.from(new Map([...previous.items, ...data.items].map(i => [itemKey(i), i])).values()) }));
      if (!group && data.groups?.length) setCategoryGroups({ account, kind, groups: data.groups });
      setCatalogAccount(account);
    }).catch(() => { if (!cancelled) setError("İçerikler yüklenemedi. Tekrar deneyebilirsin."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session, account, kind, page, search, group, favoritesOnly, reload, currentMovieRevision]);
  useEffect(() => {
    if (!overview || !session) return;
    let cancelled = false;
    Promise.all((["series", "live"] as Kind[]).map(async rowKind => ({ kind: rowKind, data: await getCatalog(rowKind, 1, search, "", account) }))).then(rows => { if (!cancelled) { setOtherRows(rows); setOtherRowsAccount(account); } }).catch(() => { if (!cancelled) setError("Bazı içerikler yüklenemedi. Tekrar deneyebilirsin."); });
    return () => { cancelled = true; };
  }, [overview, session, account, search, reload, currentMovieRevision]);
  useEffect(() => {
    if (!selectedId || !["movie", "series"].includes(selectedKind ?? "")) { setDetail(null); return; }
    let cancelled = false; setDetail(null); setDetailLoading(true);
    apiRequest<MediaItem>(`/me/library/${selectedKind}/${encodeURIComponent(selectedId)}`).then(item => { if (!cancelled) { setDetail(item); setDetailAccount(account); } }).catch(() => { if (!cancelled) setError("İçerik detayı açılamadı. Tekrar deneyebilirsin."); }).finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, selectedKind, account]);
  const open = (item: MediaItem) => {
    if (item.kind === "live") { router.push(`/canli-tv?channel=${encodeURIComponent(item.id)}`); return; }
    openedHere.current = true;
    const next = new URLSearchParams(params.toString()); next.set("item", item.id); next.set("kind", item.kind);
    router.push(`?${next}`, { scroll: false });
  };
  const close = () => { setDetail(null); if (openedHere.current) { openedHere.current = false; router.back(); } else { const next = new URLSearchParams(params.toString()); next.delete("item"); next.delete("kind"); router.replace(`?${next}`, { scroll: false }); } };
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
        next.delete("item"); next.delete("kind");
        openedHere.current = false;
        router.replace(`?${next}`, { scroll: false });
      }
    }
    invalidateFavorites();
  };
  const title = favoritesOnly ? "Favorilerim" : overview ? "Senin Alanın" : kind === "movie" ? "Filmler" : "Diziler";
  const shownCatalog: Catalog = catalogAccount === account ? catalog : { items: [], total: 0, groups: [] };
  const items = favoritesOnly ? favorites.filter(item => (filter === "all" || item.kind === filter) && item.title.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr"))) : shownCatalog.items;
  const emptyCopy = emptyCatalogCopy(kind, group, search);
  const currentOtherRows = otherRowsAccount === account ? otherRows : [];
  const heroOptions = [...shownCatalog.items, ...(overview ? currentOtherRows.find(row => row.kind === "series")?.data.items ?? [] : [])].filter(item => item.posterUrl && item.available !== false).slice(0, 5);
  const featured = heroOptions[heroIndex % heroOptions.length] ?? shownCatalog.items[0];
  const categoryRows = Array.from(items.reduce((rows, item) => {
    if (item.groupTitle) rows.set(item.groupTitle, [...(rows.get(item.groupTitle) ?? []), item]);
    return rows;
  }, new Map<string, MediaItem[]>())).filter(([, row]) => row.length >= 3).slice(0, 4);
  const seriesCatalog = kind === "series" && !overview && !favoritesOnly;
  const seriesRows = seriesCatalog && !group && !search ? (() => {
    const firstRow = items.slice(0, 12);
    const remaining = items.slice(firstRow.length);
    const byGroup = remaining.reduce((rows, item) => {
      if (item.groupTitle) rows.set(item.groupTitle, [...(rows.get(item.groupTitle) ?? []), item]);
      return rows;
    }, new Map<string, MediaItem[]>());
    const categories = Array.from(byGroup).filter(([, row]) => row.length >= 3).slice(0, 4);
    const categorized = new Set(categories.flatMap(([, row]) => row.map(itemKey)));
    const other = remaining.filter(item => !categorized.has(itemKey(item)));
    return { firstRow, categories, other };
  })() : null;
  return <main className={`${s.catalog} ${seriesCatalog ? seriesStyles.seriesPage : ""}`}>
    <div className={s.catalogContent} data-catalog-results>
    {overview && featured && !search && <section className={s.hero}><Artwork item={featured} hero/><div className={s.heroFade}/><div className={s.heroCopy}><span>{featured.kind === "series" ? "DİZİ" : "FİLM"} <b>GÜNDEMDE</b></span><h1>{featured.title}</h1><p>{featured.groupTitle}{featured.seasonCount ? ` · ${featured.seasonCount} sezon` : ""}</p><div className={s.heroActions}><a className={s.heroDiscover} href="#kesfet"><Icon name="search"/>Kataloğu Keşfet</a><button className={s.heroMore} onClick={() => open(featured)}>Daha Fazla <Icon name="arrow"/></button><FavoriteButton item={featured} expanded/></div></div>{heroOptions.length > 1 && <div className={s.heroSlides} role="group" aria-label="Öne çıkan içerikler">{heroOptions.map((item, index) => <button key={itemKey(item)} type="button" aria-label={`${index + 1}. içerik: ${item.title}`} aria-pressed={heroIndex === index} onClick={() => setHeroIndex(index)}/>)}</div>}</section>}
    {overview && !search && <section className={s.featureIntro}><span className={s.featureIntroMark}><Icon name="heart"/></span><div><small>FLIXIFY SEÇKİSİ</small><h2>Hazırsan perdeyi açalım.</h2><p>Filmleri, dizileri ve yeni hikâyeleri bir arada keşfet.</p></div><a href="#kesfet">Kataloğu Keşfet <Icon name="arrow"/></a></section>}
    <div className={`${s.catalogToolbar} ${seriesCatalog ? seriesStyles.toolbar : ""}`}><div className={s.catalogHeading} id="kesfet"><h1>{title}</h1>{(!favoritesOnly || favoritesReady) && <span>{favoritesOnly ? favorites.length : shownCatalog.total.toLocaleString("tr-TR")} içerik</span>}</div>
      <div className={s.filters}><label className={s.search}><Icon name="search"/><input id="catalog-search" aria-label={`${title} içinde ara`} placeholder={favoritesOnly ? "Favorilerinde ara…" : "İçerik ara…"} value={query} onChange={e => setQuery(e.target.value)}/>{query && <button onClick={() => setQuery("")} aria-label="Aramayı temizle"><Icon name="close"/></button>}</label></div>
    </div>
    {hasCategories && <div className={`${s.genreStrip} ${seriesCatalog ? seriesStyles.categories : ""}`} role="group" aria-label={kind === "movie" ? "Film kategorileri" : "Dizi kategorileri"}><button type="button" aria-pressed={!group} onClick={() => setGroup("")}>Tümü</button>{(categoryGroups.account === account && categoryGroups.kind === kind ? categoryGroups.groups : shownCatalog.groups ?? []).map(category => <button type="button" key={category.title} aria-pressed={group === category.title} onClick={() => setGroup(category.title)}>{category.title}</button>)}</div>}
    {kind === "movie" && !overview && !favoritesOnly && account && <AdultMovieToggle key={account} account={account} onChanged={updateAdultPreference}/>}
    {favoritesOnly && <div className={s.chips}>{(["all","live","movie","series"] as const).map(value => <button key={value} className={filter === value ? s.selectedChip : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{({all:"Tümü",live:"Canlı TV",movie:"Filmler",series:"Diziler"})[value]}</button>)}</div>}
    {error && <div className={s.inlineError} role="alert">{error}<button onClick={() => setReload(v => v+1)}>Tekrar Dene</button></div>}
    {favoritesOnly && favoritesError && <div className={s.inlineError} role="alert">{favoritesError}<button disabled={favoritesLoading} onClick={reloadFavorites}>{favoritesLoading ? "Yükleniyor…" : "Tekrar Dene"}</button></div>}
    {favoritesOnly && !favoritesReady ? (favoritesError && !favoritesLoading ? null : <Skeletons/>) : (loading && !items.length) ? <Skeletons/> : !items.length ? (favoritesOnly && favoritesError ? null : <div className={s.empty}><Icon name={favoritesOnly ? "heart" : "search"}/><h2>{emptyCopy?.heading ?? (favoritesOnly && !search ? "Henüz favori eklemediniz" : "İçerik bulunamadı")}</h2><p>{emptyCopy?.body ?? (favoritesOnly && !search ? "Beğendiğin içeriklerin kalbine dokun; hepsi burada bir araya gelsin." : "Başka bir arama veya kategori deneyebilirsin.")}</p>{favoritesOnly && <Link className={s.primary} href="/filmler">Filmlere Git</Link>}</div>) : favoritesOnly ? (["live","movie","series"] as Kind[]).map(rowKind => { const row = items.filter(item => item.kind === rowKind); return row.length ? <MediaRail key={rowKind} label={({live:"Canlı TV",movie:"Filmler",series:"Diziler"})[rowKind]} row={row} open={open}/> : null; }) : overview ? <><MediaRail label="Filmler" row={items.slice(0,12)} href="/filmler" open={open}/>{currentOtherRows.map(row => <MediaRail key={row.kind} label={row.kind === "series" ? "Diziler" : "Canlı TV"} row={row.data.items.slice(0,12)} href={row.kind === "series" ? "/diziler" : "/canli-tv"} open={open}/>)}</> : seriesRows ? <><MediaRail label="Diziler" row={seriesRows.firstRow} className={seriesStyles.firstRail} open={open}/>{seriesRows.categories.map(([label, row]) => <MediaRail key={label} label={label} row={row} className={seriesStyles.categoryRail} open={open}/>)}{seriesRows.other.length > 0 && <MediaRail label="Diğer Diziler" row={seriesRows.other} className={seriesStyles.categoryRail} open={open}/>}</> : !group && !search ? <><MediaRail label={kind === "movie" ? "Filmler" : "Diziler"} row={items} open={open}/>{categoryRows.map(([label, row]) => <MediaRail key={label} label={label} row={row} open={open}/>)}</> : <div className={s.grid}>{items.map(item => <MediaTile key={itemKey(item)} item={item} open={open}/>)}</div>}
    {!favoritesOnly && !overview && items.length < shownCatalog.total && <button className={s.more} disabled={loading} onClick={() => setPage(p => p+1)}>{loading ? "Yükleniyor…" : "Daha Fazla Göster"}</button>}
    </div>
    {detailLoading && <div className={s.toast} role="status">İçerik hazırlanıyor…</div>}{detail && detailAccount === account && <Detail key={detail.id} item={detail} onClose={close}/>}
  </main>;
}
