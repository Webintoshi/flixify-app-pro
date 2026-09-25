"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { MediaItem } from "./types";
import { itemKey } from "./types";
import { usePlatform } from "./session";
import s from "./platform.module.css";
export function Artwork({ item, hero = false }: { item: MediaItem; hero?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(hero);
  const [failed, setFailed] = useState(false);
  const url = item.posterUrl ?? item.logoUrl;
  useEffect(() => { setFailed(false); if (hero) { setVisible(true); return; } if (!("IntersectionObserver" in window)) { setVisible(true); return; } const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "250px" }); if (ref.current) observer.observe(ref.current); return () => observer.disconnect(); }, [url, hero]);
  return <div ref={ref} className={`${s.artwork} ${hero ? s.heroArtwork : ""} ${item.kind === "live" ? s.channelArtwork : ""}`}>
    {url && visible && !failed ? <img src={url} alt={hero ? "" : item.title} decoding="async" loading={hero ? "eager" : "lazy"} fetchPriority={hero ? "high" : "low"} onError={() => setFailed(true)}/> : <div className={s.artworkFallback}><Icon name={item.kind}/><span>{item.title}</span></div>}
  </div>;
}
export function FavoriteButton({ item, expanded = false }: { item: MediaItem; expanded?: boolean }) {
  const { favorites, favoritesReady, pending, toggle } = usePlatform();
  const active = favorites.some(f => itemKey(f) === itemKey(item));
  return <button className={`${s.favorite} ${active ? s.saved : ""}${expanded ? ` ${s.previewFavorite}` : ""}`} disabled={!favoritesReady || pending.has(itemKey(item))} aria-pressed={active} aria-label={`${item.title}: ${active ? "favorilerden çıkar" : "favorilere ekle"}`} onClick={e => { e.stopPropagation(); void toggle(item); }}><Icon name="heart" filled={active}/>{expanded && <span>{active ? "Listemde" : "Listeme Ekle"}</span>}</button>;
}
