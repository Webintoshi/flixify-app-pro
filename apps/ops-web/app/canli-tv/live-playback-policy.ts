export type MpegTsPlaybackConfig = {
  enableWorker: boolean;
  enableStashBuffer: boolean;
  stashInitialSize: number;
  lazyLoad: boolean;
  autoCleanupSourceBuffer: boolean;
  autoCleanupMaxBackwardDuration: number;
  autoCleanupMinBackwardDuration: number;
  liveBufferLatencyChasing: boolean;
  liveBufferLatencyMaxLatency: number;
  liveBufferLatencyMinRemain: number;
  liveSync: boolean;
  liveSyncMaxLatency: number;
  liveSyncTargetLatency: number;
  liveSyncPlaybackRate: number;
};

export type PlaybackMode = "direct" | "transcoded" | "video-only";

type QualityVariant = {
  id: string;
  title: string;
  variantGroupKey?: string | null;
  playbackAllowed: boolean;
};

function bandwidthTier(title: string): number | null {
  if (/\b(?:4k|uhd|2160p)\b/i.test(title)) return 4;
  if (/\b(?:fhd|full\s*hd|1080p)\b/i.test(title)) return 3;
  if (/\b(?:hd|720p)\b/i.test(title)) return 2;
  if (/\b(?:sd|480p)\b/i.test(title)) return 1;
  return null;
}

export function findLowerBandwidthVariant<T extends QualityVariant>(channels: readonly T[], selected: T): T | null {
  const group = selected.variantGroupKey?.trim().toLocaleLowerCase("tr-TR");
  const currentTier = bandwidthTier(selected.title);
  if (!group || currentTier === null || currentTier <= 1) return null;

  return channels
    .filter((channel) =>
      channel.id !== selected.id &&
      channel.playbackAllowed &&
      channel.variantGroupKey?.trim().toLocaleLowerCase("tr-TR") === group &&
      bandwidthTier(channel.title) !== null &&
      bandwidthTier(channel.title)! < currentTier
    )
    .sort((left, right) => bandwidthTier(left.title)! - bandwidthTier(right.title)!)[0] ?? null;
}

export function nextAudioMode(deliveryMode: string | undefined, current: PlaybackMode): PlaybackMode | null {
  if (deliveryMode === "direct_provider") return null;
  return current === "direct" ? "transcoded" : current === "transcoded" ? "video-only" : null;
}

export function shouldRequestRelayAudioFallback(
  _deliveryMode: string | undefined,
  _current: PlaybackMode
): boolean {
  return false;
}

export function shouldRequestRelayTransportFallback(
  _deliveryMode: string | undefined,
  _alreadyStarted: boolean,
  _reason: TransportRecoveryReason | "unsupported_audio"
): boolean {
  return false;
}

export function getBrowserLivePlaybackQuery(_title: string): string {
  return "clientRuntime=browser&preferRelay=false";
}

export type TransportRecoveryReason = "buffering" | "startup_failure" | "repeated_transport_error";

export function getTransportRecoveryReason(hasProgressed: boolean, attempt: number): TransportRecoveryReason {
  if (!hasProgressed) return "startup_failure";
  return attempt > 0 ? "repeated_transport_error" : "buffering";
}

export function shouldTryLowerBandwidthVariant(reason: TransportRecoveryReason, attempt: number): boolean {
  return reason === "repeated_transport_error" || (reason === "startup_failure" && attempt > 0);
}

export function getRelayFallbackDelay(deliveryMode: string | undefined): number {
  return deliveryMode === "direct_provider" ? 800 : 0;
}

export function shouldUseNativeHls(
  deliveryMode: string | undefined,
  canPlayNativeHls: boolean,
  hlsJsSupported: boolean
): boolean {
  return canPlayNativeHls && (deliveryMode === "direct_provider" || !hlsJsSupported);
}

export function shouldRequestVideoTranscodeFallback(
  _deliveryMode: string | undefined,
  _sourceUrl: string,
  _currentTime: number,
  _alreadyStarted: boolean
): boolean {
  // Full browser-side recovery transcodes every video frame and can saturate the
  // shared host when multiple viewers hit the same problematic channel. Keep
  // the lightweight AAC relay, but never escalate a stall to full H.264 here.
  return false;
}

const VIDEO_REPAIR_CHANNELS = new Set([
  "kanal 7 4k",
  "euro star",
  "kanal 7 avrupa"
]);

function normalizeChannelTitle(title: string): string {
  return title
    .toLocaleLowerCase("tr-TR")
    .replace(/[•·]/g, " ")
    .replace(/^tr\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function shouldStartWithVideoRepair(title: string): boolean {
  return VIDEO_REPAIR_CHANNELS.has(normalizeChannelTitle(title));
}

export function shouldStartWithAudioRelay(title: string): boolean {
  return normalizeChannelTitle(title) === "trt 4k";
}

export function createHlsPlaybackConfig() {
  return {
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 30,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 8,
    maxLiveSyncPlaybackRate: 1.05,
    fragLoadingMaxRetry: 6,
    manifestLoadingMaxRetry: 6
  } as const;
}

export function createSafeCleanup(steps: ReadonlyArray<() => void>): () => void {
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const step of steps) {
      try {
        step();
      } catch {
        // Cleanup is best-effort; one already-disposed player operation must not
        // prevent the remaining resources from being released.
      }
    }
  };
}

