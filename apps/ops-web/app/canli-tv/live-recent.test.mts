import assert from "node:assert/strict";
import test from "node:test";
import { parseRecentChannelIds, recentStorageKey, rememberRecentChannel } from "./live-recent.ts";

test("a recently watched channel moves to the front without duplicates", () => {
  assert.deepEqual(rememberRecentChannel(["trt", "atv", "show"], "atv"), ["atv", "trt", "show"]);
});

test("recent history keeps at most twenty channel ids", () => {
  const old = Array.from({ length: 20 }, (_, index) => `channel-${index}`);
  assert.deepEqual(rememberRecentChannel(old, "new-channel"), ["new-channel", ...old.slice(0, 19)]);
});

test("malformed recent history is ignored instead of breaking the page", () => {
  assert.deepEqual(parseRecentChannelIds("not json"), []);
  assert.deepEqual(parseRecentChannelIds('["trt",7,"trt","atv"]'), ["trt", "atv"]);
});

test("recent history follows the account across refreshed access tokens", () => {
  assert.equal(recentStorageKey("MYACCOUNT1234567", "old-token"), recentStorageKey("MYACCOUNT1234567", "new-token"));
  assert.notEqual(recentStorageKey("MYACCOUNT1234567", "old-token"), recentStorageKey("OTHERACCOUNT1234", "old-token"));
});
