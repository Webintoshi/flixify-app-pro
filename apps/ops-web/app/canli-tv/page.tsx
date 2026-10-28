"use client";

import { mapPersonalLive, liveTransport, selectedProgrammes, createLiveRequestScope } from "./personal-live";
import type { PersonalRef, PersonalEpgResult } from "../platform/personal-provider";
import { selectLivePlaybackEngine } from "../platform/playback-transport";
import { createDirectPlaybackDeadline } from "../platform/direct-playback-deadline";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../../lib/api";
import { CATEGORIES, COUNTRIES, classifyChannel, createCatalogMemoryCache, loadCatalogWithCache, type CatalogSnapshot } from "./live-channel-catalog";
import { categorySelectOptions, categorySelectValue } from "./live-category-selector";
import {
  buildAudioTranscodeUrl,
  buildLiveReleaseUrl,
  createHlsPlaybackConfig,
  createLivePlaybackRelease,
  createSafeCleanup,
  createMpegTsConfig,
  findLowerBandwidthVariant,
  getBrowserLivePlaybackQuery,
  getTransportRecoveryReason,
  getMediaSourceCapabilities,
  primeLivePlayback,
  getReconnectDelay,
  isUnsupportedAudioCodecError,
  nextAudioMode,
  safeLivePlayerError,
  shouldCancelReconnectForProgress,
  shouldReconnectForBufferedStall,
  shouldRequestRelayAudioFallback,
  shouldTryLowerBandwidthVariant,
  shouldTranscodeAudioCodec,
  shouldUseNativeHls,
  type PlaybackMode
} from "./live-playback-policy";
import styles from "./live-tv-app.module.css";
import { FavoriteButton } from "../platform/artwork";
import { usePlatform, useProviderExpiry } from "../platform/session";
import { parseRecentChannelIds, recentStorageKey, rememberRecentChannel } from "./live-recent";
import { PlayerChrome } from "../components/player-chrome";
import { useSearchParams } from "next/navigation";

type Session = { accessToken: string; kryptoniteCode?: string | null; user?: { kryptoniteCode?: string | null } };

type LiveChannel = {
  id: string;
  personalRef?: PersonalRef;
  title: string;
  groupTitle: string | null;
  logoUrl: string | null;
  playbackAllowed: boolean;
  transport: "hls" | "ts" | "mp4" | "mkv" | "unknown";
  healthStatus: "healthy" | "degraded" | "broken" | "unknown";
  variantGroupKey?: string | null;
};

type CatalogResponse = { items: LiveChannel[]; total?: number; groups?: Array<{ title: string; count: number }> };

type PlaybackResponse = {
  personalRef?: PersonalRef;
  channelId: string;
  url: string | null;
  transport: "hls" | "ts" | "mp4" | "mkv" | "unknown";
  deliveryMode?: string;
  expiresAt?: string | null;
  canPlay: boolean;
  errorMessage: string | null;
};

type AppIconName = "home" | "tv" | "movies" | "heart" | "clock" | "settings" | "search" | "close";

const catalogPageSize = 200;
const initialRenderLimit = 36;
const liveCatalogCache = createCatalogMemoryCache<CatalogSnapshot<LiveChannel>>();

function AppIcon({ name }: { name: AppIconName }) {
  const common = { width: 21, height: 21, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (name === "home") return <svg {...common}><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>;
  if (name === "tv") return <svg {...common}><rect x="3" y="6" width="18" height="13" rx="1"/><path d="m9 2 3 4 3-4M8 22h8"/></svg>;
  if (name === "movies") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M7 5l3 5M14 5l3 5"/></svg>;
  if (name === "heart") return <svg {...common}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>;
  if (name === "clock") return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  if (name === "settings") return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1.1 1.7V21h-4v-.1A1.8 1.8 0 0 0 8.8 19a1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2A1.8 1.8 0 0 0 2.7 13H2V9h.7a1.8 1.8 0 0 0 1.7-1.1 1.8 1.8 0 0 0-.4-2l-.1-.1L6.7 3l.1.1a1.8 1.8 0 0 0 2 .4A1.8 1.8 0 0 0 9.9 2H14v.1A1.8 1.8 0 0 0 15.1 4a1.8 1.8 0 0 0 2-.4l.1-.1L20 6.3l-.1.1a1.8 1.8 0 0 0-.4 2A1.8 1.8 0 0 0 21.2 9h.8v4h-.8a1.8 1.8 0 0 0-1.8 2Z"/></svg>;
  if (name === "search") return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></svg>;
  return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
}

function errorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu.";
  try {
    const parsed = JSON.parse(raw) as { message?: string };
    return parsed.message ?? raw;
  } catch {
    return raw;
  }
}

function friendlyPlaybackError(error: unknown) {
  const message = errorMessage(error);
  if (/invalid authorization|invalid user|404 error/i.test(message)) {
    return "Yayın bağlantısı doğrulanamadı. Birkaç saniye sonra tekrar deneyin.";
  }
  return message;
}

