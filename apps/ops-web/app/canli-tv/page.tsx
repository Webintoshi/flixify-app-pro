"use client";

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
import { usePlatform } from "../platform/session";
import { parseRecentChannelIds, recentStorageKey, rememberRecentChannel } from "./live-recent";
import { PlayerChrome } from "../components/player-chrome";
import { useSearchParams } from "next/navigation";

type Session = { accessToken: string; kryptoniteCode?: string | null; user?: { kryptoniteCode?: string | null } };

type LiveChannel = {
  id: string;
  title: string;
  groupTitle: string | null;
  logoUrl: string | null;
  playbackAllowed: boolean;
  transport: "hls" | "ts" | "unknown";
  healthStatus: "healthy" | "degraded" | "broken" | "unknown";
  variantGroupKey?: string | null;
};

type CatalogResponse = { items: LiveChannel[]; total?: number; groups?: Array<{ title: string; count: number }> };

type PlaybackResponse = {
  channelId: string;
  url: string | null;
  transport: "hls" | "ts" | "unknown";
  deliveryMode?: string;
  canPlay: boolean;
  errorMessage: string | null;
};

type AppIconName = "home" | "tv" | "movies" | "heart" | "clock" | "settings" | "search" | "close";

const sessionStorageKey = "flixify-public-session";
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

function readSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return typeof parsed.accessToken === "string" && parsed.accessToken ? {
      accessToken: parsed.accessToken,
      kryptoniteCode: parsed.kryptoniteCode,
      user: parsed.user
    } : null;
  } catch {
    return null;
  }
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
  onNeedLowerQuality
}: {
  playback: PlaybackResponse;
  title: string;
  accessToken: string;
  onPlaybackChange: (nextPlayback: PlaybackResponse) => void;
  onNeedLowerQuality: () => boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lowerQualityRef = useRef(onNeedLowerQuality);
  lowerQualityRef.current = onNeedLowerQuality;
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "reconnecting">("connecting");
  const [activePlaybackMode, setActivePlaybackMode] = useState<PlaybackMode>("direct");
  const [activeReconnectAttempt, setActiveReconnectAttempt] = useState(0);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!playback.url) return;
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
    const playbackUrl = playback.url;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupCurrent: () => void = () => undefined;
    let lastProgressTime = 0;
    let hasProgressed = false;
    let activeAttempt = 0;
    let activeMode: PlaybackMode = "direct";
    let suppressMediaEventsUntil = 0;
    let terminalAudioFailure = false;

    let qualityFallbackStarted = false;
    let lastReportedEvent: "playing" | "stalled" | "failed" | null = null;

    const reportDirectEvent = (event: "playing" | "stalled" | "failed") => {
      if (playback.deliveryMode !== "direct_provider" || lastReportedEvent === event) return;
      lastReportedEvent = event;
      void apiRequest(`/me/live/${encodeURIComponent(playback.channelId)}/health`, {
        method: "POST",
        accessToken,
        body: {
          event,
          clientRuntime: "browser",
          deliveryMode: "direct_provider",
          sourceTransport: playback.transport,
          playerEngine: playback.transport === "hls" ? "hls.js" : "mpegts.js"
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
      if (terminalAudioFailure) return;
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
      if (cancelled || qualityFallbackStarted || playback.deliveryMode !== "direct_provider") return false;
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
      try {
        activeAttempt = attempt;
        activeMode = mode;
        setActiveReconnectAttempt(attempt);
        setActivePlaybackMode(mode);
        lastProgressTime = 0;
        setPlayerError(null);
        setConnectionState(attempt > 0 ? "reconnecting" : "connecting");

        if (playback.transport === "hls" || playbackUrl.toLowerCase().includes(".m3u8")) {
          const canPlayNativeHls = Boolean(mediaElement.canPlayType("application/vnd.apple.mpegurl"));
          const { default: Hls } = await import("hls.js");
          if (cancelled) return;
          const hlsJsSupported = Hls.isSupported();

          if (shouldUseNativeHls(playback.deliveryMode, canPlayNativeHls, hlsJsSupported)) {
            mediaElement.src = playbackUrl;
            cleanupCurrent = resetMedia;
            await mediaElement.play();
            if (!cancelled) setConnectionState("live");
            return;
          }

          if (!hlsJsSupported) throw new Error("Bu tarayıcı HLS canlı yayını desteklemiyor.");
          const hls = new Hls(createHlsPlaybackConfig());
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
              return;
            }
            recoverTransport(attempt, mode);
          });
          hls.loadSource(playbackUrl);
          hls.attachMedia(mediaElement);
          cleanupCurrent = () => hls.destroy();
          await mediaElement.play().catch(() => undefined);
          if (!cancelled) setConnectionState("live");
          return;
        }

        const imported = await import("mpegts.js");
        if (cancelled) return;
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
          if (cancelled || switchingMode || mode === nextMode) return;
          switchingMode = true;
          clearReconnect();
          setConnectionState("reconnecting");
          cleanupCurrent();
          resetMedia();
          void start(attempt, nextMode);
        };
        player.on(mpegts.Events.MEDIA_INFO, (mediaInfo) => {
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
          if (isUnsupportedAudioCodecError(errorType, errorDetail, errorInfo)) {
            const nextMode = nextAudioMode(playback.deliveryMode, mode);
            if (nextMode) switchPlaybackMode(nextMode);
            else if (shouldRequestRelayAudioFallback(playback.deliveryMode, mode)) requestRelayAudioFallback("unsupported_audio");
            else if (playback.deliveryMode === "direct_provider") failUnsupportedAudio();
            else scheduleReconnect(attempt, mode);
            return;
          }
          if (shouldReconnectNow()) recoverTransport(attempt, mode);
        });
        player.load();
        try {
          await primeLivePlayback(mediaElement, () => player.play(), startup.signal);
        } catch (error) {
          if (startup.signal.aborted) return;
          throw error;
        }
        if (!cancelled) {
          setConnectionState("live");
          reportDirectEvent("playing");
        }
      } catch (error) {
        if (!cancelled) {
          const delay = getReconnectDelay(attempt);
          if (delay === null) {
            setPlayerError(playback.deliveryMode === "direct_provider"
              ? safeLivePlayerError(playback.deliveryMode, error)
              : friendlyPlaybackError(error));
            reportDirectEvent("failed");
          }
          else recoverTransport(attempt, mode);
        }
      }
    }

    const handlePlaying = () => markHealthy();
    const handleTimeUpdate = () => {
      const currentTime = mediaElement.currentTime;
      if (shouldCancelReconnectForProgress(lastProgressTime, currentTime)) {
        hasProgressed = true;
        markHealthy();
      }
      lastProgressTime = currentTime;
    };
    const handleWaiting = () => {
      if (Date.now() < suppressMediaEventsUntil) return;
      setConnectionState("reconnecting");
      if (shouldReconnectNow()) recoverTransport(activeAttempt, activeMode);
    };
    const handleStalled = () => {
      if (Date.now() < suppressMediaEventsUntil) return;
      setConnectionState("reconnecting");
      if (shouldReconnectNow()) recoverTransport(activeAttempt, activeMode);
    };
    const handleMediaError = () => {
      if (Date.now() < suppressMediaEventsUntil) return;
      recoverTransport(activeAttempt, activeMode);
    };
    mediaElement.addEventListener("playing", handlePlaying);
    mediaElement.addEventListener("timeupdate", handleTimeUpdate);
    mediaElement.addEventListener("waiting", handleWaiting);
    mediaElement.addEventListener("stalled", handleStalled);
    mediaElement.addEventListener("error", handleMediaError);
    void start(0);

    return () => {
      cancelled = true;
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
      {connectionState !== "live" && !playerError ? (
        <div className={styles.connectionBadge}><span className={styles.loaderSmall} /> Yayın dengeleniyor…</div>
      ) : null}
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
  const { favorites } = usePlatform();
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

  const recentKey = useMemo(() => {
    if (!session) return null;
    return recentStorageKey(session.kryptoniteCode ?? session.user?.kryptoniteCode, session.accessToken);
  }, [session]);

  useEffect(() => {
    if (!recentKey) return;
    try { setRecentIds(parseRecentChannelIds(window.localStorage.getItem(recentKey))); }
    catch { setRecentIds([]); }
  }, [recentKey]);

  useEffect(() => setSession(readSession()), []);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
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
  }, [session]);

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
    if (!session || !channel.playbackAllowed) return;
    if (selectedChannel?.id === channel.id && playback) return;
    const previousReleaseUrl = playback?.url ? buildLiveReleaseUrl(playback.url) : null;
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
      const response = await apiRequest<PlaybackResponse>(
        `/me/live/${encodeURIComponent(channel.id)}/playback?${playbackQuery}`,
        { accessToken: session.accessToken }
      );
      if (requestVersion !== requestVersionRef.current) return;
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
      if (requestVersion === requestVersionRef.current) setError(friendlyPlaybackError(nextError));
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
            {playback && selectedChannel && session ? <LiveVideo playback={playback} title={selectedChannel.title} accessToken={session.accessToken} onPlaybackChange={setPlayback} onNeedLowerQuality={() => {
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
