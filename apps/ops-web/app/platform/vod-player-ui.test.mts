import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./detail.tsx", import.meta.url), "utf8");

test("VOD player only asks for a gesture when the browser blocks autoplay, while pause updates the controls", () => {
  assert.doesNotMatch(source, /Sesli oynatmayı başlat/);
  assert.match(source, /addEventListener\("pause"/);
  assert.doesNotMatch(source, /setInterval/);
  assert.match(source, /classifyVodPlayRejection\(cause, playback\.transport\)/);
  assert.match(source, /aria-label="Oynat"/);
});

test("browser VOD starts on the normal delivery without replacing every episode in the background", () => {
  assert.doesNotMatch(source, /compatibilityProbe=1/);
  assert.doesNotMatch(source, /prepareCompatibleAudio/);
  assert.match(source, /onDirectFailure=\{time => \{ void fallbackToProxy\(time\); \}\}/);
});

test("a requested compatibility stream remains active even if direct video plays late", () => {
  assert.doesNotMatch(source, /onDirectPlaying|directResumed/);
});

test("a resume position update does not reload an in-flight direct stream", () => {
  assert.match(source, /\}, \[playback\.url, playback\.transport, playback\.deliveryMode, retry\]\);/);
});

test("manual play errors reach the same fallback path as autoplay errors", () => {
  assert.match(source, /manualPlayFailureHandler\.current\(cause\)/);
});

test("a transient HLS play rejection stays retryable while other failures are surfaced", () => {
  assert.match(source, /case "retry": setNeedsPlayGesture\(true\)/);
  assert.match(source, /case "fail": fail\(\)/);
});

test("fatal HLS network and media errors are recovered before the player gives up", () => {
  assert.match(source, /data\.type === Hls\.ErrorTypes\.NETWORK_ERROR/);
  assert.match(source, /hls\.startLoad\(video\.currentTime/);
  assert.match(source, /data\.type === Hls\.ErrorTypes\.MEDIA_ERROR/);
  assert.match(source, /hls\.recoverMediaError\(\)/);
});

test("desktop Chrome uses hls.js while Safari and Apple mobile keep native HLS", () => {
  assert.match(source, /iPhone\|iPad\|iPod/);
  assert.match(source, /Chrome\|Chromium\|Edg\|OPR\|Android/);
  assert.match(source, /shouldUseNativeHls\(navigator\.userAgent, nativeHlsSupport\)/);
});