function monogram(title: string) {
  const letters = title
    .replace(/^[A-Z]{2}\s*[•:|-]\s*/i, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  return letters || "TV";
}

function cleanChannelTitle(title: string) {
  return title.replace(/^[A-Z]{2}\s*[•:|-]\s*/i, "").trim();
}

function ChannelLogo({ channel, active = false }: { channel: LiveChannel; active?: boolean }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(active);

  useEffect(() => {
    setFailed(false);
    setShouldLoad(active);
    if (active || !channel.logoUrl) return;
    const container = containerRef.current;
    if (!container || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "240px 0px" }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, channel.id, channel.logoUrl]);

  return (
    <span ref={containerRef} className={`${styles.logoBox}${active ? ` ${styles.activeLogo}` : ""}`} aria-hidden="true">
      {channel.logoUrl && shouldLoad && !failed ? (
        <img src={channel.logoUrl} alt="" loading="lazy" decoding="async" fetchPriority="low" width={58} height={50} onError={() => setFailed(true)} />
      ) : (
        <span className={styles.logoFallback}>{monogram(channel.title)}</span>
      )}
    </span>
  );
}

function LiveVideo({
  playback,
  title,
  accessToken,
  onPlaybackChange,
  onNeedLowerQuality,
  refreshPersonalPlayback,
  onAccessExpired
}: {
  playback: PlaybackResponse;
  title: string;
  accessToken: string;
  onPlaybackChange: (nextPlayback: PlaybackResponse) => void;
  onNeedLowerQuality: () => boolean;
  refreshPersonalPlayback?: () => Promise<PlaybackResponse>;
  onAccessExpired: () => void;
}) {
  const verifiedExpiry = useProviderExpiry();
  const deadlineRef = useRef<ReturnType<typeof createDirectPlaybackDeadline> | null>(null);
  const effectiveExpiry = verifiedExpiry === undefined ? playback.expiresAt : verifiedExpiry === null ? "1970-01-01T00:00:00Z" : verifiedExpiry;
  const expiryRef = useRef(effectiveExpiry); expiryRef.current = effectiveExpiry;
  useEffect(() => { deadlineRef.current?.update(effectiveExpiry); }, [effectiveExpiry]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lowerQualityRef = useRef(onNeedLowerQuality);
  lowerQualityRef.current = onNeedLowerQuality;
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [activePlaybackMode, setActivePlaybackMode] = useState<PlaybackMode>("direct");
  const [activeReconnectAttempt, setActiveReconnectAttempt] = useState(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!playback.url || playback.personalRef) return;
    const releaseUrl = buildLiveReleaseUrl(playback.url);
    if (!releaseUrl) return;
    const release = createLivePlaybackRelease(
      releaseUrl,
      (url) => typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url),
      (url) => {
        void fetch(url, {
          method: "POST",
          credentials: "omit",
          keepalive: true
        }).catch(() => undefined);
      }
    );
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [playback.url]);

  useEffect(() => {
    const currentMediaElement = videoRef.current;
    if (!currentMediaElement || !playback.url) return;
    const mediaElement: HTMLVideoElement = currentMediaElement;
    let playbackUrl = playback.url;
    let playbackEngine = selectLivePlaybackEngine(playback.transport, playbackUrl);
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupCurrent: () => void = () => undefined;
    let lastProgressTime = 0;
    let hasProgressed = false;
    let activeAttempt = 0;
    let activeMode: PlaybackMode = "direct";
    let suppressMediaEventsUntil = 0;
    let terminalAudioFailure = false;
    let starting = false;
    let engineVersion = 0;
    let lastProgressAt = performance.now();
    let healthyProgressSince: number | null = null;
    let stallWatchdog: ReturnType<typeof setInterval> | null = null;
    const progressTimedOut = () => performance.now() - lastProgressAt >= (hasProgressed ? 12_000 : 30_000);

    let qualityFallbackStarted = false;
    let lastReportedEvent: "playing" | "stalled" | "failed" | null = null;

    const reportDirectEvent = (event: "playing" | "stalled" | "failed") => {
      if (cancelled || playback.personalRef || playback.deliveryMode !== "direct_provider" || lastReportedEvent === event) return;
      lastReportedEvent = event;
      void apiRequest(`/me/live/${encodeURIComponent(playback.channelId)}/health`, {
        method: "POST",
        accessToken,
        body: {
          event,
          clientRuntime: "browser",
          deliveryMode: "direct_provider",
          sourceTransport: playback.transport,
          playerEngine: playbackEngine === "hls" ? "hls.js" : playbackEngine === "native" ? "native" : "mpegts.js"
        }
      }).catch(() => undefined);
    };

    const clearReconnect = () => {
      if (!reconnectTimer) return;
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const resetMedia = () => {
      suppressMediaEventsUntil = Date.now() + 750;
      mediaElement.pause();
      mediaElement.removeAttribute("src");
      mediaElement.load();
    };

    const markHealthy = () => {
      if (cancelled || terminalAudioFailure) return;
      clearReconnect();
      setPlayerError(null);
      setConnectionState("live");
      reportDirectEvent("playing");
    };

    const shouldReconnectNow = () => {
      const ranges = Array.from(
        { length: mediaElement.buffered.length },
        (_, index) => [mediaElement.buffered.start(index), mediaElement.buffered.end(index)] as const
      );
      return shouldReconnectForBufferedStall(mediaElement.readyState, mediaElement.currentTime, ranges);
    };

    const scheduleReconnect = (attempt: number, mode: PlaybackMode = "direct") => {
      if (cancelled || terminalAudioFailure || reconnectTimer) return;
      const delay = getReconnectDelay(attempt);
      if (delay === null) {
        setPlayerError("Yayın bağlantısı kararsız. Tekrar deneyebilirsiniz.");
        reportDirectEvent("failed");
        return;
      }
      setConnectionState("reconnecting");
      reportDirectEvent("stalled");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        cleanupCurrent();
        resetMedia();
        void start(attempt + 1, mode);
      }, delay);
    };

    const failUnsupportedAudio = (message = "Bu kanalın ses biçimi tarayıcınızda desteklenmiyor.") => {
      if (cancelled || terminalAudioFailure) return;
      terminalAudioFailure = true;
      clearReconnect();
      setPlayerError(message);
      reportDirectEvent("failed");
      queueMicrotask(() => {
        if (!cancelled) {
          cleanupCurrent();
          resetMedia();
        }
      });
    };

    const tryLowerQuality = () => {
      if (playback.personalRef || cancelled || qualityFallbackStarted || playback.deliveryMode !== "direct_provider") return false;
      if (!lowerQualityRef.current()) return false;
      qualityFallbackStarted = true;
      terminalAudioFailure = true;
      clearReconnect();
      reportDirectEvent("stalled");
      return true;
    };

    const requestRelayAudioFallback = (reason: "unsupported_audio" | "buffering" | "startup_failure" | "repeated_transport_error") => {
      if (reason === "unsupported_audio" && tryLowerQuality()) return true;
      return false;
    };

    const recoverTransport = (attempt: number, mode: PlaybackMode) => {
      const reason = getTransportRecoveryReason(hasProgressed, attempt);
      if (shouldTryLowerBandwidthVariant(reason, attempt) && tryLowerQuality()) return;
      if (!requestRelayAudioFallback(reason)) scheduleReconnect(attempt, mode);
    };

    async function start(attempt: number, mode: PlaybackMode = "direct") {
      if (cancelled || starting) return;
      starting = true;
      const version = ++engineVersion;
      const currentEngine = () => !cancelled && version === engineVersion;
      activeAttempt = attempt;
      try {
        // The channel selection already obtained a fresh authorization. Only a
        // recovery/manual retry needs another one before opening its connection.
        if (playback.personalRef && refreshPersonalPlayback && (attempt > 0 || revision > 0)) {
          const refreshed = await refreshPersonalPlayback();
          if (!currentEngine()) return;
          deadline?.dispose();
          deadline = deadlineRef.current = createDirectPlaybackDeadline(expiryRef.current === undefined ? refreshed.expiresAt : expiryRef.current, expirePlayback);
          if (deadline.expired) return;
          playbackUrl = refreshed.url!;
          playbackEngine = selectLivePlaybackEngine(refreshed.transport, playbackUrl);
        }
        activeAttempt = attempt;
        activeMode = mode;
        setActiveReconnectAttempt(attempt);
        setActivePlaybackMode(mode);
        lastProgressTime = 0;
        hasProgressed = false;
        lastProgressAt = performance.now();
        healthyProgressSince = null;
        setPlayerError(null);
        setConnectionState(attempt > 0 ? "reconnecting" : "connecting");

        if (playbackEngine === "native") {
          mediaElement.src = playbackUrl;
          cleanupCurrent = resetMedia;
          starting = false;
          await mediaElement.play();
          if (currentEngine()) {
            setConnectionState("live");
            reportDirectEvent("playing");
          }
          return;
        }

        if (playbackEngine === "hls") {
          const canPlayNativeHls = Boolean(mediaElement.canPlayType("application/vnd.apple.mpegurl"));
          const playNativeHls = async () => {
            mediaElement.src = playbackUrl;
            cleanupCurrent = resetMedia;
            starting = false;
            await mediaElement.play();
            if (currentEngine()) setConnectionState("live");
          };
          // Safari's direct HLS path needs no optional MSE engine or chunk fetch.
          if (shouldUseNativeHls(playback.deliveryMode, canPlayNativeHls, true)) {
            await playNativeHls();
            return;
          }
          const { default: Hls } = await import("hls.js");
          if (!currentEngine()) return;
          const hlsJsSupported = Hls.isSupported();

          if (shouldUseNativeHls(playback.deliveryMode, canPlayNativeHls, hlsJsSupported)) {
            await playNativeHls();
            return;
          }

          if (!hlsJsSupported) throw new Error("Bu tarayıcı HLS canlı yayını desteklemiyor.");
          const hls = new Hls(createHlsPlaybackConfig());
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || !currentEngine()) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
              return;
            }
            recoverTransport(activeAttempt, mode);
          });
          hls.loadSource(playbackUrl);
          hls.attachMedia(mediaElement);
          cleanupCurrent = () => hls.destroy();
          starting = false;
          await mediaElement.play().catch(() => undefined);
          if (currentEngine()) setConnectionState("live");
          return;
        }

        const imported = await import("mpegts.js");
        if (!currentEngine()) return;
        const mpegts = imported.default;
        if (!mpegts.getFeatureList().mseLivePlayback) throw new Error("Bu tarayıcı MPEG-TS canlı yayını desteklemiyor.");
        const sourceUrl = mode === "transcoded" && playback.deliveryMode !== "direct_provider"
          ? buildAudioTranscodeUrl(playbackUrl) : playbackUrl;
        const player = mpegts.createPlayer(
          { type: "mpegts", isLive: true, cors: true, withCredentials: false, hasAudio: mode === "video-only" ? false : undefined, url: sourceUrl },
          createMpegTsConfig()
        );
        let switchingMode = false;
        const startup = new AbortController();
        player.attachMediaElement(mediaElement);
        cleanupCurrent = createSafeCleanup([
          () => startup.abort(),
          () => player.unload(),
          () => player.detachMediaElement(),
          () => player.destroy()
        ]);
        const switchPlaybackMode = (nextMode: PlaybackMode) => {
          if (!currentEngine() || switchingMode || mode === nextMode) return;
          switchingMode = true;
          clearReconnect();
          setConnectionState("reconnecting");
          cleanupCurrent();
          resetMedia();
          void start(attempt, nextMode);
        };
        player.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
          if (!currentEngine()) return;
          const audioCodec = typeof mediaInfo?.audioCodec === "string" ? mediaInfo.audioCodec : null;
          const mediaSource = getMediaSourceCapabilities(window);
          if (
            mode === "direct" &&
            mediaSource &&
            shouldTranscodeAudioCodec(audioCodec, (mimeType) => mediaSource.isTypeSupported(mimeType))
          ) {
            const nextMode = nextAudioMode(playback.deliveryMode, mode);
            if (nextMode) switchPlaybackMode(nextMode);
            else if (shouldRequestRelayAudioFallback(playback.deliveryMode, mode)) requestRelayAudioFallback("unsupported_audio");
            else failUnsupportedAudio();
          }
        });
        player.on(mpegts.Events.ERROR, (errorType, errorDetail, errorInfo) => {
          if (!currentEngine()) return;
          if (isUnsupportedAudioCodecError(errorType, errorDetail, errorInfo)) {
            const nextMode = nextAudioMode(playback.deliveryMode, mode);
            if (nextMode) switchPlaybackMode(nextMode);
            else if (shouldRequestRelayAudioFallback(playback.deliveryMode, mode)) requestRelayAudioFallback("unsupported_audio");
            else if (playback.deliveryMode === "direct_provider") failUnsupportedAudio();
            else scheduleReconnect(attempt, mode);
            return;
          }
          if (shouldReconnectNow()) recoverTransport(activeAttempt, mode);
        });
        player.load();
        starting = false;
        try {
          await primeLivePlayback(mediaElement, () => player.play(), startup.signal);
        } catch (error) {
          if (startup.signal.aborted) return;
          throw error;
        }
        if (currentEngine()) {
          setConnectionState("live");
          reportDirectEvent("playing");
        }
      } catch (error) {
        if (currentEngine()) {
          const delay = getReconnectDelay(attempt);
          if (delay === null) {
            setPlayerError(playback.deliveryMode === "direct_provider"
              ? safeLivePlayerError(playback.deliveryMode, error)
              : friendlyPlaybackError(error));
            reportDirectEvent("failed");
          }
          else recoverTransport(attempt, mode);
        }
      } finally { if (version === engineVersion) starting = false; }
    }

    const handlePlaying = () => {
      hasProgressed = true;
      lastProgressAt = performance.now();
      markHealthy();
    };
    const handleTimeUpdate = () => {
      if (cancelled) return;
      const currentTime = mediaElement.currentTime;
      if (shouldCancelReconnectForProgress(lastProgressTime, currentTime)) {
        hasProgressed = true;
        lastProgressAt = performance.now();
        healthyProgressSince ??= lastProgressAt;
        if (activeAttempt > 0 && lastProgressAt - healthyProgressSince >= 8_000) {
          activeAttempt = 0;
          setActiveReconnectAttempt(0);
        }
        markHealthy();
      }
      lastProgressTime = currentTime;
    };
    const handleWaiting = () => {
      if (cancelled || Date.now() < suppressMediaEventsUntil) return;
      setConnectionState("reconnecting");
      if (progressTimedOut() && shouldReconnectNow()) recoverTransport(activeAttempt, activeMode);
    };
    const handleStalled = () => {
      if (cancelled || Date.now() < suppressMediaEventsUntil) return;
      setConnectionState("reconnecting");
      if (progressTimedOut() && shouldReconnectNow()) recoverTransport(activeAttempt, activeMode);
    };
    const handleMediaError = () => {
      if (cancelled || Date.now() < suppressMediaEventsUntil) return;
      recoverTransport(activeAttempt, activeMode);
    };
    mediaElement.addEventListener("playing", handlePlaying);
    mediaElement.addEventListener("timeupdate", handleTimeUpdate);
    mediaElement.addEventListener("waiting", handleWaiting);
    mediaElement.addEventListener("stalled", handleStalled);
    mediaElement.addEventListener("error", handleMediaError);
    const expirePlayback = () => {
      cancelled = true;
      if (stallWatchdog) clearInterval(stallWatchdog);
      clearReconnect(); cleanupCurrent(); resetMedia();
      setPlayerError("İzleme süren doldu.");
      if (playback.personalRef) onAccessExpired();
    };
    let deadline = playback.deliveryMode === "direct_provider" ? createDirectPlaybackDeadline(effectiveExpiry, expirePlayback) : null;
    deadlineRef.current = deadline;
    if (!deadline?.expired) {
      // Buffered ranges can remain ahead after a dead HLS/MSE connection stops producing frames.
      stallWatchdog = setInterval(() => {
        if (cancelled || terminalAudioFailure || starting) return;
        if (mediaElement.paused && !mediaElement.ended) { lastProgressAt = performance.now(); healthyProgressSince = null; return; }
        handleTimeUpdate();
        if (progressTimedOut()) {
          healthyProgressSince = null;
          recoverTransport(activeAttempt, activeMode);
        }
      }, 1_000);
      void start(0);
    }

    return () => {
      cancelled = true;
      if (stallWatchdog) clearInterval(stallWatchdog);
      deadline?.dispose();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      mediaElement.removeEventListener("playing", handlePlaying);
      mediaElement.removeEventListener("timeupdate", handleTimeUpdate);
      mediaElement.removeEventListener("waiting", handleWaiting);
      mediaElement.removeEventListener("stalled", handleStalled);
      mediaElement.removeEventListener("error", handleMediaError);
      cleanupCurrent();
      resetMedia();
    };
  }, [accessToken, onPlaybackChange, playback, revision]);

  return (
    <div className={styles.playerShell} data-playback-mode={activePlaybackMode} data-reconnect-attempt={activeReconnectAttempt}>
      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        aria-label={`${title} canlı yayın`}
      />
      {!playerError ? <PlayerChrome videoRef={videoRef} kind="live" title={title} /> : null}
      {playerError ? (
        <div className={styles.playerMessage}>
          <strong>Yayın kesildi</strong>
          <span>{playerError}</span>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>Tekrar Dene</button>
        </div>
      ) : null}
    </div>
  );
}

