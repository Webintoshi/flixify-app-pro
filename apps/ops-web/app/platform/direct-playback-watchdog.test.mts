import assert from "node:assert/strict";
import test from "node:test";
import * as policy from "./direct-playback-watchdog.ts";

type Watchdog = {
  loading: () => void;
  progress: () => void;
  playable: () => void;
  awaitingGesture: () => void;
  gestureAttempt: () => void;
  playing: () => void;
  waiting: () => void;
  error: () => void;
  dispose: () => void;
};

type PlayRejectionAction = "gesture" | "ignore" | "retry" | "fail";

function classifyPlayRejection(cause: unknown, transport: string): PlayRejectionAction {
  const classify = (policy as { classifyVodPlayRejection?: (cause: unknown, transport: string) => PlayRejectionAction }).classifyVodPlayRejection;
  assert.equal(typeof classify, "function", "play rejection policy must be available");
  return classify(cause, transport);
}

function createWatchdog(onFallback: () => void): Watchdog {
  const create = (policy as { createDirectPlaybackWatchdog?: (fallback: () => void) => Watchdog }).createDirectPlaybackWatchdog;
  assert.equal(typeof create, "function", "direct playback watchdog must be available");
  return create(onFallback);
}

test("direct playback with no media progress falls back after eight seconds", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(0) });
  let fallbacks = 0;
  const watchdog = createWatchdog(() => { fallbacks++; });
  watchdog.loading();
  t.mock.timers.tick(7_999);
  assert.equal(fallbacks, 0);
  t.mock.timers.tick(1);
  assert.equal(fallbacks, 1);
  watchdog.error();
  assert.equal(fallbacks, 1, "fallback must only start once");
  watchdog.dispose();
});

test("incoming media gets twelve seconds from load start", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(0) });
  let fallbacks = 0;
  const watchdog = createWatchdog(() => { fallbacks++; });
  watchdog.loading();
  t.mock.timers.tick(5_000);
  watchdog.progress();
  t.mock.timers.tick(6_999);
  assert.equal(fallbacks, 0, "media progress must avoid an eight second timeout");
  t.mock.timers.tick(1);
  assert.equal(fallbacks, 1);
  watchdog.dispose();
});

test("playable media and playback cancel the fallback deadline", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(0) });
  let fallbacks = 0;
  const watchdog = createWatchdog(() => { fallbacks++; });
  watchdog.loading();
  t.mock.timers.tick(5_000);
  watchdog.playable();
  watchdog.playing();
  t.mock.timers.tick(20_000);
  assert.equal(fallbacks, 0, "a playing stream must remain active");
  watchdog.dispose();
});

test("normal buffering after playback begins retains a twelve second grace period", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(0) });
  let fallbacks = 0;
  const watchdog = createWatchdog(() => { fallbacks++; });
  watchdog.loading();
  watchdog.playing();
  watchdog.waiting();
  t.mock.timers.tick(11_999);
  assert.equal(fallbacks, 0);
  watchdog.playable();
  t.mock.timers.tick(20_000);
  assert.equal(fallbacks, 0, "temporary buffering must not switch sources");
  watchdog.waiting();
  t.mock.timers.tick(12_000);
  assert.equal(fallbacks, 1);
  watchdog.dispose();
});

test("blocked autoplay never treats a missing user gesture as a stream failure", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(0) });
  let fallbacks = 0;
  const watchdog = createWatchdog(() => { fallbacks++; });
  watchdog.awaitingGesture();
  watchdog.loading();
  watchdog.waiting();
  t.mock.timers.tick(20_000);
  assert.equal(fallbacks, 0);
  watchdog.gestureAttempt();
  t.mock.timers.tick(8_000);
  assert.equal(fallbacks, 1, "a user-initiated retry must restart stream monitoring");
  watchdog.dispose();
});

test("media error falls back immediately and disposed players cannot fall back", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: new Date(0) });
  let fallbacks = 0;
  const watchdog = createWatchdog(() => { fallbacks++; });
  watchdog.loading();
  watchdog.error();
  assert.equal(fallbacks, 1);
  watchdog.dispose();
  t.mock.timers.tick(20_000);
  assert.equal(fallbacks, 1);
});

test("manual direct playback errors use fallback while autoplay policy errors request a gesture", () => {
  assert.equal(classifyPlayRejection(new DOMException("unsupported", "NotSupportedError"), "file"), "fail");
  assert.equal(classifyPlayRejection(new DOMException("blocked", "NotAllowedError"), "file"), "gesture");
  assert.equal(classifyPlayRejection(new DOMException("interrupted", "AbortError"), "file"), "ignore");
  assert.equal(classifyPlayRejection(new Error("HLS retry"), "hls"), "retry");
});
