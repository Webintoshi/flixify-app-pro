"use client";

import { useState } from "react";
import { Artwork, FavoriteButton } from "./artwork";
import { Icon } from "./icons";
import { itemKey, type MediaItem } from "./types";
import s from "./homepage.module.css";

function displayTitle(item: MediaItem) {
  if (item.releaseYear != null && item.releaseYear !== 2026) return item.title;
  return item.title.replace(/\s*(?:\(2026\)|\[2026\])\s*$/u, "").trim() || item.title;
}

export function HomepageHero({ items, onOpen }: {
  items: MediaItem[];
  onOpen: (item: MediaItem, autoPlay?: boolean) => void;
}) {
  const [selected, setSelected] = useState(() => items[0] ? itemKey(items[0]) : null);
  const featured = items.find(item => itemKey(item) === selected) ?? items[0];
  if (!featured) return null;
  const artwork = featured.posterUrl?.trim() || featured.logoUrl?.trim();
  const details = [
    featured.seasonCount ? `${featured.seasonCount} sezon` : null,
    featured.episodeCount ? `${featured.episodeCount} bölüm` : null
  ].filter(Boolean).join(" · ");

  return <section className={`${s.hero} ${items.length === 1 ? s.single : ""}`} aria-label="Günün öne çıkan içeriği" data-homepage-hero>
    {artwork && <div className={s.ambient} data-homepage-poster={itemKey(featured)} aria-hidden="true"><img src={artwork} alt="" decoding="async"/></div>}
    <div className={s.copy}>
      <p className={s.metadata}>2026 · {featured.kind === "series" ? "Dizi" : "Film"}</p>
      <h1>{displayTitle(featured)}</h1>
      {featured.groupTitle && <p className={s.category}>{featured.groupTitle}</p>}
      {details && <p className={s.details}>{details}</p>}
      <div className={s.actions}>
        <button type="button" className={s.watch} onClick={() => onOpen(featured, true)}><Icon name="play"/>İzle</button>
        <button type="button" className={s.info} onClick={() => onOpen(featured, false)}>İncele</button>
        <div className={s.favoriteAction}><FavoriteButton item={featured}/></div>
      </div>
    </div>
    <button type="button" className={s.poster} data-homepage-poster={itemKey(featured)} aria-label={`${featured.title} oynat`} onClick={() => onOpen(featured, true)}><Artwork item={featured} hero/></button>
    {items.length > 1 && <div className={s.selectors} role="group" aria-label="Öne çıkan içerikler">
      {items.map((item, index) => <button key={itemKey(item)} type="button" className={s.selector} data-homepage-poster={itemKey(item)} aria-label={`${index + 1}. içerik: ${item.title}`} aria-pressed={itemKey(featured) === itemKey(item)} onClick={() => setSelected(itemKey(item))}>
        <span className={s.selectorImage}><Artwork item={item}/></span>
        <span className={s.selectorTitle}>{displayTitle(item)}</span>
      </button>)}
    </div>}
  </section>;
}
