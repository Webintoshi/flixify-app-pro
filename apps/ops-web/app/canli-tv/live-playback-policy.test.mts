import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveReleaseUrl,
  createHlsPlaybackConfig,
  createMpegTsConfig,
  createLivePlaybackRelease,
  createSafeCleanup,
  findLowerBandwidthVariant,
  getRelayFallbackDelay,
  getReconnectDelay,
  getTransportRecoveryReason,
  nextAudioMode,
  primeLivePlayback,
  safeLivePlayerError,
  shouldStartWithAudioRelay,
  shouldStartWithVideoRepair,
  shouldTryLowerBandwidthVariant,
  shouldRequestRelayAudioFallback,
  shouldRequestRelayTransportFallback,
  shouldRequestVideoTranscodeFallback,
  shouldUseNativeHls
} from "./live-playback-policy.ts";

test("a stalled 4K channel selects its playable HD sibling, not a different channel", () => {
  const selected = { id: "atv-4k", title: "TR • ATV 4K", variantGroupKey: "atv", playbackAllowed: true };
  const channels = [
    selected,
    { id: "atv-fhd", title: "TR • ATV FHD", variantGroupKey: "atv", playbackAllowed: true },
    { id: "atv-hd", title: "TR • Atv HD", variantGroupKey: "atv", playbackAllowed: true },
    { id: "other-hd", title: "TR • TRT 1 HD", variantGroupKey: "trt 1", playbackAllowed: true }
  ];
  assert.equal(findLowerBandwidthVariant(channels, selected)?.id, "atv-hd");
});

test("quality recovery never switches to an unavailable or higher-bitrate stream", () => {
  const selected = { id: "hd", title: "TR • Kanal 7 HD", variantGroupKey: "kanal 7", playbackAllowed: true };
  const channels = [
    selected,
    { id: "sd", title: "TR • Kanal 7 SD", variantGroupKey: "kanal 7", playbackAllowed: false },
    { id: "fhd", title: "TR • Kanal 7 FHD", variantGroupKey: "kanal 7", playbackAllowed: true },
    { id: "4k", title: "TR • Kanal 7 4K", variantGroupKey: "kanal 7", playbackAllowed: true }
  ];
  assert.equal(findLowerBandwidthVariant(channels, selected), null);
});

test("normal startup buffering does not prematurely replace a 4K channel", () => {
  assert.equal(shouldTryLowerBandwidthVariant("startup_failure", 0), false);
  assert.equal(shouldTryLowerBandwidthVariant("buffering", 0), false);
  assert.equal(shouldTryLowerBandwidthVariant("startup_failure", 1), true);
  assert.equal(shouldTryLowerBandwidthVariant("repeated_transport_error", 1), true);
});

test("live startup asks the player to play immediately instead of waiting behind a canplay gate", async () => {
  let playCalls = 0;
  const media = {
    readyState: 0,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    currentTime: 0,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };
  const controller = new AbortController();

  await primeLivePlayback(media, () => { playCalls += 1; }, controller.signal);

  assert.equal(playCalls, 1);
});

test("an autoplay-policy rejection leaves manual play usable instead of starting a reconnect loop", async () => {
  const media = {
    readyState: 0,
    buffered: { length: 0, start: () => 0, end: () => 0 },
    currentTime: 0,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  };

  await assert.doesNotReject(() => primeLivePlayback(
    media,
    () => Promise.reject(new DOMException("User gesture required", "NotAllowedError")),
    new AbortController().signal
  ));
});

test("only known malformed live channels start with the shared video repair relay", () => {
  assert.equal(shouldStartWithVideoRepair("TRT 4K"), false);
  assert.equal(shouldStartWithVideoRepair("KANAL 7 4K"), true);
  assert.equal(shouldStartWithVideoRepair("Euro Star"), true);
  assert.equal(shouldStartWithVideoRepair("Kanal 7 Avrupa"), true);
  assert.equal(shouldStartWithVideoRepair("TR • Euro Star"), true);
  assert.equal(shouldStartWithVideoRepair("ATV 4K"), false);
  assert.equal(shouldStartWithVideoRepair("Star Tv FHD"), false);
});

test("true 4K TRT starts with the lightweight shared audio relay", () => {
  assert.equal(shouldStartWithAudioRelay("TRT 4K"), true);
  assert.equal(shouldStartWithAudioRelay("TR • TRT 4K"), true);
  assert.equal(shouldStartWithAudioRelay("TRT 1 4K"), false);
  assert.equal(shouldStartWithAudioRelay("Euro Star"), false);
});

test("relay playback URLs produce a credential-free release endpoint", () => {
  assert.equal(
    buildLiveReleaseUrl("https://api.flixify.vip/live/playback/session-1/master.m3u8?token=viewer-token"),
    "https://api.flixify.vip/live/playback/session-1/release?token=viewer-token"
  );
  assert.equal(
    buildLiveReleaseUrl("https://provider.example/live/account/password/channel.ts"),
    null
  );
});

test("direct provider never gains Flixify-only transcode or silent video mode", () => {
  assert.equal(nextAudioMode("direct_provider", "direct"), null);
  assert.equal(nextAudioMode("direct_provider", "transcoded"), null);
});

