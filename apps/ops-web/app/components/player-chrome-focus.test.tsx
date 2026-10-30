import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerChrome } from "./player-chrome";

describe("live player control visibility", () => {
  let root: Root;
  let container: HTMLElement;
  let focused: Element | null;
  let focusCalls: Array<{ element: Element; options?: FocusOptions }>;
  function Player({ kind = "live", guide = false, favorite }: { kind?: "live" | "vod"; guide?: boolean; favorite?: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    return <section data-surface><div><video ref={videoRef}/><PlayerChrome videoRef={videoRef} kind={kind} title="Test channel" actions={favorite ? <button type="button" aria-label="Test kanalı: favorilere ekle" onClick={favorite}>Favori</button> : undefined} guide={guide ? <p>Fixture programme from supplied EPG</p> : undefined}/></div></section>;
  }
  async function settle(action: () => void = () => {}) { await act(async () => { action(); }); }
  async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
  const controls = () => container.querySelector("[role='group']")!;
  const surface = () => container.querySelector("[data-surface]")!;
  const fullscreenButton = () => container.querySelector<HTMLButtonElement>("button[aria-label^='Tam ekran']")!;
  const visible = () => controls().getAttribute("data-visible");
  function focus(element: Element) {
    const previous = focused;
    focused = element;
    previous?.dispatchEvent(new Event("focusout", { bubbles: true }));
    element.dispatchEvent(new Event("focusin", { bubbles: true }));
  }
  function keyboard(key: string) {
    const event = new Event("keydown", { bubbles: true });
    Object.defineProperty(event, "key", { value: key });
    (focused ?? document).dispatchEvent(event);
  }
  beforeEach(() => {
    vi.useFakeTimers();
    const dom = parseHTML("<html><body><div id='root'></div><button id='outside'>Outside</button></body></html>");
    vi.stubGlobal("window", dom.window); vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("Event", dom.window.Event); vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    focused = document.body;
    focusCalls = [];
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => focused });
    Object.defineProperties(dom.window.HTMLElement.prototype, {
      paused: { configurable: true, writable: true, value: false },
      muted: { configurable: true, writable: true, value: false },
      volume: { configurable: true, writable: true, value: 1 },
      currentTime: { configurable: true, writable: true, value: 10 },
      duration: { configurable: true, writable: true, value: 120 },
      focus: { configurable: true, value(options?: FocusOptions) { focusCalls.push({ element: this, options }); focus(this); } },
      play: { configurable: true, value() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); } },
      pause: { configurable: true, value() { this.paused = true; this.dispatchEvent(new Event("pause")); } },
      requestFullscreen: { configurable: true, value() {
        Object.defineProperty(document, "fullscreenElement", { configurable: true, value: this });
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      } }
    });
    container = document.getElementById("root")!;
    root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("hides two seconds after a pointer fullscreen click even while its button keeps focus", async () => {
    await settle(() => root.render(<Player/>));
    const button = fullscreenButton();
    await settle(() => {
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      focus(button);
      button.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(button.getAttribute("aria-label")).toBe("Tam ekrandan çık");
    expect(document.activeElement).toBe(button);
    await tick(1999); expect(visible()).toBe("true");
    await tick(1); expect(visible()).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it.each(["pointermove", "touchstart"])("reveals hidden controls on %s and starts a fresh two-second timeout", async event => {
    await settle(() => root.render(<Player/>));
    await tick(2500); expect(visible()).toBe("false");
    await settle(() => surface().dispatchEvent(new Event(event, { bubbles: true })));
    expect(visible()).toBe("true");
    await tick(1999); expect(visible()).toBe("true");
    await tick(1); expect(visible()).toBe("false");
  });

  it("restarts the idle timeout when asynchronous fullscreen entry completes", async () => {
    await settle(() => root.render(<Player/>));
    await tick(1500);
    await settle(() => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: container.querySelector("video")!.parentElement });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    await tick(1999); expect(visible()).toBe("true");
    await tick(1); expect(visible()).toBe("false");
  });

  it("keeps keyboard-focused controls visible until focus leaves the player", async () => {
    await settle(() => root.render(<Player/>));
    await settle(() => { keyboard("Tab"); focus(fullscreenButton()); });
    await tick(6000); expect(visible()).toBe("true");
    await settle(() => focus(document.getElementById("outside")!));
    await tick(2000); expect(visible()).toBe("false");
  });

  it("lets pointer interaction release a previous keyboard focus hold", async () => {
    await settle(() => root.render(<Player/>));
    await settle(() => { keyboard("Tab"); focus(fullscreenButton()); });
    await tick(6000); expect(visible()).toBe("true");
    await settle(() => fullscreenButton().dispatchEvent(new Event("pointerdown", { bubbles: true })));
    await tick(2000); expect(visible()).toBe("false");
  });

  it("lets mouse movement release a previous keyboard focus hold without another click", async () => {
    await settle(() => root.render(<Player/>));
    await settle(() => { keyboard("Tab"); focus(fullscreenButton()); });
    await tick(6000); expect(visible()).toBe("true");
    await settle(() => surface().dispatchEvent(new Event("pointermove", { bubbles: true })));
    await tick(1999); expect(visible()).toBe("true");
    await tick(1); expect(visible()).toBe("false");
  });

  it("keeps VOD controls visible", async () => {
    await settle(() => root.render(<Player kind="vod"/>));
    await tick(6000);
    expect(visible()).toBe("true");
    expect(container.querySelector("input[aria-label='İlerleme']")).not.toBeNull();
  });

  it("holds an open guide for reading and hides two seconds after a pointer close", async () => {
    await settle(() => root.render(<Player guide/>));
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-label='Yayın akışı']");
    expect(trigger).not.toBeNull();
    await settle(() => { trigger!.dispatchEvent(new Event("pointerdown", { bubbles: true })); trigger!.click(); });
    const dialog = container.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain("Fixture programme from supplied EPG");
    expect(focusCalls.at(-1)?.options).toEqual({ preventScroll: true });
    await tick(10000); expect(visible()).toBe("true");
    expect(container.querySelector("input[aria-label='İlerleme']")).toBeNull();
    await settle(() => container.querySelector<HTMLButtonElement>("button[aria-label='Yayın akışını kapat']")!.click());
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(focusCalls.at(-1)).toEqual({ element: trigger, options: { preventScroll: true } });
    await tick(1999); expect(visible()).toBe("true");
    await tick(1); expect(visible()).toBe("false");
  });

  it("closes guide with Escape and restores keyboard focus to its owner", async () => {
    await settle(() => root.render(<Player guide/>));
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-label='Yayın akışı']");
    expect(trigger).not.toBeNull();
    await settle(() => { keyboard("Tab"); focus(trigger!); trigger!.click(); });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Yayın akışını kapat");
    await settle(() => keyboard("Escape"));
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await tick(6000); expect(visible()).toBe("true");
  });

  it("hosts the existing favorite action and preserves playback, volume and fullscreen controls", async () => {
    const favorite = vi.fn();
    await settle(() => root.render(<Player favorite={favorite}/>));
    const saved = container.querySelector<HTMLButtonElement>("button[aria-label='Test kanalı: favorilere ekle']");
    expect(saved).not.toBeNull();
    await settle(() => saved!.click()); expect(favorite).toHaveBeenCalledOnce();
    await settle(() => container.querySelector<HTMLButtonElement>("button[aria-label='Duraklat']")!.click());
    expect(container.querySelector("video")!.paused).toBe(true);
    await settle(() => container.querySelector<HTMLButtonElement>("button[aria-label='Oynat']")!.click());
    expect(container.querySelector("video")!.paused).toBe(false);
    expect(container.querySelector("input[aria-label='Ses düzeyi']")).not.toBeNull();
    expect(fullscreenButton()).not.toBeNull();
    expect(container.querySelector("input[aria-label='İlerleme']")).toBeNull();
  });
});
