import assert from "node:assert/strict";
import test from "node:test";
import { clampSeekTime, formatPlayerTime, playableDuration, shouldHidePlayerChrome } from "./player-chrome-policy.ts";

test("VOD time labels stay readable for minutes, hours, and unknown time", () => {
  assert.equal(formatPlayerTime(0), "0:00");
  assert.equal(formatPlayerTime(65), "1:05");
  assert.equal(formatPlayerTime(3661), "1:01:01");
  assert.equal(formatPlayerTime(Number.NaN), "0:00");
});

test("seek controls accept only finite, positive VOD durations", () => {
  assert.equal(playableDuration(120), 120);
  assert.equal(playableDuration(0), null);
  assert.equal(playableDuration(Number.POSITIVE_INFINITY), null);
  assert.equal(playableDuration(Number.NaN), null);
});

test("seeking clamps progress inside the available movie", () => {
  assert.equal(clampSeekTime(-10, 120), 0);
  assert.equal(clampSeekTime(45, 120), 45);
  assert.equal(clampSeekTime(200, 120), 120);
});

test("live controls hide after 2.5 seconds of inactivity", () => {
  assert.equal(shouldHidePlayerChrome("live", 2499, false), false);
  assert.equal(shouldHidePlayerChrome("live", 2500, false), true);
});

test("focused controls remain accessible and VOD controls remain visible", () => {
  assert.equal(shouldHidePlayerChrome("live", 3000, true), false);
  assert.equal(shouldHidePlayerChrome("vod", 3000, false), false);
});
