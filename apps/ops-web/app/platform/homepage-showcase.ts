import { buildShowcaseRails, orderShowcaseCatalog, selectShowcaseHero } from "./catalog-showcase";
import { homepageReleaseYear } from "./catalog-release-year";
import { itemKey, type Kind, type MediaItem } from "./types";

export type HomepageShowcase = { hero: MediaItem[]; movies: MediaItem[]; series: MediaItem[]; total: number };

function uniqueRows(items: readonly MediaItem[], kind: Kind, excluded?: ReadonlySet<string>): MediaItem[] {
  const rows = buildShowcaseRails(items, kind, excluded);
  return [...rows.primary, ...rows.categories.flatMap(([, entries]) => entries), ...rows.other];
}

export function selectHomepageCatalog(items: readonly MediaItem[], kind: Kind, dayKey: string): MediaItem[] {
  if (kind === "live") return [];
  const current = items.filter(item => item.kind === kind && homepageReleaseYear(item) === 2026);
  return uniqueRows(orderShowcaseCatalog(current, kind, dayKey), kind);
}

export function buildHomepageShowcase(items: readonly MediaItem[], dayKey: string): HomepageShowcase {
  const pool = [...selectHomepageCatalog(items, "movie", dayKey), ...selectHomepageCatalog(items, "series", dayKey)];
  const heroLimit = Math.min(5, Math.max(1, Math.floor(pool.length / 3)));
  const hero = selectShowcaseHero(pool, dayKey, heroLimit);
  const excluded = new Set(hero.map(itemKey));
  return {
    hero,
    movies: uniqueRows(pool, "movie", excluded).slice(0, 18),
    series: uniqueRows(pool, "series", excluded).slice(0, 18),
    total: pool.length
  };
}