export default function LiveTvPage() {
  const searchParams = useSearchParams();
  const { favorites, session: platformSession, personalProvider, providerMode, providerScope, providerExpiresAt } = usePlatform();
  const openedChannel = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [catalogLoaded, setCatalogLoaded] = useState(0);
  const [selectedChannel, setSelectedChannel] = useState<LiveChannel | null>(null);
  const [playback, setPlayback] = useState<PlaybackResponse | null>(null);
  const [selectedCountry, setSelectedCountry] = useState("tr");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [directoryTab, setDirectoryTab] = useState<"all" | "favorites" | "recent">("all");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [renderLimit, setRenderLimit] = useState(initialRenderLimit);
  const [loading, setLoading] = useState(true);
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const identityRef = useRef({ personalProvider, providerMode, token: platformSession?.accessToken, scope: providerScope });
  identityRef.current = { personalProvider, providerMode, token: platformSession?.accessToken, scope: providerScope };
  const epgScope = useRef(createLiveRequestScope());
  const [epg, setEpg] = useState<PersonalEpgResult | null>(null);
  const [epgRevision, setEpgRevision] = useState(0);
  useEffect(() => { setSession(platformSession); }, [platformSession]);
  useEffect(() => {
    requestVersionRef.current += 1;
    setChannels([]); setSelectedChannel(null); setPlayback(null); setPlaying(false); setError(null);
    openedChannel.current = null; setRecentIds([]);
    return () => { requestVersionRef.current += 1; };
  }, [personalProvider, providerMode, providerScope, platformSession?.accessToken]);
  useEffect(() => {
    const generation = epgScope.current.begin();
    setEpg(null);
    if (providerMode !== "personal" || !personalProvider || !selectedChannel?.personalRef) return;
    const ref = selectedChannel.personalRef;
    const controller = new AbortController();
    let expired = false;
    const refresh = async () => {
      try {
        const result = await personalProvider.shortEpg(ref, controller.signal);
        if (!expired && epgScope.current.current(generation)) setEpg(result);
      } catch {
        if (!expired && epgScope.current.current(generation)) setEpg({status:"error", programmes:[], error:"Program bilgisi alınamadı"});
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const epgExpiresAt = providerExpiresAt === undefined ? playback?.expiresAt : providerExpiresAt === null ? "1970-01-01T00:00:00Z" : providerExpiresAt;
    const deadline = epgExpiresAt ? createDirectPlaybackDeadline(epgExpiresAt, () => {
      expired = true; controller.abort(); clearInterval(timer); epgScope.current.clear(); setEpg(null);
    }) : null;
    return () => { expired = true; controller.abort(); clearInterval(timer); deadline?.dispose(); epgScope.current.clear(); };
  }, [personalProvider, providerMode, selectedChannel, providerScope, platformSession?.accessToken, epgRevision, playback?.expiresAt, providerExpiresAt]);

  const recentKey = useMemo(() => {
    if (!session) return null;
    return recentStorageKey(session.kryptoniteCode ?? session.user?.kryptoniteCode, session.accessToken);
  }, [session]);

  useEffect(() => {
    if (!recentKey) return;
    try { setRecentIds(parseRecentChannelIds(window.localStorage.getItem(recentKey))); }
    catch { setRecentIds([]); }
  }, [recentKey]);



  useEffect(() => {
    if (providerMode === "loading") { setLoading(true); return; }
    if (!session) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    if (providerMode === "personal") {
      setLoading(true); setCatalogSyncing(false);
      if (!personalProvider) { setLoading(false); return; }
      void personalProvider.catalog("live").then(items => {
        if (controller.signal.aborted) return;
        const mapped = items.map(mapPersonalLive);
        setChannels(mapped); setCatalogTotal(mapped.length); setCatalogLoaded(mapped.length);
      }).catch(() => { if (!controller.signal.aborted) setError("Kanal listesi alınamadı."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
      return () => controller.abort();
    }
    const cached = liveCatalogCache.get(session.accessToken, "live");
    setCatalogLoaded(cached?.snapshot.items.length ?? 0);
    setLoading(!cached);
    setCatalogSyncing(!cached?.fresh);
    setError(null);
    if (!cached) {
      setChannels([]);
      setCatalogTotal(null);
    }

    void loadCatalogWithCache<LiveChannel>({
      cache: liveCatalogCache,
      account: session.accessToken,
      scope: "live",
      pageSize: catalogPageSize,
      signal: controller.signal,
      fetchPage: ({ page, signal }) => apiRequest<CatalogResponse>(
        `/me/catalog/live?page=${page}&pageSize=${catalogPageSize}`,
        { accessToken: session.accessToken, signal }
      ),
      onPage: (snapshot, isFirstPage) => {
        if (controller.signal.aborted) return;
        setChannels(snapshot.items);
        setCatalogTotal(snapshot.total);
        if (isFirstPage || cached) setLoading(false);
      },
      onProgress: (loaded) => {
        if (!controller.signal.aborted) setCatalogLoaded(loaded);
      }
    }).catch((nextError) => {
      if (!controller.signal.aborted) {
        setError(cached ? "Kanal listesi güncellenemedi. Kayıtlı liste gösteriliyor." : errorMessage(nextError));
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
        setCatalogSyncing(false);
      }
    });

    return () => controller.abort();
  }, [session, personalProvider, providerMode, providerScope]);

  const enrichedChannels = useMemo(
    () => channels.map((channel) => ({ channel, ...classifyChannel(channel) })),
    [channels]
  );

  const countryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of enrichedChannels) counts.set(item.countryId, (counts.get(item.countryId) ?? 0) + 1);
    return counts;
  }, [enrichedChannels]);

  const availableCountries = useMemo(
    () => COUNTRIES.filter((country) => (countryCounts.get(country.id) ?? 0) > 0),
    [countryCounts]
  );

  useEffect(() => {
    if (availableCountries.length && !availableCountries.some((country) => country.id === selectedCountry)) {
      setSelectedCountry(availableCountries[0].id);
      setSelectedCategory("all");
    }
  }, [availableCountries, selectedCountry]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of enrichedChannels) {
      if (item.countryId !== selectedCountry) continue;
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [enrichedChannels, selectedCountry]);

  const visibleChannels = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr-TR");
    const favoriteIds = new Set(favorites.filter((item) => item.kind === "live").map((item) => item.id));
    const recentOrder = new Map(recentIds.map((id, index) => [id, index]));
    return enrichedChannels
      .filter((item) => {
        const matchesCountry = item.countryId === selectedCountry;
        const matchesCategory = selectedCategory === "all" || item.categoryId === selectedCategory;
        const matchesSearch = !query || `${item.channel.title} ${item.channel.groupTitle ?? ""}`.toLocaleLowerCase("tr-TR").includes(query);
        const matchesTab = directoryTab === "all" || (directoryTab === "favorites" ? favoriteIds.has(item.channel.id) : recentOrder.has(item.channel.id));
        return matchesCountry && matchesCategory && matchesSearch && matchesTab;
      })
      .map((item) => item.channel)
      .sort((a, b) => directoryTab === "recent" ? (recentOrder.get(a.id) ?? 99) - (recentOrder.get(b.id) ?? 99) : 0);
  }, [directoryTab, enrichedChannels, favorites, recentIds, search, selectedCategory, selectedCountry]);

  const renderedChannels = visibleChannels.slice(0, renderLimit);

  useEffect(() => setRenderLimit(initialRenderLimit), [directoryTab, search, selectedCategory, selectedCountry]);

  async function playChannel(channel: LiveChannel) {
    if (!session || !channel.playbackAllowed || providerMode === "loading") return;
    if (providerMode === "personal" && (!personalProvider || !channel.personalRef)) return;
    const identity = identityRef.current;
    if (selectedChannel?.id === channel.id && playback) return;
    const previousReleaseUrl = !playback?.personalRef && playback?.url ? buildLiveReleaseUrl(playback.url) : null;
    const requestVersion = ++requestVersionRef.current;
    setSelectedChannel(channel);
    setPlayback(null);
    setPlaying(true);
    setError(null);
    try {
      if (previousReleaseUrl) {
        await fetch(previousReleaseUrl, {
          method: "POST",
          credentials: "omit",
          keepalive: true
        }).catch(() => undefined);
        // Single-line providers may need a brief moment to register the closed
        // upstream socket before accepting the next channel connection.
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (requestVersion !== requestVersionRef.current) return;
      } else if (playback?.url) {
        // A direct single-line stream needs time to close before the next one opens.
        await new Promise((resolve) => setTimeout(resolve, 800));
        if (requestVersion !== requestVersionRef.current) return;
      }
      const playbackQuery = getBrowserLivePlaybackQuery(channel.title);
      const response: PlaybackResponse = channel.personalRef && personalProvider
        ? { ...await personalProvider.playback(channel.personalRef), channelId:channel.id, personalRef:channel.personalRef, transport:channel.transport, canPlay:true, deliveryMode:"direct_provider", errorMessage:null }
        : await apiRequest<PlaybackResponse>(
        `/me/live/${encodeURIComponent(channel.id)}/playback?${playbackQuery}`,
        { accessToken: session.accessToken }
      );
      if (requestVersion !== requestVersionRef.current || identity !== identityRef.current && (identity.personalProvider !== identityRef.current.personalProvider || identity.token !== identityRef.current.token || identity.providerMode !== identityRef.current.providerMode || identity.scope !== identityRef.current.scope)) return;
      if (response.personalRef && response.url) response.transport = liveTransport(response.url);
      if (!response.canPlay || !response.url) throw new Error(response.errorMessage ?? "Canlı yayın başlatılamıyor.");
      if (!response.url.startsWith("https://")) throw new Error("Güvenli HTTPS yayın adresi hazırlanamadı.");
      setPlayback(response);
      setRecentIds((current) => {
        const next = rememberRecentChannel(current, channel.id);
        if (recentKey) {
          try { window.localStorage.setItem(recentKey, JSON.stringify(next)); } catch { /* Private browsing can restrict storage. */ }
        }
        return next;
      });
    } catch (nextError) {
      if (requestVersion === requestVersionRef.current) setError(channel.personalRef ? "Canlı yayın başlatılamadı. Tekrar deneyin." : friendlyPlaybackError(nextError));
    } finally {
      if (requestVersion === requestVersionRef.current) setPlaying(false);
    }
  }

  function closePlayer() {
    requestVersionRef.current += 1;
    setSelectedChannel(null);
    setPlayback(null);
    setPlaying(false);
    setError(null);
  }

  useEffect(() => {
    const id = searchParams.get("channel");
    if (!id || openedChannel.current === id) return;
    const channel = channels.find(item => item.id === id);
    if (!channel) return;
    openedChannel.current = id;
    setSelectedCountry(classifyChannel(channel).countryId);
    setSelectedCategory("all");
    void playChannel(channel);
  }, [channels, searchParams]);

  if (session === undefined || loading) {
    return <main className={styles.statePage}><div className={styles.loader} /><p>Flixify Canlı hazırlanıyor…</p></main>;
  }

  if (!session) {
    return (
      <main className={styles.statePage}>
        <span className={styles.eyebrow}>CANLI TV</span>
        <h1>Canlı yayınlarınıza bağlanın.</h1>
        <p>Kanal listenizi açmak için erişim kodunuzla giriş yapın.</p>
        <Link href="/giris-yap" className={styles.primaryButton}>Giriş Yap</Link>
      </main>
    );
  }

  const displayedTotal = catalogTotal ?? channels.length;

  return (
    <main className={styles.page}>

      <div className={styles.appBody}>

        <section className={styles.playerColumn} aria-live="polite">
          <div className={styles.playerStage}>
            {playback && selectedChannel && session ? <LiveVideo playback={playback} title={selectedChannel.title} accessToken={session.accessToken} onAccessExpired={() => { requestVersionRef.current++; setChannels([]); setSelectedChannel(null); setPlayback(null); setEpg(null); epgScope.current.clear(); setError("İzleme süren doldu."); }} refreshPersonalPlayback={selectedChannel.personalRef && personalProvider ? async () => {
              const identity = identityRef.current;
              const result = await personalProvider.playback(selectedChannel.personalRef!);
              if (identity.personalProvider !== identityRef.current.personalProvider || identity.token !== identityRef.current.token || identity.providerMode !== identityRef.current.providerMode || identity.scope !== identityRef.current.scope) throw new Error("Oturum değişti");
              return {...result, channelId:selectedChannel.id, personalRef:selectedChannel.personalRef, transport:liveTransport(result.url), canPlay:true, deliveryMode:"direct_provider", errorMessage:null};
            } : undefined} onPlaybackChange={setPlayback} onNeedLowerQuality={() => {
              const lower = findLowerBandwidthVariant(channels, selectedChannel);
              if (!lower) return false;
              void playChannel(lower);
              return true;
            }} /> : (
              <div className={styles.playerEmpty}>
                {playing ? <><div className={styles.loader} /><strong>Yayın hazırlanıyor…</strong></> : <><span className={styles.emptyPlay}>▶</span><strong>İzlemek için bir kanal seçin</strong><small>Güvenli canlı bağlantı otomatik olarak hazırlanır.</small></>}
              </div>
            )}
            <div className={styles.playerTopbar}>
              <div><span className={styles.livePill}>CANLI</span>{selectedChannel ? <span className={styles.playerTitle}><strong>{cleanChannelTitle(selectedChannel.title)}</strong><small>{selectedChannel.groupTitle ?? "Canlı TV"}</small></span> : null}</div>
              {selectedChannel ? <button type="button" className={styles.closeButton} onClick={closePlayer} aria-label="Oynatıcıyı kapat"><AppIcon name="close" /></button> : null}
            </div>
          </div>
          {error ? <div className={styles.error} role="alert"><span>{error}</span>{selectedChannel ? <button type="button" onClick={() => void playChannel(selectedChannel)}>Tekrar Dene</button> : null}</div> : null}
          <div className={styles.nowPlaying}>
            {selectedChannel ? (
              <>
                <ChannelLogo channel={selectedChannel} active />
                <div><span>Şu Anda</span><strong>{cleanChannelTitle(selectedChannel.title)}</strong><small>{selectedChannel.groupTitle ?? "Canlı TV"}</small></div>
                <div className={styles.detailAction}><FavoriteButton item={{ ...selectedChannel, kind: "live", posterUrl: selectedChannel.logoUrl }}/><span>Favori</span></div>
              </>
            ) : (
              <div className={styles.emptyProgramme}><span>Şu Anda</span><strong>Canlı yayın seçilmedi</strong><small>Sağdaki listeden izlemek istediğiniz kanala dokunun.</small></div>
            )}
          </div>
          {selectedChannel?.personalRef ? <section className={styles.epg} aria-label="Yayın akışı">
            <h2>Yayın Akışı</h2>
            {!epg ? <p>Program bilgisi yükleniyor…</p> : epg.status === "error" ? <p role="alert">{epg.error} <button type="button" onClick={() => setEpgRevision(value => value + 1)}>Tekrar Dene</button></p> : selectedProgrammes(epg.programmes).length ? selectedProgrammes(epg.programmes).map((programme, index) => <article key={`${programme.start}-${index}`}><time>{new Date(programme.start).toLocaleTimeString("tr-TR", {hour:"2-digit",minute:"2-digit",timeZone:"Europe/Istanbul"})} – {new Date(programme.end).toLocaleTimeString("tr-TR", {hour:"2-digit",minute:"2-digit",timeZone:"Europe/Istanbul"})}</time><strong>{programme.start <= Date.now() ? "Şu Anda · " : "Sıradaki · "}{programme.title}</strong>{programme.description ? <p>{programme.description}</p> : null}</article>) : <p>Bu kanal için program bilgisi bulunmuyor.</p>}
          </section> : null}
        </section>

        <aside className={styles.channelRail}>
          <div className={styles.directoryTabs} role="tablist" aria-label="Kanal listesi">
            <button type="button" role="tab" aria-selected={directoryTab === "all"} className={directoryTab === "all" ? styles.activeTab : undefined} onClick={() => setDirectoryTab("all")}><AppIcon name="tv" /> Tüm Kanallar</button>
            <button type="button" role="tab" aria-selected={directoryTab === "favorites"} className={directoryTab === "favorites" ? styles.activeTab : undefined} onClick={() => setDirectoryTab("favorites")}><AppIcon name="heart" /> Favorilerim</button>
            <button type="button" role="tab" aria-selected={directoryTab === "recent"} className={directoryTab === "recent" ? styles.activeTab : undefined} onClick={() => setDirectoryTab("recent")}><AppIcon name="clock" /> Son İzlediklerim</button>
          </div>

          <div className={styles.filterDropdowns}>
            <label><span className={styles.srOnly}>Ülke seç</span><select value={selectedCountry} onChange={(event) => { setSelectedCountry(event.target.value); setSelectedCategory("all"); }}>
              {availableCountries.map((country) => <option key={country.id} value={country.id}>{country.flag} {country.label}</option>)}
            </select></label>
            <label><span className={styles.srOnly}>Kategori seç</span><select value={categorySelectValue(selectedCategory)} onChange={(event) => setSelectedCategory(event.target.value)}>
              {categorySelectOptions(CATEGORIES, categoryCounts, countryCounts.get(selectedCountry) ?? 0).map((category) => (
                <option key={category.id} value={category.id} disabled={category.disabled}>{category.label}</option>
              ))}
            </select></label>
          </div>

          <div className={styles.directoryHeader}>
            <label className={styles.searchLine}>
              <AppIcon name="search" />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Kanal adı ile ara…" aria-label="Kanal ara" />
            </label>
            <span className={styles.channelCount}>{visibleChannels.length.toLocaleString("tr-TR")} kanal</span>
          </div>

          <div className={styles.catalogStatus} aria-live="polite">
            {catalogSyncing
              ? channels.length >= displayedTotal
                ? "Kanal listesi güncelleniyor…"
                : `${catalogLoaded.toLocaleString("tr-TR")} / ${displayedTotal.toLocaleString("tr-TR")} kanal hazırlanıyor`
              : `${channels.length.toLocaleString("tr-TR")} kanal listelendi`}
          </div>

          <div className={styles.channelList} aria-label="Canlı kanallar">
            {renderedChannels.map((channel) => {
              const isSelected = selectedChannel?.id === channel.id;
              return (
                <div key={channel.id} className={styles.favoriteRow}><button type="button" className={`${styles.channelRow}${isSelected ? ` ${styles.selectedChannel}` : ""}`} disabled={!channel.playbackAllowed} onClick={() => void playChannel(channel)}>
                  <ChannelLogo channel={channel} />
                  <span className={styles.channelInfo}><strong>{cleanChannelTitle(channel.title)}</strong><small>{channel.groupTitle ?? "Canlı TV"}</small></span>
                  <span className={styles.rowLive}><i /> {isSelected && playback ? "OYNUYOR" : "CANLI"}</span>
                </button><FavoriteButton item={{ ...channel, kind: "live", posterUrl: channel.logoUrl }}/></div>
              );
            })}
            {!visibleChannels.length ? <p className={styles.empty}>{directoryTab === "favorites" ? "Henüz favori kanalın yok." : directoryTab === "recent" ? "Henüz izlediğin kanal yok." : "Bu seçimde kanal bulunamadı."}</p> : null}
            {renderedChannels.length < visibleChannels.length ? (
              <button type="button" className={styles.loadMore} onClick={() => setRenderLimit((value) => value + initialRenderLimit)}>
                Daha fazla kanal göster
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
