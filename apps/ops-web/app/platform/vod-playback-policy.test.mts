import assert from "node:assert/strict";
import test from "node:test";
import { shouldAdoptCompatibilityPlayback } from "./vod-playback-policy.ts";

test("direct browser VOD adopts an HLS compatibility result but keeps safe direct playback", () => {
  assert.equal(shouldAdoptCompatibilityPlayback("direct_provider", "hls_transcoded"), true);
  assert.equal(shouldAdoptCompatibilityPlayback("direct_provider", "file_proxy"), false);
  assert.equal(shouldAdoptCompatibilityPlayback("hls_transcoded", "hls_transcoded"), false);
});