export function buildLiveReleaseUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const match = /^\/live\/playback\/([^/]+)\/(?:master[.]m3u8|file)$/.exec(url.pathname);
    const token = url.searchParams.get("token");
    if (!match || !token) return null;
    url.pathname = `/live/playback/${match[1]}/release`;
    url.search = "";
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    return null;
  }
}

export function createLivePlaybackRelease(
  releaseUrl: string,
  sendBeacon: (url: string) => boolean,
  fetchRelease: (url: string) => void
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (sendBeacon(releaseUrl)) return;
    } catch {
      // Fall back to a keepalive request when the browser cannot queue a beacon.
    }
    fetchRelease(releaseUrl);
  };
}

export function safeLivePlayerError(deliveryMode: string | undefined, error: unknown): string {
  if (deliveryMode === "direct_provider") return "Doğrudan yayın bağlantısı kurulamadı. Tekrar deneyin.";
  return error instanceof Error ? error.message : "Yayın bağlantısı kurulamadı.";
}

export function createMpegTsConfig(): MpegTsPlaybackConfig {
  return {
    enableWorker: true,
    enableStashBuffer: true,
    stashInitialSize: 512 * 1024,
    lazyLoad: false,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: 24,
    autoCleanupMinBackwardDuration: 12,
    liveBufferLatencyChasing: false,
    liveBufferLatencyMaxLatency: 8,
    liveBufferLatencyMinRemain: 2,
    // Drain brief delivery bursts without jumping over unseen live content.
    liveSync: true,
    liveSyncMaxLatency: 12,
    liveSyncTargetLatency: 8,
    liveSyncPlaybackRate: 1.01
  };
}

export function getReconnectDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= 3) return null;
  return [4_000, 6_000, 10_000][attempt] ?? null;
}

type LiveStartMedia = Pick<HTMLMediaElement, "readyState" | "buffered" | "currentTime" | "addEventListener" | "removeEventListener">;

export async function primeLivePlayback(_media: LiveStartMedia, play: () => unknown, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  try {
    await play();
  } catch {
    // Browsers may reject scripted autoplay even though the stream is loaded.
    // The page's play control remains available, so autoplay rejection is not
    // a transport failure and must not send the viewer into the reconnect loop.
  }
  signal.throwIfAborted();
}
function describePlaybackErrorPart(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value ?? "");
  }
}

export function isUnsupportedAudioCodecError(
  errorType: unknown,
  errorDetail: unknown,
  errorInfo: unknown
): boolean {
  const description = [errorType, errorDetail, errorInfo].map(describePlaybackErrorPart).join(" ");
  return /(?:ec-?3|eac-?3)/i.test(description) && /(?:unsupported|not supported|addsourcebuffer|codec)/i.test(description);
}

export function shouldCancelReconnectForProgress(previousTime: number, currentTime: number): boolean {
  return Number.isFinite(previousTime) && Number.isFinite(currentTime) && currentTime - previousTime >= 0.05;
}

export function shouldReconnectForBufferedStall(
  readyState: number,
  currentTime: number,
  bufferedRanges: ReadonlyArray<readonly [number, number]>
): boolean {
  if (readyState === 0) return true;
  const activeRange = bufferedRanges.find(([start, end]) => currentTime >= start - 0.1 && currentTime <= end);
  return !activeRange || activeRange[1] - currentTime < 0.75;
}

export function shouldTranscodeAudioCodec(
  audioCodec: string | null | undefined,
  isTypeSupported: (mimeType: string) => boolean
): boolean {
  if (!audioCodec) return false;
  // mpegts.js reports MPEG Layer II as "mp3" too. A positive browser MP3
  // capability check cannot prove that these frames are decodable.
  if (/^(?:mp2|mp3|mp4a[.]40[.](?:32|33|34))$/i.test(audioCodec.trim())) return true;
  if (!/(?:ec-?3|eac-?3)/i.test(audioCodec)) return false;
  return !isTypeSupported(`audio/mp4;codecs="${audioCodec}"`);
}

type MediaSourceCapabilities = { isTypeSupported: (mimeType: string) => boolean };

export function getMediaSourceCapabilities(browser: {
  MediaSource?: MediaSourceCapabilities;
  ManagedMediaSource?: MediaSourceCapabilities;
}): MediaSourceCapabilities | null {
  // Match mpegts.js: iPhone uses ManagedMediaSource when standard MSE is absent.
  // Checking only MediaSource silently bypasses incompatible-audio recovery there.
  return browser.MediaSource ?? browser.ManagedMediaSource ?? null;
}

export function buildAudioTranscodeUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.searchParams.set("flixify_audio", "aac");
  return url.toString();
}
