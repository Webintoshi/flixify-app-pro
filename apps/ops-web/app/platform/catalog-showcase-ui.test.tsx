import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CatalogPage from "./catalog";
import type { MediaItem } from "./types";
const state = vi.hoisted(() => ({ platform: {} as any, params: new URLSearchParams() }));
vi.mock("./session", () => ({ usePlatform: () => state.platform }));
vi.mock("../../lib/api", () => ({ apiRequest: async () => ({ user: { status: "active", hasAssignedLink: true, hasActiveSubscription: true, activePackage: { endsAt: "2099-01-01" } } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params, useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: (props: any) => <a {...props}/> }));
vi.mock("./artwork", () => ({ Artwork: () => null, FavoriteButton: () => null }));
vi.mock("./detail", () => ({ Detail: ({ item }: any) => <div data-detail>{item.title}</div> }));
let root: Root, container: HTMLElement;
const items = (kind = "movie", version = "v1") => Array.from({ length: 120 }, (_, i) => ({ id: `${version}-${i}`, kind, title: `${kind} Title ${i}`, groupTitle: `Group ${i % 8}`, posterUrl: "/poster", personalRef: { kind, id: String(i), sourceVersion: version } } as MediaItem));
const titles = () => [...container.querySelectorAll("strong")].map(n => n.textContent);
const settle = async (fn = () => {}) => { await act(async () => { fn(); }); };
const render = async (props = {}) => settle(() => root.render(<CatalogPage kind="movie" {...props}/>));
const click = async (text: string) => settle(() => { ([...container.querySelectorAll("button")].find(b => b.textContent === text) as HTMLElement).click(); });
beforeEach(() => {
  const dom = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  state.params = new URLSearchParams();
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
  await render(); await click("Group 0"); expect(titles()).toEqual(items().filter(i => i.groupTitle === "Group 0").map(i => i.title));
  state.platform.favorites = [items()[4], items()[1]]; await render({ favoritesOnly: true }); expect(titles()).toEqual(["movie Title 4", "movie Title 1"]);
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
