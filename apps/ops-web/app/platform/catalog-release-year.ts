import type { MediaItem } from "./types";

function year(value: unknown): number | null {
  const candidate = typeof value === "number" ? value
    : typeof value === "string" && /^(?:19|20)\d{2}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(candidate) && candidate >= 1900 && candidate <= 2099 ? candidate : null;
}

function dateYear(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const match = /^((?:19|20)\d{2})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.exec(value.trim());
  if (!match) return null;
  const [yyyy, mm, dd] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(yyyy, mm - 1, dd));
  return parsed.getUTCFullYear() === yyyy && parsed.getUTCMonth() === mm - 1 && parsed.getUTCDate() === dd ? yyyy : null;
}

function titleYear(title: string): number | null {
  const normalized = title.normalize("NFKC").trim();
  const terminal = /(?:\(((?:19|20)\d{2})\)|\[((?:19|20)\d{2})\])$/.exec(normalized);
  if (!terminal) return null;
  const markers = [...normalized.matchAll(/\(((?:19|20)\d{2})\)|\[((?:19|20)\d{2})\]/g)];
  const years = new Set(markers.map(match => Number(match[1] ?? match[2])));
  return years.size === 1 ? Number(terminal[1] ?? terminal[2]) : null;
}

export function catalogReleaseYear(metadata: unknown, title: string): number | null {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
  const years = new Set<number>();
  for (const [field, parse] of [
    ["year", year], ["release_year", year], ["releaseYear", year],
    ["releaseDate", dateYear], ["release_date", dateYear]
  ] as const) {
    const value = source[field];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) continue;
    const parsed = parse(value);
    if (parsed === null) return null;
    years.add(parsed);
  }
  if (years.size > 1) return null;
  return years.size ? years.values().next().value! : titleYear(title);
}

export function homepageReleaseYear(item: Pick<MediaItem, "title" | "releaseYear">): number | null {
  // Null preserves a normalized conflict; only legacy records omit the field.
  return item.releaseYear === undefined ? titleYear(item.title) : year(item.releaseYear);
}
