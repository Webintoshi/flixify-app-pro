"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import { Artwork, FavoriteButton } from "./artwork";
import { Detail } from "./detail";
import { AdultMovieToggle } from "./adult-movie-toggle";
import { emptyCatalogCopy } from "./catalog-empty";
import { Icon } from "./icons";
import { usePlatform } from "./session";
import { itemKey, type Catalog, type Kind, type MediaItem } from "./types";
import s from "./platform.module.css";

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
  return <div className={`${s.tile} ${item.kind === "live" ? s.channelTile : ""}`}>
    <button className={s.tileOpen} onClick={() => open(item)} disabled={item.available === false} aria-label={`${item.title} detayını aç`}><Artwork item={item}/>{item.kind !== "live" && <span className={s.tilePreview} aria-hidden="true"><b>{item.title}</b><span>{item.groupTitle}</span><em>Detayları Gör <Icon name="arrow"/></em></span>}<strong>{item.title}</strong>{item.available === false ? <small>{item.lookupFailed ? "Geçici olarak doğrulanamıyor" : "Şu anda kullanılamıyor"}</small> : <small>{item.groupTitle}</small>}</button><FavoriteButton item={item}/>
  </div>;
}
function Skeletons() { return <div className={s.grid} aria-busy="true" aria-label="İçerikler yükleniyor">{Array.from({ length: 12 }, (_, i) => <div className={s.skeleton} key={i}/>)}</div>; }
function MediaRail({ label, row, href, open }: { label: string; row: MediaItem[]; href?: string; open: (item: MediaItem) => void }) {
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
  return <section className={s.mediaSection}><div className={s.sectionHeading}><h2>{label}</h2><div className={s.railActions}>{href && <Link href={href}>Tümünü Gör <Icon name="arrow"/></Link>}<button type="button" aria-label={`${label} önceki içerikler`} disabled={position.start} onClick={() => rail.current?.scrollBy({ left: -rail.current.clientWidth * .8, behavior: "smooth" })}>‹</button><button type="button" aria-label={`${label} sonraki içerikler`} disabled={position.end} onClick={() => rail.current?.scrollBy({ left: rail.current.clientWidth * .8, behavior: "smooth" })}>›</button></div></div><div ref={rail} className={s.horizontalRail} onScroll={() => { const element = rail.current; if (element) setPosition({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 }); }}>{row.map(item => <MediaTile key={itemKey(item)} item={item} open={open}/>)}</div></section>;
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
  return <main className={s.catalog}>
    <div className={s.catalogContent} data-catalog-results>
    {overview && featured && !search && <section className={s.hero}><Artwork item={featured} hero/><div className={s.heroFade}/><div className={s.heroCopy}><span>{featured.kind === "series" ? "ÖNE ÇIKAN DİZİ" : "ÖNE ÇIKAN FİLM"}</span><h1>{featured.title}</h1><p>{featured.groupTitle}{featured.seasonCount ? ` · ${featured.seasonCount} sezon` : ""}</p><div className={s.heroActions}><button className={s.primary} onClick={() => open(featured)}><Icon name="play" filled/>Detayları Gör</button><FavoriteButton item={featured}/></div></div>{heroOptions.length > 1 && <div className={s.heroSlides} role="group" aria-label="Öne çıkan içerikler">{heroOptions.map((item, index) => <button key={itemKey(item)} type="button" aria-label={`${index + 1}. içerik: ${item.title}`} aria-pressed={heroIndex === index} onClick={() => setHeroIndex(index)}/>)}</div>}</section>}
    <div className={s.catalogHeading}><h1>{title}</h1>{(!favoritesOnly || favoritesReady) && <span>{favoritesOnly ? favorites.length : shownCatalog.total.toLocaleString("tr-TR")} içerik</span>}</div>
    {hasCategories && <div className={s.genreStrip} role="group" aria-label={kind === "movie" ? "Film kategorileri" : "Dizi kategorileri"}><button type="button" aria-pressed={!group} onClick={() => setGroup("")}>Tümü</button>{(categoryGroups.account === account && categoryGroups.kind === kind ? categoryGroups.groups : shownCatalog.groups ?? []).map(category => <button type="button" key={category.title} aria-pressed={group === category.title} onClick={() => setGroup(category.title)}>{category.title}</button>)}</div>}
    <div className={s.filters}><label className={s.search}><Icon name="search"/><input aria-label={`${title} içinde ara`} placeholder={favoritesOnly ? "Favorilerinde ara…" : "İçerik ara…"} value={query} onChange={e => setQuery(e.target.value)}/>{query && <button onClick={() => setQuery("")} aria-label="Aramayı temizle"><Icon name="close"/></button>}</label>
    </div>
    {kind === "movie" && !overview && !favoritesOnly && account && <AdultMovieToggle key={account} account={account} onChanged={updateAdultPreference}/>}
    {favoritesOnly && <div className={s.chips}>{(["all","live","movie","series"] as const).map(value => <button key={value} className={filter === value ? s.selectedChip : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{({all:"Tümü",live:"Canlı TV",movie:"Filmler",series:"Diziler"})[value]}</button>)}</div>}
    {error && <div className={s.inlineError} role="alert">{error}<button onClick={() => setReload(v => v+1)}>Tekrar Dene</button></div>}
    {favoritesOnly && favoritesError && <div className={s.inlineError} role="alert">{favoritesError}<button disabled={favoritesLoading} onClick={reloadFavorites}>{favoritesLoading ? "Yükleniyor…" : "Tekrar Dene"}</button></div>}
    {favoritesOnly && !favoritesReady ? (favoritesError && !favoritesLoading ? null : <Skeletons/>) : (loading && !items.length) ? <Skeletons/> : !items.length ? (favoritesOnly && favoritesError ? null : <div className={s.empty}><Icon name={favoritesOnly ? "heart" : "search"}/><h2>{emptyCopy?.heading ?? (favoritesOnly && !search ? "Henüz favori eklemediniz" : "İçerik bulunamadı")}</h2><p>{emptyCopy?.body ?? (favoritesOnly && !search ? "Beğendiğin içeriklerin kalbine dokun; hepsi burada bir araya gelsin." : "Başka bir arama veya kategori deneyebilirsin.")}</p>{favoritesOnly && <Link className={s.primary} href="/filmler">Filmlere Git</Link>}</div>) : favoritesOnly ? (["live","movie","series"] as Kind[]).map(rowKind => { const row = items.filter(item => item.kind === rowKind); return row.length ? <MediaRail key={rowKind} label={({live:"Canlı TV",movie:"Filmler",series:"Diziler"})[rowKind]} row={row} open={open}/> : null; }) : overview ? <><MediaRail label="Filmler" row={items.slice(0,12)} href="/filmler" open={open}/>{currentOtherRows.map(row => <MediaRail key={row.kind} label={row.kind === "series" ? "Diziler" : "Canlı TV"} row={row.data.items.slice(0,12)} href={row.kind === "series" ? "/diziler" : "/canli-tv"} open={open}/>)}</> : !group && !search ? <><MediaRail label={kind === "movie" ? "Filmler" : "Diziler"} row={items} open={open}/>{categoryRows.map(([label, row]) => <MediaRail key={label} label={label} row={row} open={open}/>)}</> : <div className={s.grid}>{items.map(item => <MediaTile key={itemKey(item)} item={item} open={open}/>)}</div>}
    {!favoritesOnly && !overview && items.length < shownCatalog.total && <button className={s.more} disabled={loading} onClick={() => setPage(p => p+1)}>{loading ? "Yükleniyor…" : "Daha Fazla Göster"}</button>}
    </div>
    {detailLoading && <div className={s.toast} role="status">İçerik hazırlanıyor…</div>}{detail && detailAccount === account && <Detail key={detail.id} item={detail} onClose={close}/>}
  </main>;
}
