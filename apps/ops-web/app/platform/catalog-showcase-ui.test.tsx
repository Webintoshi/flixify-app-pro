import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CatalogPage from "./catalog";
import { orderShowcaseCatalog } from "./catalog-showcase";
import type { MediaItem } from "./types";
const state = vi.hoisted(() => ({ platform: {} as any, params: new URLSearchParams(), api: vi.fn(), preference: null as null | ((revision: number, visible: boolean) => void) }));
vi.mock("./session", () => ({ usePlatform: () => state.platform }));
vi.mock("../../lib/api", () => ({ apiRequest: (path: string) => state.api(path) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params, useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: (props: any) => <a {...props}/> }));
vi.mock("./artwork", () => ({ Artwork: () => null, FavoriteButton: () => null }));
vi.mock("./detail", () => ({ Detail: ({ item }: any) => <div data-detail>{item.title}</div> }));
vi.mock("./adult-movie-toggle", () => ({ AdultMovieToggle: ({ onChanged }: any) => { state.preference = onChanged; return null; } }));
let root: Root, container: HTMLElement;
const items = (kind = "movie", version = "v1") => Array.from({ length: 120 }, (_, i) => ({ id: `${version}-${i}`, kind, title: `${kind} Title ${i}`, groupTitle: `Group ${i % 8}`, posterUrl: "/poster", personalRef: { kind, id: String(i), sourceVersion: version } } as MediaItem));
const titles = () => [...container.querySelectorAll("strong")].map(n => n.textContent);
const settle = async (fn = () => {}) => { await act(async () => { fn(); }); };
const render = async (props = {}) => settle(() => root.render(<CatalogPage kind="movie" {...props}/>));
const click = async (text: string) => settle(() => { ([...container.querySelectorAll("button")].find(b => b.textContent === text) as HTMLElement).click(); });
beforeEach(() => {
  const dom = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  (dom.window.HTMLElement.prototype as any).showModal = function (this: HTMLElement) { this.setAttribute("open", ""); };
  (dom.window.HTMLElement.prototype as any).close = function (this: HTMLElement) { this.removeAttribute("open"); };
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  state.api.mockReset().mockResolvedValue({ user: { status: "active", hasAssignedLink: true, hasActiveSubscription: true, activePackage: { endsAt: "2099-01-01" } } });
  state.params = new URLSearchParams();
  state.preference = null;
  state.platform = { session: { accessToken: "a" }, providerMode: "personal", providerScope: "v1", personalProvider: { catalog: vi.fn(async (kind: string) => items(kind)), detail: vi.fn() }, favorites: [], favoritesReady: true, invalidateFavorites: vi.fn(), reload: vi.fn() };
  container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("freezes the raw snapshot for unique stable subsequent pages", async () => {
  await render(); const first = titles(); expect(first.length).toBe(48); expect(new Set(first).size).toBe(48);
  state.platform.personalProvider.catalog.mockResolvedValue(items().reverse());
  await click("Daha Fazla Göster"); const second = titles(); expect(second.length).toBe(96); expect(new Set(second).size).toBe(96); expect(second.filter(t => first.includes(t))).toHaveLength(48);
  expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
});
it("uses common provider identities across source versions", async () => {
  await render(); const first = titles(); state.platform = { ...state.platform, session: { accessToken: "b" }, providerScope: "v2", personalProvider: { catalog: vi.fn(async () => items("movie", "v2").reverse()) } };
  await render(); expect(titles()).toEqual(first);
});
it("ignores a late account response", async () => {
  let resolve!: (v: MediaItem[]) => void; state.platform.personalProvider.catalog = vi.fn(() => new Promise<MediaItem[]>(done => { resolve = done; }));
  await render(); state.platform = { ...state.platform, session: { accessToken: "b" }, providerScope: "new", personalProvider: { catalog: vi.fn(async () => items("movie", "new")) } }; await render(); const current = titles();
  await settle(() => resolve([{ ...items()[0], title: "OLD ACCOUNT" }])); expect(titles()).toEqual(current);
});
it("refreshes a safe new day without fetching and defers while on page two", async () => {
  await render(); const first = titles(); vi.setSystemTime(new Date("2026-10-27T12:00:00Z")); await settle(() => window.dispatchEvent(new Event("focus"))); expect(titles()).not.toEqual(first);
  await click("Daha Fazla Göster"); const second = titles(); vi.setSystemTime(new Date("2026-10-28T12:00:00Z")); await settle(() => window.dispatchEvent(new Event("focus"))); expect(titles()).toEqual(second); expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
});
it("preserves category order and favorite order", async () => {
  await render(); await click("Kategori: Tümü"); await settle(() => (container.querySelector('[data-category-value="Group 0"]') as HTMLElement).click()); expect(titles()).toEqual(items().filter(i => i.groupTitle === "Group 0").map(i => i.title));
  state.platform.favorites = [items()[4], items()[1]]; await render({ favoritesOnly: true }); expect(titles()).toEqual(["movie Title 4", "movie Title 1"]);
});

it("previews a draft without changing rows, cancels it, and commits the category intersection without refetching", async () => {
  await render(); await click("Kategori: Tümü"); await settle(() => (container.querySelector('[data-category-value="Group 0"]') as HTMLElement).click());
  const before = titles();
  const openSearch = () => (container.querySelector('[data-catalog-search-trigger]') as HTMLElement).click();
  const draft = (value: string) => { const input = container.querySelector<HTMLInputElement>("#catalog-search")!; input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); };
  await settle(openSearch); await settle(() => draft("Title 1")); await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(container.querySelector("dialog")?.textContent).toContain("3 sonuç"); expect(titles()).toEqual(before);
  await click("Vazgeç"); expect(titles()).toEqual(before); expect(container.querySelector("dialog")).toBeNull();
  await settle(openSearch); expect(container.querySelector<HTMLInputElement>("#catalog-search")!.value).toBe("");
  await settle(() => draft("Title 1")); await settle(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(titles()).toEqual(items().filter(item => item.groupTitle === "Group 0" && item.title.includes("Title 1")).map(item => item.title));
  expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
  await click("Kategori: Group 0");
  expect(container.querySelector('[data-category-value="Group 0"]')?.textContent).toContain("3");
});
it("closes catalog panels on source changes so old drafts cannot be submitted", async () => {
  await render(); await settle(() => (container.querySelector('[data-catalog-search-trigger]') as HTMLElement).click());
  const input = container.querySelector<HTMLInputElement>("#catalog-search")!;
  await settle(() => { input.value = "Old draft"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  state.platform = { ...state.platform, providerScope: "replacement", personalProvider: { catalog: vi.fn(async () => items("movie", "replacement")) } };
  await render(); await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(container.querySelector("dialog")).toBeNull(); expect(container.textContent).not.toContain("Old draft"); expect(titles()).toHaveLength(48);
});
it("defers daily reshuffling while a search draft is open", async () => {
  await render(); const before = titles(); await settle(() => (container.querySelector('[data-catalog-search-trigger]') as HTMLElement).click());
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z")); await settle(() => window.dispatchEvent(new Event("focus"))); expect(titles()).toEqual(before);
  await click("Vazgeç"); expect(titles()).not.toEqual(before); expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
});
it("drops an open search when a pending movie-visibility preference changes its revision", async () => {
  state.platform = { ...state.platform, providerMode: "legacy", providerScope: "legacy-preference", personalProvider: null };
  state.api.mockImplementation(async (path: string) => path.startsWith("/me/catalog/")
    ? { items: items().slice(0, 48), total: 120, groups: [{ title: "Group 0", count: 15 }] }
    : { user: { status: "active", hasAssignedLink: true, hasActiveSubscription: true, activePackage: { endsAt: "2099-01-01" } } });
  await render(); await settle(() => (container.querySelector('[data-catalog-search-trigger]') as HTMLElement).click());
  expect(container.querySelector("dialog")).not.toBeNull(); expect(state.preference).not.toBeNull();
  await settle(() => state.preference!(1, false));
  expect(container.querySelector("dialog")).toBeNull();
});
it("keeps every hero candidate out of recommendation rails", async () => {
  await render({ overview: true }); const heroes = [...container.querySelectorAll('[aria-label^="Öne çıkan"] button')].map(b => b.getAttribute("aria-label")!.split(": ")[1]); expect(heroes).toHaveLength(5); expect(titles().filter(t => heroes.includes(t!))).toEqual([]);
});
it("evicts a failed promise so retry can load", async () => {
  state.platform.personalProvider.catalog.mockRejectedValueOnce(new Error("failed")); await render(); expect(container.textContent).toContain("İçerikler yüklenemedi"); await click("Tekrar Dene"); expect(titles()).toHaveLength(48); expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(2);
});
it("preserves original search results and totals", async () => {
  state.params = new URLSearchParams("q=Title+1"); await render();
  expect(titles()).toEqual(items().filter(i => i.title.includes("Title 1")).map(i => i.title));
  expect(container.textContent).toContain("31 içerik");
});
it("defers day rollover while a detail URL is open", async () => {
  await render(); const before = titles(); state.params = new URLSearchParams("item=missing&kind=movie"); await render(); const calls = state.platform.personalProvider.catalog.mock.calls.length;
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z")); await settle(() => window.dispatchEvent(new Event("focus"))); expect(titles()).toEqual(before);
  state.params = new URLSearchParams(); await render(); expect(titles()).not.toEqual(before); expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(calls);
});
it("hides the previous kind immediately while the new catalog is pending", async () => {
  await render(); state.platform.personalProvider.catalog.mockImplementation(() => new Promise(() => {})); await render({ kind: "series" }); expect(titles()).toEqual([]);
});

it("re-presents loaded legacy overview after midnight without reacquiring any catalog", async () => {
  state.platform = { ...state.platform, providerMode: "legacy", providerScope: "legacy-midnight", personalProvider: null };
  const catalogCalls: string[] = [];
  state.api.mockImplementation(async (path: string) => {
    if (!path.startsWith("/me/catalog/")) return { user: { status: "active", hasAssignedLink: true, hasActiveSubscription: true, activePackage: { endsAt: "2099-01-01" } } };
    catalogCalls.push(path);
    const kind = path.includes("/movies?") ? "movie" : path.includes("/series?") ? "series" : "live";
    return { items: items(kind).slice(0, 48), total: 120 };
  });
  await render({ overview: true });
  const liveTitles = () => [...container.querySelectorAll("section")].find(section => section.querySelector("h2")?.textContent === "Canlı TV")!.textContent;
  const beforeLive = liveTitles();
  const before = titles();
  const heroes = () => [...container.querySelectorAll('[aria-label="Öne çıkan içerikler"] button')].map(button => button.getAttribute("aria-label"));
  const beforeHeroes = heroes();
  expect(catalogCalls).toHaveLength(3);
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  await settle(() => window.dispatchEvent(new Event("focus")));
  expect(catalogCalls).toHaveLength(3);
  expect(liveTitles()).toEqual(beforeLive);
  expect(titles()).not.toEqual(before);
  expect(heroes()).not.toEqual(beforeHeroes);
});
it("appends adversarial legacy page two without replacing the primary or reordering existing selections", async () => {
  state.platform = { ...state.platform, providerMode: "legacy", providerScope: "legacy-pagination", personalProvider: null };
  const pool = items();
  const ranked = orderShowcaseCatalog(pool, "movie", "2026-10-26");
  const firstPage = ranked.slice(-48), secondPage = ranked.slice(0, 48);
  expect(orderShowcaseCatalog([...firstPage, ...secondPage], "movie", "2026-10-26")[0]).toBe(secondPage[0]);
  state.api.mockImplementation(async (path: string) => path.startsWith("/me/catalog/")
    ? { items: path.includes("page=2&") ? secondPage : firstPage, total: 96 }
    : { user: { status: "active", hasAssignedLink: true, hasActiveSubscription: true, activePackage: { endsAt: "2099-01-01" } } });
  await render();
  const first = titles();
  const primary = () => [...container.querySelectorAll("section")].find(section => section.querySelector("h2")?.textContent === "Günün Seçkisi")!.querySelectorAll("strong");
  const beforePrimary = [...primary()].map(node => node.textContent);
  await click("Daha Fazla Göster");
  expect([...primary()].map(node => node.textContent)).toEqual(beforePrimary);
  expect(titles().filter(title => first.includes(title))).toEqual(first);
  expect(titles()).toHaveLength(96);
  expect(new Set(titles()).size).toBe(96);
});
it("recovers the mounted production access gate on polling and preserves pagination on extension and outage", async () => {
  state.api.mockResolvedValue({user:{status:"active",hasAssignedLink:true,hasActiveSubscription:false,activePackage:null}});
  await render(); expect(titles()).toEqual([]);
  state.api.mockResolvedValue({user:{status:"active",hasAssignedLink:true,hasActiveSubscription:true,activePackage:{endsAt:"2099-01-01"}}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
  expect(titles()).toHaveLength(48); await click("Daha Fazla Göster");
  const before=titles(); state.api.mockResolvedValue({user:{status:"active",hasAssignedLink:true,hasActiveSubscription:true,activePackage:{endsAt:"2099-02-01"}}});
  await settle(()=>window.dispatchEvent(new Event("focus")));
  expect(titles()).toEqual(before);expect(state.platform.personalProvider.catalog).toHaveBeenCalledTimes(1);
  state.api.mockRejectedValue(new Error("offline"));await settle(()=>window.dispatchEvent(new Event("focus")));
  expect(titles()).toEqual(before);
});
