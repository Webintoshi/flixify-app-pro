import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VodControls } from "./detail";
import type { Episode } from "./types";

const first: Episode = { id: "first", title: "Başlangıç", seasonNumber: 1, episodeNumber: 1, playbackAllowed: true };
const second: Episode = { id: "second", title: "Yolculuk", seasonNumber: 1, episodeNumber: 2, playbackAllowed: true };
const seasons = [{ seasonNumber: 1, title: "1. Sezon", episodes: [first, second] }];

describe("cinematic VOD episode navigation", () => {
  let root: Root;
  let container: HTMLElement;
  let focused: Element | null;
  const select = vi.fn();
  const back = vi.fn();
  const play = vi.fn();
  const pause = vi.fn();
  function Fixture() {
    const ref = useRef<HTMLVideoElement>(null);
    return <section><video ref={ref}/><VodControls videoRef={ref} title="Başlangıç" seriesTitle="Örnek Dizi" currentEpisode={first} seasons={seasons} onSelectEpisode={select} onBack={back}/></section>;
  }
  async function settle(action: () => void = () => {}) { await act(async () => { action(); }); }
  const click = (element: Element) => settle(() => element.dispatchEvent(new Event("click", { bubbles: true })));
  const opener = () => container.querySelector<HTMLButtonElement>("button[aria-label='Bölümler']")!;
  beforeEach(() => {
    const dom = parseHTML("<html><body><div id='root'></div></body></html>");
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    focused = document.body;
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => focused });
    const tracks = Object.assign([], { addEventListener() {}, removeEventListener() {} });
    Object.defineProperties(dom.window.HTMLElement.prototype, {
      paused: { configurable: true, writable: true, value: true },
      ended: { configurable: true, writable: true, value: false },
      muted: { configurable: true, writable: true, value: false },
      volume: { configurable: true, writable: true, value: 1 },
      currentTime: { configurable: true, writable: true, value: 12 },
      duration: { configurable: true, writable: true, value: 120 },
      playbackRate: { configurable: true, writable: true, value: 1 },
      textTracks: { configurable: true, value: tracks },
      focus: { configurable: true, value() { focused = this; } },
      play: { configurable: true, value() { play(); this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); } },
      pause: { configurable: true, value() { pause(); this.paused = true; this.dispatchEvent(new Event("pause")); } },
    });
    container = document.getElementById("root")!; root = createRoot(container);
    select.mockClear(); back.mockClear(); play.mockClear(); pause.mockClear();
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });

  it("Escape closes the episode panel, restores its opener and keeps the player open", async () => {
    await settle(() => root.render(<Fixture/>));
    opener().focus(); await click(opener());
    const panel = container.querySelector("aside")!;
    expect(panel).not.toBeNull();
    await settle(() => {
      const event = new Event("keydown", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "key", { value: "Escape" }); panel.dispatchEvent(event);
    });
    expect(container.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(opener());
    expect(back).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  });

  it("the panel close button returns keyboard focus without starting another media request", async () => {
    await settle(() => root.render(<Fixture/>)); await click(opener());
    const close = container.querySelector<HTMLButtonElement>("button[aria-label='Bölümleri kapat']")!;
    close.focus(); await click(close);
    expect(container.querySelector("aside")).toBeNull(); expect(document.activeElement).toBe(opener());
    expect(select).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
  });

  it("the actual selected episode still reaches the existing callback exactly once", async () => {
    await settle(() => root.render(<Fixture/>)); await click(opener());
    await click(container.querySelector<HTMLButtonElement>("button[aria-label^='1. sezon 2. bölüm']")!);
    expect(select).toHaveBeenCalledTimes(1); expect(select).toHaveBeenCalledWith(second);
    expect(container.querySelector("aside")).toBeNull();
  });
});
