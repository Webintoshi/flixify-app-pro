import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomepageHero } from "./homepage-hero";
import type { MediaItem } from "./types";

vi.mock("./artwork", () => ({
  Artwork: ({ item }: { item: MediaItem }) => <div data-artwork-kind={item.kind}><img alt={item.title} src={item.posterUrl ?? ""}/></div>,
  FavoriteButton: ({ item }: { item: MediaItem }) => <button aria-label={`${item.title}: favorilere ekle`}>Listeme Ekle</button>
}));

const movie: MediaItem = { id: "movie-2026", kind: "movie", title: "Örnek Film (2026)", releaseYear: 2026, posterUrl: "/movie.webp", groupTitle: "TR | Yerli Filmler" };
const series: MediaItem = { id: "series-2026", kind: "series", title: "Örnek Dizi [2026]", releaseYear: 2026, posterUrl: "/series.webp", groupTitle: "TR | Yerli Diziler", seasonCount: 2, episodeCount: 12 };
let root: Root;
let container: HTMLElement;
let onOpen: ReturnType<typeof vi.fn>;
const render = async (items: MediaItem[]) => { await act(async () => root.render(<HomepageHero items={items} onOpen={onOpen}/>)); };
const click = async (label: string) => { await act(async () => {
  const button = [...container.querySelectorAll("button")].find(element => element.textContent === label || element.getAttribute("aria-label") === label);
  expect(button).toBeDefined();
  button!.click();
}); };

beforeEach(() => {
  const dom = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.getElementById("root")!;
  root = createRoot(container);
  onOpen = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("does not invent a featured title for an empty 2026 inventory", async () => {
  await render([]);
  expect(container.childElementCount).toBe(0);
});

it("keeps playback and explicit information actions separate", async () => {
  await render([movie]);
  expect(container.querySelector("h1")?.textContent).toBe("Örnek Film");
  expect(container.textContent).toContain("2026 · Film");
  expect(container.textContent).toContain(movie.groupTitle);
  expect(container.querySelector('[aria-label="Öne çıkan içerikler"]')).toBeNull();
  await click("İzle");
  await click("İncele");
  expect(onOpen.mock.calls).toEqual([[movie, true], [movie, false]]);
});

it("changes the hero without starting playback and acts on the selected canonical item", async () => {
  await render([movie, series]);
  await click(`2. içerik: ${series.title}`);
  expect(onOpen).not.toHaveBeenCalled();
  expect(container.querySelector("h1")?.textContent).toBe("Örnek Dizi");
  expect(container.textContent).toContain("2026 · Dizi");
  expect(container.textContent).toContain("2 sezon");
  expect(container.querySelector(`[aria-label="2. içerik: ${series.title}"]`)?.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(`[aria-label="1. içerik: ${movie.title}"]`)?.getAttribute("aria-pressed")).toBe("false");
  await click("İzle");
  expect(onOpen).toHaveBeenLastCalledWith(series, true);
});

it("keeps a selected identity after reordered candidates and falls back when it disappears", async () => {
  await render([movie, series]);
  await click(`2. içerik: ${series.title}`);
  await render([series, movie]);
  expect(container.querySelector("h1")?.textContent).toBe("Örnek Dizi");
  await render([movie]);
  expect(container.querySelector("h1")?.textContent).toBe("Örnek Film");
  await click("İncele");
  expect(onOpen).toHaveBeenLastCalledWith(movie, false);
});

it("leaves meaningful title years and conflicting explicit metadata intact", async () => {
  await render([{ ...movie, title: "2026: Bir Hikâye" }]);
  expect(container.querySelector("h1")?.textContent).toBe("2026: Bir Hikâye");
  await render([{ ...movie, title: "Başka Film (2025)" }]);
  expect(container.querySelector("h1")?.textContent).toBe("Başka Film (2025)");
});
