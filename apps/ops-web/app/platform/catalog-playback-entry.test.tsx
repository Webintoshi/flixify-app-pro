import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Detail } from "./detail";
import type { Episode, MediaItem } from "./types";

const state = vi.hoisted(() => ({ platform: {} as any, api: vi.fn(), playback: vi.fn() }));
vi.mock("./session", () => ({ usePlatform: () => state.platform, useProviderExpiry: () => undefined }));
vi.mock("../../lib/api", () => ({ apiRequest: (...args: any[]) => state.api(...args) }));
vi.mock("./artwork", () => ({ Artwork: () => null, FavoriteButton: () => null }));
vi.mock("./personal-integration", async () => ({ ...await vi.importActual<any>("./personal-integration"), requestPersonalPlayback: (...args: any[]) => state.playback(...args) }));

const movie: MediaItem = { id: "canonical-movie", kind: "movie", title: "Örnek Film", playbackAllowed: true, personalRef: { source: "personal", kind: "movie", id: "42", sourceVersion: "owned-source" } };
const episode = (id: string, number: number): Episode => ({ id, title: `Bölüm ${number}`, seasonNumber: 1, episodeNumber: number, playbackAllowed: true, personalRef: { source: "personal", kind: "episode", id: String(number), seriesId: "7", sourceVersion: "owned-source" } });
const first = episode("first", 1), second = episode("second", 2);
const series: MediaItem = { id: "canonical-series", kind: "series", title: "Örnek Dizi", playbackAllowed: true, personalRef: { source: "personal", kind: "series", id: "7", sourceVersion: "owned-source" }, seasons: [{ seasonNumber: 1, title: "1. Sezon", episodes: [first, second] }] };
let root: Root, container: HTMLElement;
const settle = async (fn = () => {}) => { await act(async () => { fn(); }); };
const render = (item = movie, autoPlay = true) => settle(() => root.render(<Detail item={item} autoPlay={autoPlay} onClose={() => {}}/>));
beforeEach(() => {
  const dom = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document); vi.stubGlobal("Event", dom.window.Event);
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("location", { origin: "https://flixify.example", protocol: "https:" });
  vi.stubGlobal("navigator", { userAgent: "Chrome" });
  const tracks = Object.assign([], { addEventListener() {}, removeEventListener() {} });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    textTracks: { configurable: true, value: tracks },
    paused: { configurable: true, writable: true, value: true },
    currentTime: { configurable: true, writable: true, value: 0 },
    duration: { configurable: true, value: 120 },
    volume: { configurable: true, value: 1 },
    playbackRate: { configurable: true, value: 1 },
    play: { configurable: true, value() { this.paused = false; return Promise.resolve(); } },
    pause: { configurable: true, value() { this.paused = true; } },
    load: { configurable: true, value() {} },
    showModal: { configurable: true, value() { this.setAttribute("open", ""); } },
  });
  state.platform = { providerMode: "personal", providerScope: "owned-source", personalProvider: { id: "owned-provider" } };
  state.api.mockReset().mockResolvedValue({ watched: [] });
  state.playback.mockReset().mockResolvedValue({ canPlay: true, url: "https://media.example.invalid/fixture.mp4", transport: "mp4", deliveryMode: "direct_provider", expiresAt: "2099-01-01" });
  vi.useFakeTimers(); container = document.getElementById("root")!; root = createRoot(container);
});
afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("starts the selected movie once without a second play click and keeps back-to-detail usable", async () => {
  await render();
  expect(state.playback).toHaveBeenCalledExactlyOnceWith(state.platform.personalProvider, movie.personalRef);
  expect(container.querySelector("video")).not.toBeNull();
  await render(); expect(state.playback).toHaveBeenCalledTimes(1);
  await settle(() => container.querySelector<HTMLButtonElement>('[aria-label="Detaya dön"]')!.click());
  expect(container.querySelector("video")).toBeNull(); expect(state.playback).toHaveBeenCalledTimes(1);
  const manualPlay = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Oynat")!;
  await settle(() => manualPlay.click()); expect(state.playback).toHaveBeenCalledTimes(2);
});
it("keeps an explicit detail-only entry from starting media", async () => {
  await render(movie, false); expect(state.playback).not.toHaveBeenCalled(); expect(container.querySelector("video")).toBeNull();
});
it("keeps a StrictMode mount playable without issuing duplicate playback requests", async () => {
  await settle(() => root.render(<React.StrictMode><Detail item={movie} autoPlay onClose={() => {}}/></React.StrictMode>));
  expect(state.playback).toHaveBeenCalledExactlyOnceWith(state.platform.personalProvider, movie.personalRef);
  expect(container.querySelector("video")).not.toBeNull();
});
it("hydrates series progress before automatically selecting the first unwatched playable episode", async () => {
  let resolve!: (value: unknown) => void;
  state.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  await render(series); expect(state.playback).not.toHaveBeenCalled();
  await settle(() => resolve({ watched: [first.personalRef] }));
  expect(state.playback).toHaveBeenCalledExactlyOnceWith(state.platform.personalProvider, second.personalRef);
  expect(container.querySelector("video")?.getAttribute("aria-label")).toBe(second.title);
});
it("does not replace a manually selected episode when delayed progress arrives", async () => {
  let resolve!: (value: unknown) => void;
  state.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  await render(series);
  await settle(() => container.querySelector<HTMLButtonElement>('[aria-label^="1. sezon 2. bölüm"]')!.click());
  await settle(() => resolve({ watched: [] }));
  expect(state.playback).toHaveBeenCalledExactlyOnceWith(state.platform.personalProvider, second.personalRef);
});
it("never automatically starts unavailable or access-denied items", async () => {
  await render({ ...movie, playbackAllowed: false }); expect(state.playback).not.toHaveBeenCalled();
  await settle(() => root.render(<Detail key="unavailable" item={{ ...movie, available: false }} autoPlay onClose={() => {}}/>));
  expect(state.playback).not.toHaveBeenCalled();
});
