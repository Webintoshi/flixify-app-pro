import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveTvPage from "./page";

const state = vi.hoisted(() => ({ platform: {} as any }));
vi.mock("../platform/session", () => ({ usePlatform: () => state.platform, useProviderExpiry: () => state.platform.providerExpiresAt }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: (props: any) => React.createElement("a", props) }));

describe("live directory presentation and player tools", () => {
  let root: Root;
  let container: HTMLElement;
  let playback: ReturnType<typeof vi.fn>;
  let shortEpg: ReturnType<typeof vi.fn>;
  let toggle: ReturnType<typeof vi.fn>;
  let starts: number;
  const ref = { source: "personal", sourceVersion: "fixture-line", kind: "live", id: "101", extension: "mp4" };
  const source = "https://fixture.invalid/101.mp4";
  const channel = { id: "fixture-channel", title: "TR | Fixture Haber", groupTitle: "TR-GENEL", posterUrl: "/fixture-logo.png", personalRef: ref };
  const second = { ...channel, id: "fixture-second", title: "TR | Fixture Sinema", personalRef: { ...ref, id: "102" } };
  async function settle(action: () => void = () => {}) { await act(async () => { action(); await vi.dynamicImportSettled(); }); }
  const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(value => value.textContent?.includes(label))!;
  const guideSection = () => container.querySelector<HTMLElement>("section[aria-label='Yayın akışı']")!;
  async function select() { await settle(() => button("Fixture Haber").click()); await settle(); }
  beforeEach(() => {
    vi.useFakeTimers();
    const dom = parseHTML("<html><body><div id='root'></div></body></html>");
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const memory = new Map<string, string>();
    Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } });
    starts = 0;
    Object.defineProperties(dom.window.HTMLElement.prototype, {
      currentTime: { configurable: true, writable: true, value: 0 },
      src: { configurable: true, get() { return this.getAttribute("src") ?? ""; }, set(value: string) { this.setAttribute("src", value); } },
      readyState: { configurable: true, writable: true, value: 4 },
      paused: { configurable: true, writable: true, value: false },
      ended: { configurable: true, writable: true, value: false },
      muted: { configurable: true, writable: true, value: false },
      volume: { configurable: true, writable: true, value: 1 },
      buffered: { configurable: true, get() { return { length: 1, start: () => 0, end: () => this.currentTime + 5 }; } },
      play: { configurable: true, value() { starts++; this.paused = false; return Promise.resolve(); } },
      pause: { configurable: true, value() { this.paused = true; } },
      load: { configurable: true, value() { this.currentTime = 0; } },
      canPlayType: { configurable: true, value: () => "" }
    });
    const expiry = new Date(Date.now() + 3600000).toISOString();
    playback = vi.fn(async () => ({ url: source, expiresAt: expiry }));
    shortEpg = vi.fn(async () => ({ status: "empty", programmes: [] }));
    toggle = vi.fn();
    state.platform = { session: { accessToken: "fixture-token" }, favorites: [{ ...channel, kind: "live" }], favoritesReady: true, pending: new Set(), toggle, providerMode: "personal", providerScope: "fixture-line", providerExpiresAt: expiry,
      personalProvider: { catalog: async () => [channel, second], playback, shortEpg } };
    container = document.getElementById("root")!; root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("keeps favorite ownership in the player and tabs filtering the same catalog", async () => {
    await settle(() => root.render(<LiveTvPage/>)); await settle();
    expect(container.querySelectorAll("button[aria-label*='favoriler']")).toHaveLength(0);
    await select();
    const saved = container.querySelector<HTMLButtonElement>("button[aria-label*='favorilerden çıkar']")!;
    expect(saved).not.toBeNull(); expect(saved.closest("[aria-label$='oynatıcı kontrolleri']")).not.toBeNull();
    expect(container.querySelectorAll("button[aria-label*='favoriler']")).toHaveLength(1);
    await settle(() => saved.click());
    expect(toggle).toHaveBeenCalledOnce();
    expect(toggle.mock.calls[0][0].personalRef).toEqual(ref);
    await settle(() => button("Favorilerim").click());
    const list = container.querySelector("[aria-label='Canlı kanallar']")!;
    expect(list.textContent).toContain("Fixture Haber"); expect(list.textContent).not.toContain("Fixture Sinema");
    expect(playback).toHaveBeenCalledOnce(); expect(starts).toBe(1);
  });

  it("previews three actual programmes and opens the full supplied guide without another stream or request", async () => {
    const now = Date.now();
    const programmes = Array.from({ length: 5 }, (_, index) => ({ title: `Fixture programme ${index}`, description: "", start: now - 1000 + index * 60000, end: now + (index + 1) * 60000 }));
    shortEpg.mockResolvedValue({ status: "ready", programmes });
    await settle(() => root.render(<LiveTvPage/>)); await settle(); await select();
    expect(guideSection().querySelectorAll("article")).toHaveLength(3);
    expect(guideSection().textContent).toContain("Fixture programme 0");
    expect(guideSection().querySelector("[role='progressbar']")).not.toBeNull();
    const epgReads = shortEpg.mock.calls.length;
    await settle(() => container.querySelector<HTMLButtonElement>("button[aria-label='Yayın akışı']")!.click());
    const dialog = container.querySelector("[role='dialog']")!;
    expect(dialog.querySelectorAll("article")).toHaveLength(5);
    expect(dialog.textContent).toContain("Fixture programme 4");
    expect(shortEpg).toHaveBeenCalledTimes(epgReads); expect(playback).toHaveBeenCalledOnce(); expect(starts).toBe(1);
    expect(container.querySelector("input[aria-label='İlerleme']")).toBeNull();
  });

  it("shows EPG failures and empty results honestly and retries only its existing metadata owner", async () => {
    shortEpg.mockResolvedValue({ status: "error", programmes: [], error: "Program bilgisi alınamadı" });
    await settle(() => root.render(<LiveTvPage/>)); await settle(); await select();
    const video = container.querySelector("video");
    expect(guideSection().querySelector("[role='alert']")?.textContent).toContain("Program bilgisi alınamadı");
    const epgReads = shortEpg.mock.calls.length;
    shortEpg.mockResolvedValue({ status: "empty", programmes: [] });
    await settle(() => guideSection().querySelector<HTMLButtonElement>("button")!.click());
    expect(guideSection().textContent).toContain("Bu kanal için program bilgisi bulunmuyor.");
    expect(shortEpg).toHaveBeenCalledTimes(epgReads + 1); expect(playback).toHaveBeenCalledOnce(); expect(starts).toBe(1);
    expect(container.querySelector("video")).toBe(video);
  });
});
