import assert from "node:assert/strict";
import test from "node:test";
import * as policy from "./direct-playback-attempt.ts";

type Attempt = {
  initialQuery: (key: string) => string;
  beginFallback: (key: string) => AbortController;
  canAdopt: (controller: AbortController) => boolean;
  finish: (controller: AbortController) => void;
  cancel: () => void;
};

function createAttempt(): Attempt {
  const create = (policy as { createDirectPlaybackAttempt?: () => Attempt }).createDirectPlaybackAttempt;
  assert.equal(typeof create, "function", "direct playback attempt must be available");
  return create();
}

test("a failed episode bypasses the same direct URL on its next attempt", () => {
  const attempt = createAttempt();
  assert.equal(attempt.initialQuery("episode:one"), "vodDirect=1");
  const fallback = attempt.beginFallback("episode:one");
  assert.equal(attempt.initialQuery("episode:one"), "direct=0");
  assert.equal(attempt.initialQuery("episode:two"), "vodDirect=1");
  assert.equal(attempt.canAdopt(fallback), true);
  attempt.finish(fallback);
  assert.equal(attempt.initialQuery("episode:one"), "direct=0");
});

test("a pending compatibility playback remains adoptable until it resolves", () => {
  const attempt = createAttempt();
  const fallback = attempt.beginFallback("movie:one");
  assert.equal(fallback.signal.aborted, false);
  assert.equal(attempt.canAdopt(fallback), true);
  attempt.finish(fallback);
  assert.equal(fallback.signal.aborted, false);
  assert.equal(attempt.initialQuery("movie:one"), "direct=0");
});

test("changing selection aborts the previous compatibility request", () => {
  const attempt = createAttempt();
  const fallback = attempt.beginFallback("episode:one");
  attempt.cancel();
  assert.equal(fallback.signal.aborted, true);
  assert.equal(attempt.canAdopt(fallback), false);
  assert.equal(attempt.initialQuery("episode:one"), "direct=0");
});
