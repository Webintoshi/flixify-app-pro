import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CatalogPage from "./catalog";
import { AppShell } from "./shell";
import { Artwork } from "./artwork";
import { tvDownload } from "./tv-download";
import type { MediaItem } from "./types";

const state = vi.hoisted(() => ({ platform: {} as any, params: new URLSearchParams(), pathname: "/", push: vi.fn(), api: vi.fn() }));
vi.mock("./session", () => ({ usePlatform: () => state.platform }));
vi.mock("../../lib/api", () => ({ apiRequest: (path: string) => state.api(path) }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useSearchParams: () => state.params, useRouter: () => ({ push: state.push, back: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: (props: any) => <a {...props}/> }));
vi.mock("./detail", () => ({ Detail: () => null }));
vi.mock("./adult-movie-toggle", () => ({ AdultMovieToggle: () => null }));

let root: Root, container: HTMLElement, focus: HTMLElement | null;
const items = (kind: "movie" | "series" | "live") => Array.from({ length: 48 }, (_, index) => ({
  id: `${kind}-${index}`, kind, title: `${kind} ${index}`, releaseYear: 2026, groupTitle: "Gerçek katalog kategorisi", posterUrl: "/fixture-poster.jpg"
} as MediaItem));
const settle = async (action = () => {}) => { await act(async () => { action(); }); };
beforeEach(() => {
  const dom = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true }); Object.defineProperty(window, "innerHeight", { value: 720, configurable: true });
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
  focus = null; Object.defineProperty(document, "activeElement", { configurable: true, get: () => focus });
  const matches = dom.window.HTMLElement.prototype.matches;
  dom.window.HTMLElement.prototype.matches = function (selector: string) { return selector === ":focus-visible" ? focus === this : matches.call(this, selector); };
  dom.window.HTMLElement.prototype.focus = function () {
    const previous = focus; focus = this;
    previous?.dispatchEvent(new Event("focusout", { bubbles: true })); this.dispatchEvent(new Event("focusin", { bubbles: true }));
  };
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 150, left: 300, right: 500, bottom: 450, width: 200, height: 300, x: 300, y: 150, toJSON() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (dom.window.HTMLElement.prototype as any).showModal = function (this: HTMLElement) { this.setAttribute("open", ""); };
  (dom.window.HTMLElement.prototype as any).close = function (this: HTMLElement) { this.removeAttribute("open"); };
  (dom.window.HTMLElement.prototype as any).attachEvent = function () {};
  (dom.window.HTMLElement.prototype as any).detachEvent = function () {};
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
  state.pathname = "/"; state.params = new URLSearchParams(); state.push.mockReset();
  state.api.mockReset().mockResolvedValue({ user: { status: "active", hasAssignedLink: true, hasActiveSubscription: true, activePackage: { endsAt: "2099-01-01" } } });
  state.platform = { session: { accessToken: "fixture", kryptoniteCode: "TESTTESTTEST1234" }, ready: true,
    providerMode: "personal", providerScope: "composition-source", personalProvider: { catalog: vi.fn(async (kind: "movie" | "series" | "live") => items(kind)), detail: vi.fn() },
    favorites: [], favoritesReady: true, pending: new Set(), toggle: vi.fn(), invalidateFavorites: vi.fn(), reload: vi.fn(), logout: vi.fn() };
  container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

function legacyLiveFixture(sourceScope: string) {
  const live = [
    { id: "41", kind: "live", title: "TR | ATV HD", groupTitle: "TR | Ulusal", logoUrl: "/atv-hd.png" },
    { id: "44", kind: "live", title: "TR | TRT1", groupTitle: "TR | Ulusal", logoUrl: "/trt.png" },
    ...Array.from({ length: 298 }, (_, i) => ({ id: `other-${i}`, kind: "live", title: `TR | Other ${i}`, groupTitle: "TR | Ulusal", logoUrl: "/other.png" })),
    { id: "42", kind: "live", title: "TR | Atv FHD", groupTitle: "TR | Ulusal", logoUrl: "/atv-fhd.png" }
  ];
  state.platform = { ...state.platform, providerMode: "legacy", providerScope: sourceScope, personalProvider: null };
  state.api.mockImplementation(async (path: string) => {
    if (path.startsWith("/me/catalog/live")) {
      const params = new URL(path, "https://fixture.invalid").searchParams;
      const needle = (params.get("search") ?? "").toLowerCase();
      const rows = live.filter(item => item.title.toLowerCase().includes(needle));
      const page = Number(params.get("page") ?? "1"), size = Number(params.get("pageSize") ?? "48");
      return { items: rows.slice((page - 1) * size, page * size), total: rows.length, groups: [{ title: "TR | Ulusal", count: rows.length }] };
    }
    if (path.startsWith("/me/catalog/")) {
      const kind = path.includes("/series") ? "series" : "movie";
      return { items: items(kind).slice(0, 1), total: 1 };
    }
    return { user: { status: "active", hasAssignedLink: true, hasActiveSubscription: true, activePackage: { endsAt: "2099-01-01" } } };
  });
}

it("curates the whole legacy live pool before paging and routes search to its selected FHD", async () => {
  legacyLiveFixture("legacy-live-curation");
  await settle(() => root.render(<CatalogPage kind="live"/>));
  expect([...container.querySelectorAll("strong")].map(node => node.textContent)).toContain("ATV");
  expect(container.textContent).toContain("300 içerik");
  expect(container.textContent).not.toContain("TR | ATV HD");
  expect(state.api.mock.calls.some(([path]) => String(path).includes("/me/catalog/live?page=2&pageSize=300"))).toBe(true);
  await settle(() => container.querySelector<HTMLButtonElement>("[data-catalog-search-trigger]")!.click());
  const input = container.querySelector<HTMLInputElement>("#catalog-search")!;
  await settle(() => { input.value = "ATV"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(container.querySelector("dialog")?.textContent).toContain("1 sonuç");
  expect(container.querySelectorAll("dialog li button")).toHaveLength(1);
  await settle(() => container.querySelector<HTMLButtonElement>("dialog li button")!.click());
  expect(state.push).toHaveBeenLastCalledWith("/canli-tv?channel=42");
});

it("uses the same complete legacy live selection for the homepage rail", async () => {
  legacyLiveFixture("legacy-home-live-curation");
  await settle(() => root.render(<CatalogPage kind="movie" overview/>));
  const rail = [...container.querySelectorAll("section")].find(section => section.querySelector("h2")?.textContent === "Canlı TV")!;
  expect(rail).toBeDefined();
  expect([...rail.querySelectorAll("strong")].map(node => node.textContent)).toContain("ATV");
  expect(rail.textContent).not.toContain("TR | ATV HD");
  const atv = rail.querySelector<HTMLButtonElement>('button[aria-label="ATV oynat"]')!;
  expect(atv.querySelector("img")?.getAttribute("src")).toBe("/atv-fhd.png");
  await settle(() => atv.click()); expect(state.push).toHaveBeenCalledWith("/canli-tv?channel=42");
});

it("keeps the exact signed APK download in the header without a separate home notice", async () => {
  await settle(() => root.render(<AppShell publicAccess><div>Library</div></AppShell>));
  const download = container.querySelector<HTMLAnchorElement>("header a[download]");
  expect(download?.getAttribute("href")).toBe(tvDownload.href); expect(download?.getAttribute("download")).toBe(tvDownload.filename);
  expect(container.querySelector('aside[aria-label="Android TV uygulaması"]')).toBeNull();
  expect([...container.querySelectorAll('nav[aria-label="Hızlı menü"] a')].map(link => link.textContent)).toEqual(["Ana Sayfa", "Canlı TV", "Filmler", "Diziler", "Favoriler", "Hesabım"]);
});
it("uses a real featured title and opens its existing detail deep link honestly", async () => {
  await settle(() => root.render(<CatalogPage kind="movie" overview/>));
  const hero = container.querySelector('[aria-label="Günün öne çıkan içeriği"]')!;
  expect(hero).not.toBeNull();
  const selected = [...items("movie"), ...items("series")].find(item => item.title === hero.querySelector("h1")?.textContent)!;
  expect(selected).toBeDefined();
  const action = [...hero.querySelectorAll("button")].find(button => button.textContent === "İncele")!;
  await settle(() => action.click());
  expect(state.push).toHaveBeenCalledWith(`?item=${selected.id}&kind=${selected.kind}`, { scroll: false });
  expect(hero.textContent).not.toContain("Oynat");
});
it("presents disjoint 2026 movie and series selections as portrait poster rails", async () => {
  await settle(() => root.render(<CatalogPage kind="movie" overview/>));
  const rails = [...container.querySelectorAll("section")];
  const series = rails.find(section => section.querySelector("h2")?.textContent === "2026 Dizileri")!;
  const movies = rails.find(section => section.querySelector("h2")?.textContent === "2026 Filmleri")!;
  expect(series?.getAttribute("data-media-layout")).toBe("poster"); expect(series?.querySelectorAll("strong")).toHaveLength(18);
  expect(movies?.getAttribute("data-media-layout")).toBe("poster"); expect(movies?.querySelectorAll("strong")).toHaveLength(18);
  const filmTitles = [...container.querySelectorAll("strong")].map(node => node.textContent!).filter(title => title.startsWith("movie "));
  expect(filmTitles).toHaveLength(18); expect(new Set(filmTitles).size).toBe(18);
  expect(state.platform.personalProvider.catalog.mock.calls).toHaveLength(3);
  expect(container.textContent).not.toContain("İzlemeye devam et");
});
it("backfills a failed homepage poster while retaining the content in the movie archive", async () => {
  await settle(() => root.render(<CatalogPage kind="movie" overview/>));
  const movies = () => [...container.querySelectorAll("section")].find(section => section.querySelector("h2")?.textContent === "2026 Filmleri")!;
  const first = movies().querySelector<HTMLButtonElement>('button[aria-label$=" oynat"]')!;
  const failedTitle = first.querySelector("strong")!.textContent!;
  const image = first.querySelector("img")!;
  await settle(() => image.dispatchEvent(new Event("error", { bubbles: true })));
  expect([...movies().querySelectorAll("strong")].map(node => node.textContent)).not.toContain(failedTitle);
  expect(movies().querySelectorAll("strong")).toHaveLength(18);
  await settle(() => root.render(<CatalogPage kind="movie"/>));
  expect([...container.querySelectorAll("strong")].map(node => node.textContent)).toContain(failedTitle);
});
it("opens expanded artwork from keyboard focus even on a coarse pointer device and closes on Escape", async () => {
  await settle(() => root.render(<CatalogPage kind="movie"/>));
  const tile = container.querySelector<HTMLButtonElement>('button[aria-label$="oynat"]')!;
  await settle(() => tile.focus());
  expect(document.querySelector("[data-media-preview]")).not.toBeNull();
  const escape = new Event("keydown"); Object.defineProperty(escape, "key", { value: "Escape" });
  await settle(() => window.dispatchEvent(escape));
  expect(document.querySelector("[data-media-preview]")).toBeNull(); expect(document.activeElement).toBe(tile);
});
it("uses the actual channel logo when its poster field is empty", async () => {
  await settle(() => root.render(<Artwork item={{ id: "live-logo", kind: "live", title: "Kanal", posterUrl: "", logoUrl: "/fixture-channel-logo.png" }}/>));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/fixture-channel-logo.png");
});
it("routes movie and series posters directly to playback while explicit more keeps detail navigation", async () => {
  for (const kind of ["movie", "series"] as const) {
    await settle(() => root.render(<CatalogPage kind={kind}/>));
    const tile = container.querySelector<HTMLButtonElement>('button[aria-label$="oynat"]');
    expect(tile).not.toBeNull();
    const selected = items(kind).find(item => item.title === tile!.querySelector("strong")?.textContent)!;
    await settle(() => tile!.click());
    expect(state.push).toHaveBeenLastCalledWith(`?item=${selected.id}&kind=${kind}&play=1`, { scroll: false });
    await settle(() => tile!.focus());
    const more = [...document.querySelectorAll<HTMLButtonElement>("[data-media-preview] button")].find(button => button.textContent?.includes("Daha Fazla"))!;
    await settle(() => more.click());
    expect(state.push).toHaveBeenLastCalledWith(`?item=${selected.id}&kind=${kind}`, { scroll: false });
  }
});
it("closes search and opens its canonical preview result directly without filtering the underlying catalog", async () => {
  await settle(() => root.render(<CatalogPage kind="movie"/>));
  await settle(() => container.querySelector<HTMLButtonElement>("[data-catalog-search-trigger]")!.click());
  const input = container.querySelector<HTMLInputElement>("#catalog-search")!;
  await settle(() => { input.value = "movie 12"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  const result = container.querySelector<HTMLButtonElement>("dialog li button");
  expect(result).not.toBeNull();
  await settle(() => result!.click());
  expect(state.push).toHaveBeenLastCalledWith("?item=movie-12&kind=movie&play=1", { scroll: false });
  expect(container.querySelector("#catalog-search-dialog")).toBeNull();
  expect(container.querySelector('[aria-label="Aramayı temizle"]')).toBeNull();
});
it("plays from the expanded poster surface while its explicit more action still opens details", async () => {
  await settle(() => root.render(<CatalogPage kind="movie"/>));
  const tile = container.querySelector<HTMLButtonElement>('button[aria-label$="oynat"]')!;
  const selected = items("movie").find(item => item.title === tile.querySelector("strong")?.textContent)!;
  await settle(() => tile.focus());
  const previewPlay = document.querySelector<HTMLButtonElement>('[data-media-preview] button[aria-label$="önizlemeden oynat"]');
  expect(previewPlay).not.toBeNull(); expect(previewPlay?.type).toBe("button");
  await settle(() => previewPlay!.focus()); expect(document.activeElement).toBe(previewPlay);
  await settle(() => previewPlay!.click());
  expect(state.push).toHaveBeenCalledTimes(1);
  expect(state.push).toHaveBeenLastCalledWith(`?item=${selected.id}&kind=movie&play=1`, { scroll: false });
  expect(document.querySelector("[data-media-preview]")).toBeNull();
  await settle(() => tile.focus());
  const more = [...document.querySelectorAll<HTMLButtonElement>("[data-media-preview] button")].find(button => button.textContent?.includes("Daha Fazla"))!;
  await settle(() => more.click());
  expect(state.push).toHaveBeenLastCalledWith(`?item=${selected.id}&kind=movie`, { scroll: false });
  state.push.mockClear(); await settle(() => tile.focus());
  const favorite = document.querySelector<HTMLButtonElement>('[data-media-preview] button[aria-label$="favorilere ekle"]')!;
  await settle(() => favorite.click());
  expect(state.push).not.toHaveBeenCalled(); expect(state.platform.toggle).toHaveBeenCalledExactlyOnceWith(selected);
});
