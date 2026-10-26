import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerChrome } from "./player-chrome";

describe("live player control visibility", () => {
  let root: Root;
  let container: HTMLElement;
  let focused: Element | null;
  function Player({ kind = "live" }: { kind?: "live" | "vod" }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    return <section data-surface><div><video ref={videoRef}/><PlayerChrome videoRef={videoRef} kind={kind} title="Test channel"/></div></section>;
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
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => focused });
    Object.defineProperties(dom.window.HTMLElement.prototype, {
      paused: { configurable: true, writable: true, value: false },
      muted: { configurable: true, writable: true, value: false },
      volume: { configurable: true, writable: true, value: 1 },
      currentTime: { configurable: true, writable: true, value: 10 },
      duration: { configurable: true, writable: true, value: 120 },
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
});