test("direct-provider audio keeps the current stream without a relay fallback", () => {
  assert.equal(shouldRequestRelayAudioFallback("direct_provider", "direct"), false);
  assert.equal(shouldRequestRelayAudioFallback("file_proxy", "direct"), false);
  assert.equal(shouldRequestRelayAudioFallback("direct_provider", "transcoded"), false);
});

test("transport reason is tracked while direct-provider relay fallback stays disabled", () => {
  assert.equal(getTransportRecoveryReason(false, 0), "startup_failure");
  assert.equal(getTransportRecoveryReason(true, 0), "buffering");
  assert.equal(getTransportRecoveryReason(true, 1), "repeated_transport_error");
  assert.equal(shouldRequestRelayTransportFallback("direct_provider", false, "unsupported_audio"), false);
  assert.equal(shouldRequestRelayTransportFallback("direct_provider", false, "buffering"), false);
  assert.equal(shouldRequestRelayTransportFallback("direct_provider", false, "startup_failure"), false);
  assert.equal(shouldRequestRelayTransportFallback("direct_provider", false, "repeated_transport_error"), false);
  assert.equal(shouldRequestRelayTransportFallback("direct_provider", true, "unsupported_audio"), false);
  assert.equal(shouldRequestRelayTransportFallback("hls_transcoded", false, "unsupported_audio"), false);
});

test("direct TS playback keeps a jitter margin and retries without a long freeze", () => {
  const config = createMpegTsConfig();
  assert.equal(config.liveSyncMaxLatency, 12);
  assert.equal(config.liveSyncTargetLatency, 8);
  assert.equal(config.liveSyncPlaybackRate, 1.01);
  assert.deepEqual([0, 1, 2, 3].map(getReconnectDelay), [4_000, 6_000, 10_000, null]);
});

test("direct-provider fallback allows the single upstream socket to close before opening the relay", () => {
  assert.equal(getRelayFallbackDelay("direct_provider"), 800);
  assert.equal(getRelayFallbackDelay("hls_transcoded"), 0);
});

test("player cleanup is idempotent and continues after one cleanup step fails", () => {
  const calls: string[] = [];
  const cleanup = createSafeCleanup([
    () => calls.push("abort"),
    () => { calls.push("unload"); throw new Error("already unloaded"); },
    () => calls.push("destroy")
  ]);

  cleanup();
  cleanup();

  assert.deepEqual(calls, ["abort", "unload", "destroy"]);
});

test("existing relayed modes retain audio fallback order", () => {
  assert.equal(nextAudioMode("file_proxy", "direct"), "transcoded");
  assert.equal(nextAudioMode("file_proxy", "transcoded"), "video-only");
  assert.equal(nextAudioMode("file_proxy", "video-only"), null);
});

test("direct provider errors cannot reveal a credential-bearing URL", () => {
  assert.equal(
    safeLivePlayerError("direct_provider", new Error("https://sifiriptvdns.com:2087/live/a/b/283.ts")),
    "Doğrudan yayın bağlantısı kurulamadı. Tekrar deneyin."
  );
});

test("Chrome relays use hls.js while native-only clients keep native HLS", () => {
  assert.equal(shouldUseNativeHls("hls_transcoded", true, true), false);
  assert.equal(shouldUseNativeHls("direct_provider", true, true), true);
  assert.equal(shouldUseNativeHls("hls_transcoded", true, false), true);
  assert.equal(shouldUseNativeHls("hls_transcoded", false, true), false);
});

test("page exit releases a live relay once and falls back when beacon is unavailable", async () => {
  const beaconCalls: string[] = [];
  const fetchCalls: string[] = [];
  const release = createLivePlaybackRelease(
    "https://api.flixify.vip/live/playback/session-1/release?token=viewer-token",
    (url) => { beaconCalls.push(url); return false; },
    async (url) => { fetchCalls.push(url); }
  );

  release();
  release();
  await Promise.resolve();

  assert.deepEqual(beaconCalls, ["https://api.flixify.vip/live/playback/session-1/release?token=viewer-token"]);
  assert.deepEqual(fetchCalls, ["https://api.flixify.vip/live/playback/session-1/release?token=viewer-token"]);
});

test("browser relay never escalates a stall to CPU-heavy full video transcoding", () => {
  const audioRelay = "https://api.flixify.vip/live/playback/session-1/master.m3u8?token=viewer-token";
  const videoRelay = `${audioRelay}&flixify_video=h264`;

  assert.equal(shouldRequestVideoTranscodeFallback("hls_transcoded", audioRelay, 12, false), false);
  assert.equal(shouldRequestVideoTranscodeFallback("hls_transcoded", audioRelay, 0, false), false);
  assert.equal(shouldRequestVideoTranscodeFallback("hls_transcoded", videoRelay, 12, false), false);
  assert.equal(shouldRequestVideoTranscodeFallback("direct_provider", audioRelay, 12, false), false);
  assert.equal(shouldRequestVideoTranscodeFallback("hls_transcoded", audioRelay, 12, true), false);
});

test("standard HLS recovery keeps a larger buffer and avoids aggressive low-latency churn", () => {
  assert.deepEqual(createHlsPlaybackConfig(), {
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 30,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    maxLiveSyncPlaybackRate: 1.05,
    fragLoadingMaxRetry: 6,
    manifestLoadingMaxRetry: 6
  });
});
