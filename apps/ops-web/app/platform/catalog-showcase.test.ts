import { describe, expect, it } from "vitest";
import { buildShowcaseRails, orderShowcaseCatalog, selectShowcaseHero, showcaseDayKey } from "./catalog-showcase";
import { itemKey, type MediaItem } from "./types";
const item = (n: number, group = `Group ${n % 8}`): MediaItem => ({ id: `${n}`, title: `Film ${n}`, kind: "movie", groupTitle: group, posterUrl: "/poster", personalRef: { source: "personal", kind: "movie", id: `${n}`, sourceVersion: "a" } as MediaItem["personalRef"] });
const catalog = (n: number) => Array.from({ length: n }, (_, i) => item(i));
describe("daily showcase", () => {
  it("uses Istanbul midnight", () => {
    expect(showcaseDayKey(Date.parse("2026-10-25T20:59:59Z"))).toBe("2026-10-25");
    expect(showcaseDayKey(Date.parse("2026-10-25T21:00:00Z"))).toBe("2026-10-26");
  });
  it("is independent of source version, opaque IDs and input order", () => {
    const a = catalog(200);
    const b = a.map(x => ({ ...x, id: `new:${x.id}`, personalRef: { ...x.personalRef!, sourceVersion: "b" } })).reverse();
    expect(orderShowcaseCatalog(a, "movie", "2026-10-26").map(x => x.personalRef!.id)).toEqual(orderShowcaseCatalog(b, "movie", "2026-10-26").map(x => x.personalRef!.id));
    expect(orderShowcaseCatalog(a, "movie", "2026-10-27").map(itemKey)).not.toEqual(orderShowcaseCatalog(a, "movie", "2026-10-26").map(itemKey));
  });
  it("balances categories and selects beyond the original prefix", () => {
    const a = Array.from({ length: 800 }, (_, i) => item(i, `Group ${Math.floor(i / 100)}`));
    const ordered = orderShowcaseCatalog(a, "movie", "2026-10-26");
    expect(new Set(ordered.slice(0, 12).map(x => x.groupTitle)).size).toBe(8);
    expect(ordered.slice(0, 48).some(x => Number(x.id) >= 100)).toBe(true);
    expect(ordered).toHaveLength(a.length);
    expect(new Set(ordered)).toEqual(new Set(a));
  });
  it("retains every original object and leaves live ordering intact", () => {
    const repeated = item(99);
    const a = [...catalog(30), item(0), repeated, repeated, { ...item(2), available: false }];
    expect(orderShowcaseCatalog(a, "movie", "day").slice().sort((a,b) => a.title.localeCompare(b.title))).toEqual(a.slice().sort((a,b) => a.title.localeCompare(b.title)));
    expect(orderShowcaseCatalog(a, "live", "day")).toEqual(a);
  });
  it("makes eligible, title-deduplicated disjoint rails and poster heroes", () => {
    const a = [...catalog(180), { ...item(900), title: "  FILM 1  " }, { ...item(901), playbackAllowed: false }, { ...item(902), available: false }, { ...item(903), lookupFailed: true }, { ...item(904), posterUrl: null }];
    const ordered = orderShowcaseCatalog(a, "movie", "day");
    const hero = selectShowcaseHero(ordered, "day");
    expect(hero).toHaveLength(5);
    expect(hero.every(x => x.posterUrl && x.playbackAllowed !== false && x.available !== false && !x.lookupFailed)).toBe(true);
    const rails = buildShowcaseRails(ordered, "movie", new Set(hero.map(itemKey)));
    expect(rails.categories).toHaveLength(4);
    expect(rails.primary).toHaveLength(12);
    expect(rails.categories.every(([, xs]) => xs.length <= 12)).toBe(true);
    const all = [...hero, ...rails.primary, ...rails.categories.flatMap(([, xs]) => xs), ...rails.other];
    expect(new Set(all.map(itemKey)).size).toBe(all.length);
    expect(new Set(all.map(x => x.title.trim().toLowerCase())).size).toBe(all.length);
    expect(all.some(x => ["901", "902", "903"].includes(x.id))).toBe(false);
  });
  it("deduplicates provider aliases and propagates hero exclusions to their titles", () => {
    const original = item(1);
    const alias = { ...original, id: "alias", personalRef: { ...original.personalRef!, sourceVersion: "other" } };
    const sameTitle = { ...item(2), title: original.title };
    const a = [original, alias, sameTitle, item(3)];
    expect(buildShowcaseRails(a, "movie").primary).toEqual([original, a[3]]);
    expect(buildShowcaseRails(a, "movie", new Set([itemKey(original)])).primary).toEqual([a[3]]);
    expect(selectShowcaseHero(a, "day")).toHaveLength(2);
  });
  it("preserves sequel numbers and years", () => {
    const a = ["Film", "Film 2", "Film (2020)", "Film (2021)"].map((title, i) => ({ ...item(i), title }));
    expect(buildShowcaseRails(a, "movie").primary).toHaveLength(4);
  });
  it("promotes eligible records beyond a blocked prefix without dropping blocked records", () => {
    const blocked = catalog(200).map(x => ({ ...x, available: false, groupTitle: "Blocked" }));
    const allowed = catalog(100).map((x, i) => ({ ...x, id: `allowed:${i}`, personalRef: undefined }));
    const ordered = orderShowcaseCatalog([...blocked, ...allowed], "movie", "day");
    expect(ordered.slice(0, 48).every(x => x.available !== false)).toBe(true);
    expect(ordered).toHaveLength(300);
    expect(new Set(ordered)).toEqual(new Set([...blocked, ...allowed]));
  });
  it("handles 50k entries without loss", () => {
    const a = catalog(50_000);
    expect(orderShowcaseCatalog(a, "movie", "day")).toHaveLength(50_000);
  });
});
