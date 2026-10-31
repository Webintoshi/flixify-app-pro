import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CategorySidebar } from "./categories";
import { CatalogSearchDialog } from "./catalog-search";
import type { Catalog } from "./types";

vi.mock("./artwork", () => ({ Artwork: ({ item }: any) => <img alt="" src={item.posterUrl ?? "/poster"}/> }));
let root: Root, container: HTMLElement, focus: HTMLElement | null;
const settle = async (action = () => {}) => { await act(async () => { action(); }); };
const textButton = (text: string) => [...container.querySelectorAll("button")].find(button => button.textContent === text) as HTMLButtonElement;
const type = async (element: HTMLInputElement, value: string) => settle(() => {
  element.focus();
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
beforeEach(() => {
  const dom = parseHTML("<html><body><button id='opener'>Ara</button><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  focus = document.getElementById("opener");
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => focus });
  dom.window.HTMLElement.prototype.focus = function () {
    if (focus === this) return;
    const previous = focus; focus = this;
    previous?.dispatchEvent(new Event("focusout", { bubbles: true }));
    this.dispatchEvent(new Event("focusin", { bubbles: true }));
  };
  // React is imported before Linkedom exists and therefore uses its legacy input-focus path.
  (dom.window.HTMLElement.prototype as any).attachEvent = function () {};
  (dom.window.HTMLElement.prototype as any).detachEvent = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (dom.window.HTMLElement.prototype as any).showModal = function (this: HTMLElement) { this.setAttribute("open", ""); };
  (dom.window.HTMLElement.prototype as any).close = function (this: HTMLElement) { this.removeAttribute("open"); };
  document.body.style.overflow = "auto";
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
  container = document.getElementById("root")!; root = createRoot(container);
  vi.useFakeTimers();
});
afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("opens a native category dialog at every width with counts and a persistent selected mark", async () => {
  const onSelect = vi.fn(), onClose = vi.fn();
  await settle(() => root.render(<CategorySidebar open groups={[{ title: "Drama", count: 12 }, { title: "Bilim Kurgu", count: 7 }]} selected="Drama" onSelect={onSelect} onClose={onClose}/>));
  const dialog = container.querySelector("dialog")!;
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  const selected = container.querySelector('[data-category-value="Drama"]')!;
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  expect(selected.textContent).toContain("12");
  expect(selected.querySelector('[data-selected-mark]')).not.toBeNull();
  expect(selected.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  await settle(() => (container.querySelector('[data-category-value="Bilim Kurgu"]') as HTMLElement).focus());
  expect(selected.getAttribute("aria-pressed")).toBe("true");
  await settle(() => (container.querySelector('[data-category-value="Bilim Kurgu"]') as HTMLElement).click());
  expect(onSelect).toHaveBeenCalledWith("Bilim Kurgu"); expect(onClose).toHaveBeenCalledOnce();
  await settle(() => root.render(null));
  expect(document.body.style.overflow).toBe("auto"); expect(document.activeElement?.id).toBe("opener");
});
it("finds Turkish category names locally without changing the selected category", async () => {
  const onSelect = vi.fn();
  await settle(() => root.render(<CategorySidebar open groups={[{ title: "İstanbul Hikâyeleri", count: 3 }, { title: "Drama", count: 9 }]} selected="Drama" onSelect={onSelect} onClose={() => {}}/>));
  await type(container.querySelector("input")!, "  istanbul  ");
  expect(container.querySelector('[data-category-value="İstanbul Hikâyeleri"]')).not.toBeNull();
  expect(container.querySelector('[data-category-value="Drama"]')).toBeNull(); expect(onSelect).not.toHaveBeenCalled();
  await type(container.querySelector("input")!, "bulunamayan");
  expect(container.textContent).toContain("Kategori bulunamadı");
});
const catalog = (title: string, total = 1): Catalog => ({ total, items: [{ id: title, kind: "movie", title, groupTitle: "Drama", posterUrl: "/poster" }] });
it("activates the actual search result without submitting the draft", async () => {
  const selected = catalog("Avengers").items[0];
  const onSelect = vi.fn(), onSubmit = vi.fn(), onClose = vi.fn();
  await settle(() => root.render(<CatalogSearchDialog title="Filmler" initialQuery="Avengers" scope="Kategori: Tümü" preview={async () => ({ items: [selected], total: 1 })} onSelect={onSelect} onSubmit={onSubmit} onClose={onClose}/>));
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  const result = container.querySelector<HTMLButtonElement>("li button");
  expect(result).not.toBeNull(); expect(result?.type).toBe("button");
  await settle(() => result!.click());
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(selected);
  expect(onSubmit).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});
it("does not activate an unavailable preview or retain results while a new query is pending", async () => {
  const unavailable = { ...catalog("Eski film").items[0], available: false };
  const onSelect = vi.fn();
  await settle(() => root.render(<CatalogSearchDialog title="Filmler" initialQuery="Eski" scope="Kategori: Tümü" preview={async () => ({ items: [unavailable], total: 1 })} onSelect={onSelect} onSubmit={() => {}} onClose={() => {}}/>));
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  const result = container.querySelector<HTMLButtonElement>("li button");
  expect(result).not.toBeNull(); expect(result?.disabled).toBe(true);
  await settle(() => result!.click()); expect(onSelect).not.toHaveBeenCalled();
  await type(container.querySelector("input")!, "Yeni");
  expect(container.querySelector("li button")).toBeNull();
});
it("keeps search as a draft, clears locally, and submits only on Ara", async () => {
  const onSubmit = vi.fn(), onClose = vi.fn(), preview = vi.fn(async (query: string) => catalog(query || "Gece Yolcusu", 4));
  await settle(() => root.render(<CatalogSearchDialog title="Filmler" initialQuery="Gece" scope="Kategori: Drama" preview={preview} onSelect={() => {}} onSubmit={onSubmit} onClose={onClose}/>));
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(container.textContent).toContain("4 sonuç"); expect(onSubmit).not.toHaveBeenCalled();
  await type(container.querySelector("input")!, "  Deniz  ");
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(preview).toHaveBeenLastCalledWith("Deniz"); expect(onSubmit).not.toHaveBeenCalled();
  await settle(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onSubmit).toHaveBeenCalledWith("Deniz");
  await settle(() => textButton("Vazgeç").click()); expect(onClose).toHaveBeenCalledOnce();
});
it("rejects late search preview responses and cancels pending preview on close", async () => {
  let resolveOld!: (value: Catalog) => void;
  const preview = vi.fn((query: string) => query === "Eski" ? new Promise<Catalog>(done => { resolveOld = done; }) : Promise.resolve(catalog("Yeni sonuç")));
  await settle(() => root.render(<CatalogSearchDialog title="Filmler" initialQuery="Eski" scope="Kategori: Tümü" preview={preview} onSelect={() => {}} onSubmit={() => {}} onClose={() => {}}/>));
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  await type(container.querySelector("input")!, "Yeni");
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  await settle(() => resolveOld(catalog("Eski hesap sonucu", 400)));
  expect(container.textContent).toContain("Yeni sonuç"); expect(container.textContent).not.toContain("Eski hesap sonucu");
  await type(container.querySelector("input")!, "Bekleyen"); await settle(() => root.render(null));
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(preview).toHaveBeenCalledTimes(2); expect(document.body.style.overflow).toBe("auto");
});

it("closes nonempty search on the first Escape before the browser clears its draft", async () => {
  const onSubmit = vi.fn(), preview = vi.fn(async () => catalog("Deniz", 2));
  function SearchHarness() {
    const [open, setOpen] = React.useState(true);
    return open ? <CatalogSearchDialog title="Filmler" initialQuery="Gece" scope="Kategori: Tümü" preview={preview} onSelect={() => {}} onSubmit={onSubmit} onClose={() => setOpen(false)}/> : <p>Kapalı</p>;
  }
  await settle(() => root.render(<SearchHarness/>));
  const input = container.querySelector<HTMLInputElement>("input")!;
  await type(input, "Deniz");
  const escape = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  await settle(() => input.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(container.querySelector("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("auto"); expect(document.activeElement?.id).toBe("opener");
  await act(async () => { await vi.advanceTimersByTimeAsync(180); });
  expect(onSubmit).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
});

it("closes nonempty category finder on one Escape and restores its opener without selecting", async () => {
  const onSelect = vi.fn();
  function CategoryHarness() {
    const [open, setOpen] = React.useState(true);
    return open ? <CategorySidebar open groups={[{ title: "Drama", count: 12 }]} selected="Drama" onSelect={onSelect} onClose={() => setOpen(false)}/> : <p>Kapalı</p>;
  }
  await settle(() => root.render(<CategoryHarness/>));
  const input = container.querySelector<HTMLInputElement>("input")!;
  await type(input, "Dra");
  const escape = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  await settle(() => input.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(container.querySelector("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("auto"); expect(document.activeElement?.id).toBe("opener");
  expect(onSelect).not.toHaveBeenCalled();
});

it("uses the latest close callback for Escape without reopening the native dialog", async () => {
  const first = vi.fn(), latest = vi.fn(), preview = vi.fn(async () => catalog("Gece"));
  const render = (onClose: () => void) => root.render(<CatalogSearchDialog title="Filmler" initialQuery="Gece" scope="Kategori: Tümü" preview={preview} onSelect={() => {}} onSubmit={() => {}} onClose={onClose}/>);
  await settle(() => render(first)); const dialog = container.querySelector("dialog");
  await settle(() => render(latest)); expect(container.querySelector("dialog")).toBe(dialog);
  const input = container.querySelector<HTMLInputElement>("input")!;
  const escape = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(escape, "key", { value: "Escape" });
  await settle(() => input.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true); expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
});
