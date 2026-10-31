import { describe, expect, it } from "vitest";
import { buildHomepageShowcase, selectHomepageCatalog } from "./homepage-showcase";
import { itemKey, type Kind, type MediaItem } from "./types";

const item = (id: number, kind: Kind = "movie", year = 2026): MediaItem => ({
  id: `${kind}-${id}`, kind, title: `${kind} ${id} (${year})`, groupTitle: `Group ${id % 5}`,
  posterUrl: `/poster-${id}.jpg`, personalRef: { source: "personal", sourceVersion: "a", kind, id: String(id) }
});
const visible = (showcase: ReturnType<typeof buildHomepageShowcase>) => [...showcase.hero, ...showcase.movies, ...showcase.series];

describe("2026 homepage composition", () => {
  it("selects from the complete pool beyond the old first-48 prefix", () => {
    const older = Array.from({ length: 100 }, (_, i) => item(i, "movie", 2016));
    const current = Array.from({ length: 100 }, (_, i) => item(i + 100));
    const input = [...older, ...current];
    const selected = selectHomepageCatalog(input, "movie", "2026-10-31");
    expect(selected).toHaveLength(100);
    expect(new Set(selected)).toEqual(new Set(current));
    expect(input).toEqual([...older, ...current]);
  });

  it("rejects old, unknown, ineligible and mismatched content while preserving IDs", () => {
    const accepted = item(1);
    const input = [accepted, item(2, "movie", 2025), { ...item(3), title: "Unknown", groupTitle: "2026" },
      { ...item(4), available: false }, { ...item(5), playbackAllowed: false }, { ...item(6), lookupFailed: true },
      item(7, "series"), item(8, "live"), { ...item(9), releaseYear: 2025 }];
    expect(selectHomepageCatalog(input, "movie", "day")).toEqual([accepted]);
    expect(selectHomepageCatalog(input, "live", "day")).toEqual([]);
  });

  it("uses shared deterministic daily ordering independent of input order and source version", () => {
    const a = Array.from({ length: 120 }, (_, i) => item(i));
    const b = a.map(row => ({ ...row, id: `new-${row.id}`, personalRef: { ...row.personalRef!, sourceVersion: "b" } })).reverse();
    const refs = (rows: MediaItem[]) => rows.map(row => row.personalRef!.id);
    expect(refs(selectHomepageCatalog(a, "movie", "2026-10-31"))).toEqual(refs(selectHomepageCatalog(b, "movie", "2026-10-31")));
    expect(refs(selectHomepageCatalog(a, "movie", "2026-11-01"))).not.toEqual(refs(selectHomepageCatalog(a, "movie", "2026-10-31")));
  });

  it("keeps eligible hero and poster rails disjoint, unique and bounded", () => {
    const rows = ["movie", "series"].flatMap(kind => Array.from({ length: 100 }, (_, i) => item(i, kind as Kind)));
    const duplicate = { ...rows[0], id: "provider-alias", personalRef: { ...rows[0].personalRef!, sourceVersion: "other" } };
    const duplicateTitle = { ...item(900), title: rows[1].title.toUpperCase() };
    const result = buildHomepageShowcase([...rows, duplicate, duplicateTitle], "2026-10-31");
    expect(result.total).toBe(200);
    expect(result.hero).toHaveLength(5);
    expect(result.movies).toHaveLength(18);
    expect(result.series).toHaveLength(18);
    const displayed = visible(result);
    expect(new Set(displayed.map(itemKey)).size).toBe(displayed.length);
    expect(new Set(displayed.map(row => `${row.kind}:${row.title.toLowerCase()}`)).size).toBe(displayed.length);
    expect(result.hero.every(row => row.posterUrl && row.kind !== "live")).toBe(true);
  });

  it("does not consume every small inventory in the hero or fill gaps with older releases", () => {
    for (const count of [1, 2, 3, 4, 5, 6]) {
      const current = Array.from({ length: count }, (_, i) => item(i));
      const result = buildHomepageShowcase([...current, item(100, "movie", 2016)], "day");
      expect(result.total).toBe(count);
      expect(visible(result)).toHaveLength(count);
      expect(new Set(visible(result))).toEqual(new Set(current));
      if (count > 1) expect(result.movies.length).toBeGreaterThan(0);
    }
  });

  it("supports series-only and empty inventories without inventing movies", () => {
    const seriesOnly = buildHomepageShowcase([item(1, "series"), item(2, "series")], "day");
    expect(seriesOnly.total).toBe(2);
    expect(seriesOnly.movies).toEqual([]);
    expect(seriesOnly.series).toHaveLength(1);
    expect(buildHomepageShowcase([item(1, "movie", 2025)], "day")).toEqual({ hero: [], movies: [], series: [], total: 0 });
  });

  it("retains genuine entries without artwork in rails while excluding them from the hero", () => {
    const withoutArt = { ...item(1), posterUrl: null };
    expect(buildHomepageShowcase([withoutArt], "day")).toEqual({ hero: [], movies: [withoutArt], series: [], total: 1 });
  });
});
