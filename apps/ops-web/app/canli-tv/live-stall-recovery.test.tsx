import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveTvPage from "./page";

const state = vi.hoisted(() => ({ platform: {} as any, engines: [] as any[] }));
vi.mock("../platform/session", () => ({ usePlatform: () => state.platform, useProviderExpiry: () => state.platform.providerExpiresAt }));
vi.mock("../platform/artwork", () => ({ FavoriteButton: () => null }));
vi.mock("../components/player-chrome", () => ({ PlayerChrome: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("channel=channel-a") }));
vi.mock("next/link", () => ({ default: (props: any) => React.createElement("a", props) }));
vi.mock("hls.js", () => ({ default: class {
  static Events = { ERROR: "error" };
  static ErrorTypes = { MEDIA_ERROR: "media" };
  static isSupported() { return true; }
  handlers = new Map<string, Function>();
  destroyed = false;
  source = "";
  constructor() { state.engines.push(this); }
  on(event: string, listener: Function) { this.handlers.set(event, listener); }
  loadSource(source: string) { this.source = source; }
  attachMedia() {}
  recoverMediaError() {}
  destroy() { this.destroyed = true; }
  networkError() { this.handlers.get("error")?.("error", { fatal: true, type: "network" }); }
} }));

describe("live stream stall recovery", () => {
  let root: Root;
  let container: HTMLElement;
  let expiresAt: string;
  let playback: ReturnType<typeof vi.fn>;
  const ref = { source: "personal", sourceVersion: "line-a", kind: "live", id: "274", extension: "m3u8" };
  const url = "https://edge.test/live/personal/test-password/274.m3u8";
  async function settle(action: () => void = () => {}) { await act(async () => { action(); await vi.dynamicImportSettled(); }); }
  async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); await vi.dynamicImportSettled(); }); }
  function video() { return container.querySelector("video")!; }
  async function progress() {
    await settle(() => { video().currentTime += 1; video().dispatchEvent(new Event("timeupdate")); });
  }
  beforeEach(() => {
    vi.useFakeTimers();
    const dom = parseHTML("<html><body><div id='root'></div></body></html>");
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    vi.stubGlobal("localStorage", storage);
    Object.defineProperty(dom.window, "localStorage", { configurable: true, value: storage });
    Object.defineProperties(dom.window.HTMLElement.prototype, {
      currentTime: { configurable: true, writable: true, value: 0 },
      readyState: { configurable: true, writable: true, value: 4 },
      paused: { configurable: true, writable: true, value: false },
      ended: { configurable: true, writable: true, value: false },
      buffered: { configurable: true, get() { return { length: 1, start: () => 0, end: () => this.currentTime + 5 }; } },
      play: { configurable: true, value() { this.paused = false; return Promise.resolve(); } },
      pause: { configurable: true, value() { this.paused = true; } },
      load: { configurable: true, value() {} },
      canPlayType: { configurable: true, value: () => "" }
    });
    expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    playback = vi.fn(async () => ({ url, expiresAt }));
    state.engines = [];
    state.platform = { session: { accessToken: "test-token" }, favorites: [], providerMode: "personal", providerScope: "line-a",
      personalProvider: { catalog: async () => [{ id: "channel-a", title: "ATV HD", groupTitle: "TR", personalRef: ref }],
        playback, shortEpg: async () => ({ status: "empty", programmes: [] }) } };
    container = document.getElementById("root")!;
    root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
  async function mount() {
    await settle(() => root.render(<LiveTvPage/>));
    await settle();
    expect(state.engines).toHaveLength(1);
    await progress();
  }

  it("restarts the same authorized HLS channel after a buffered stall with no further media events", async () => {
    await mount();
    await settle(() => video().dispatchEvent(new Event("stalled")));
    await tick(9_000);
    expect(container.textContent).not.toMatch(/Yayın (?:dengeleniyor|yenileniyor)/i);
    await tick(4_000);
    expect(state.engines).toHaveLength(2);
    expect(state.engines[0].destroyed).toBe(true);
    expect(state.engines[1].source).toBe(url);
    expect(playback.mock.calls.every(([value]) => value.id === "274")).toBe(true);
    expect(video().getAttribute("aria-label")).toBe("ATV HD canlı yayın");
  });

  it("leaves a manually paused stream alone", async () => {
    await mount();
    Object.defineProperty(video(), "paused", { value: true, configurable: true, writable: true });
    await tick(30_000);
    expect(state.engines).toHaveLength(1);
  });

  it("cancels recovery at the original three-hour access deadline", async () => {
    expiresAt = new Date(Date.now() + 10_000).toISOString();
    await mount();
    await tick(15_000);
    expect(state.engines).toHaveLength(1);
    expect(container.querySelector("video")).toBeNull();
  });

  it("extends and shortens a running engine deadline without replacing the engine", async () => {
    expiresAt = new Date(Date.now()+10000).toISOString(); await mount();
    const engine = state.engines[0];
    state.platform = {...state.platform, providerExpiresAt:new Date(Date.now()+30000).toISOString()};
    await settle(()=>root.render(<LiveTvPage/>));
    await tick(11000); await progress();
    expect(state.engines).toHaveLength(1); expect(engine.destroyed).toBe(false);
    expect(container.querySelector("video")).not.toBeNull();
    state.platform = {...state.platform, providerExpiresAt:new Date(Date.now()).toISOString()};
    await settle(()=>root.render(<LiveTvPage/>));
    expect(engine.destroyed).toBe(true); expect(container.querySelector("video")).toBeNull();
  });

  it("uses the latest extended cutoff when a later stall recreates its deadline", async () => {
    expiresAt=new Date(Date.now()+10000).toISOString();await mount();
    state.platform={...state.platform,providerExpiresAt:new Date(Date.now()+60000).toISOString()};
    await settle(()=>root.render(<LiveTvPage/>));
    await settle(()=>video().dispatchEvent(new Event("stalled")));
    await tick(13000);
    expect(state.engines).toHaveLength(2);expect(state.engines[1].destroyed).toBe(false);
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("cancels recovery when the account signs out", async () => {
    await mount();
    await tick(9_000);
    state.platform = { ...state.platform, session: null, personalProvider: null, providerMode: "legacy", providerScope: "" };
    await settle(() => root.render(<LiveTvPage/>));
    await tick(20_000);
    expect(state.engines).toHaveLength(1);
    expect(container.querySelector("video")).toBeNull();
  });

  it("coalesces watchdog ticks while personal playback authorization is pending", async () => {
    await mount();
    let resolve!: (value: { url: string; expiresAt: string }) => void;
    playback.mockImplementation(() => new Promise(done => { resolve = done; }));
    await tick(13_000);
    expect(playback).toHaveBeenCalledTimes(3);
    await tick(20_000);
    expect(playback).toHaveBeenCalledTimes(3);
    await settle(() => resolve({ url, expiresAt }));
    expect(state.engines).toHaveLength(2);
  });

  it("resets the retry budget after sustained healthy progress between independent interruptions", async () => {
    await mount();
    for (let interruption = 0; interruption < 4; interruption++) {
      for (let second = 0; second < 10; second++) { await progress(); await tick(1_000); }
      expect(container.querySelector("[data-reconnect-attempt]")?.getAttribute("data-reconnect-attempt")).toBe("0");
      await settle(() => state.engines.at(-1).networkError());
      await tick(4_100);
      await settle();
      expect(state.engines).toHaveLength(interruption + 2);
    }
  });
});
