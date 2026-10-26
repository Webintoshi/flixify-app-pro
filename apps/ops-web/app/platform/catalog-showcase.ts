import { itemKey, type Kind, type MediaItem } from "./types";

/** Calendar day shared by every viewer, independent of the device timezone. */
export function showcaseDayKey(now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const identity = (item: MediaItem): string => item.personalRef
  ? `${item.personalRef.kind}:${item.personalRef.id}` : itemKey(item);
const titleIdentity = (item: MediaItem): string => `${item.kind}:${item.title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`;
const eligible = (item: MediaItem): boolean => item.available !== false && item.playbackAllowed !== false && !item.lookupFailed;
const group = (item: MediaItem): string => item.groupTitle?.trim() || "Diğer";
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  result ^= result >>> 16;
  result = Math.imul(result, 0x85ebca6b);
  result ^= result >>> 13;
  return result >>> 0;
}
function ranked(items: readonly MediaItem[], dayKey: string): MediaItem[] {
  return items.map(item => ({ item, key: identity(item), rank: hash(`${dayKey}\0${identity(item)}`) }))
    .sort((a, b) => a.rank - b.rank || compareText(a.key, b.key) || compareText(group(a.item), group(b.item)) || compareText(titleIdentity(a.item), titleIdentity(b.item)))
    .map(({ item }) => item);
}

/** Reorders the complete multiset. Visibility and deduplication belong to rails. */
export function orderShowcaseCatalog(items: readonly MediaItem[], kind: Kind, dayKey: string): MediaItem[] {
  if (kind === "live") return [...items];
  const allowed = items.filter(eligible);
  if (allowed.length !== items.length) {
    return [...orderShowcaseCatalog(allowed, kind, dayKey), ...ranked(items.filter(item => !eligible(item)), dayKey)];
  }
  const sorted = ranked(items, dayKey);
  const buckets = new Map<string, MediaItem[]>();
  for (const item of sorted) {
    const name = group(item);
    const bucket = buckets.get(name);
    if (bucket) bucket.push(item); else buckets.set(name, [item]);
  }
  const names = [...buckets.keys()].sort((a, b) => hash(`${dayKey}\0group\0${a}`) - hash(`${dayKey}\0group\0${b}`) || compareText(a, b));
  const offsets = new Map(names.map(name => [name, 0]));
  const result: MediaItem[] = [];
  // Round robin gives small categories a place in the first twelve as well.
  while (result.length < Math.min(12, items.length)) {
    for (const name of names) {
      const offset = offsets.get(name)!;
      const bucket = buckets.get(name)!;
      if (offset < bucket.length) { result.push(bucket[offset]); offsets.set(name, offset + 1); }
      if (result.length >= 12) break;
    }
  }
  for (const name of names.slice(0, 4)) {
    const offset = offsets.get(name)!;
    const block = buckets.get(name)!.slice(offset, offset + 12);
    result.push(...block);
    offsets.set(name, offset + block.length);
  }
  // Count occurrences so even repeated references are retained in the archive.
  const counts = new Map<MediaItem, number>();
  for (const item of result) counts.set(item, (counts.get(item) || 0) + 1);
  for (const item of sorted) {
    const count = counts.get(item) || 0;
    if (count) counts.set(item, count - 1); else result.push(item);
  }
  return result;
}

export function selectShowcaseHero(items: readonly MediaItem[], dayKey: string, limit = 5): MediaItem[] {
  const ids = new Set<string>(), titles = new Set<string>();
  const result: MediaItem[] = [];
  for (const item of ranked(items.filter(item => item.kind !== "live" && eligible(item) && Boolean(item.posterUrl?.trim())), dayKey)) {
    if (result.length >= Math.max(0, limit)) break;
    const id = identity(item), title = titleIdentity(item);
    if (ids.has(id) || titles.has(title)) continue;
    ids.add(id); titles.add(title); result.push(item);
  }
  return result;
}

export function buildShowcaseRails(items: readonly MediaItem[], kind: Kind, excluded: ReadonlySet<string> = new Set()): { primary: MediaItem[]; categories: [string, MediaItem[]][]; other: MediaItem[] } {
  const ids = new Set<string>(), titles = new Set<string>();
  for (const item of items) if (excluded.has(itemKey(item))) { ids.add(identity(item)); titles.add(titleIdentity(item)); }
  const visible: MediaItem[] = [];
  for (const item of items) {
    if (item.kind !== kind || !eligible(item) || excluded.has(itemKey(item))) continue;
    const id = identity(item), title = titleIdentity(item);
    if (ids.has(id) || titles.has(title)) continue;
    ids.add(id); titles.add(title); visible.push(item);
  }
  const primary = visible.slice(0, 12);
  const categories: [string, MediaItem[]][] = [];
  const categoryMap = new Map<string, MediaItem[]>();
  const other: MediaItem[] = [];
  for (const item of visible.slice(12)) {
    const name = group(item);
    let bucket = categoryMap.get(name);
    if (!bucket && categories.length < 4) { bucket = []; categoryMap.set(name, bucket); categories.push([name, bucket]); }
    if (bucket && bucket.length < 12) bucket.push(item); else other.push(item);
  }
  return { primary, categories, other };
}
