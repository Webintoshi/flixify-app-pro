import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type {
  CatalogGroup,
  EpisodeRecord,
  LiveChannel,
  LiveHealthStatus,
  LivePlaybackRecord,
  LiveTransport,
  MovieRecord,
  PaymentMethodId,
  PaymentMethodOption,
  PackageRecord,
  SeriesRecord,
  SeriesSeasonRecord,
  VodPlaybackRecord
} from "@flixify/contracts";
import {
  createBrowserStorageAdapter,
  createInMemoryStorageAdapter,
  legacyAuthRedirects,
  loginRoute,
  registerRoute,
  useViewerCore
} from "@flixify/viewer-core";

const ENV_API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const DEV_API_BASE_URL = "http://localhost:4000";
const API_HEALTH_PATH = "/health";
const DEFAULT_RUNTIME_CONFIG_PATH = "/app-config.json";
const LIVE_PLAYER_POSTER_URL = "/live-brand-poster.svg";
const LIVE_COUNTRY_FILTER_PREFIX = "country:";
const LIVE_DEFAULT_COUNTRY_CODE = "TR";
const LIVE_DEFAULT_COUNTRY_FILTER = `${LIVE_COUNTRY_FILTER_PREFIX}${LIVE_DEFAULT_COUNTRY_CODE}`;
const TV_FOCUSABLE_SELECTOR = '[data-tv-focusable="true"]';
const AUTH_PREFILL_CODE_KEY = "flixify-auth-prefill-code";
const AUTH_DEVICE_NAME = "LG webOS TV";
const AUTH_LEGACY_REDIRECT_ENTRIES = Object.entries(legacyAuthRedirects);
const AUTH_ROUTE_PATHS = new Set<string>([
  loginRoute,
  registerRoute,
  ...Object.keys(legacyAuthRedirects)
]);

type RuntimeAppConfig = {
  apiBaseUrl?: string | null;
};

type ViewerCoreHandle = ReturnType<typeof useViewerCore>;
type PlaybackKind = "live" | "movie" | "episode";
type ArtworkMode = "poster" | "logo";
type PlayerState =
  | "idle"
  | "resolving"
  | "connecting"
  | "buffering"
  | "playing"
  | "stalled"
  | "recovering"
  | "ended"
  | "failed";

type PlaybackQueueItem = {
  id: string;
  kind: PlaybackKind;
  title: string;
  subtitle: string | null | undefined;
  imageUrl: string | null;
  artworkMode: ArtworkMode;
  streamUrl: string | null;
  playbackAllowed: boolean;
  transport?: LiveTransport;
  healthStatus?: LiveHealthStatus;
  isVerified?: boolean;
  lastCheckedAt?: string | null;
};

type PlaybackItem = PlaybackQueueItem & {
  nextItem?: PlaybackItem | null;
  autoSkipDepth?: number;
};

type SeriesArtworkItem = {
  id: string;
  title: string;
  posterUrl: string | null;
};

type TvDirection = "left" | "right" | "up" | "down";

const primaryNavigationItems = [
  { href: "/", label: "Ana Sayfa" },
  { href: "/canli-tv", label: "Canli TV" },
  { href: "/filmler", label: "Filmler" },
  { href: "/diziler", label: "Diziler" }
] as const;

const playerStateLabels: Record<PlayerState, string> = {
  idle: "Hazir",
  resolving: "Yayin hazirlaniyor",
  connecting: "Baglaniyor",
  buffering: "Buffer dolduruluyor",
  playing: "Oynuyor",
  stalled: "Yayin bekliyor",
  recovering: "Toparlaniyor",
  ended: "Tamamlandi",
  failed: "Yayin acilamadi"
};

const paymentMethodApprovalText = "Ortalama 30 Dakika Icerisinde Onay";

const paymentMethodLabelById: Record<PaymentMethodId, string> = {
  "bank-transfer-eft": "Banka Havale / EFT",
  crypto: "Kripto",
  "bank-card": "Banka Karti"
};

type CryptoAssetId = "usdt-trc20" | "tron" | "sol" | "btc" | "usdc";

type CryptoAssetView = {
  id: CryptoAssetId;
  label: string;
  symbol: string;
  logoUrl: string;
  walletAddress: string | null;
};

const defaultCryptoAssets: CryptoAssetView[] = [
  { id: "usdt-trc20", label: "Tether", symbol: "USDT", logoUrl: "/crypto-icons/usdt.svg", walletAddress: null },
  { id: "tron", label: "Tron", symbol: "TRX", logoUrl: "/crypto-icons/trx.svg", walletAddress: null },
  { id: "sol", label: "Sol", symbol: "SOL", logoUrl: "/crypto-icons/sol.svg", walletAddress: null },
  { id: "btc", label: "BTC", symbol: "BTC", logoUrl: "/crypto-icons/btc.svg", walletAddress: null },
  { id: "usdc", label: "USDC", symbol: "USDC", logoUrl: "/crypto-icons/usdc.svg", walletAddress: null }
];

function toTextOrNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildCryptoAssets(method: PaymentMethodOption | null | undefined): CryptoAssetView[] {
  if (!method?.cryptoAssets || method.cryptoAssets.length === 0) {
    return defaultCryptoAssets;
  }

  return defaultCryptoAssets.map((fallbackAsset) => {
    const found = method.cryptoAssets?.find((asset) => asset.id === fallbackAsset.id);
    return {
      id: fallbackAsset.id,
      label: found?.label?.trim() || fallbackAsset.label,
      symbol: found?.symbol?.trim() || fallbackAsset.symbol,
      logoUrl: fallbackAsset.logoUrl,
      walletAddress: toTextOrNull(found?.walletAddress)
    };
  });
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("clipboard-unsupported");
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "true");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(helper);
  if (!copied) {
    throw new Error("copy-failed");
  }
}

const liveCountryLabelByCode: Record<string, string> = {
  TR: "Turkiye"
};

function describeHealth(healthStatus: LiveHealthStatus | undefined, isVerified: boolean | undefined) {
  if (!isVerified || !healthStatus || healthStatus === "unknown") {
    return {
      label: "Kontrol Bekliyor",
      tone: "pending"
    } as const;
  }

  if (healthStatus === "healthy") {
    return {
      label: "Hazir",
      tone: "success"
    } as const;
  }

  if (healthStatus === "degraded") {
    return {
      label: "Kararsiz",
      tone: "warning"
    } as const;
  }

  return {
    label: "Sorunlu",
    tone: "danger"
  } as const;
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "--:--";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatCheckedAt(value: string | null | undefined) {
  if (!value) {
    return "Az once";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Az once";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(parsed);
}

function normalizeAuthCode(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
}

function formatAuthCodeBlocks(value: string) {
  const sanitized = normalizeAuthCode(value);
  if (!sanitized) {
    return "---- ---- ---- ----";
  }

  const groups = sanitized.match(/.{1,4}/g);
  return groups ? groups.join(" ") : sanitized;
}

function setAuthPrefillCode(code: string) {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeAuthCode(code);
  if (!normalized) {
    window.sessionStorage.removeItem(AUTH_PREFILL_CODE_KEY);
    return;
  }

  window.sessionStorage.setItem(AUTH_PREFILL_CODE_KEY, normalized);
}

function popAuthPrefillCode() {
  if (typeof window === "undefined") {
    return "";
  }

  const stored = normalizeAuthCode(window.sessionStorage.getItem(AUTH_PREFILL_CODE_KEY) ?? "");
  window.sessionStorage.removeItem(AUTH_PREFILL_CODE_KEY);
  return stored;
}

function downloadAuthCodeAsText(code: string) {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = normalizeAuthCode(code);
  if (!normalized) {
    return;
  }

  const blob = new Blob(
    [
      "Flixify Pro Hesap Numarasi\n",
      `Kod: ${formatAuthCodeBlocks(normalized)}\n`,
      `Tam kod: ${normalized}\n`
    ],
    { type: "text/plain;charset=utf-8" }
  );

  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `flixify-kod-${normalized.slice(-4)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}

function isLiveDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const fromStorage = window.localStorage.getItem("flixify-live-debug");
    if (fromStorage === "1" || fromStorage === "true") {
      return true;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const fromSearch = searchParams.get("liveDebug");
    if (fromSearch === "1" || fromSearch === "true") {
      return true;
    }

    const hash = window.location.hash;
    const queryStart = hash.indexOf("?");
    if (queryStart >= 0) {
      const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
      const fromHash = hashParams.get("liveDebug");
      if (fromHash === "1" || fromHash === "true") {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function isVodDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const fromStorage = window.localStorage.getItem("flixify-vod-debug");
    if (fromStorage === "1" || fromStorage === "true") {
      return true;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const fromSearch = searchParams.get("vodDebug");
    if (fromSearch === "1" || fromSearch === "true") {
      return true;
    }

    const hash = window.location.hash;
    const queryStart = hash.indexOf("?");
    if (queryStart >= 0) {
      const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
      const fromHash = hashParams.get("vodDebug");
      if (fromHash === "1" || fromHash === "true") {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function getRuntimeConfigPath() {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return "./app-config.json";
  }
  return DEFAULT_RUNTIME_CONFIG_PATH;
}

function normalizeApiBaseUrl(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function resolveApiBaseUrlFromLocation() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const searchParams = new URLSearchParams(window.location.search);
    const direct = normalizeApiBaseUrl(searchParams.get("apiBaseUrl"));
    if (direct) {
      return direct;
    }

    const hash = window.location.hash;
    const queryStart = hash.indexOf("?");
    if (queryStart >= 0) {
      const hashParams = new URLSearchParams(hash.slice(queryStart + 1));
      const fromHash = normalizeApiBaseUrl(hashParams.get("apiBaseUrl"));
      if (fromHash) {
        return fromHash;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function resolveApiBaseUrl(runtimeConfig: RuntimeAppConfig | null) {
  const locationApiBaseUrl = resolveApiBaseUrlFromLocation();
  if (locationApiBaseUrl) {
    return locationApiBaseUrl;
  }

  const runtimeApiBaseUrl = normalizeApiBaseUrl(runtimeConfig?.apiBaseUrl ?? undefined);
  if (runtimeApiBaseUrl) {
    return runtimeApiBaseUrl;
  }

  const envApiBaseUrl = normalizeApiBaseUrl(ENV_API_BASE_URL);
  if (envApiBaseUrl) {
    return envApiBaseUrl;
  }

  return import.meta.env.DEV ? DEV_API_BASE_URL : null;
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch(getRuntimeConfigPath(), { cache: "no-store" });
    if (!response.ok) {
      return null;
    }

    const parsed = (await response.json()) as RuntimeAppConfig;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      apiBaseUrl: typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl : null
    } satisfies RuntimeAppConfig;
  } catch {
    return null;
  }
}

async function probeApiHealth(baseUrl: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl}${API_HEALTH_PATH}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `API yanit veriyor fakat /health ${response.status} dondu.`
      };
    }

    return {
      ok: true,
      message: null
    };
  } catch (error) {
    return {
      ok: false,
      message: getMediaErrorMessage(error, "API'ye baglanilamadi.")
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function getMediaErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isAutoplayBlockedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const signal = `${error.name} ${error.message}`.toLowerCase();
  return signal.includes("notallowederror") || signal.includes("user didn't interact") || signal.includes("play() failed");
}

function isPlayInterruptedError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const signal = `${error.name} ${error.message}`.toLowerCase();
  return signal.includes("aborterror") || signal.includes("interrupted");
}

function isUnsupportedSourceError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const signal = `${error.name} ${error.message}`.toLowerCase();
  return (
    signal.includes("notsupportederror") ||
    signal.includes("no supported sources") ||
    signal.includes("not supported")
  );
}

function escapeFocusKey(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, "\\$&");
}

function getFocusableTarget(target: EventTarget | null, scope: HTMLElement | null) {
  if (!(target instanceof HTMLElement) || !scope) {
    return null;
  }

  const candidate = target.closest<HTMLElement>(TV_FOCUSABLE_SELECTOR);
  return candidate && scope.contains(candidate) ? candidate : null;
}

function getTvFocusableElements(scope: HTMLElement) {
  return Array.from(scope.querySelectorAll<HTMLElement>(TV_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    if ("disabled" in element && typeof element.disabled === "boolean" && element.disabled) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function clearTvActiveState(scope: HTMLElement) {
  scope.querySelectorAll<HTMLElement>('[data-tv-active="true"]').forEach((element) => {
    delete element.dataset.tvActive;
  });
}

function syncTvActiveState(scope: HTMLElement, element: HTMLElement) {
  clearTvActiveState(scope);
  element.dataset.tvActive = "true";
}

function revealFocusedElement(element: HTMLElement, behavior: ScrollBehavior) {
  element.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior
  });
}

function focusTvElement(scope: HTMLElement, element: HTMLElement, behavior: ScrollBehavior) {
  syncTvActiveState(scope, element);
  element.focus({ preventScroll: true });
  window.requestAnimationFrame(() => {
    revealFocusedElement(element, behavior);
  });
}

function getRectCenter(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function getDirectionalScore(currentRect: DOMRect, candidateRect: DOMRect, direction: TvDirection) {
  const currentCenter = getRectCenter(currentRect);
  const candidateCenter = getRectCenter(candidateRect);
  const horizontalGap =
    candidateRect.left >= currentRect.right
      ? candidateRect.left - currentRect.right
      : currentRect.left >= candidateRect.right
        ? currentRect.left - candidateRect.right
        : 0;
  const verticalGap =
    candidateRect.top >= currentRect.bottom
      ? candidateRect.top - currentRect.bottom
      : currentRect.top >= candidateRect.bottom
        ? currentRect.top - candidateRect.bottom
        : 0;
  const overlapX = Math.max(0, Math.min(currentRect.right, candidateRect.right) - Math.max(currentRect.left, candidateRect.left));
  const overlapY = Math.max(0, Math.min(currentRect.bottom, candidateRect.bottom) - Math.max(currentRect.top, candidateRect.top));

  if (direction === "left") {
    if (candidateCenter.x >= currentCenter.x - 4) {
      return Number.POSITIVE_INFINITY;
    }

    return horizontalGap * 1000 + Math.abs(candidateCenter.y - currentCenter.y) + (overlapY > 0 ? 0 : 220);
  }

  if (direction === "right") {
    if (candidateCenter.x <= currentCenter.x + 4) {
      return Number.POSITIVE_INFINITY;
    }

    return horizontalGap * 1000 + Math.abs(candidateCenter.y - currentCenter.y) + (overlapY > 0 ? 0 : 220);
  }

  if (direction === "up") {
    if (candidateCenter.y >= currentCenter.y - 4) {
      return Number.POSITIVE_INFINITY;
    }

    return verticalGap * 1000 + Math.abs(candidateCenter.x - currentCenter.x) + (overlapX > 0 ? 0 : 220);
  }

  if (candidateCenter.y <= currentCenter.y + 4) {
    return Number.POSITIVE_INFINITY;
  }

  return verticalGap * 1000 + Math.abs(candidateCenter.x - currentCenter.x) + (overlapX > 0 ? 0 : 220);
}

function findBestDirectionalCandidate(candidates: HTMLElement[], currentElement: HTMLElement, direction: TvDirection) {
  const currentRect = currentElement.getBoundingClientRect();
  let bestMatch: { element: HTMLElement; score: number } | null = null;

  for (const candidate of candidates) {
    if (candidate === currentElement) {
      continue;
    }

    const score = getDirectionalScore(currentRect, candidate.getBoundingClientRect(), direction);
    if (!Number.isFinite(score)) {
      continue;
    }

    if (!bestMatch || score < bestMatch.score) {
      bestMatch = { element: candidate, score };
    }
  }

  return bestMatch?.element ?? null;
}

function shouldPreserveArrowBehavior(element: HTMLElement | null, key: string) {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLSelectElement) {
    return true;
  }

  if (element instanceof HTMLTextAreaElement || element.isContentEditable) {
    return key === "ArrowLeft" || key === "ArrowRight";
  }

  if (element instanceof HTMLInputElement) {
    const inputType = (element.type || "text").toLowerCase();

    if (inputType === "range") {
      return key === "ArrowLeft" || key === "ArrowRight";
    }

    if (["button", "checkbox", "color", "file", "image", "radio", "reset", "submit"].includes(inputType)) {
      return false;
    }

    return key === "ArrowLeft" || key === "ArrowRight";
  }

  return false;
}

function useTvNavigation({
  scopeRef,
  routeKey,
  overlayOpen,
  onBack
}: {
  scopeRef: { current: HTMLElement | null };
  routeKey: string;
  overlayOpen: boolean;
  onBack: () => boolean;
}) {
  const focusMemoryRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) {
      return;
    }
    const activeScope = scope;

    function handleFocusIn(event: FocusEvent) {
      const target = getFocusableTarget(event.target, activeScope);
      if (!target) {
        return;
      }

      syncTvActiveState(activeScope, target);
      const focusKey = target.dataset.tvFocusKey;
      if (focusKey) {
        focusMemoryRef.current[routeKey] = focusKey;
      }
    }

    activeScope.addEventListener("focusin", handleFocusIn);

    return () => {
      activeScope.removeEventListener("focusin", handleFocusIn);
    };
  }, [routeKey, scopeRef]);

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const rememberedKey = focusMemoryRef.current[routeKey];
      const overlayInitialSelector = `${TV_FOCUSABLE_SELECTOR}[data-tv-overlay-initial="true"]`;
      const pageInitialSelector = `${TV_FOCUSABLE_SELECTOR}[data-tv-initial="true"]`;
      const rememberedSelector = rememberedKey
        ? `${TV_FOCUSABLE_SELECTOR}[data-tv-focus-key="${escapeFocusKey(rememberedKey)}"]`
        : null;

      const nextTarget =
        (rememberedSelector ? scope.querySelector<HTMLElement>(rememberedSelector) : null) ??
        (overlayOpen ? scope.querySelector<HTMLElement>(overlayInitialSelector) : null) ??
        scope.querySelector<HTMLElement>(pageInitialSelector) ??
        getTvFocusableElements(scope)[0] ??
        null;

      if (nextTarget) {
        focusTvElement(scope, nextTarget, "auto");
      } else {
        clearTvActiveState(scope);
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [overlayOpen, routeKey, scopeRef]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const scope = scopeRef.current;
      if (!scope) {
        return;
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (activeElement && !scope.contains(activeElement)) {
        return;
      }

      if (event.key === "Escape" || event.key === "BrowserBack" || event.key === "GoBack") {
        if (onBack()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        return;
      }

      if (shouldPreserveArrowBehavior(activeElement, event.key)) {
        return;
      }

      const currentFocus = getFocusableTarget(activeElement, scope);
      if (!currentFocus) {
        const fallbackTarget =
          (overlayOpen ? scope.querySelector<HTMLElement>(`${TV_FOCUSABLE_SELECTOR}[data-tv-overlay-initial="true"]`) : null) ??
          scope.querySelector<HTMLElement>(`${TV_FOCUSABLE_SELECTOR}[data-tv-initial="true"]`) ??
          getTvFocusableElements(scope)[0] ??
          null;
        if (fallbackTarget) {
          event.preventDefault();
          focusTvElement(scope, fallbackTarget, "auto");
        }
        return;
      }

      const directionMap: Record<string, TvDirection> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down"
      };
      const direction = directionMap[event.key];
      const allCandidates = getTvFocusableElements(scope).filter((element) => element !== currentFocus);
      const sameRegionCandidates = currentFocus.dataset.tvRegion
        ? allCandidates.filter((element) => element.dataset.tvRegion === currentFocus.dataset.tvRegion)
        : [];
      const nextTarget =
        findBestDirectionalCandidate(sameRegionCandidates, currentFocus, direction) ??
        findBestDirectionalCandidate(allCandidates, currentFocus, direction);

      if (!nextTarget) {
        return;
      }

      event.preventDefault();
      focusTvElement(scope, nextTarget, "smooth");
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onBack, overlayOpen, routeKey, scopeRef]);
}

function detectVodTransport(url: string) {
  if (/\.m3u8(?:$|\?)/i.test(url)) {
    return "hls" as const;
  }
  return "native" as const;
}

function shouldUseHlsForVodPlayback(playback: VodPlaybackRecord) {
  if (playback.deliveryMode.startsWith("hls_")) {
    return true;
  }

  if (playback.transport === "hls") {
    return true;
  }

  const { url } = playback;
  if (!url) {
    return false;
  }

  return detectVodTransport(url) === "hls";
}

function canUseVodCompatibilityRetry(playback: VodPlaybackRecord | null | undefined) {
  if (!playback || !playback.url) {
    return false;
  }

  if (playback.deliveryMode !== "file_proxy") {
    return false;
  }

  return playback.transport !== "hls";
}

function clampPlaybackTime(nextTime: number, duration: number) {
  const safeTime = Number.isFinite(nextTime) ? nextTime : 0;
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, safeTime);
  }

  return Math.min(Math.max(0, safeTime), duration);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit"].includes((target.type || "text").toLowerCase());
  }

  return false;
}

function createQueueItem(item: PlaybackItem): PlaybackQueueItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    imageUrl: item.imageUrl,
    artworkMode: item.artworkMode,
    streamUrl: item.streamUrl,
    playbackAllowed: item.playbackAllowed,
    transport: item.transport,
    healthStatus: item.healthStatus,
    isVerified: item.isVerified,
    lastCheckedAt: item.lastCheckedAt
  };
}

function buildEpisodeSubtitle(seriesTitle: string, episode: EpisodeRecord) {
  return `${seriesTitle} / S${episode.seasonNumber}E${episode.episodeNumber}`;
}

function createSeriesArtworkItem(series: SeriesArtworkItem): PlaybackQueueItem {
  return {
    id: series.id,
    kind: "episode",
    title: series.title,
    subtitle: null,
    imageUrl: series.posterUrl,
    artworkMode: "poster",
    streamUrl: null,
    playbackAllowed: true
  };
}

function findNextPlayableEpisode(start: PlaybackItem | null | undefined, maxHops = 48) {
  let cursor = start ?? null;
  let hops = 0;

  while (cursor && hops < maxHops) {
    if (cursor.kind === "episode" && cursor.playbackAllowed) {
      return cursor;
    }
    cursor = cursor.nextItem ?? null;
    hops += 1;
  }

  return null;
}

function getSeriesPlaybackAllowed(series: SeriesRecord) {
  return series.featuredEpisode?.playbackAllowed ?? series.seasons.some((season) => season.episodes.some((episode) => episode.playbackAllowed));
}

function buildSeriesPlaybackItems(series: SeriesRecord) {
  const orderedEpisodes: Array<{ season: SeriesSeasonRecord; episode: EpisodeRecord }> = [];

  for (const season of series.seasons) {
    for (const episode of season.episodes) {
      orderedEpisodes.push({ season, episode });
    }
  }

  const itemsByEpisodeId = new Map<string, PlaybackItem>();
  let nextItem: PlaybackItem | null = null;

  for (let index = orderedEpisodes.length - 1; index >= 0; index -= 1) {
    const current = orderedEpisodes[index];
    if (!current) {
      continue;
    }

    const playbackItem: PlaybackItem = {
      id: current.episode.id,
      kind: "episode",
      title: current.episode.title,
      subtitle: buildEpisodeSubtitle(series.title, current.episode),
      imageUrl: series.posterUrl,
      artworkMode: "poster",
      streamUrl: current.episode.streamUrl,
      playbackAllowed: current.episode.playbackAllowed,
      nextItem
    };

    itemsByEpisodeId.set(current.episode.id, playbackItem);
    nextItem = playbackItem;
  }

  const featuredPlaybackItem = series.featuredEpisode ? itemsByEpisodeId.get(series.featuredEpisode.id) ?? null : null;

  return {
    itemsByEpisodeId,
    featuredPlaybackItem
  };
}

function MediaArtwork({ item, className = "" }: { item: PlaybackQueueItem; className?: string }) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [item.imageUrl, item.id]);

  const src = broken ? null : item.imageUrl;
  const titleParts = item.title.trim().split(/\s+/).slice(0, 2);
  const monogram = titleParts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "FX";

  return (
    <div className={`media-artwork is-${item.artworkMode} ${className}`.trim()}>
      {src ? (
        <img
          src={src}
          alt={item.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth === 0 || image.naturalHeight === 0) {
              setBroken(true);
            }
          }}
        />
      ) : (
        <div className="media-artwork-fallback">
          <div className="media-artwork-fallback-content">
            <span className="media-artwork-monogram">{monogram}</span>
            <strong>{item.title}</strong>
            <span>{item.kind === "live" ? "Canli Yayin" : item.kind === "movie" ? "Film" : "Dizi"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function BrandGlyph() {
  return <img src="/favicon.svg" className="brand-glyph" alt="" aria-hidden="true" />;
}

function ProfileGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 19c1.5-3 4-4.5 6.5-4.5S17 16 18.5 19" />
    </svg>
  );
}

function LogoutGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
      <path d="M14 8l4 4-4 4" />
      <path d="M18 12H9" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </svg>
  );
}

function ChevronLeftGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

function ChevronRightGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

function VolumeGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <path d="M5 9h4l5-4v14l-5-4H5z" />
      <path d="M17 9.5a4.5 4.5 0 0 1 0 5" />
      <path d="M19.5 7a8 8 0 0 1 0 10" />
    </svg>
  );
}

function MuteGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <path d="M5 9h4l5-4v14l-5-4H5z" />
      <path d="M17 9l4 6" />
      <path d="M21 9l-4 6" />
    </svg>
  );
}

function FullscreenGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M4 16v4h4" />
      <path d="M20 16v4h-4" />
    </svg>
  );
}

function ExitFullscreenGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph" aria-hidden="true">
      <path d="M9 4H4v5" />
      <path d="M15 4h5v5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
      <path d="M9 9H4" />
      <path d="M15 9h5" />
      <path d="M9 15H4" />
      <path d="M15 15h5" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph vod-mini-glyph" aria-hidden="true">
      <path d="M8 6.5l9 5.5-9 5.5z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph vod-mini-glyph" aria-hidden="true">
      <path d="M8.5 7v10" />
      <path d="M15.5 7v10" />
    </svg>
  );
}

function SeekBackwardGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph vod-mini-glyph" aria-hidden="true">
      <path d="M14.5 7l-5 5 5 5" />
      <path d="M20 7l-5 5 5 5" />
    </svg>
  );
}

function SeekForwardGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="site-glyph vod-mini-glyph" aria-hidden="true">
      <path d="M9.5 7l5 5-5 5" />
      <path d="M4 7l5 5-5 5" />
    </svg>
  );
}

function ViewerHeader({
  userLabel,
  onLogout
}: {
  userLabel: string;
  onLogout: () => void;
}) {
  return (
    <header className="shell-header">
      <div className="site-header">
        <NavLink to="/" end className="site-brand">
          <BrandGlyph />
          <span className="site-brand-wordmark">FLIXIFY</span>
          <span className="site-brand-badge">PRO</span>
        </NavLink>

        <nav className="site-nav" aria-label="Ana navigasyon">
          {primaryNavigationItems.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href === "/"}
              className={({ isActive }) => `site-nav-link${isActive ? " is-active" : ""}`}
              data-tv-focusable="true"
              data-tv-region="header-nav"
              data-tv-focus-key={`nav-${item.href}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="site-header-actions">
          <NavLink
            to="/profil"
            className="site-user-chip"
            title={userLabel}
            data-tv-focusable="true"
            data-tv-region="header-nav"
            data-tv-focus-key="nav-settings"
          >
            <span className="site-user-icon">
              <ProfileGlyph />
            </span>
            <span className="site-user-label">{userLabel}</span>
          </NavLink>

          <button
            type="button"
            className="site-logout"
            onClick={onLogout}
            data-tv-focusable="true"
            data-tv-region="header-nav"
            data-tv-focus-key="nav-logout"
          >
            <LogoutGlyph />
            <span>Cikis</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase("tr-TR");
}

function normalizeAsciiText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeLiveCountryCode(value: string | null | undefined) {
  const sanitized = (value ?? "").replace(/[^a-z]/gi, "").toUpperCase();
  if (sanitized.length < 2 || sanitized.length > 3) {
    return null;
  }
  return sanitized;
}

function buildLiveCountryFilter(code: string) {
  const normalizedCode = normalizeLiveCountryCode(code);
  return normalizedCode
    ? `${LIVE_COUNTRY_FILTER_PREFIX}${normalizedCode}`
    : LIVE_DEFAULT_COUNTRY_FILTER;
}

function parseLiveCountryCodeFromFilter(group: string | null | undefined) {
  const normalized = normalizeAsciiText(group);
  if (!normalized) {
    return null;
  }

  if (normalized === "turkiye") {
    return "TR";
  }

  for (const prefix of ["country:", "ulke:"]) {
    if (!normalized.startsWith(prefix)) {
      continue;
    }
    return normalizeLiveCountryCode(normalized.slice(prefix.length).trim());
  }

  return null;
}

function parseLiveCountryCodeFromGroupTitle(title: string | null | undefined) {
  const normalizedTitle = normalizeAsciiText(title);
  const match = normalizedTitle.match(/^([a-z]{2,3})\s*:/);
  if (!match?.[1]) {
    return null;
  }
  return normalizeLiveCountryCode(match[1]);
}

function getLiveCountryLabel(code: string) {
  const normalizedCode = normalizeLiveCountryCode(code);
  if (!normalizedCode) {
    return code;
  }
  return liveCountryLabelByCode[normalizedCode] ?? normalizedCode;
}

function countKeywordMatches(text: string, keywords: string[]) {
  return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0);
}

function isBeinVipChannel(item: PlaybackItem) {
  const text = normalizeText(`${item.title} ${item.subtitle ?? ""}`);
  return /be[\s.-]*in/.test(text) && /(spor|sport|sports)/.test(text) && /vip/.test(text);
}

function isBeinSportsChannel(item: PlaybackItem) {
  const text = normalizeText(`${item.title} ${item.subtitle ?? ""}`);
  return /be[\s.-]*in/.test(text) && /(spor|sport|sports)/.test(text);
}

function getLiveSelectionScore(item: PlaybackItem, preferSports = false) {
  const text = normalizeText(`${item.title} ${item.subtitle ?? ""}`);
  const playbackScore = item.playbackAllowed ? 180 : -220;
  const healthScore =
    item.healthStatus === "healthy"
      ? 90
      : item.healthStatus === "degraded"
        ? 24
        : item.healthStatus === "unknown" || !item.healthStatus
          ? 8
          : -320;
  const verifiedScore = item.isVerified ? 18 : 0;
  const artworkScore = item.imageUrl ? 8 : 0;
  const sportsScore = preferSports ? countKeywordMatches(text, ["spor", "sports", "sport", "futbol", "mac", "lig"]) * 24 : 0;
  const beinScore = preferSports ? (isBeinVipChannel(item) ? 260 : isBeinSportsChannel(item) ? 140 : 0) : 0;

  return playbackScore + healthScore + verifiedScore + artworkScore + sportsScore + beinScore;
}

function getPreferredLiveItem(items: PlaybackItem[], options?: { preferSports?: boolean }) {
  if (!items.length) {
    return null;
  }

  const preferSports = options?.preferSports ?? false;
  return [...items]
    .sort((left, right) => getLiveSelectionScore(right, preferSports) - getLiveSelectionScore(left, preferSports))[0] ?? null;
}

function buildEditorialSelection<T extends PlaybackItem>(
  items: T[],
  limit: number,
  scorer: (item: T, index: number) => number,
  pinnedItem?: T | null
) {
  const selected: T[] = [];
  const seenIds = new Set<string>();

  if (pinnedItem) {
    selected.push(pinnedItem);
    seenIds.add(pinnedItem.id);
  }

  const scoredItems = items
    .map((item, index) => ({ item, index, score: scorer(item, index) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  for (const entry of scoredItems) {
    if (selected.length >= limit) {
      break;
    }
    if (seenIds.has(entry.item.id)) {
      continue;
    }
    selected.push(entry.item);
    seenIds.add(entry.item.id);
  }

  return selected.slice(0, limit);
}

function getItemKindLabel(item: PlaybackItem) {
  if (item.kind === "live") {
    return "Canli";
  }
  if (item.kind === "movie") {
    return "Film";
  }
  return "Dizi";
}

function getPlayActionLabel(item: PlaybackItem) {
  if (item.kind === "live") {
    return "Canli Ac";
  }
  if (item.kind === "movie") {
    return "Filmi Oynat";
  }
  return "Diziyi Baslat";
}

function getRailCardCopy(item: PlaybackItem) {
  if (item.kind === "live") {
    return item.playbackAllowed
      ? `${item.subtitle ?? "Canli yayin"} icin hizli acilis rail'i`
      : "Paket aktif oldugunda bu kanal tek tusla acilir.";
  }

  if (item.kind === "movie") {
    return item.subtitle
      ? `${item.subtitle} rafinda premium poster secimi`
      : "One cikan film seckisi";
  }

  return item.subtitle ?? "Binge-ready dizi secimi";
}

function getHeroDescription(item: PlaybackItem) {
  if (item.kind === "movie") {
    return "Aksam izleme seansini tek hamlede baslatan, poster odakli ve karanlik sinema yuzeyine oturan premium film secimi.";
  }

  if (item.kind === "live") {
    return "Mac gunu kanallarini, haber akislarini ve hizli acilan premium yayinlari ayni billboard ustunden yoneten secili canli TV katmani.";
  }

  return "Tek sezonda akip gidecek diziler, ilk bolumden itibaren otomatik siradaki akisa hazir premium seyir deneyimi ile sunuluyor.";
}

function getBillboardEyebrow(item: PlaybackItem) {
  if (item.kind === "movie") {
    return "Flixify Film Selection";
  }
  if (item.kind === "live") {
    return "Canli Yayin Spotlight";
  }
  return "Binge-Worthy Series";
}

function getHeroMeta(item: PlaybackItem) {
  const parts = item.kind === "live" ? [] : [getItemKindLabel(item)];

  if (item.subtitle) {
    parts.push(item.subtitle);
  }

  if (item.kind === "movie") {
    parts.push("4K Ready");
  }

  if (item.kind === "episode") {
    parts.push("Auto Next");
  }

  return parts.slice(0, 3);
}

function HomeBillboard({
  item,
  subscriptionLabel,
  liveSpotlight,
  movieCount,
  seriesCount,
  liveCount,
  onPlay,
  onBrowseMovies,
  onBrowseLive
}: {
  item: PlaybackItem;
  subscriptionLabel: string;
  liveSpotlight: PlaybackItem | null;
  movieCount: number;
  seriesCount: number;
  liveCount: number;
  onPlay: (item: PlaybackItem) => void;
  onBrowseMovies: () => void;
  onBrowseLive: () => void;
}) {
  const spotlightIsBein = liveSpotlight ? isBeinSportsChannel(liveSpotlight) : false;

  return (
    <section className="home-billboard">
      <div className="home-billboard-backdrop" aria-hidden="true">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="eager" referrerPolicy="no-referrer" />
        ) : null}
      </div>

      <div className="home-billboard-content">
        <span className="home-eyebrow">{getBillboardEyebrow(item)}</span>
        <h1>{item.title}</h1>
        <div className="home-billboard-meta">
          {getHeroMeta(item).map((part) => (
            <span key={part} className="pill">
              {part}
            </span>
          ))}
          <span className="pill is-accent">{subscriptionLabel}</span>
        </div>
        <p className="home-billboard-description">{getHeroDescription(item)}</p>
        <div className="button-row">
          <button
            type="button"
            className="button button-large"
            onClick={() => onPlay(item)}
            data-tv-focusable="true"
            data-tv-region="home-hero"
            data-tv-focus-key="home-hero-play"
            data-tv-initial="true"
          >
            {getPlayActionLabel(item)}
          </button>
          <button
            type="button"
            className="button secondary button-large"
            onClick={onBrowseMovies}
            data-tv-focusable="true"
            data-tv-region="home-hero"
            data-tv-focus-key="home-hero-browse-movies"
          >
            Filmleri Kesfet
          </button>
        </div>
      </div>

      <aside className="home-billboard-panel">
        <div className="home-spotlight-card">
          <span className="home-panel-label">Canli Spor Odagi</span>
          <strong>{liveSpotlight?.title ?? "Canli Spor Vitrini"}</strong>
          <p>
            {spotlightIsBein ? "beIN oncelikli secimle" : "spor odakli secimle"} mac gunu kanalina hizli ulas, ardindan kalan premium spor ve haber
            akisini tek rail ustunden gez.
          </p>
          <button
            type="button"
            className="button secondary home-panel-button"
            onClick={() => {
              if (liveSpotlight) {
                onPlay(liveSpotlight);
                return;
              }
              onBrowseLive();
            }}
            data-tv-focusable="true"
            data-tv-region="home-hero"
            data-tv-focus-key="home-hero-browse-live"
          >
            {liveSpotlight ? (spotlightIsBein ? "beIN Kanalini Ac" : "Canli Kanali Ac") : "Canli TV'ye Git"}
          </button>
        </div>

        <div className="home-stat-grid">
          <article className="home-stat-card">
            <span>Filmler</span>
            <strong>{movieCount}</strong>
            <small>Seckin poster rail'i</small>
          </article>
          <article className="home-stat-card">
            <span>Diziler</span>
            <strong>{seriesCount}</strong>
            <small>Binge-ready secki</small>
          </article>
          <article className="home-stat-card">
            <span>Canli TV</span>
            <strong>{liveCount}</strong>
            <small>beIN dahil premium kanal rail'i</small>
          </article>
          <article className="home-stat-card">
            <span>Deneyim</span>
            <strong>4K</strong>
            <small>Sinema parlakligi ve koyu cam yuzeyler</small>
          </article>
        </div>
      </aside>
    </section>
  );
}

function HomeRail({
  title,
  badge,
  description,
  items,
  onPlay,
  onBrowseAll
}: {
  title: string;
  badge: string;
  description: string;
  items: PlaybackItem[];
  onPlay: (item: PlaybackItem) => void;
  onBrowseAll: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  function scrollRail(direction: "left" | "right") {
    trackRef.current?.scrollBy({
      left: direction === "right" ? 960 : -960,
      behavior: "smooth"
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="home-rail">
      <div className="home-rail-header">
        <div>
          <span className="home-rail-badge">{badge}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>

        <div className="home-rail-actions">
          <button type="button" className="rail-control" onClick={() => scrollRail("left")} aria-label={`${title} sola kaydir`}>
            ‹
          </button>
          <button type="button" className="rail-control" onClick={() => scrollRail("right")} aria-label={`${title} saga kaydir`}>
            ›
          </button>
          <button type="button" className="button secondary" onClick={onBrowseAll}>
            Tumunu Ac
          </button>
        </div>
      </div>

      <div ref={trackRef} className="home-rail-track" data-tv-scroll="horizontal">
        {items.map((item, index) => {
          return (
            <article
              key={`${title}-${item.id}`}
              className={`home-rail-card ${item.playbackAllowed ? "is-playable" : "is-locked"}`}
              onClick={() => onPlay(item)}
              role="button"
              tabIndex={0}
              data-tv-focusable="true"
              data-tv-region={`home-rail-${title}`}
              data-tv-focus-key={`home-rail-${title}-${item.id}`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPlay(item);
                }
              }}
            >
              <div className="home-rail-rank">{String(index + 1).padStart(2, "0")}</div>
              <MediaArtwork item={item} className="home-rail-artwork" />
              <div className="home-rail-body">
                {item.kind === "live" ? null : (
                  <div className="home-rail-topline">
                    <span className="pill">{getItemKindLabel(item)}</span>
                  </div>
                )}
                <strong>{item.title}</strong>
                <p>{getRailCardCopy(item)}</p>
                {item.kind === "live" ? null : (
                  <div className="home-rail-meta">
                    <span className={`status-pill ${item.playbackAllowed ? "is-success" : "is-muted"}`}>
                      {item.playbackAllowed ? "Hazir" : "Paket Gerekli"}
                    </span>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function HomeDashboard({
  heroItem,
  liveSpotlight,
  featuredMovies,
  featuredSeries,
  featuredLive,
  subscriptionLabel,
  onPlay,
  onNavigate
}: {
  heroItem: PlaybackItem | null;
  liveSpotlight: PlaybackItem | null;
  featuredMovies: PlaybackItem[];
  featuredSeries: PlaybackItem[];
  featuredLive: PlaybackItem[];
  subscriptionLabel: string;
  onPlay: (item: PlaybackItem) => void;
  onNavigate: (path: string) => void;
}) {
  if (!heroItem && featuredMovies.length === 0 && featuredSeries.length === 0 && featuredLive.length === 0) {
    return (
      <section className="panel-card panel-stack">
        <h2>Katalog hazirlaniyor</h2>
        <p className="muted">
          Icerikler yuklenir yuklenmez secili film, dizi ve canli TV rail'leri ana sayfada premium yerlesimle gorunecek.
        </p>
      </section>
    );
  }

  return (
    <div className="home-dashboard">
      {heroItem ? (
        <HomeBillboard
          item={heroItem}
          subscriptionLabel={subscriptionLabel}
          liveSpotlight={liveSpotlight}
          movieCount={featuredMovies.length}
          seriesCount={featuredSeries.length}
          liveCount={featuredLive.length}
          onPlay={onPlay}
          onBrowseMovies={() => onNavigate("/filmler")}
          onBrowseLive={() => onNavigate("/canli-tv")}
        />
      ) : null}

      <HomeRail
        title="Filmler"
        badge="10 Seckin Film"
        description="Poster kuvveti yuksek, akisi hizli ve premium aksam seansina yakisan film rail'i."
        items={featuredMovies}
        onPlay={onPlay}
        onBrowseAll={() => onNavigate("/filmler")}
      />

      <HomeRail
        title="Diziler"
        badge="10 Seckin Dizi"
        description="Tek dokunusla baslayan, sonraki bolume otomatik gecen binge-ready dizi secimi."
        items={featuredSeries}
        onPlay={onPlay}
        onBrowseAll={() => onNavigate("/diziler")}
      />

      <HomeRail
        title="Canli TV"
        badge="10 Canli Kanal"
        description="Spor, haber ve premium yayinlar; beIN Sports VIP oncelikli sekilde canli TV rail'ine yerlestirildi."
        items={featuredLive}
        onPlay={onPlay}
        onBrowseAll={() => onNavigate("/canli-tv")}
      />
    </div>
  );
}

// Icons
function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {visible ? (
        <>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SmartphoneIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function formatCodeDisplay(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16);
  const parts = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    parts.push(cleaned.slice(i, i + 4));
  }
  return parts.join(" ");
}

function LoginAuthPage({
  onLogin,
  busy,
  error
}: {
  onLogin: (code: string, deviceName: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(true);

  useEffect(() => {
    const prefill = popAuthPrefillCode();
    if (prefill) {
      setCode(prefill);
    }
  }, []);

  const normalizedCode = normalizeAuthCode(code);
  const progressSegments = Math.min(Math.ceil(normalizedCode.length / 4), 4);

  return (
    <div className="content auth-screen-content">
      <section className="auth-screen-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <BrandGlyph />
          </div>
          <span className="auth-logo-text">FLIXIFY</span>
          <span className="auth-logo-badge">PRO</span>
        </div>

        {/* Subtitle */}
        <p className="auth-subtitle">16 haneli erişim kodunuzu girin</p>

        {/* Form */}
        <div className="auth-form">
          <label className="auth-field-label">Erişim Kodu</label>
          
          <div className="auth-input-wrapper">
            <input
              className="auth-input"
              type={showCode ? "text" : "password"}
              value={formatCodeDisplay(code)}
              onChange={(event) => {
                const rawValue = event.target.value.replace(/[^a-zA-Z0-9]/g, "");
                setCode(rawValue.toUpperCase().slice(0, 16));
              }}
              placeholder="X7F2 A9B1 C4D8 E6F0"
              autoComplete="off"
              maxLength={19}
              data-tv-focusable="true"
              data-tv-region="auth-form"
              data-tv-initial="true"
              data-tv-focus-key="auth-input"
            />
            <button
              type="button"
              className="auth-eye-button"
              onClick={() => setShowCode(!showCode)}
              data-tv-focusable="true"
              data-tv-region="auth-form"
              data-tv-focus-key="auth-eye"
            >
              <EyeIcon visible={showCode} />
            </button>
          </div>

          {/* Progress bar */}
          <div className="auth-progress">
            <div className="auth-progress-segments">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`auth-progress-segment ${index < progressSegments ? "active" : ""}`}
                />
              ))}
            </div>
            <span className="auth-char-count">{normalizedCode.length}/16</span>
          </div>

          {/* Error message */}
          {error ? <div className="auth-error">{error}</div> : null}

          {/* Submit button */}
          <button
            className="auth-submit-btn"
            type="button"
            disabled={busy || normalizedCode.length !== 16}
            onClick={() => void onLogin(normalizedCode, AUTH_DEVICE_NAME)}
            data-tv-focusable="true"
            data-tv-region="auth-form"
            data-tv-focus-key="auth-submit"
          >
            {busy ? (
              <span className="auth-loading">
                <span className="auth-spinner" />
                Giriş Yapılıyor...
              </span>
            ) : (
              "Giriş Yap"
            )}
          </button>
        </div>

        {/* Links */}
        <div className="auth-links">
          <p className="auth-link-text">
            Hesabınız yok mu? <NavLink to={registerRoute} data-tv-focusable="true" data-tv-region="auth-links" data-tv-focus-key="auth-register-link">Hesap Oluştur</NavLink>
          </p>
          <NavLink to="/" className="auth-back-link" data-tv-focusable="true" data-tv-region="auth-links" data-tv-focus-key="auth-back-link">
            <ArrowLeftIcon />
            Ana Sayfaya Dön
          </NavLink>
        </div>

        {/* Feature cards */}
        <div className="auth-features">
          <div className="auth-feature-card">
            <div className="auth-feature-icon">
              <LockIcon />
            </div>
            <strong>Güvenli</strong>
            <span>Şifreli erişim</span>
          </div>
          <div className="auth-feature-card">
            <div className="auth-feature-icon">
              <ZapIcon />
            </div>
            <strong>Hızlı</strong>
            <span>Anında yayın</span>
          </div>
          <div className="auth-feature-card">
            <div className="auth-feature-icon">
              <SmartphoneIcon />
            </div>
            <strong>Her Yerde</strong>
            <span>Tüm cihazlar</span>
          </div>
        </div>

        {/* Footer */}
        <footer className="auth-footer">
          <p>© 2026 Flixify Pro. Tüm hakları saklıdır.</p>
        </footer>
      </section>
    </div>
  );
}

function RegisterAuthPage({
  issueAnonCode,
  busy,
  error
}: {
  issueAnonCode: (deviceName: string) => Promise<string | null>;
  busy: boolean;
  error: string | null;
}) {
  const navigate = useNavigate();
  const [issuedCode, setIssuedCode] = useState("");
  const [displayCode, setDisplayCode] = useState("");
  const [revealedCount, setRevealedCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Realistic code generation animation
  useEffect(() => {
    if (!issuedCode) {
      setDisplayCode("");
      setRevealedCount(0);
      return;
    }

    setIsGenerating(true);
    setRevealedCount(0);
    setCopied(false);
    setAcknowledged(false);

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let currentIndex = 0;
    const codeLength = issuedCode.length;
    
    // Initial scramble phase
    const scrambleInterval = setInterval(() => {
      let tempCode = "";
      for (let i = 0; i < codeLength; i++) {
        if (i < currentIndex) {
          tempCode += issuedCode[i];
        } else {
          tempCode += chars[Math.floor(Math.random() * chars.length)];
        }
      }
      setDisplayCode(tempCode);
    }, 50);

    // Reveal characters one by one
    const revealNextChar = () => {
      if (currentIndex >= codeLength) {
        clearInterval(scrambleInterval);
        setDisplayCode(issuedCode);
        setIsGenerating(false);
        return;
      }

      currentIndex++;
      setRevealedCount(currentIndex);
      
      const delay = 80 + Math.random() * 120;
      setTimeout(revealNextChar, delay);
    };

    setTimeout(() => {
      revealNextChar();
    }, 300);

    return () => {
      clearInterval(scrambleInterval);
    };
  }, [issuedCode]);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  async function handleCreateCode() {
    const nextCode = await issueAnonCode(AUTH_DEVICE_NAME);
    if (!nextCode) {
      return;
    }
    setIssuedCode(normalizeAuthCode(nextCode));
  }

  async function handleCopy() {
    if (!issuedCode || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(issuedCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function handleContinueLogin() {
    if (!issuedCode || !acknowledged) return;
    setAuthPrefillCode(issuedCode);
    navigate(loginRoute);
  }

  const progressPercent = issuedCode ? (revealedCount / issuedCode.length) * 100 : 0;
  const isComplete = issuedCode && !isGenerating && revealedCount === issuedCode.length;

  // Icons
  function CopyIcon() {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    );
  }

  function DownloadIcon() {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" x2="12" y1="15" y2="3" />
      </svg>
    );
  }

  function CheckIcon() {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }

  function ShieldIcon() {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      </svg>
    );
  }

  function SparklesIcon() {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3" />
        <path d="M5 3v4" />
        <path d="M19 17v4" />
        <path d="M3 5h4" />
        <path d="M17 19h4" />
      </svg>
    );
  }

  function KeyIcon() {
    return (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7.5" cy="15.5" r="5.5" />
        <path d="m21 2-9.6 9.6" />
        <path d="m15.5 7.5 3 3L22 7l-3-3" />
      </svg>
    );
  }

  return (
    <div className="content auth-screen-content">
      <section className="auth-screen-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <BrandGlyph />
          </div>
          <span className="auth-logo-text">FLIXIFY</span>
          <span className="auth-logo-badge">PRO</span>
        </div>

        {/* Subtitle */}
        <p className="auth-subtitle">
          {!issuedCode ? "Yeni bir hesap oluşturun" : "Hesabınız oluşturuldu!"}
        </p>

        {/* Main Content */}
        <div className="auth-form">
          {!issuedCode ? (
            <>
              <div className="auth-intro">
                <p>Tek kullanımlık erişim kodunuzu oluşturun.</p>
              </div>

              <button 
                className="auth-submit-btn" 
                type="button" 
                onClick={() => void handleCreateCode()} 
                disabled={busy}
                data-tv-focusable="true"
                data-tv-region="auth-form"
                data-tv-initial="true"
                data-tv-focus-key="register-submit"
              >
                {busy ? (
                  <span className="auth-loading">
                    <span className="auth-spinner" />
                    Kod Üretiliyor...
                  </span>
                ) : (
                  "Hesap Numarası Oluştur"
                )}
              </button>
            </>
          ) : (
            <>
              {/* Code Display Box */}
              <div className={`auth-code-box ${isGenerating ? "generating" : ""} ${isComplete ? "complete" : ""}`}>
                <div className="auth-code-header">
                  <span className="auth-code-label">Erişim Kodunuz</span>
                  {isComplete && (
                    <span className="auth-code-status success">
                      <CheckIcon />
                      Hazır
                    </span>
                  )}
                  {isGenerating && (
                    <span className="auth-code-status generating">
                      <span className="auth-pulse" />
                      Üretiliyor
                    </span>
                  )}
                </div>

                <div className="auth-code-value">
                  {formatAuthCodeBlocks(displayCode)}
                </div>

                {/* Progress Bar */}
                <div className="auth-code-progress">
                  <div 
                    className="auth-code-progress-fill" 
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="auth-actions">
                <button
                  className={`auth-action-btn ${copied ? "success" : ""}`}
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!isComplete}
                  data-tv-focusable="true"
                  data-tv-region="auth-actions"
                  data-tv-focus-key="auth-copy"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? "Kopyalandı" : "Kopyala"}
                </button>
                
                <button
                  className="auth-action-btn"
                  type="button"
                  onClick={() => downloadAuthCodeAsText(issuedCode)}
                  disabled={!isComplete}
                  data-tv-focusable="true"
                  data-tv-region="auth-actions"
                  data-tv-focus-key="auth-download"
                >
                  <DownloadIcon />
                  İndir
                </button>
              </div>

              {/* Warning Box */}
              <div className={`auth-warning ${isComplete ? "active" : ""}`}>
                <div className="auth-warning-icon">
                  <ShieldIcon />
                </div>
                <div className="auth-warning-content">
                  <strong>Önemli!</strong>
                  <p>Bu kodu kaybetmeyin. Kodunuzu kaybederseniz hesabınıza erişemezsiniz.</p>
                </div>
              </div>

              {/* Acknowledgment Checkbox */}
              <label className={`auth-checkbox-row ${isComplete ? "enabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={!isComplete}
                />
                <span className="auth-checkbox-checkmark" />
                <span className="auth-checkbox-text">
                  Hesap numaramı kaydettiğimi onaylıyorum
                </span>
              </label>

              {/* Login Button */}
              <button
                className="auth-submit-btn"
                type="button"
                disabled={!isComplete || !acknowledged}
                onClick={handleContinueLogin}
                data-tv-focusable="true"
                data-tv-region="auth-form"
                data-tv-focus-key="auth-login"
              >
                Oturum Aç
              </button>
            </>
          )}

          {/* Error Message */}
          {error ? <div className="auth-error">{error}</div> : null}
        </div>

        {/* Links */}
        <div className="auth-links">
          <p className="auth-link-text">
            Zaten hesabınız var mı? <NavLink to={loginRoute} data-tv-focusable="true" data-tv-region="auth-links" data-tv-focus-key="auth-login-link">Giriş Yapın</NavLink>
          </p>
          <NavLink to="/" className="auth-back-link" data-tv-focusable="true" data-tv-region="auth-links" data-tv-focus-key="auth-back-link">
            <ArrowLeftIcon />
            Ana Sayfaya Dön
          </NavLink>
        </div>

        {/* Feature Cards */}
        <div className="auth-features">
          <div className="auth-feature-card">
            <div className="auth-feature-icon highlight">
              <KeyIcon />
            </div>
            <strong>Anonim</strong>
            <span>Kayıt gerekmez</span>
          </div>
          <div className="auth-feature-card">
            <div className="auth-feature-icon highlight">
              <SparklesIcon />
            </div>
            <strong>Anında</strong>
            <span>Hemen kullanıma hazır</span>
          </div>
          <div className="auth-feature-card">
            <div className="auth-feature-icon highlight">
              <ShieldIcon />
            </div>
            <strong>Güvenli</strong>
            <span>Şifreli erişim</span>
          </div>
        </div>

        {/* Footer */}
        <footer className="auth-footer">
          <p>© 2026 Flixify Pro. Tüm hakları saklıdır.</p>
        </footer>
      </section>
    </div>
  );
}

function AuthExperience({ core }: { core: ViewerCoreHandle }) {
  return (
    <Routes>
      <Route
        path={loginRoute}
        element={<LoginAuthPage onLogin={(code, deviceName) => core.loginByCode(code, deviceName)} busy={core.busy} error={core.error} />}
      />
      <Route
        path={registerRoute}
        element={<RegisterAuthPage issueAnonCode={(deviceName) => core.issueAnonCode(deviceName)} busy={core.busy} error={core.error} />}
      />
      {AUTH_LEGACY_REDIRECT_ENTRIES.map(([legacyPath, targetPath]) => (
        <Route key={legacyPath} path={legacyPath} element={<Navigate to={targetPath} replace />} />
      ))}
      <Route path="*" element={<Navigate to={loginRoute} replace />} />
    </Routes>
  );
}

function MoviesPage({
  title,
  items,
  groups,
  onApplyFilters,
  onLoadMore,
  hasMoreItems,
  onPlay
}: {
  title: string;
  items: PlaybackItem[];
  groups: CatalogGroup[];
  onApplyFilters: (search: string, group?: string) => Promise<void>;
  onLoadMore: (search: string, group?: string) => Promise<void>;
  hasMoreItems: boolean;
  onPlay: (item: PlaybackItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("");
  const [isFiltering, setIsFiltering] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [canScrollChipsLeft, setCanScrollChipsLeft] = useState(false);
  const [canScrollChipsRight, setCanScrollChipsRight] = useState(false);
  const applyFiltersRef = useRef(onApplyFilters);
  const activeGroupRef = useRef("");
  const chipRowRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);
  const loadingMoreInFlightRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const skipInitialFilterRef = useRef(true);
  const skipNextSearchEffectRef = useRef(false);
  const sortedGroups = [...groups].sort((left, right) => right.count - left.count);
  const groupChips =
    activeGroup && !sortedGroups.some((item) => item.title === activeGroup)
      ? [{ title: activeGroup, count: 0, kind: "movie" as const }, ...sortedGroups]
      : sortedGroups;

  useEffect(() => {
    applyFiltersRef.current = onApplyFilters;
  }, [onApplyFilters]);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    activeGroupRef.current = activeGroup;
  }, [activeGroup]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const rail = chipRowRef.current;
    if (!rail) {
      return;
    }

    function updateChipRailState() {
      const currentRail = chipRowRef.current;
      if (!currentRail) {
        return;
      }

      const maxScrollLeft = Math.max(0, currentRail.scrollWidth - currentRail.clientWidth);
      setCanScrollChipsLeft(currentRail.scrollLeft > 4);
      setCanScrollChipsRight(maxScrollLeft - currentRail.scrollLeft > 4);
    }

    const animationFrame = window.requestAnimationFrame(updateChipRailState);
    rail.addEventListener("scroll", updateChipRailState, { passive: true });
    window.addEventListener("resize", updateChipRailState);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      rail.removeEventListener("scroll", updateChipRailState);
      window.removeEventListener("resize", updateChipRailState);
    };
  }, [groupChips.length, activeGroup]);

  function clearMovieDebounce() {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }

  async function runMovieFilters(nextSearch: string, nextGroup: string) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsFiltering(true);

    try {
      await applyFiltersRef.current(nextSearch.trim(), nextGroup || undefined);
    } finally {
      if (requestIdRef.current === requestId) {
        setIsFiltering(false);
      }
    }
  }

  useEffect(() => {
    void runMovieFilters("", "");
  }, []);

  function submitMovieSearch() {
    clearMovieDebounce();
    void runMovieFilters(search, activeGroupRef.current);
  }

  function clearMovieSearch() {
    if (!search) {
      return;
    }

    skipNextSearchEffectRef.current = true;
    clearMovieDebounce();
    setSearch("");
    void runMovieFilters("", activeGroupRef.current);
  }

  function applyGroupFilter(nextGroup: string) {
    if (nextGroup === activeGroupRef.current) {
      return;
    }

    activeGroupRef.current = nextGroup;
    setActiveGroup(nextGroup);
    clearMovieDebounce();
    void runMovieFilters(search, nextGroup);
  }

  function scrollMovieChips(direction: "left" | "right") {
    const rail = chipRowRef.current;
    if (!rail) {
      return;
    }

    const travel = Math.max(220, Math.round(rail.clientWidth * 0.72));
    rail.scrollBy({
      left: direction === "left" ? -travel : travel,
      behavior: "smooth"
    });
  }

  async function loadNextMoviePage() {
    if (loadingMoreInFlightRef.current || isFiltering || !hasMoreItems) {
      return;
    }

    loadingMoreInFlightRef.current = true;
    setIsLoadingMore(true);

    try {
      await loadMoreRef.current(search.trim(), activeGroupRef.current || undefined);
    } finally {
      loadingMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    if (skipInitialFilterRef.current) {
      skipInitialFilterRef.current = false;
      return;
    }

    if (skipNextSearchEffectRef.current) {
      skipNextSearchEffectRef.current = false;
      return;
    }

    clearMovieDebounce();
    debounceTimerRef.current = window.setTimeout(() => {
      void runMovieFilters(search, activeGroupRef.current);
    }, 260);

    return () => {
      clearMovieDebounce();
    };
  }, [search]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !items.length || !hasMoreItems) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadNextMoviePage();
        }
      },
      {
        rootMargin: "320px 0px"
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [items.length, hasMoreItems, isFiltering, search, activeGroup]);

  return (
    <section className="movies-page">
      <article className="movies-toolbar-panel">
        <div className="movies-toolbar-head">
          <div>
            <h2>{title}</h2>
          </div>
          <div className="movies-toolbar-summary">
            {isFiltering ? (
              <span className="movies-filter-status" aria-live="polite">
                Yukleniyor
              </span>
            ) : null}
          </div>
        </div>

        <div className="movies-filter-bar">
          <div className="movies-search-field">
            <SearchGlyph />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitMovieSearch();
                }
              }}
              placeholder="Film ara"
              className="movies-search-input"
              aria-label="Film ara"
              data-tv-focusable="true"
              data-tv-region="movies-search"
              data-tv-focus-key="movies-search"
              data-tv-initial="true"
            />
            {search ? (
              <button type="button" className="movies-search-clear" onClick={clearMovieSearch}>
                Temizle
              </button>
            ) : null}
          </div>
        </div>

        <div className="movies-chip-scroller">
          <button
            type="button"
            className="movies-chip-nav"
            onClick={() => scrollMovieChips("left")}
            aria-label="Kategorileri sola kaydir"
            disabled={!canScrollChipsLeft}
          >
            <ChevronLeftGlyph />
          </button>

          <div ref={chipRowRef} className="movies-chip-row" aria-label="Film grup secimi" data-tv-scroll="horizontal">
            <button
              type="button"
              className={`movies-chip${activeGroup === "" ? " active" : ""}`}
              onClick={() => applyGroupFilter("")}
              data-tv-focusable="true"
              data-tv-region="movies-chips"
              data-tv-focus-key="movies-chip-all"
            >
              Tumu
            </button>
            {groupChips.map((item) => (
              <button
                key={item.title}
                type="button"
                className={`movies-chip${activeGroup === item.title ? " active" : ""}`}
                onClick={() => applyGroupFilter(item.title)}
                data-tv-focusable="true"
                data-tv-region="movies-chips"
                data-tv-focus-key={`movies-chip-${item.title}`}
              >
                {item.title} <strong>{item.count}</strong>
              </button>
            ))}
          </div>

          <button
            type="button"
            className="movies-chip-nav"
            onClick={() => scrollMovieChips("right")}
            aria-label="Kategorileri saga kaydir"
            disabled={!canScrollChipsRight}
          >
            <ChevronRightGlyph />
          </button>
        </div>
      </article>

      <section className="movies-grid-section">
        {items.length > 0 ? (
          <>
            <div className="movies-grid">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`movie-poster-card ${item.playbackAllowed ? "playable" : "locked"}`}
                  onClick={() => onPlay(item)}
                  aria-label={item.subtitle ? `${item.title} - ${item.subtitle}` : item.title}
                  title={item.subtitle ? `${item.title} - ${item.subtitle}` : item.title}
                  data-tv-focusable="true"
                  data-tv-region="movies-grid"
                  data-tv-focus-key={`movie-${item.id}`}
                  onFocus={() => {
                    if (index >= Math.max(0, items.length - 8)) {
                      void loadNextMoviePage();
                    }
                  }}
                >
                  <div className="movie-poster-visual">
                    <MediaArtwork item={item} className="movie-poster-artwork" />
                  </div>
                </button>
              ))}
            </div>

            {hasMoreItems || isLoadingMore ? (
              <div ref={loadMoreSentinelRef} className="movies-load-more-anchor" aria-hidden="true">
                {isLoadingMore ? <span className="movies-load-more-indicator" /> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="movies-empty-state" aria-live="polite">
            <strong>Filtreye uygun film bulunamadi.</strong>
            <p className="muted">Arama terimini temizleyip baska bir kategori deneyebilirsiniz.</p>
          </div>
        )}
      </section>
    </section>
  );
}

function LiveTvPage({
  items,
  groups,
  onApplyFilters,
  onLoadMore,
  hasMoreItems,
  resolveLivePlayback,
  reportLivePlayback
}: {
  items: PlaybackItem[];
  groups: CatalogGroup[];
  onApplyFilters: (search: string, group?: string) => Promise<void>;
  onLoadMore: (search: string, group?: string) => Promise<void>;
  hasMoreItems: boolean;
  resolveLivePlayback: ViewerCoreHandle["resolveLivePlayback"];
  reportLivePlayback: ViewerCoreHandle["reportLivePlayback"];
}) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState(LIVE_DEFAULT_COUNTRY_FILTER);
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedGroup, setAppliedGroup] = useState(LIVE_DEFAULT_COUNTRY_FILTER);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [isFiltering, setIsFiltering] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const applyFiltersRef = useRef(onApplyFilters);
  const loadMoreRef = useRef(onLoadMore);
  const requestIdRef = useRef(0);
  const activeGroupRef = useRef(LIVE_DEFAULT_COUNTRY_FILTER);
  const appliedSearchRef = useRef("");
  const appliedGroupRef = useRef(LIVE_DEFAULT_COUNTRY_FILTER);
  const loadingMoreInFlightRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const channelListRef = useRef<HTMLDivElement | null>(null);
  const autoFillLengthRef = useRef(-1);
  const initialAutoSelectionDoneRef = useRef(false);

  useEffect(() => {
    applyFiltersRef.current = onApplyFilters;
  }, [onApplyFilters]);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    activeGroupRef.current = activeGroup;
  }, [activeGroup]);

  const countryCounts = new Map<string, number>();
  const nonCountryGroups: CatalogGroup[] = [];
  for (const group of groups) {
    const countryCode = parseLiveCountryCodeFromGroupTitle(group.title);
    if (!countryCode) {
      nonCountryGroups.push(group);
      continue;
    }
    countryCounts.set(countryCode, (countryCounts.get(countryCode) ?? 0) + group.count);
  }

  const countryChips = Array.from(countryCounts.entries())
    .map(([code, count]) => ({
      code,
      count,
      filter: buildLiveCountryFilter(code),
      label: getLiveCountryLabel(code)
    }))
    .sort((left, right) => {
      if (left.code === LIVE_DEFAULT_COUNTRY_CODE && right.code !== LIVE_DEFAULT_COUNTRY_CODE) {
        return -1;
      }
      if (right.code === LIVE_DEFAULT_COUNTRY_CODE && left.code !== LIVE_DEFAULT_COUNTRY_CODE) {
        return 1;
      }
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label, "tr-TR");
    });

  const activeCountryCode = parseLiveCountryCodeFromFilter(activeGroup);
  const countryChipsWithFallback =
    activeCountryCode && !countryChips.some((chip) => chip.code === activeCountryCode)
      ? [
          {
            code: activeCountryCode,
            count: 0,
            filter: buildLiveCountryFilter(activeCountryCode),
            label: getLiveCountryLabel(activeCountryCode)
          },
          ...countryChips
        ]
      : countryChips;

  const sortedGroups = [...nonCountryGroups].sort(
    (left, right) => right.count - left.count || left.title.localeCompare(right.title, "tr-TR")
  );
  const groupChips =
    activeGroup &&
    !activeCountryCode &&
    !sortedGroups.some((group) => group.title === activeGroup)
      ? [{ title: activeGroup, count: 0, kind: "live" as const }, ...sortedGroups]
      : sortedGroups;

  async function runLiveFilters(nextSearch: string, nextGroup: string) {
    const normalizedSearch = nextSearch.trim();
    const normalizedGroup = nextGroup.trim().length > 0 ? nextGroup.trim() : LIVE_DEFAULT_COUNTRY_FILTER;
    appliedSearchRef.current = normalizedSearch;
    appliedGroupRef.current = normalizedGroup;
    setAppliedSearch(normalizedSearch);
    setAppliedGroup(normalizedGroup);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsFiltering(true);

    try {
      await applyFiltersRef.current(normalizedSearch, normalizedGroup || undefined);
    } finally {
      if (requestIdRef.current === requestId) {
        setIsFiltering(false);
      }
    }
  }

  useEffect(() => {
    void runLiveFilters("", LIVE_DEFAULT_COUNTRY_FILTER);
  }, []);

  async function loadNextLivePage() {
    if (loadingMoreInFlightRef.current || isFiltering || !hasMoreItems) {
      return;
    }

    loadingMoreInFlightRef.current = true;
    setIsLoadingMore(true);

    try {
      await loadMoreRef.current(appliedSearchRef.current, appliedGroupRef.current || undefined);
    } catch {
      // Errors are reflected by the shared core error state.
    } finally {
      loadingMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const channelList = channelListRef.current;
    if (!sentinel || !channelList || !items.length || !hasMoreItems) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadNextLivePage();
        }
      },
      {
        root: channelList,
        rootMargin: "220px 0px"
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [items.length, hasMoreItems, isFiltering, appliedSearch, appliedGroup]);

  useEffect(() => {
    autoFillLengthRef.current = -1;
  }, [appliedSearch, appliedGroup]);

  useEffect(() => {
    const channelList = channelListRef.current;
    if (!channelList || !items.length || !hasMoreItems || isFiltering || isLoadingMore) {
      return;
    }

    if (autoFillLengthRef.current === items.length) {
      return;
    }
    autoFillLengthRef.current = items.length;

    const frame = window.requestAnimationFrame(() => {
      const currentList = channelListRef.current;
      if (!currentList || currentList.scrollHeight > currentList.clientHeight + 8) {
        return;
      }
      void loadNextLivePage();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [items.length, hasMoreItems, isFiltering, isLoadingMore, appliedSearch, appliedGroup]);

  const preferredChannel = getPreferredLiveItem(items, { preferSports: true });

  useEffect(() => {
    if (items.length === 0) {
      setSelectedChannelId(null);
      return;
    }

    const selectedStillExists = selectedChannelId ? items.some((item) => item.id === selectedChannelId) : false;
    if (!selectedStillExists && selectedChannelId) {
      setSelectedChannelId(null);
      return;
    }

    if (!selectedChannelId && !initialAutoSelectionDoneRef.current && appliedSearch.length === 0) {
      initialAutoSelectionDoneRef.current = true;
      setSelectedChannelId(preferredChannel?.id ?? items[0]?.id ?? null);
    }
  }, [items, preferredChannel?.id, selectedChannelId, appliedSearch]);

  const activeChannel = selectedChannelId ? items.find((item) => item.id === selectedChannelId) ?? null : null;

  return (
    <section className="live-tv-page">
      <div className="live-tv-pill-row" aria-label="Canli TV kategorileri" data-tv-scroll="horizontal">
        {countryChipsWithFallback.map((country, index) => (
          <button
            key={`country-${country.code}`}
            type="button"
            className={`live-tv-pill${activeCountryCode === country.code ? " is-active" : ""}`}
            onClick={() => {
              setActiveGroup(country.filter);
              void runLiveFilters(search, country.filter);
            }}
            data-tv-focusable="true"
            data-tv-region="live-pills"
            data-tv-focus-key={`live-pill-country-${country.code}`}
            data-tv-initial={index === 0 ? "true" : undefined}
          >
            <span>{country.label}</span>
            <strong>{country.count}</strong>
          </button>
        ))}

        {groupChips.map((group) => (
          <button
            key={group.title}
            type="button"
            className={`live-tv-pill${activeGroup === group.title ? " is-active" : ""}`}
            onClick={() => {
              setActiveGroup(group.title);
              void runLiveFilters(search, group.title);
            }}
            data-tv-focusable="true"
            data-tv-region="live-pills"
            data-tv-focus-key={`live-pill-group-${group.title}`}
          >
            <span>{group.title}</span>
            <strong>{group.count}</strong>
          </button>
        ))}
      </div>

      <div className="live-tv-layout">
        <section className="live-tv-player-shell">
          {activeChannel ? (
            <>
              <div className="live-tv-player-surface">
                {activeChannel.playbackAllowed ? (
                  <LivePlayerSurface
                    key={activeChannel.id}
                    item={activeChannel}
                    compact
                    resolveLivePlayback={resolveLivePlayback}
                    reportLivePlayback={reportLivePlayback}
                  />
                ) : (
                  <div className="live-tv-player-empty">
                    <strong>Bu kanali acmak icin aktif paket gerekiyor.</strong>
                    <p className="muted">Sag panelden baska bir kanal secin ya da paket durumunuzu guncelleyin.</p>
                  </div>
                )}
              </div>
            </>
          ) : items.length > 0 ? (
            <div className="live-tv-player-empty">
              <strong>Kanali acmak icin listeden secim yapin.</strong>
              <p className="muted">Arama sonuclari otomatik oynatilmaz, secimi sizin yapmaniz gerekir.</p>
            </div>
          ) : (
            <div className="live-tv-player-empty">
              <strong>Filtreye uyan kanal bulunamadi.</strong>
              <p className="muted">Arama terimini temizleyip baska bir kategori deneyebilirsiniz.</p>
            </div>
          )}
        </section>

        <aside className="live-tv-sidebar">
          <div className="live-tv-sidebar-head">
            <div className="live-tv-search">
              <button
                type="button"
                className="live-tv-search-trigger"
                aria-label="Kanal ara"
                onClick={() => void runLiveFilters(search, activeGroupRef.current)}
              >
                <SearchGlyph />
              </button>
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void runLiveFilters(search, activeGroupRef.current);
                  }
                }}
                placeholder="Kanal ara..."
                className="live-tv-search-input"
                data-tv-focusable="true"
                data-tv-region="live-search"
                data-tv-focus-key="live-search"
              />
              {search ? (
                <button
                  type="button"
                  className="live-tv-search-clear"
                  onClick={() => {
                    setSearch("");
                    void runLiveFilters("", activeGroupRef.current);
                  }}
                >
                  Temizle
                </button>
              ) : null}
            </div>

            <div className="live-tv-sidebar-bar">
              <strong>Kanallar</strong>
              {isFiltering || isLoadingMore ? <span className="muted">{isFiltering ? "Yukleniyor" : "Daha fazla yukleniyor"}</span> : null}
            </div>
          </div>

          {items.length > 0 ? (
            <div ref={channelListRef} className="live-tv-channel-list">
              {items.map((channel, index) => {
                const isActive = activeChannel?.id === channel.id;

                return (
                  <button
                    key={channel.id}
                    type="button"
                    className={`live-tv-channel-row${isActive ? " is-active" : ""}`}
                    onClick={() => setSelectedChannelId(channel.id)}
                    data-tv-focusable="true"
                    data-tv-region="live-channels"
                    data-tv-focus-key={`live-channel-${channel.id}`}
                  >
                    <span className="live-tv-channel-index">{index + 1}</span>
                    <MediaArtwork item={channel} className="live-tv-channel-artwork" />
                    <span className="live-tv-channel-copy">
                      <strong>{channel.title}</strong>
                      {channel.subtitle ? <span>{channel.subtitle}</span> : null}
                    </span>
                  </button>
                );
              })}

              {hasMoreItems || isLoadingMore ? (
                <div ref={loadMoreSentinelRef} className="movies-load-more-anchor" aria-hidden="true">
                  {isLoadingMore ? <span className="movies-load-more-indicator" /> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="live-tv-sidebar-empty">
              <strong>Sonuc bulunamadi</strong>
              <p className="muted">Kanal aramasini temizleyin ya da baska bir kategori secin.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function SeriesGridPage({
  title,
  items,
  groups,
  onApplyFilters,
  onLoadMore,
  hasMoreItems,
  onOpenSeries
}: {
  title: string;
  items: SeriesRecord[];
  groups: CatalogGroup[];
  onApplyFilters: (search: string, group?: string) => Promise<void>;
  onLoadMore: (search: string, group?: string) => Promise<void>;
  hasMoreItems: boolean;
  onOpenSeries: (seriesId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState("");
  const [isFiltering, setIsFiltering] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [canScrollChipsLeft, setCanScrollChipsLeft] = useState(false);
  const [canScrollChipsRight, setCanScrollChipsRight] = useState(false);
  const applyFiltersRef = useRef(onApplyFilters);
  const activeGroupRef = useRef("");
  const chipRowRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);
  const loadingMoreInFlightRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const skipInitialFilterRef = useRef(true);
  const skipNextSearchEffectRef = useRef(false);
  const sortedGroups = [...groups].sort((left, right) => right.count - left.count);
  const groupChips =
    activeGroup && !sortedGroups.some((item) => item.title === activeGroup)
      ? [{ title: activeGroup, count: 0, kind: "series" as const }, ...sortedGroups]
      : sortedGroups;

  useEffect(() => {
    applyFiltersRef.current = onApplyFilters;
  }, [onApplyFilters]);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    activeGroupRef.current = activeGroup;
  }, [activeGroup]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const rail = chipRowRef.current;
    if (!rail) {
      return;
    }

    function updateChipRailState() {
      const currentRail = chipRowRef.current;
      if (!currentRail) {
        return;
      }

      const maxScrollLeft = Math.max(0, currentRail.scrollWidth - currentRail.clientWidth);
      setCanScrollChipsLeft(currentRail.scrollLeft > 4);
      setCanScrollChipsRight(maxScrollLeft - currentRail.scrollLeft > 4);
    }

    const animationFrame = window.requestAnimationFrame(updateChipRailState);
    rail.addEventListener("scroll", updateChipRailState, { passive: true });
    window.addEventListener("resize", updateChipRailState);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      rail.removeEventListener("scroll", updateChipRailState);
      window.removeEventListener("resize", updateChipRailState);
    };
  }, [groupChips.length, activeGroup]);

  function clearSeriesDebounce() {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }

  async function runSeriesFilters(nextSearch: string, nextGroup: string) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsFiltering(true);

    try {
      await applyFiltersRef.current(nextSearch.trim(), nextGroup || undefined);
    } finally {
      if (requestIdRef.current === requestId) {
        setIsFiltering(false);
      }
    }
  }

  useEffect(() => {
    void runSeriesFilters("", "");
  }, []);

  function submitSeriesSearch() {
    clearSeriesDebounce();
    void runSeriesFilters(search, activeGroupRef.current);
  }

  function clearSeriesSearch() {
    if (!search) {
      return;
    }

    skipNextSearchEffectRef.current = true;
    clearSeriesDebounce();
    setSearch("");
    void runSeriesFilters("", activeGroupRef.current);
  }

  function applySeriesGroupFilter(nextGroup: string) {
    if (nextGroup === activeGroupRef.current) {
      return;
    }

    activeGroupRef.current = nextGroup;
    setActiveGroup(nextGroup);
    clearSeriesDebounce();
    void runSeriesFilters(search, nextGroup);
  }

  function scrollSeriesChips(direction: "left" | "right") {
    const rail = chipRowRef.current;
    if (!rail) {
      return;
    }

    const travel = Math.max(220, Math.round(rail.clientWidth * 0.72));
    rail.scrollBy({
      left: direction === "left" ? -travel : travel,
      behavior: "smooth"
    });
  }

  async function loadNextSeriesPage() {
    if (loadingMoreInFlightRef.current || isFiltering || !hasMoreItems) {
      return;
    }

    loadingMoreInFlightRef.current = true;
    setIsLoadingMore(true);

    try {
      await loadMoreRef.current(search.trim(), activeGroupRef.current || undefined);
    } finally {
      loadingMoreInFlightRef.current = false;
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    if (skipInitialFilterRef.current) {
      skipInitialFilterRef.current = false;
      return;
    }

    if (skipNextSearchEffectRef.current) {
      skipNextSearchEffectRef.current = false;
      return;
    }

    clearSeriesDebounce();
    debounceTimerRef.current = window.setTimeout(() => {
      void runSeriesFilters(search, activeGroupRef.current);
    }, 260);

    return () => {
      clearSeriesDebounce();
    };
  }, [search]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !items.length || !hasMoreItems) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadNextSeriesPage();
        }
      },
      {
        rootMargin: "320px 0px"
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [items.length, hasMoreItems, isFiltering, search, activeGroup]);

  return (
    <section className="movies-page series-page">
      <article className="movies-toolbar-panel series-toolbar-panel">
        <div className="movies-toolbar-head">
          <div>
            <h2>{title}</h2>
          </div>
          <div className="movies-toolbar-summary">
            {isFiltering ? (
              <span className="movies-filter-status" aria-live="polite">
                Yukleniyor
              </span>
            ) : null}
          </div>
        </div>

        <div className="movies-filter-bar">
          <div className="movies-search-field">
            <SearchGlyph />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitSeriesSearch();
                }
              }}
              placeholder="Dizi ara"
              className="movies-search-input"
              aria-label="Dizi ara"
              data-tv-focusable="true"
              data-tv-region="series-search"
              data-tv-focus-key="series-search"
              data-tv-initial="true"
            />
            {search ? (
              <button type="button" className="movies-search-clear" onClick={clearSeriesSearch}>
                Temizle
              </button>
            ) : null}
          </div>
        </div>

        <div className="movies-chip-scroller">
          <button
            type="button"
            className="movies-chip-nav"
            onClick={() => scrollSeriesChips("left")}
            aria-label="Dizi kategorilerini sola kaydir"
            disabled={!canScrollChipsLeft}
          >
            <ChevronLeftGlyph />
          </button>

          <div ref={chipRowRef} className="movies-chip-row series-chip-row" aria-label="Dizi grup secimi" data-tv-scroll="horizontal">
            <button
              type="button"
              className={`movies-chip${activeGroup === "" ? " active" : ""}`}
              onClick={() => applySeriesGroupFilter("")}
              data-tv-focusable="true"
              data-tv-region="series-chips"
              data-tv-focus-key="series-chip-all"
            >
              Tumu
            </button>
            {groupChips.map((item) => (
              <button
                key={item.title}
                type="button"
                className={`movies-chip${activeGroup === item.title ? " active" : ""}`}
                onClick={() => applySeriesGroupFilter(item.title)}
                data-tv-focusable="true"
                data-tv-region="series-chips"
                data-tv-focus-key={`series-chip-${item.title}`}
              >
                {item.title} <strong>{item.count}</strong>
              </button>
            ))}
          </div>

          <button
            type="button"
            className="movies-chip-nav"
            onClick={() => scrollSeriesChips("right")}
            aria-label="Dizi kategorilerini saga kaydir"
            disabled={!canScrollChipsRight}
          >
            <ChevronRightGlyph />
          </button>
        </div>
      </article>

      <section className="movies-grid-section series-grid-section">
        {items.length > 0 ? (
          <>
            <div className="series-poster-grid">
              {items.map((series, index) => {
                const canPlay = getSeriesPlaybackAllowed(series);
                return (
                  <button
                    key={series.id}
                    type="button"
                    className={`series-poster-card ${canPlay ? "playable" : "locked"}`}
                    onClick={() => onOpenSeries(series.id)}
                    aria-label={series.title}
                    title={series.title}
                    data-tv-focusable="true"
                    data-tv-region="series-grid"
                    data-tv-focus-key={`series-${series.id}`}
                    onFocus={() => {
                      if (index >= Math.max(0, items.length - 8)) {
                        void loadNextSeriesPage();
                      }
                    }}
                  >
                    <div className="series-poster-visual">
                      <MediaArtwork
                        item={createSeriesArtworkItem({
                          id: series.id,
                          title: series.title,
                          posterUrl: series.posterUrl
                        })}
                        className="series-poster-artwork"
                      />
                      <div className="series-poster-overlay">
                        <span className="series-poster-kicker">{series.groupTitle ?? "Premium Dizi"}</span>
                        <strong>{series.title}</strong>
                        <span>
                          {series.seasonCount} sezon • {series.episodeCount} bolum
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {hasMoreItems || isLoadingMore ? (
              <div ref={loadMoreSentinelRef} className="movies-load-more-anchor" aria-hidden="true">
                {isLoadingMore ? <span className="movies-load-more-indicator" /> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="movies-empty-state" aria-live="polite">
            <strong>Filtreye uygun dizi bulunamadi.</strong>
            <p className="muted">Arama terimini temizleyip baska bir kategori deneyebilirsiniz.</p>
          </div>
        )}
      </section>
    </section>
  );
}

function SeriesDetailPage({
  seriesList,
  onOpenPlayer,
  onBack
}: {
  seriesList: SeriesRecord[];
  onOpenPlayer: (item: PlaybackItem) => void;
  onBack: () => void;
}) {
  const { seriesId } = useParams<{ seriesId: string }>();
  const series = seriesList.find((item) => item.id === seriesId) ?? null;
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number | null>(null);

  useEffect(() => {
    const firstSeasonNumber = series?.seasons[0]?.seasonNumber ?? null;
    setSelectedSeasonNumber(firstSeasonNumber);
  }, [series?.id, series?.seasons]);

  if (!series) {
    return (
      <section className="panel-card panel-stack">
        <h2>Dizi bulunamadi</h2>
        <p className="muted">Bu dizi kaynaktan kalkmis olabilir veya filtre degistigi icin gosterilemiyor olabilir.</p>
        <div className="button-row">
          <button
            className="button secondary"
            onClick={onBack}
            data-tv-focusable="true"
            data-tv-region="series-detail-actions"
            data-tv-focus-key="series-detail-back-missing"
            data-tv-initial="true"
          >
            Dizi Listesine Don
          </button>
        </div>
      </section>
    );
  }

  const playback = buildSeriesPlaybackItems(series);
  const seasons = [...series.seasons].sort((left, right) => left.seasonNumber - right.seasonNumber);
  const selectedSeason =
    seasons.find((season) => season.seasonNumber === selectedSeasonNumber) ??
    seasons[0] ??
    null;
  const featuredPlaybackItem = playback.featuredPlaybackItem;

  return (
    <section className="series-detail-page">
      <article className="series-detail-shell">
        <div className="series-detail-artwork">
          <MediaArtwork
            item={createSeriesArtworkItem({ id: series.id, title: series.title, posterUrl: series.posterUrl })}
            className="series-detail-poster-artwork"
          />
        </div>
        <div className="series-detail-copy">
          <div className="series-detail-topbar">
            <button
              className="button secondary"
              onClick={onBack}
              data-tv-focusable="true"
              data-tv-region="series-detail-actions"
              data-tv-focus-key="series-detail-back"
              data-tv-initial="true"
            >
              Dizilere Don
            </button>
            <span className="pill">{series.groupTitle ?? "Premium Dizi"}</span>
          </div>
          <span className="series-detail-kicker">Binge Ready Series</span>
          <h2>{series.title}</h2>
          <div className="series-detail-meta">
            <span>{series.seasonCount} sezon</span>
            <span>{series.episodeCount} bolum</span>
            <span>{featuredPlaybackItem?.playbackAllowed ? "Tek dokunusta baslar" : "Paket dogrulamasi gerekli"}</span>
          </div>
          <p className="muted">
            Sezon rail&apos;i ve bolum akisi sade bir binge deneyimi icin toparlandi. Uygun ilk bolumden baslayip sonraki
            bolume dogrudan gecebilirsiniz.
          </p>
          {featuredPlaybackItem ? (
            <div className="series-detail-actions">
              <button
                className="button"
                onClick={() => onOpenPlayer(featuredPlaybackItem)}
                data-tv-focusable="true"
                data-tv-region="series-detail-actions"
                data-tv-focus-key="series-detail-play"
              >
                Izlemeye Basla
              </button>
              <span className={`status-pill ${featuredPlaybackItem.playbackAllowed ? "is-success" : "is-muted"}`}>
                {featuredPlaybackItem.playbackAllowed ? "Otomatik gecis hazir" : "Paket gerekli"}
              </span>
            </div>
          ) : null}
        </div>
      </article>

      <article className="series-season-panel">
        <div className="series-season-head">
          <div>
            <h3>Sezonlar</h3>
            <p className="muted">Bir sezon secin ve bolumleri tek akista acin.</p>
          </div>
          {selectedSeason ? <span className="pill">{selectedSeason.title}</span> : null}
        </div>

        <div className="season-selector">
          {seasons.map((season) => (
            <button
              key={season.seasonNumber}
              className={`season-chip${season.seasonNumber === selectedSeason?.seasonNumber ? " active" : ""}`}
              onClick={() => setSelectedSeasonNumber(season.seasonNumber)}
              data-tv-focusable="true"
              data-tv-region="series-seasons"
              data-tv-focus-key={`series-season-${season.seasonNumber}`}
            >
              {season.title}
            </button>
          ))}
        </div>

        {selectedSeason ? (
          <div className="episode-list">
            {selectedSeason.episodes.map((episode) => {
              const playbackItem = playback.itemsByEpisodeId.get(episode.id) ?? null;
              return (
                <article key={episode.id} className="episode-row">
                  <div className="episode-index">
                    S{episode.seasonNumber}E{episode.episodeNumber}
                  </div>
                  <div className="episode-copy">
                    <strong>{episode.title}</strong>
                    <div className="muted">{buildEpisodeSubtitle(series.title, episode)}</div>
                  </div>
                  <div className="episode-actions">
                    <span className={`status-pill ${episode.playbackAllowed ? "is-success" : "is-muted"}`}>
                      {episode.playbackAllowed ? "Hazir" : "Kilitli"}
                    </span>
                    <button
                      className="button secondary series-episode-trigger"
                      disabled={!playbackItem}
                      onClick={() => {
                        if (playbackItem) {
                          onOpenPlayer(playbackItem);
                        }
                      }}
                      data-tv-focusable="true"
                      data-tv-region="series-episodes"
                      data-tv-focus-key={`series-episode-${episode.id}`}
                    >
                      {playbackItem ? "Oynat" : "Bolum Yok"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="notice-card subtle">Bu dizi icin henuz sezon bulunmuyor.</div>
        )}
      </article>
    </section>
  );
}

function PlayerOverlay({
  item,
  onClose,
  resolveLivePlayback,
  resolveVodPlayback,
  reportLivePlayback,
  reportVodPlayback
}: {
  item: PlaybackItem | null;
  onClose: () => void;
  resolveLivePlayback: ViewerCoreHandle["resolveLivePlayback"];
  resolveVodPlayback: ViewerCoreHandle["resolveVodPlayback"];
  reportLivePlayback: ViewerCoreHandle["reportLivePlayback"];
  reportVodPlayback: ViewerCoreHandle["reportVodPlayback"];
}) {
  const [activeItem, setActiveItem] = useState<PlaybackItem | null>(item);
  const overlayToneClass =
    activeItem?.kind === "live"
      ? " is-live-modal"
      : activeItem?.kind === "movie"
        ? " is-movie-modal"
        : activeItem?.kind === "episode"
          ? " is-episode-modal"
          : "";

  useEffect(() => {
    setActiveItem(item);
  }, [item]);

  if (!activeItem) {
    return null;
  }

  return (
    <div className={`modal${overlayToneClass}${activeItem.kind !== "live" ? " is-vod-modal" : ""}`}>
      <div
        className={`player-card${
          activeItem.kind === "live"
            ? " is-live-player-card"
            : activeItem.kind === "movie"
              ? " is-movie-player-card"
              : " is-episode-player-card"
        }`}
      >
        {activeItem.kind === "live" ? (
          <div className="live-overlay-header">
            <div className="live-overlay-title-group">
              <span className="live-overlay-kicker">Canli TV</span>
              <h2 className="player-title">{activeItem.title}</h2>
              {activeItem.subtitle ? <div className="live-overlay-subtitle">{activeItem.subtitle}</div> : null}
            </div>
            <button
              className="button secondary live-overlay-close"
              onClick={onClose}
              data-tv-focusable="true"
              data-tv-region="overlay-actions"
              data-tv-focus-key="overlay-close"
              data-tv-overlay-initial="true"
            >
              <ChevronLeftGlyph />
              <span>Geri</span>
            </button>
          </div>
        ) : null}

        {activeItem.playbackAllowed ? (
          activeItem.kind === "live" ? (
            <LivePlayerSurface
              key={activeItem.id}
              item={activeItem}
              resolveLivePlayback={resolveLivePlayback}
              reportLivePlayback={reportLivePlayback}
            />
          ) : activeItem.kind === "movie" ? (
            <MoviePlayerSurface
              key={activeItem.id}
              item={activeItem}
              resolveVodPlayback={resolveVodPlayback}
              reportVodPlayback={reportVodPlayback}
              onClose={onClose}
            />
          ) : (
            <EpisodePlayerSurface
              key={activeItem.id}
              item={activeItem}
              resolveVodPlayback={resolveVodPlayback}
              reportVodPlayback={reportVodPlayback}
              onClose={onClose}
              onRequestNext={(nextItem, options) => {
                const currentDepth = activeItem?.autoSkipDepth ?? 0;
                const nextDepth = options?.reason === "failed" ? Math.min(5, currentDepth + 1) : 0;
                setActiveItem({
                  ...nextItem,
                  autoSkipDepth: nextDepth
                });
              }}
            />
          )
        ) : (
          <div className="notice-card danger">Bu icerigi oynatmak icin aktif paket gerekir.</div>
        )}
      </div>
    </div>
  );
}

function LivePlayerSurface({
  item,
  compact = false,
  resolveLivePlayback,
  reportLivePlayback
}: {
  item: PlaybackItem;
  compact?: boolean;
  resolveLivePlayback: ViewerCoreHandle["resolveLivePlayback"];
  reportLivePlayback: ViewerCoreHandle["reportLivePlayback"];
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef(0);
  const startedPlayingRef = useRef(false);
  const stallCountRef = useRef(0);
  const playbackReportedRef = useRef(false);
  const startupTimerRef = useRef<number | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const recoveryInFlightRef = useRef(false);
  const pendingRecoveryReportRef = useRef(false);
  const playerStateRef = useRef<PlayerState>("idle");
  const lastRecoverAtRef = useRef(0);
  const lastPlaybackPositionRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const lastFragmentBufferedAtRef = useRef(0);
  const lastManifestAdvanceAtRef = useRef(0);
  const lastManifestSequenceRef = useRef<number | null>(null);
  const lastBufferedEndRef = useRef(0);
  const recoveryTierRef = useRef(0);
  const lastVolumeBeforeMuteRef = useRef(1);
  const playbackStartedAtRef = useRef(0);
  const mediaErrorStreakRef = useRef(0);
  const videoTrackMissingSinceRef = useRef(0);
  const videoTrackMissingRecoveryCountRef = useRef(0);
  const relayFallbackAttemptCountRef = useRef(0);
  const lastRelayFallbackAttemptAtRef = useRef(0);
  const lastRelayFallbackResultRef = useRef<"none" | "success" | "fallback-direct" | "failed">("none");
  const lastHlsNetworkRecoveryAtRef = useRef(0);
  const lastHlsMediaRecoveryAtRef = useRef(0);
  const lastDebugSnapshotAtRef = useRef(0);
  const debugLogCountRef = useRef(0);
  const liveDebugEnabledRef = useRef(false);
  const playerEngineRef = useRef<"native" | "hls.js" | "mpegts.js" | "unknown">("unknown");
  const hlsControllerRef = useRef<{
    startLoad?: (startPosition?: number) => void;
    recoverMediaError?: () => void;
    setAudioTrack?: (trackIndex: number) => void;
    destroy?: () => void;
  } | null>(null);

  const initialLivePlayback: LivePlaybackRecord | null =
    item.kind === "live"
      ? {
          channelId: item.id,
          url: item.streamUrl,
          transport: item.transport ?? "unknown",
          sourceTransport: item.transport ?? "unknown",
          deliveryMode: item.transport === "hls" ? ("hls_proxy" as const) : ("file_proxy" as const),
          diagnosticsSessionId: null,
          healthStatus: item.healthStatus ?? "unknown",
          lastCheckedAt: item.lastCheckedAt ?? null,
          expiresAt: null,
          canPlay: item.playbackAllowed,
          isVerified: item.isVerified ?? false,
          errorMessage: null
        }
      : null;
  const playbackSnapshotRef = useRef<LivePlaybackRecord | null>(initialLivePlayback);

  const [playerError, setPlayerError] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [interactionRequired, setInteractionRequired] = useState(false);
  const [livePlayback, setLivePlayback] = useState<LivePlaybackRecord | null>(initialLivePlayback);

  function clearControlsHideTimer() {
    if (controlsHideTimerRef.current !== null) {
      window.clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  }

  function scheduleControlsHide(delayMs = 3000) {
    clearControlsHideTimer();
    if (!compact || playerState !== "playing") {
      setControlsVisible(true);
      return;
    }
    controlsHideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, delayMs);
  }

  function revealControls() {
    setControlsVisible(true);
    scheduleControlsHide();
  }

  useEffect(() => {
    const media = videoRef.current;
    if (!media) {
      return;
    }

    const onVolumeChange = () => {
      const nextVolume = media.volume;
      const nextMuted = media.muted || nextVolume === 0;
      setVolume(nextVolume);
      setIsMuted(nextMuted);
      if (!nextMuted && nextVolume > 0) {
        lastVolumeBeforeMuteRef.current = nextVolume;
      }
    };

    media.addEventListener("volumechange", onVolumeChange);
    onVolumeChange();

    return () => {
      media.removeEventListener("volumechange", onVolumeChange);
    };
  }, [item.id]);

  useEffect(() => {
    const media = videoRef.current;
    if (!media) {
      return;
    }

    media.volume = volume;
    media.muted = isMuted || volume === 0;
  }, [isMuted, volume]);

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement === frameRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!compact) {
      return;
    }

    if (playerState === "playing") {
      scheduleControlsHide();
    } else {
      clearControlsHideTimer();
      setControlsVisible(true);
    }

    return () => {
      clearControlsHideTimer();
    };
  }, [compact, playerState]);

  useEffect(() => {
    if (!compact) {
      return;
    }

    setControlsVisible(true);
    scheduleControlsHide(3200);
  }, [compact, isFullscreen, item.id]);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement) {
      return;
    }
    const media = mediaElement;
    const liveBufferTargetSec = 90;
    const liveBufferMaxSec = 180;
    const liveBackBufferSec = 90;
    const liveBufferByteCap = 140 * 1000 * 1000;
    const liveSyncDurationSegments = 6;
    const liveMaxLatencySegments = 18;
    const liveDriftSoftNudgeSec = 10;
    const liveDriftHardResyncSec = 60;
    const liveTrimBehindEdgeSec = 18;
    const liveWatchdogIntervalMs = 4_000;
    const liveSilentThresholdMs = 8_000;
    const liveAdvanceWindowMs = 8_000;
    const liveStallRecoveryThresholdMs = 12_000;
    const liveDebugEnabled = isLiveDebugEnabled();
    liveDebugEnabledRef.current = liveDebugEnabled;

    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    let disposed = false;

    function clearStartupTimer() {
      if (startupTimerRef.current !== null) {
        window.clearTimeout(startupTimerRef.current);
        startupTimerRef.current = null;
      }
    }

    function clearWatchdogTimer() {
      if (watchdogTimerRef.current !== null) {
        window.clearInterval(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
    }

    function setStateSafe(nextState: PlayerState) {
      if (!disposed && sessionRef.current === sessionId) {
        playerStateRef.current = nextState;
        setPlayerState(nextState);
      }
    }

    function setErrorSafe(message: string | null) {
      if (!disposed && sessionRef.current === sessionId) {
        setPlayerError(message);
      }
    }

    function setInteractionRequiredSafe(nextValue: boolean) {
      if (!disposed && sessionRef.current === sessionId) {
        setInteractionRequired(nextValue);
      }
    }

    function setPlaybackSafe(value: LivePlaybackRecord | null) {
      if (!disposed && sessionRef.current === sessionId) {
        playbackSnapshotRef.current = value;
        setLivePlayback(value);
      }
    }

    function debugLog(event: string, detail?: Record<string, unknown>) {
      if (!liveDebugEnabledRef.current || typeof console === "undefined") {
        return;
      }

      debugLogCountRef.current += 1;
      const payload = {
        channelId: item.id,
        event,
        playerState: playerStateRef.current,
        engine: playerEngineRef.current,
        currentTime: Number.isFinite(media.currentTime) ? Number(media.currentTime.toFixed(2)) : null,
        bufferedSeconds: Number(getBufferRemaining().toFixed(2)),
        bufferTargetSeconds: liveBufferTargetSec,
        bufferMaxSeconds: liveBufferMaxSec,
        debugIndex: debugLogCountRef.current,
        ...(detail ?? {})
      };
      console.info("[flixify-live-debug]", payload);
    }

    function getBufferRemaining() {
      for (let index = 0; index < media.buffered.length; index += 1) {
        const start = media.buffered.start(index);
        const end = media.buffered.end(index);
        if (media.currentTime >= start - 0.2 && media.currentTime <= end + 0.2) {
          return Math.max(0, end - media.currentTime);
        }
      }
      return 0;
    }

    function getBufferedEnd() {
      for (let index = 0; index < media.buffered.length; index += 1) {
        const start = media.buffered.start(index);
        const end = media.buffered.end(index);
        if (media.currentTime >= start - 0.2 && media.currentTime <= end + 0.2) {
          return end;
        }
      }

      if (media.buffered.length > 0) {
        return media.buffered.end(media.buffered.length - 1);
      }

      return null;
    }

    function trimLiveLatency() {
      if (playerEngineRef.current === "mpegts.js") {
        return false;
      }

      const bufferedEnd = getBufferedEnd();
      if (bufferedEnd === null || !startedPlayingRef.current || media.paused || media.ended) {
        return false;
      }

      const liveDrift = bufferedEnd - media.currentTime;
      if (!Number.isFinite(liveDrift) || liveDrift < liveDriftHardResyncSec) {
        return false;
      }

      media.currentTime = Math.max(0, bufferedEnd - liveTrimBehindEdgeSec);
      lastProgressAtRef.current = Date.now();
      debugLog("latency-trimmed", {
        liveDrift: Number(liveDrift.toFixed(2)),
        trimTargetBehindEdgeSec: liveTrimBehindEdgeSec
      });
      return true;
    }

    function buildDiagnosticsPayload(input?: {
      errorMessage?: string | null;
      stallReason?: string | null;
      errorCode?: string | null;
      upstreamStatus?: number | null;
      detail?: Record<string, unknown> | null;
    }) {
      const playback = playbackSnapshotRef.current;
      const playlistAgeMs =
        lastManifestAdvanceAtRef.current > 0 ? Math.max(0, Date.now() - lastManifestAdvanceAtRef.current) : null;
      const baseDetail = {
        playerState: playerStateRef.current,
        stallCount: stallCountRef.current,
        recoveryTier: recoveryTierRef.current,
        bufferTargetSeconds: liveBufferTargetSec,
        bufferMaxSeconds: liveBufferMaxSec,
        liveSyncDurationSegments,
        liveMaxLatencySegments,
        lastPlaybackPosition: Number(lastPlaybackPositionRef.current.toFixed(2)),
        lastFragmentBufferedAt:
          lastFragmentBufferedAtRef.current > 0
            ? new Date(lastFragmentBufferedAtRef.current).toISOString()
            : null,
        lastManifestAdvanceAt:
          lastManifestAdvanceAtRef.current > 0
            ? new Date(lastManifestAdvanceAtRef.current).toISOString()
            : null,
        manifestSeq: lastManifestSequenceRef.current,
        playlistAgeMs,
        relayAttempted: relayFallbackAttemptCountRef.current > 0,
        relayAttemptCount: relayFallbackAttemptCountRef.current,
        lastRelayAttemptAt:
          lastRelayFallbackAttemptAtRef.current > 0
            ? new Date(lastRelayFallbackAttemptAtRef.current).toISOString()
            : null,
        relayResult: lastRelayFallbackResultRef.current
      };
      return {
        diagnosticsSessionId: playback?.diagnosticsSessionId ?? null,
        deliveryMode: playback?.deliveryMode ?? null,
        sourceTransport: playback?.sourceTransport ?? playback?.transport ?? item.transport ?? null,
        playerEngine: playerEngineRef.current,
        uptimeMs:
          playbackStartedAtRef.current > 0 ? Math.max(0, Date.now() - playbackStartedAtRef.current) : null,
        bufferedSeconds: Number(getBufferRemaining().toFixed(2)),
        currentTime: Number.isFinite(media.currentTime) && media.currentTime >= 0 ? media.currentTime : null,
        readyState: media.readyState,
        networkState: media.networkState,
        stallReason: input?.stallReason ?? null,
        errorCode: input?.errorCode ?? null,
        upstreamStatus: input?.upstreamStatus ?? null,
        detail: {
          ...baseDetail,
          ...(input?.detail ?? {})
        },
        errorMessage: input?.errorMessage ?? null
      };
    }

    async function reportEvent(
      event: "playing" | "stalled" | "recovered" | "failed",
      input?: {
        errorMessage?: string | null;
        stallReason?: string | null;
        errorCode?: string | null;
        upstreamStatus?: number | null;
        detail?: Record<string, unknown> | null;
      }
    ) {
      try {
        await reportLivePlayback(item.id, event, buildDiagnosticsPayload(input));
      } catch {
        // Health reporting should not block playback.
      }
    }

    function teardownPlayer() {
      clearStartupTimer();
      clearWatchdogTimer();
      hlsControllerRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      try {
        media.pause();
      } catch {
        // noop
      }
      media.removeAttribute("src");
      media.srcObject = null;
      media.load();
    }

    async function failPlayback(message: string) {
      if (disposed || sessionRef.current !== sessionId) {
        return;
      }
      recoveryInFlightRef.current = false;
      pendingRecoveryReportRef.current = false;
      teardownPlayer();
      setStateSafe("failed");
      setErrorSafe(message);
      setInteractionRequiredSafe(false);
      await reportEvent("failed", {
        errorMessage: message,
        errorCode: "playback-failed",
        detail: {
          lastKnownPosition: lastPlaybackPositionRef.current,
          relayAttempted: relayFallbackAttemptCountRef.current > 0,
          relayAttemptCount: relayFallbackAttemptCountRef.current,
          relayResult: lastRelayFallbackResultRef.current
        }
      });
    }

    function scheduleStartupTimeout(message: string) {
      clearStartupTimer();
      startupTimerRef.current = window.setTimeout(() => {
        if (disposed || sessionRef.current !== sessionId || startedPlayingRef.current) {
          return;
        }
        void failPlayback(message);
      }, 15_000);
    }

    function markPlaybackHealthy(nextPosition?: number) {
      clearStartupTimer();
      lastProgressAtRef.current = Date.now();
      if (playbackStartedAtRef.current === 0) {
        playbackStartedAtRef.current = Date.now();
      }
      if (typeof nextPosition === "number" && Number.isFinite(nextPosition)) {
        lastPlaybackPositionRef.current = nextPosition;
      }
      if (media.videoWidth > 0 && media.videoHeight > 0) {
        videoTrackMissingSinceRef.current = 0;
        videoTrackMissingRecoveryCountRef.current = 0;
      }

      const shouldReportInitialPlay = !playbackReportedRef.current;
      const shouldReportRecovery = pendingRecoveryReportRef.current && playbackReportedRef.current;
      const recoveredStallCount = stallCountRef.current;
      const recoveredTier = recoveryTierRef.current;

      startedPlayingRef.current = true;
      stallCountRef.current = 0;
      recoveryTierRef.current = 0;
      mediaErrorStreakRef.current = 0;
      if ((playbackSnapshotRef.current?.deliveryMode ?? "file_proxy") !== "file_proxy") {
        relayFallbackAttemptCountRef.current = 0;
        lastRelayFallbackAttemptAtRef.current = 0;
        lastRelayFallbackResultRef.current = "none";
      }
      recoveryInFlightRef.current = false;
      pendingRecoveryReportRef.current = false;
      setStateSafe("playing");
      setErrorSafe(null);
      setInteractionRequiredSafe(false);

      if (shouldReportInitialPlay) {
        playbackReportedRef.current = true;
        void reportEvent("playing", {
          detail: {
            initial: true
          }
        });
        return;
      }

      if (shouldReportRecovery) {
        void reportEvent("recovered", {
          detail: {
            stallCount: recoveredStallCount,
            recoveryTier: recoveredTier
          }
        });
      }
    }

    async function recoverPlayback(reason: string, errorCode = "reconnect") {
      if (disposed || sessionRef.current !== sessionId) {
        return;
      }
      if (recoveryInFlightRef.current) {
        return;
      }
      if (Date.now() - lastRecoverAtRef.current < 10_000) {
        return;
      }
      debugLog("recover-requested", {
        reason,
        errorCode,
        mediaErrorStreak: mediaErrorStreakRef.current,
        relayAttempts: relayFallbackAttemptCountRef.current
      });

      recoveryInFlightRef.current = true;
      pendingRecoveryReportRef.current = playbackReportedRef.current;
      lastRecoverAtRef.current = Date.now();
      if (errorCode.includes("media")) {
        mediaErrorStreakRef.current += 1;
      } else {
        mediaErrorStreakRef.current = 0;
      }
      if (errorCode === "video-track-missing") {
        videoTrackMissingRecoveryCountRef.current += 1;
      }

      const nextStallCount = stallCountRef.current + 1;
      const nextRecoveryTier = Math.min(6, recoveryTierRef.current + 1);
      stallCountRef.current = nextStallCount;
      recoveryTierRef.current = nextRecoveryTier;
      await reportEvent("stalled", {
        errorMessage: reason,
        stallReason: reason,
        errorCode,
        detail: {
          stallCount: nextStallCount,
          recoveryTier: nextRecoveryTier,
          bufferedSeconds: Number(getBufferRemaining().toFixed(2)),
          relayAttempted: relayFallbackAttemptCountRef.current > 0,
          relayAttemptCount: relayFallbackAttemptCountRef.current,
          relayResult: lastRelayFallbackResultRef.current
        }
      });

      if (nextRecoveryTier >= 6) {
        await failPlayback("Bu kanal gecici olarak kararsiz. Lutfen baska bir kanal deneyin.");
        return;
      }

      if (nextRecoveryTier === 1) {
        setStateSafe("recovering");
        try {
          const bufferedEnd = getBufferedEnd();
          startedPlayingRef.current = false;
          if (bufferedEnd !== null && getBufferRemaining() > 0.25) {
            media.currentTime = Math.max(0, bufferedEnd - 0.2);
          } else if (playerEngineRef.current === "native") {
            media.load();
          }
          scheduleStartupTimeout("Canli yayin tekrar akmaya baslamadi.");
          await media.play();
          setInteractionRequiredSafe(false);
          recoveryInFlightRef.current = false;
          return;
        } catch (error) {
          if (isAutoplayBlockedError(error)) {
            clearStartupTimer();
            setStateSafe("idle");
            setErrorSafe(null);
            setInteractionRequiredSafe(true);
            recoveryInFlightRef.current = false;
            return;
          }
          if (isPlayInterruptedError(error)) {
            setStateSafe("buffering");
            recoveryInFlightRef.current = false;
            return;
          }
          recoveryInFlightRef.current = false;
        }
      }

      setStateSafe("recovering");

      if (nextRecoveryTier === 2 && hlsControllerRef.current) {
        try {
          startedPlayingRef.current = false;
          if (errorCode.includes("media")) {
            hlsControllerRef.current.recoverMediaError?.();
          } else {
            hlsControllerRef.current.startLoad?.(-1);
          }
          scheduleStartupTimeout("Canli yayin tekrar akmaya baslamadi.");
          await media.play();
          setInteractionRequiredSafe(false);
          recoveryInFlightRef.current = false;
          return;
        } catch (error) {
          if (isAutoplayBlockedError(error)) {
            clearStartupTimer();
            setStateSafe("idle");
            setErrorSafe(null);
            setInteractionRequiredSafe(true);
            recoveryInFlightRef.current = false;
            return;
          }
          if (isPlayInterruptedError(error)) {
            setStateSafe("buffering");
            recoveryInFlightRef.current = false;
            return;
          }
          recoveryInFlightRef.current = false;
        }
      }

      teardownPlayer();

      try {
        const snapshot = playbackSnapshotRef.current;
        const sourceTransport = snapshot?.sourceTransport ?? snapshot?.transport ?? item.transport ?? "unknown";
        const activeDeliveryMode = snapshot?.deliveryMode ?? "file_proxy";
        const relayFallbackCooldownMs = 20_000;
        const relayFallbackMaxAttempts = 3;
        const relayEligible =
          activeDeliveryMode === "file_proxy" &&
          sourceTransport === "ts" &&
          (errorCode === "watchdog-timeout" ||
            errorCode === "video-track-missing" ||
            mediaErrorStreakRef.current >= 2);
        const shouldForceTranscode = sourceTransport === "ts" && errorCode === "video-track-missing";
        const stickWithRelay = activeDeliveryMode !== "file_proxy" && sourceTransport === "ts";
        const relayWithinLimit = relayFallbackAttemptCountRef.current < relayFallbackMaxAttempts;
        const relayCooldownElapsed = Date.now() - lastRelayFallbackAttemptAtRef.current >= relayFallbackCooldownMs;
        const shouldTryRelay = relayEligible && relayWithinLimit && relayCooldownElapsed;

        let playback: LivePlaybackRecord;
        if (shouldTryRelay) {
          relayFallbackAttemptCountRef.current += 1;
          lastRelayFallbackAttemptAtRef.current = Date.now();
          lastRelayFallbackResultRef.current = "failed";
          try {
            const relayPlayback = await resolveLivePlayback(item.id, {
              preferRelay: true,
              forceRelayRestart: shouldForceTranscode,
              preferTranscode: shouldForceTranscode
            });
            if (
              relayPlayback.canPlay &&
              relayPlayback.url &&
              relayPlayback.deliveryMode !== "file_proxy"
            ) {
              playback = relayPlayback;
              lastRelayFallbackResultRef.current = "success";
            } else {
              playback = await resolveLivePlayback(item.id, { preferRelay: false });
              lastRelayFallbackResultRef.current = "fallback-direct";
            }
          } catch {
            playback = await resolveLivePlayback(item.id, { preferRelay: false });
            lastRelayFallbackResultRef.current = "fallback-direct";
          }
        } else if (stickWithRelay) {
          try {
            const relayPlayback = await resolveLivePlayback(item.id, {
              preferRelay: true,
              forceRelayRestart: shouldForceTranscode,
              preferTranscode: shouldForceTranscode
            });
            if (relayPlayback.canPlay && relayPlayback.url) {
              playback = relayPlayback;
              lastRelayFallbackResultRef.current = "success";
            } else {
              playback = await resolveLivePlayback(item.id, { preferRelay: false });
              lastRelayFallbackResultRef.current = "fallback-direct";
            }
          } catch {
            playback = await resolveLivePlayback(item.id, { preferRelay: false });
            lastRelayFallbackResultRef.current = "fallback-direct";
          }
        } else {
          if (relayEligible && (!relayWithinLimit || !relayCooldownElapsed)) {
            lastRelayFallbackResultRef.current = "failed";
          }
          playback = await resolveLivePlayback(item.id, { preferRelay: false });
        }

        if (disposed || sessionRef.current !== sessionId) {
          return;
        }
        setPlaybackSafe(playback);
        if (!playback.canPlay || !playback.url) {
          await failPlayback(playback.errorMessage ?? "Canli yayin gecici olarak kullanilamiyor.");
          return;
        }
        await mountResolvedPlayback(playback);
      } catch (error) {
        await failPlayback(getMediaErrorMessage(error, "Canli yayin yeniden baglanamadi."));
      }
    }

    function attachMediaEvents() {
      const onLoadStart = () => setStateSafe("connecting");
      const onCanPlay = () => {
        if (startedPlayingRef.current && getBufferRemaining() > 1) {
          markPlaybackHealthy(media.currentTime);
          return;
        }
        setStateSafe(startedPlayingRef.current ? "playing" : "buffering");
      };
      const onTimeUpdate = () => {
        if (Number.isFinite(media.currentTime) && media.currentTime > lastPlaybackPositionRef.current + 0.02) {
          if (media.videoWidth <= 0 || media.videoHeight <= 0) {
            const now = Date.now();
            if (videoTrackMissingSinceRef.current === 0) {
              videoTrackMissingSinceRef.current = now;
            }

            const missingForMs = now - videoTrackMissingSinceRef.current;
            if (
              startedPlayingRef.current &&
              !recoveryInFlightRef.current &&
              missingForMs >= 7_000 &&
              now - lastRecoverAtRef.current > 10_000
            ) {
              void recoverPlayback(
                "Canli yayinda ses var ancak goruntu olusmadi. Transcode fallback denenecek.",
                "video-track-missing"
              );
              return;
            }
          } else {
            videoTrackMissingSinceRef.current = 0;
            videoTrackMissingRecoveryCountRef.current = 0;
          }
          markPlaybackHealthy(media.currentTime);
          return;
        }
      };
      const onProgress = () => {
        const bufferedEnd = getBufferedEnd();
        if (bufferedEnd !== null && bufferedEnd > lastBufferedEndRef.current + 0.5) {
          lastBufferedEndRef.current = bufferedEnd;
          lastFragmentBufferedAtRef.current = Date.now();
          if (playerEngineRef.current === "native") {
            lastManifestAdvanceAtRef.current = Date.now();
          }
        }

        const now = Date.now();
        if (liveDebugEnabledRef.current && now - lastDebugSnapshotAtRef.current >= 8_000) {
          lastDebugSnapshotAtRef.current = now;
          debugLog("buffer-snapshot", {
            bufferedEnd: bufferedEnd !== null ? Number(bufferedEnd.toFixed(2)) : null,
            liveDrift: bufferedEnd !== null ? Number((bufferedEnd - media.currentTime).toFixed(2)) : null
          });
        }

        void trimLiveLatency();
      };
      const onWaiting = () => {
        if (!startedPlayingRef.current) {
          setStateSafe("buffering");
          return;
        }
        if (
          !recoveryInFlightRef.current &&
          getBufferRemaining() < 0.25 &&
          Date.now() - lastProgressAtRef.current >= liveSilentThresholdMs &&
          Date.now() - lastRecoverAtRef.current > 10_000
        ) {
          void recoverPlayback("Canli akis waiting durumunda uzun sure kaldi.", "media-error");
          return;
        }
        if (getBufferRemaining() > 1.5) {
          setStateSafe("playing");
          return;
        }
        setStateSafe("buffering");
      };
      const onStalled = () => {
        if (!startedPlayingRef.current) {
          setStateSafe("buffering");
          return;
        }
        if (
          !recoveryInFlightRef.current &&
          getBufferRemaining() < 0.35 &&
          Date.now() - lastRecoverAtRef.current > 10_000
        ) {
          void recoverPlayback("Canli akis stalled event ile durdu.", "media-error");
          return;
        }
        if (getBufferRemaining() > 1) {
          setStateSafe("playing");
          return;
        }
        setStateSafe("buffering");
      };
      const onPlaying = () => markPlaybackHealthy(media.currentTime);
      const onError = () => {
        void recoverPlayback("Canli yayin hata verdi.", "media-error");
      };

      watchdogTimerRef.current = window.setInterval(() => {
        if (!startedPlayingRef.current || recoveryInFlightRef.current) {
          return;
        }
        if (media.paused || media.ended) {
          return;
        }
        const now = Date.now();
        const silentForMs = now - lastProgressAtRef.current;
        const fragmentQuietMs = now - lastFragmentBufferedAtRef.current;
        const manifestQuietMs = now - lastManifestAdvanceAtRef.current;
        const bufferedAhead = getBufferRemaining();
        const streamAdvancing = fragmentQuietMs < liveAdvanceWindowMs || manifestQuietMs < liveAdvanceWindowMs;
        const bufferedEnd = getBufferedEnd();
        const liveDrift =
          bufferedEnd !== null && Number.isFinite(bufferedEnd)
            ? Math.max(0, bufferedEnd - media.currentTime)
            : bufferedAhead;

        if (silentForMs < liveSilentThresholdMs) {
          return;
        }

        if (streamAdvancing) {
          if (playerEngineRef.current !== "mpegts.js" && bufferedEnd !== null && liveDrift > liveDriftSoftNudgeSec) {
            try {
              media.currentTime = Math.max(0, bufferedEnd - Math.min(4, liveDrift / 3));
              setStateSafe("buffering");
              debugLog("soft-latency-nudge", {
                liveDrift: Number(liveDrift.toFixed(2))
              });
              return;
            } catch {
              // noop
            }
          }
          if (playerEngineRef.current !== "mpegts.js" && liveDrift > liveDriftHardResyncSec) {
            setStateSafe("recovering");
            void recoverPlayback("Canli player takildi, buyuk gecikme algilandi.", "player-desync");
            return;
          }
          if (playerEngineRef.current === "mpegts.js" && silentForMs > liveStallRecoveryThresholdMs) {
            setStateSafe("buffering");
            void media.play().catch(() => undefined);
            return;
          }
          setStateSafe(bufferedAhead > 0.5 ? "buffering" : "connecting");
          return;
        }

        if (silentForMs < liveStallRecoveryThresholdMs) {
          return;
        }

        setStateSafe("stalled");
        void recoverPlayback("Canli akis uzun sure ilerlemedi.", "watchdog-timeout");
      }, liveWatchdogIntervalMs);

      media.addEventListener("loadstart", onLoadStart);
      media.addEventListener("canplay", onCanPlay);
      media.addEventListener("timeupdate", onTimeUpdate);
      media.addEventListener("progress", onProgress);
      media.addEventListener("waiting", onWaiting);
      media.addEventListener("stalled", onStalled);
      media.addEventListener("playing", onPlaying);
      media.addEventListener("error", onError);

      return () => {
        media.removeEventListener("loadstart", onLoadStart);
        media.removeEventListener("canplay", onCanPlay);
        media.removeEventListener("timeupdate", onTimeUpdate);
        media.removeEventListener("progress", onProgress);
        media.removeEventListener("waiting", onWaiting);
        media.removeEventListener("stalled", onStalled);
        media.removeEventListener("playing", onPlaying);
        media.removeEventListener("error", onError);
        clearWatchdogTimer();
      };
    }

    async function mountNative(url: string, startupMessage: string) {
      teardownPlayer();
      playerEngineRef.current = "native";
      hlsControllerRef.current = null;
      startedPlayingRef.current = false;
      lastPlaybackPositionRef.current = 0;
      lastBufferedEndRef.current = 0;
      lastManifestSequenceRef.current = null;
      lastProgressAtRef.current = Date.now();
      lastFragmentBufferedAtRef.current = Date.now();
      lastManifestAdvanceAtRef.current = Date.now();
      const detachEvents = attachMediaEvents();
      cleanupRef.current = () => {
        detachEvents();
      };
      media.muted = false;
      if (media.volume === 0) {
        media.volume = 1;
      }
      media.src = url;
      media.preload = "auto";
      media.playsInline = true;
      media.load();
      scheduleStartupTimeout(startupMessage);
      try {
        await media.play();
        setInteractionRequiredSafe(false);
      } catch (error) {
        if (isAutoplayBlockedError(error)) {
          clearStartupTimer();
          setStateSafe("idle");
          setErrorSafe(null);
          setInteractionRequiredSafe(true);
          return;
        }
        if (isPlayInterruptedError(error)) {
          setStateSafe("buffering");
          return;
        }
        await failPlayback(getMediaErrorMessage(error, startupMessage));
      }
    }

    async function mountHls(url: string, startupMessage: string) {
      if (media.canPlayType("application/vnd.apple.mpegurl")) {
        await mountNative(url, startupMessage);
        return;
      }

      const module = await import("hls.js");
      const HlsCtor = (module as { default?: new (config?: Record<string, unknown>) => unknown }).default;
      const HlsNamespace = module as {
        default?: {
          isSupported?: () => boolean;
          Events?: Record<string, string>;
        };
      };
      const isSupported = typeof HlsNamespace.default?.isSupported === "function" ? HlsNamespace.default.isSupported() : false;
      const hlsEvents = HlsNamespace.default?.Events;

      if (!HlsCtor || !isSupported || !hlsEvents) {
        await mountNative(url, startupMessage);
        return;
      }

      teardownPlayer();
      playerEngineRef.current = "hls.js";
      startedPlayingRef.current = false;
      lastPlaybackPositionRef.current = 0;
      lastBufferedEndRef.current = 0;
      lastManifestSequenceRef.current = null;
      lastProgressAtRef.current = Date.now();
      lastFragmentBufferedAtRef.current = Date.now();
      lastManifestAdvanceAtRef.current = Date.now();
      const detachEvents = attachMediaEvents();
      const hls = new HlsCtor({
        enableWorker: true,
        lowLatencyMode: false,
        initialLiveManifestSize: 6,
        backBufferLength: liveBackBufferSec,
        maxBufferSize: liveBufferByteCap,
        maxBufferLength: liveBufferTargetSec,
        maxMaxBufferLength: liveBufferMaxSec,
        maxBufferHole: 0.45,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 8,
        startFragPrefetch: true,
        liveSyncMode: "buffered",
        liveSyncDurationCount: liveSyncDurationSegments,
        liveMaxLatencyDurationCount: liveMaxLatencySegments,
        liveSyncOnStallIncrease: 2,
        maxLiveSyncPlaybackRate: 1,
        manifestLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 12_000,
            maxLoadTimeMs: 20_000,
            timeoutRetry: {
              maxNumRetry: 6,
              retryDelayMs: 500,
              maxRetryDelayMs: 6_000
            },
            errorRetry: {
              maxNumRetry: 6,
              retryDelayMs: 1_000,
              maxRetryDelayMs: 10_000
            }
          }
        },
        playlistLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 10_000,
            maxLoadTimeMs: 16_000,
            timeoutRetry: {
              maxNumRetry: 6,
              retryDelayMs: 500,
              maxRetryDelayMs: 5_000
            },
            errorRetry: {
              maxNumRetry: 6,
              retryDelayMs: 900,
              maxRetryDelayMs: 8_000
            }
          }
        },
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 12_000,
            maxLoadTimeMs: 24_000,
            timeoutRetry: {
              maxNumRetry: 6,
              retryDelayMs: 600,
              maxRetryDelayMs: 6_000
            },
            errorRetry: {
              maxNumRetry: 6,
              retryDelayMs: 1_000,
              maxRetryDelayMs: 12_000
            }
          }
        }
      }) as {
        attachMedia: (element: HTMLMediaElement) => void;
        loadSource: (source: string) => void;
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        startLoad?: (startPosition?: number) => void;
        recoverMediaError?: () => void;
        audioTrack?: number;
        destroy: () => void;
      };
      hlsControllerRef.current = {
        startLoad: (startPosition?: number) => hls.startLoad?.(startPosition),
        recoverMediaError: () => hls.recoverMediaError?.(),
        setAudioTrack: (trackIndex: number) => {
          if (typeof hls.audioTrack === "number") {
            hls.audioTrack = trackIndex;
          }
        },
        destroy: () => hls.destroy()
      };

      hls.on(hlsEvents.MEDIA_ATTACHED, () => {
        hls.loadSource(url);
      });

      hls.on(hlsEvents.MANIFEST_PARSED, () => {
        lastManifestAdvanceAtRef.current = Date.now();
        scheduleStartupTimeout(startupMessage);
        void media.play().catch((error) => {
          if (isAutoplayBlockedError(error)) {
            clearStartupTimer();
            setStateSafe("idle");
            setErrorSafe(null);
            setInteractionRequiredSafe(true);
            return;
          }
          if (isPlayInterruptedError(error)) {
            setStateSafe("buffering");
            return;
          }
          void failPlayback(getMediaErrorMessage(error, startupMessage));
        });
      });

      hls.on(hlsEvents.LEVEL_UPDATED, (_event, data) => {
        const details = (data as { details?: { endSN?: number } } | undefined)?.details;
        const nextSequence = details?.endSN;
        if (typeof nextSequence === "number" && nextSequence !== lastManifestSequenceRef.current) {
          lastManifestSequenceRef.current = nextSequence;
          lastManifestAdvanceAtRef.current = Date.now();
        }
      });

      hls.on(hlsEvents.FRAG_BUFFERED, () => {
        lastFragmentBufferedAtRef.current = Date.now();
      });

      hls.on(hlsEvents.ERROR, (_event, data) => {
        const errorData = data as { fatal?: boolean; details?: string; type?: string } | undefined;
        const normalizedType = `${errorData?.type ?? ""}`.toLowerCase();
        const normalizedDetail = `${errorData?.details ?? ""}`.toLowerCase();
        const isNetworkError = normalizedType.includes("network");
        const isMediaError = normalizedType.includes("media");
        const isBufferStall =
          normalizedDetail.includes("bufferstalled") || normalizedDetail.includes("buffer_stalled");

        if (!errorData?.fatal) {
          if (isBufferStall && getBufferRemaining() < 0.4 && Date.now() - lastRecoverAtRef.current > 10_000) {
            void recoverPlayback("Canli HLS buffer takildi.", "hls-buffer-stalled");
          }
          return;
        }

        if (isNetworkError && hlsControllerRef.current?.startLoad) {
          const now = Date.now();
          if (now - lastHlsNetworkRecoveryAtRef.current > 3_500) {
            lastHlsNetworkRecoveryAtRef.current = now;
            setStateSafe("recovering");
            startedPlayingRef.current = false;
            hlsControllerRef.current.startLoad?.(-1);
            scheduleStartupTimeout("Canli yayin tekrar akmaya baslamadi.");
            void media.play().catch(() => undefined);
            return;
          }
        }

        if (isMediaError && hlsControllerRef.current?.recoverMediaError) {
          const now = Date.now();
          if (now - lastHlsMediaRecoveryAtRef.current > 5_000) {
            lastHlsMediaRecoveryAtRef.current = now;
            setStateSafe("recovering");
            startedPlayingRef.current = false;
            hlsControllerRef.current.recoverMediaError?.();
            scheduleStartupTimeout("Canli yayin tekrar akmaya baslamadi.");
            void media.play().catch(() => undefined);
            return;
          }
        }

        void recoverPlayback(
          errorData.details ?? "Canli HLS akisi hata verdi.",
          errorData.type ? `hls-${errorData.type}` : "hls-fatal"
        );
      });

      hls.attachMedia(media);
      cleanupRef.current = () => {
        detachEvents();
        hlsControllerRef.current = null;
        try {
          hls.destroy();
        } catch {
          // noop
        }
      };
    }

    async function mountTs(url: string, startupMessage: string) {
      const module = await import("mpegts.js");
      const mpegts = (module as { default?: Record<string, unknown> }).default ?? module;
      const isSupported =
        typeof (mpegts as { isSupported?: () => boolean }).isSupported === "function"
          ? (mpegts as { isSupported: () => boolean }).isSupported()
          : false;

      if (!isSupported) {
        await mountNative(url, startupMessage);
        return;
      }

      const factory = (mpegts as {
        createPlayer?: (mediaDataSource: Record<string, unknown>, config?: Record<string, unknown>) => {
          attachMediaElement: (element: HTMLMediaElement) => void;
          load: () => void;
          play: () => Promise<void>;
          on?: (event: string, handler: (...args: unknown[]) => void) => void;
          pause: () => void;
          unload: () => void;
          detachMediaElement: () => void;
          destroy: () => void;
        };
      }).createPlayer;

      if (!factory) {
        await mountNative(url, startupMessage);
        return;
      }

      teardownPlayer();
      playerEngineRef.current = "mpegts.js";
      startedPlayingRef.current = false;
      lastPlaybackPositionRef.current = 0;
      lastBufferedEndRef.current = 0;
      lastManifestSequenceRef.current = null;
      lastProgressAtRef.current = Date.now();
      lastFragmentBufferedAtRef.current = Date.now();
      lastManifestAdvanceAtRef.current = Date.now();
      const detachEvents = attachMediaEvents();
      const mpegtsEvents = (mpegts as { Events?: Record<string, string> }).Events;
      const player = factory(
        {
          type: "mpegts",
          isLive: true,
          cors: true,
          url
        },
        {
          enableWorker: false,
          enableWorkerForMSE: false,
          lazyLoad: false,
          enableStashBuffer: true,
          stashInitialSize: 2 * 1024 * 1024,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 90,
          autoCleanupMinBackwardDuration: 45,
          liveBufferLatencyChasing: false,
          liveBufferLatencyMaxLatency: 20,
          liveBufferLatencyMinRemain: 6,
          liveBufferLatencyChasingOnPaused: false,
          fixAudioTimestampGap: true,
          reuseRedirectedURL: true,
          referrerPolicy: "no-referrer"
        }
      );

      if (mpegtsEvents?.ERROR) {
        player.on?.(mpegtsEvents.ERROR, () => {
          void recoverPlayback("Canli TS akisi hata verdi.", "media-error");
        });
      }

      if (mpegtsEvents?.RECOVERED_EARLY_EOF) {
        player.on?.(mpegtsEvents.RECOVERED_EARLY_EOF, () => {
          lastFragmentBufferedAtRef.current = Date.now();
          markPlaybackHealthy(media.currentTime);
        });
      }

      if (mpegtsEvents?.STATISTICS_INFO) {
        player.on?.(mpegtsEvents.STATISTICS_INFO, () => {
          lastFragmentBufferedAtRef.current = Date.now();
        });
      }

      if (mpegtsEvents?.MEDIA_INFO) {
        player.on?.(mpegtsEvents.MEDIA_INFO, () => {
          lastManifestAdvanceAtRef.current = Date.now();
        });
      }

      player.attachMediaElement(media);
      player.load();
      cleanupRef.current = () => {
        detachEvents();
        try {
          player.pause();
        } catch {
          // noop
        }
        try {
          player.unload();
        } catch {
          // noop
        }
        try {
          player.detachMediaElement();
        } catch {
          // noop
        }
        try {
          player.destroy();
        } catch {
          // noop
        }
      };

      scheduleStartupTimeout(startupMessage);
      try {
        await player.play();
        setInteractionRequiredSafe(false);
      } catch (error) {
        if (isAutoplayBlockedError(error)) {
          clearStartupTimer();
          setStateSafe("idle");
          setErrorSafe(null);
          setInteractionRequiredSafe(true);
          return;
        }
        if (isPlayInterruptedError(error)) {
          setStateSafe("buffering");
          return;
        }
        await failPlayback(getMediaErrorMessage(error, startupMessage));
      }
    }

    async function mountResolvedPlayback(playback: LivePlaybackRecord) {
      const startupMessage = playback.errorMessage ?? "Canli yayin 15 saniye icinde baslamadi.";
      if (!playback.url || !playback.canPlay) {
        await failPlayback(playback.errorMessage ?? "Canli yayin gecici olarak kullanilamiyor.");
        return;
      }

      if (playback.deliveryMode.startsWith("hls_") || playback.transport === "hls") {
        await mountHls(playback.url, startupMessage);
        return;
      }

      if (playback.deliveryMode === "file_proxy" && playback.transport === "ts") {
        await mountTs(playback.url, startupMessage);
        return;
      }

      await mountNative(playback.url, startupMessage);
    }

    async function startPlayback() {
      teardownPlayer();
      setErrorSafe(null);
      setStateSafe("resolving");
      startedPlayingRef.current = false;
      playbackStartedAtRef.current = 0;
      stallCountRef.current = 0;
      recoveryTierRef.current = 0;
      mediaErrorStreakRef.current = 0;
      videoTrackMissingSinceRef.current = 0;
      videoTrackMissingRecoveryCountRef.current = 0;
      relayFallbackAttemptCountRef.current = 0;
      lastRelayFallbackAttemptAtRef.current = 0;
      lastRelayFallbackResultRef.current = "none";
      playbackReportedRef.current = false;
      recoveryInFlightRef.current = false;
      pendingRecoveryReportRef.current = false;
      playerEngineRef.current = "unknown";
      hlsControllerRef.current = null;
      lastHlsNetworkRecoveryAtRef.current = 0;
      lastHlsMediaRecoveryAtRef.current = 0;
      lastBufferedEndRef.current = 0;
      lastManifestSequenceRef.current = null;
      lastProgressAtRef.current = Date.now();
      lastFragmentBufferedAtRef.current = Date.now();
      lastManifestAdvanceAtRef.current = Date.now();
      setInteractionRequiredSafe(false);
      setPlaybackSafe(initialLivePlayback);
      debugLog("playback-start", {
        sourceTransport: item.transport ?? "unknown",
        bufferTargetSeconds: liveBufferTargetSec,
        bufferMaxSeconds: liveBufferMaxSec,
        liveSyncDurationSegments,
        liveMaxLatencySegments
      });

      try {
        const playback = await resolveLivePlayback(item.id, { preferRelay: true });
        if (disposed || sessionRef.current !== sessionId) {
          return;
        }
        setPlaybackSafe(playback);
        if (!playback.canPlay || !playback.url) {
          await failPlayback(playback.errorMessage ?? "Canli yayin gecici olarak kullanilamiyor.");
          return;
        }
        await mountResolvedPlayback(playback);
      } catch (error) {
        await failPlayback(getMediaErrorMessage(error, "Canli yayin baslatilamadi."));
      }
    }

    void startPlayback();

    return () => {
      disposed = true;
      clearStartupTimer();
      teardownPlayer();
    };
  }, [item.id, reportLivePlayback, resolveLivePlayback]);

  async function continuePlayback() {
    const media = videoRef.current;
    if (!media) {
      return;
    }

    setPlayerError(null);
    try {
      await media.play();
      setInteractionRequired(false);
      setPlayerState("buffering");
    } catch (error) {
      if (isAutoplayBlockedError(error)) {
        setPlayerState("idle");
        setInteractionRequired(true);
        return;
      }
      setInteractionRequired(false);
      setPlayerState("failed");
      setPlayerError(getMediaErrorMessage(error, "Canli yayin baslatilamadi."));
    }
  }

  const currentHealth = describeHealth(
    livePlayback?.healthStatus ?? item.healthStatus,
    livePlayback?.isVerified ?? item.isVerified
  );
  const activeTransport = (livePlayback?.sourceTransport ?? livePlayback?.transport ?? item.transport ?? "unknown").toUpperCase();
  const stateTone =
    playerState === "failed"
      ? "danger"
      : playerState === "recovering" || playerState === "stalled"
        ? "warning"
        : playerState === "playing"
          ? "success"
          : "info";

  function handleVolumeChange(event: ChangeEvent<HTMLInputElement>) {
    const nextVolume = Number(event.currentTarget.value) / 100;
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
    if (nextVolume > 0) {
      lastVolumeBeforeMuteRef.current = nextVolume;
    }
  }

  function handleMuteToggle() {
    if (isMuted || volume === 0) {
      const restoredVolume = lastVolumeBeforeMuteRef.current > 0 ? lastVolumeBeforeMuteRef.current : 1;
      setVolume(restoredVolume);
      setIsMuted(false);
      return;
    }

    if (volume > 0) {
      lastVolumeBeforeMuteRef.current = volume;
    }
    setIsMuted(true);
  }

  async function handleFullscreenToggle() {
    const frame = frameRef.current;
    const media = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;

    if (document.fullscreenElement === frame) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }

    if (frame?.requestFullscreen) {
      await frame.requestFullscreen().catch(() => undefined);
      return;
    }

    media?.webkitEnterFullscreen?.();
  }

  return (
    <div className={`live-player-shell${compact ? "" : " is-overlay-mode"}`}>
      {!compact ? (
        <div className="live-player-topbar">
          <span className={`status-pill is-${stateTone}`}>{playerStateLabels[playerState]}</span>
          <span className={`status-pill is-${currentHealth.tone}`}>{currentHealth.label}</span>
          <span className="pill">{activeTransport}</span>
          <span className="muted">Son kontrol: {formatCheckedAt(livePlayback?.lastCheckedAt ?? item.lastCheckedAt)}</span>
        </div>
      ) : null}

      <div
        ref={frameRef}
        className={`live-player-frame${controlsVisible ? "" : " is-chrome-hidden"}${isFullscreen ? " is-fullscreen" : ""}`}
      >
        <div className="live-player-stage">
          <div
            className="live-player-video-wrap"
            onPointerMove={revealControls}
            onPointerDown={revealControls}
            onTouchStart={revealControls}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              disablePictureInPicture
              controls={false}
              poster={LIVE_PLAYER_POSTER_URL}
              className="player-video live-player-video"
            >
              Tarayici video elementini desteklemiyor.
            </video>

            <div
              className={`live-player-controls is-volume${controlsVisible ? "" : " is-hidden"}`}
              role="group"
              aria-label="Ses kontrolleri"
              onFocusCapture={revealControls}
            >
              <button
                type="button"
                className="live-player-control-button"
                aria-label={isMuted || volume === 0 ? "Sesi ac" : "Sesi kapat"}
                onClick={handleMuteToggle}
                data-tv-focusable="true"
                data-tv-region="live-player-controls"
                data-tv-focus-key={compact ? `live-compact-mute-${item.id}` : `live-player-mute-${item.id}`}
              >
                {isMuted || volume === 0 ? <MuteGlyph /> : <VolumeGlyph />}
              </button>

              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round((isMuted ? 0 : volume) * 100)}
                aria-label="Ses seviyesi"
                className="live-player-volume-slider"
                onChange={handleVolumeChange}
                data-tv-focusable="true"
                data-tv-region="live-player-controls"
                data-tv-focus-key={compact ? `live-compact-volume-${item.id}` : `live-player-volume-${item.id}`}
              />
            </div>

            <div
              className={`live-player-controls is-fullscreen${controlsVisible ? "" : " is-hidden"}`}
              role="group"
              aria-label="Ekran kontrolleri"
              onFocusCapture={revealControls}
            >
              <button
                type="button"
                className="live-player-control-button"
                aria-label={isFullscreen ? "Tam ekrandan cik" : "Tam ekran"}
                onClick={() => {
                  void handleFullscreenToggle();
                }}
                data-tv-focusable="true"
                data-tv-region="live-player-controls"
                data-tv-focus-key={compact ? `live-compact-fullscreen-${item.id}` : `live-player-fullscreen-${item.id}`}
              >
                {isFullscreen ? <ExitFullscreenGlyph /> : <FullscreenGlyph />}
              </button>
            </div>

            {playerState !== "playing" ? (
              <div className={`live-player-center-state${interactionRequired ? " is-interactive" : ""}`}>
                {!interactionRequired ? <span className="live-player-center-ring" /> : null}
                <strong>{interactionRequired ? "Oynatmaya Devam Et" : playerStateLabels[playerState]}</strong>
                <span>
                  {interactionRequired
                    ? `${item.title} icin sesli oynatma izni gerekiyor.`
                    : `${item.title} yayina hazirlaniyor.`}
                </span>
                {interactionRequired ? (
                  <button
                    type="button"
                    className="live-play-overlay"
                    onClick={() => {
                      void continuePlayback();
                    }}
                    data-tv-focusable="true"
                    data-tv-region="live-player-controls"
                    data-tv-focus-key={compact ? `live-compact-play-${item.id}` : `live-player-play-${item.id}`}
                  >
                    Oynat
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {playerError ? (
        <div className="notice-card danger">
          <strong>{playerError}</strong>
          <div className="muted">Bu kanal yerine baska bir kanal secmek daha saglikli olabilir.</div>
        </div>
      ) : null}
    </div>
  );
}

function useVodPlaybackController({
  item,
  resolveVodPlayback,
  reportVodPlayback,
  onEnded
}: {
  item: PlaybackItem;
  resolveVodPlayback: ViewerCoreHandle["resolveVodPlayback"];
  reportVodPlayback: ViewerCoreHandle["reportVodPlayback"];
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef(0);
  const seekGuardTimerRef = useRef<number | null>(null);
  const stallWatchdogTimerRef = useRef<number | null>(null);
  const desiredSeekTimeRef = useRef<number | null>(null);
  const recoverAttemptsRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const lastPlaybackPositionRef = useRef(0);
  const waitingSinceRef = useRef(0);
  const lastRecoverAtRef = useRef(0);
  const playbackStartedAtRef = useRef(0);
  const resolvedPlaybackRef = useRef<VodPlaybackRecord | null>(null);
  const hlsControllerRef = useRef<{
    startLoad?: (startPosition?: number) => void;
    recoverMediaError?: () => void;
    setAudioTrack?: (trackIndex: number) => void;
    destroy?: () => void;
  } | null>(null);
  const lastHlsNetworkRecoveryAtRef = useRef(0);
  const lastHlsMediaRecoveryAtRef = useRef(0);
  const transcodeFallbackAttemptedRef = useRef(false);
  const compatibilityRetryHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const compatibilityRetryingRef = useRef(false);
  const autoCompatibilityEscalatedRef = useRef(false);
  const vodDebugEnabledRef = useRef(false);
  const vodDebugCounterRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  const preferredAudioTrackIdRef = useRef<string | null>(null);
  const activeAudioTrackIdRef = useRef<string | null>(null);
  const audioTracksRef = useRef<VodPlaybackRecord["audioTracks"]>([]);

  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [resolvedPlayback, setResolvedPlayback] = useState<VodPlaybackRecord | null>(null);
  const [interactionRequired, setInteractionRequired] = useState(false);
  const [compatibilityRetrying, setCompatibilityRetrying] = useState(false);
  const [isPaused, setIsPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [canSeek, setCanSeek] = useState(false);
  const [audioTracks, setAudioTracks] = useState<VodPlaybackRecord["audioTracks"]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    vodDebugEnabledRef.current = isVodDebugEnabled();
    vodDebugCounterRef.current = 0;
    resolvedPlaybackRef.current = null;
    hlsControllerRef.current = null;
    lastHlsNetworkRecoveryAtRef.current = 0;
    lastHlsMediaRecoveryAtRef.current = 0;
    transcodeFallbackAttemptedRef.current = false;
    compatibilityRetryHandlerRef.current = null;
    compatibilityRetryingRef.current = false;
    autoCompatibilityEscalatedRef.current = false;
    preferredAudioTrackIdRef.current = null;
    activeAudioTrackIdRef.current = null;
    audioTracksRef.current = [];
    lastProgressAtRef.current = Date.now();
    lastPlaybackPositionRef.current = 0;
    waitingSinceRef.current = 0;
    lastRecoverAtRef.current = 0;
    playbackStartedAtRef.current = 0;
    setResolvedPlayback(null);
    setInteractionRequired(false);
    setCompatibilityRetrying(false);
    setIsPaused(true);
    setCurrentTime(0);
    setDuration(0);
    setCanSeek(false);
    setAudioTracks([]);
    setSelectedAudioTrackId(null);
  }, [item.id]);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement || !item.playbackAllowed) {
      return;
    }
    const media = mediaElement;
    const vodWatchdogIntervalMs = 3_000;
    const vodSilentThresholdMs = 12_000;
    const waitingRecoveryThresholdMs = 5_500;
    const recoveryCooldownMs = 6_000;

    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    let disposed = false;

    function clearSeekGuard() {
      if (seekGuardTimerRef.current !== null) {
        window.clearTimeout(seekGuardTimerRef.current);
        seekGuardTimerRef.current = null;
      }
    }

    function clearStallWatchdog() {
      if (stallWatchdogTimerRef.current !== null) {
        window.clearInterval(stallWatchdogTimerRef.current);
        stallWatchdogTimerRef.current = null;
      }
    }

    function getBufferRemaining() {
      const buffered = media.buffered;
      if (!buffered || buffered.length === 0) {
        return 0;
      }

      const current = media.currentTime;
      for (let index = 0; index < buffered.length; index += 1) {
        if (current >= buffered.start(index) && current <= buffered.end(index)) {
          return Math.max(0, buffered.end(index) - current);
        }
      }

      return 0;
    }

    function markPlaybackProgress(nextPosition?: number) {
      const now = Date.now();
      const position =
        typeof nextPosition === "number" && Number.isFinite(nextPosition) ? nextPosition : media.currentTime;
      if (Number.isFinite(position) && position > lastPlaybackPositionRef.current + 0.02) {
        lastPlaybackPositionRef.current = position;
        lastProgressAtRef.current = now;
        waitingSinceRef.current = 0;
      } else if (lastProgressAtRef.current === 0) {
        lastProgressAtRef.current = now;
      }
    }

    function setStateSafe(nextState: PlayerState) {
      if (!disposed && sessionRef.current === sessionId) {
        setPlayerState(nextState);
      }
    }

    function setErrorSafe(message: string | null) {
      if (!disposed && sessionRef.current === sessionId) {
        setPlayerError(message);
      }
    }

    function setResolvedPlaybackSafe(nextPlayback: VodPlaybackRecord | null) {
      if (!disposed && sessionRef.current === sessionId) {
        resolvedPlaybackRef.current = nextPlayback;
        setResolvedPlayback(nextPlayback);
        const nextTracks = nextPlayback?.audioTracks ?? [];
        const nextSelectedTrackId =
          nextPlayback?.selectedAudioTrackId ??
          nextPlayback?.defaultAudioTrackId ??
          nextTracks.find((track) => track.isDefault)?.id ??
          nextTracks[0]?.id ??
          null;
        audioTracksRef.current = nextTracks;
        activeAudioTrackIdRef.current = nextSelectedTrackId;
        preferredAudioTrackIdRef.current = nextSelectedTrackId;
        setAudioTracks(nextTracks);
        setSelectedAudioTrackId(nextSelectedTrackId);
      }
    }

    function setInteractionRequiredSafe(nextValue: boolean) {
      if (!disposed && sessionRef.current === sessionId) {
        setInteractionRequired(nextValue);
      }
    }

    function setPausedSafe(nextValue: boolean) {
      if (!disposed && sessionRef.current === sessionId) {
        setIsPaused(nextValue);
      }
    }

    function setCurrentTimeSafe(nextValue: number) {
      if (!disposed && sessionRef.current === sessionId) {
        setCurrentTime(nextValue);
      }
    }

    function setDurationSafe(nextValue: number) {
      if (!disposed && sessionRef.current === sessionId) {
        setDuration(nextValue);
      }
    }

    function setCanSeekSafe(nextValue: boolean) {
      if (!disposed && sessionRef.current === sessionId) {
        setCanSeek(nextValue);
      }
    }

    function setCompatibilityRetryingSafe(nextValue: boolean) {
      if (!disposed && sessionRef.current === sessionId) {
        setCompatibilityRetrying(nextValue);
      }
    }

    function debugVod(event: string, detail?: Record<string, unknown>) {
      if (!vodDebugEnabledRef.current || typeof console === "undefined") {
        return;
      }

      vodDebugCounterRef.current += 1;
      console.info("[flixify-vod-debug]", {
        id: item.id,
        kind: item.kind,
        event,
        index: vodDebugCounterRef.current,
        state: playerState,
        deliveryMode: resolvedPlaybackRef.current?.deliveryMode ?? null,
        transport: resolvedPlaybackRef.current?.transport ?? null,
        currentTime: Number.isFinite(media.currentTime) ? Number(media.currentTime.toFixed(2)) : null,
        duration: Number.isFinite(media.duration) ? Number(media.duration.toFixed(2)) : null,
        buffered: Number(getBufferRemaining().toFixed(2)),
        ...(detail ?? {})
      });
    }

    function getVodPlayerEngine() {
      if (hlsControllerRef.current) {
        return "hls.js" as const;
      }
      return "native" as const;
    }

    async function reportVodEvent(
      event:
        | "session-created"
        | "audio-track-selected"
        | "audio-track-switch-failed"
        | "no-audio-detected"
        | "transcode-started"
        | "transcode-failed"
        | "playback-failed"
        | "recovered",
      input?: {
        audioTrackId?: string | null;
        errorCode?: string | null;
        upstreamStatus?: number | null;
        detail?: Record<string, unknown> | null;
        errorMessage?: string | null;
      }
    ) {
      try {
        const playback = resolvedPlaybackRef.current;
        await reportVodPlayback(item.kind === "movie" ? "movie" : "episode", item.id, {
          event,
          deliveryMode: playback?.deliveryMode ?? null,
          sourceTransport: playback?.transport ?? null,
          playerEngine: getVodPlayerEngine(),
          uptimeMs:
            playbackStartedAtRef.current > 0
              ? Math.max(0, Date.now() - playbackStartedAtRef.current)
              : null,
          bufferedSeconds: Number(getBufferRemaining().toFixed(2)),
          currentTime: Number.isFinite(media.currentTime) ? media.currentTime : null,
          readyState: media.readyState,
          networkState: media.networkState,
          audioTrackId: input?.audioTrackId ?? activeAudioTrackIdRef.current ?? null,
          errorCode: input?.errorCode ?? null,
          upstreamStatus: input?.upstreamStatus ?? null,
          detail: input?.detail ?? null,
          errorMessage: input?.errorMessage ?? null
        });
      } catch {
        // Diagnostics should not block playback flow.
      }
    }

    function syncTimelineState() {
      const rawDuration = Number.isFinite(media.duration) ? media.duration : 0;
      const normalizedDuration = rawDuration > 0 ? rawDuration : 0;
      const normalizedCurrentTime = clampPlaybackTime(media.currentTime, normalizedDuration || Number.POSITIVE_INFINITY);
      const nextCanSeek = normalizedDuration > 0 && media.readyState >= 1;

      setDurationSafe(normalizedDuration);
      setCurrentTimeSafe(normalizedCurrentTime);
      setCanSeekSafe(nextCanSeek);
      setPausedSafe(media.paused);
    }

    function ensureAudioTrackSelected() {
      const audioTracks = (
        media as HTMLVideoElement & {
          audioTracks?: {
            length: number;
            [index: number]: { enabled: boolean } | undefined;
          };
        }
      ).audioTracks;

      if (!audioTracks || typeof audioTracks.length !== "number" || audioTracks.length === 0) {
        return false;
      }

      let hasEnabledTrack = false;
      for (let index = 0; index < audioTracks.length; index += 1) {
        if (audioTracks[index]?.enabled) {
          hasEnabledTrack = true;
          break;
        }
      }

      if (!hasEnabledTrack && audioTracks[0]) {
        audioTracks[0].enabled = true;
      }

      return true;
    }

    function teardownPlayer() {
      clearSeekGuard();
      clearStallWatchdog();
      hlsControllerRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;
      try {
        media.pause();
      } catch {
        // noop
      }
      media.removeAttribute("src");
      media.srcObject = null;
      media.load();
      waitingSinceRef.current = 0;
      lastPlaybackPositionRef.current = 0;
      lastProgressAtRef.current = Date.now();
      setPausedSafe(true);
      setCurrentTimeSafe(0);
      setDurationSafe(0);
      setCanSeekSafe(false);
    }

    async function failPlayback(message: string) {
      if (disposed || sessionRef.current !== sessionId) {
        return;
      }
      debugVod("playback-failed", {
        message
      });
      teardownPlayer();
      setStateSafe("failed");
      setErrorSafe(message);
      setInteractionRequiredSafe(false);
      await reportVodEvent("playback-failed", {
        errorCode: "playback-failed",
        errorMessage: message
      });
    }

    async function resolvePlayback(options: { preferTranscode?: boolean } = {}) {
      setStateSafe("resolving");
      setErrorSafe(null);
      setInteractionRequiredSafe(false);
      const requestedAudioTrackId = preferredAudioTrackIdRef.current;
      const playback = await resolveVodPlayback(item.kind === "movie" ? "movie" : "episode", item.id, {
        debugVod: vodDebugEnabledRef.current,
        preferTranscode: options.preferTranscode === true,
        audioTrackId: requestedAudioTrackId ?? undefined
      });
      debugVod("resolve-playback", {
        canPlay: playback.canPlay,
        url: playback.url,
        deliveryMode: playback.deliveryMode,
        transport: playback.transport,
        errorMessage: playback.errorMessage,
        preferTranscode: options.preferTranscode === true,
        requestedAudioTrackId
      });
      setResolvedPlaybackSafe(playback);
      if (!playback.canPlay || !playback.url) {
        await failPlayback(playback.errorMessage ?? "VOD akisi hazirlanamadi.");
        return null;
      }

      await reportVodEvent("session-created", {
        audioTrackId: playback.selectedAudioTrackId ?? playback.defaultAudioTrackId,
        detail: {
          audioTrackCount: playback.audioTracks.length
        }
      });
      if (playback.audioTracks.length === 0) {
        await reportVodEvent("no-audio-detected", {
          audioTrackId: null
        });
      }

      return playback;
    }

    async function runCompatibilityRetry(
      reason: string,
      options: { resumeAt?: number; trigger: "manual" | "auto" }
    ) {
      if (disposed || sessionRef.current !== sessionId) {
        return;
      }

      if (compatibilityRetryingRef.current) {
        return;
      }

      if (!canUseVodCompatibilityRetry(resolvedPlaybackRef.current)) {
        return;
      }

      compatibilityRetryingRef.current = true;
      setCompatibilityRetryingSafe(true);
      setStateSafe("recovering");
      setErrorSafe(null);
      setInteractionRequiredSafe(false);
      debugVod("compatibility-retry-start", {
        reason,
        trigger: options.trigger,
        resumeAt: options.resumeAt
      });

      try {
        const resumeFrom =
          options.resumeAt ?? desiredSeekTimeRef.current ?? media.currentTime;
        const playback = await resolvePlayback({ preferTranscode: true });
        if (!playback) {
          return;
        }

        await mountSource(playback, resumeFrom);
      } catch (error) {
        await failPlayback(getMediaErrorMessage(error, "Uyumluluk modu baslatilamadi."));
      } finally {
        compatibilityRetryingRef.current = false;
        setCompatibilityRetryingSafe(false);
      }
    }

    function scheduleSeekRecovery(timeToResume: number) {
      clearSeekGuard();
      desiredSeekTimeRef.current = timeToResume;
      seekGuardTimerRef.current = window.setTimeout(() => {
        void recoverPlayback("Ileri sarma sonrasinda akis takildi.", timeToResume);
      }, 3500);
    }

    async function recoverPlayback(reason: string, resumeAt?: number) {
      if (disposed || sessionRef.current !== sessionId) {
        return;
      }
      if (Date.now() - lastRecoverAtRef.current < recoveryCooldownMs) {
        return;
      }
      debugVod("recover-requested", {
        reason,
        resumeAt
      });
      lastRecoverAtRef.current = Date.now();
      waitingSinceRef.current = 0;

      const attempts = recoverAttemptsRef.current + 1;
      recoverAttemptsRef.current = attempts;
      setStateSafe("recovering");

      if (attempts >= 3) {
        await failPlayback(reason);
        return;
      }

      try {
        if (attempts === 1 && hlsControllerRef.current) {
          const now = Date.now();
          const normalizedReason = reason.toLowerCase();
          const shouldRecoverMedia =
            normalizedReason.includes("hls") ||
            normalizedReason.includes("oynatici hata") ||
            normalizedReason.includes("decode");

          if (shouldRecoverMedia && hlsControllerRef.current.recoverMediaError) {
            if (now - lastHlsMediaRecoveryAtRef.current > 5_000) {
              lastHlsMediaRecoveryAtRef.current = now;
              hlsControllerRef.current.recoverMediaError();
              await requestPlay();
              return;
            }
          } else if (hlsControllerRef.current.startLoad) {
            if (now - lastHlsNetworkRecoveryAtRef.current > 3_500) {
              lastHlsNetworkRecoveryAtRef.current = now;
              hlsControllerRef.current.startLoad(-1);
              await requestPlay();
              return;
            }
          }
        }

        const resumeFrom = resumeAt ?? desiredSeekTimeRef.current ?? media.currentTime;
        const playback = resolvedPlaybackRef.current ?? (await resolvePlayback());
        if (!playback) {
          return;
        }
        await mountSource(playback, resumeFrom);
      } catch (error) {
        await failPlayback(getMediaErrorMessage(error, reason));
      }
    }

    function attachMediaEvents(onReady: (resumeAt?: number) => void, resumeAt?: number) {
      const onLoadStart = () => {
        setStateSafe("connecting");
        syncTimelineState();
      };
      const onLoadedMetadata = () => {
        const hasAudioTrack = ensureAudioTrackSelected();
        if (!hasAudioTrack) {
          void reportVodEvent("no-audio-detected", {
            audioTrackId: activeAudioTrackIdRef.current
          });
        }
        syncTimelineState();
        onReady(resumeAt);
      };
      const onCanPlay = () => {
        ensureAudioTrackSelected();
        setStateSafe("buffering");
        syncTimelineState();
      };
      const onPlaying = () => {
        const recoveredFromFailure = recoverAttemptsRef.current > 0 || playerState === "recovering";
        clearSeekGuard();
        desiredSeekTimeRef.current = null;
        recoverAttemptsRef.current = 0;
        if (playbackStartedAtRef.current === 0) {
          playbackStartedAtRef.current = Date.now();
        }
        setStateSafe("playing");
        setErrorSafe(null);
        setPausedSafe(false);
        markPlaybackProgress(media.currentTime);
        syncTimelineState();
        if (recoveredFromFailure) {
          void reportVodEvent("recovered", {
            audioTrackId: activeAudioTrackIdRef.current
          });
        }
      };
      const onPlay = () => {
        setPausedSafe(false);
        waitingSinceRef.current = 0;
        markPlaybackProgress(media.currentTime);
        syncTimelineState();
      };
      const onPause = () => {
        setPausedSafe(true);
        waitingSinceRef.current = 0;
        syncTimelineState();
      };
      const onTimeUpdate = () => {
        markPlaybackProgress(media.currentTime);
        syncTimelineState();
      };
      const onDurationChange = () => {
        syncTimelineState();
      };
      const onWaiting = () => {
        if (media.seeking || media.paused || media.ended) {
          return;
        }
        setStateSafe("buffering");
        const now = Date.now();
        if (waitingSinceRef.current === 0) {
          waitingSinceRef.current = now;
        }
        if (
          now - waitingSinceRef.current >= waitingRecoveryThresholdMs &&
          now - lastProgressAtRef.current >= waitingRecoveryThresholdMs &&
          getBufferRemaining() < 0.5
        ) {
          void recoverPlayback("Video bekleme durumunda uzun sure kaldi.", media.currentTime);
        }
      };
      const onStalled = () => {
        if (media.seeking || media.paused || media.ended) {
          return;
        }
        waitingSinceRef.current = Date.now();
        void recoverPlayback("Film veya bolum akisinda takilma algilandi.", media.currentTime);
      };
      const onSeeking = () => {
        setStateSafe("buffering");
        syncTimelineState();
        scheduleSeekRecovery(media.currentTime);
      };
      const onSeeked = () => {
        clearSeekGuard();
        desiredSeekTimeRef.current = null;
        waitingSinceRef.current = 0;
        markPlaybackProgress(media.currentTime);
        syncTimelineState();
      };
      const onEnded = () => {
        setStateSafe("ended");
        setPausedSafe(true);
        waitingSinceRef.current = 0;
        syncTimelineState();
        onEndedRef.current?.();
      };
      const onError = () => {
        if (media.seeking) {
          void recoverPlayback("Ileri sarma sonrasinda akis hata verdi.", media.currentTime);
          return;
        }
        void recoverPlayback("Video oynatici hata verdi.", media.currentTime);
      };

      media.addEventListener("loadstart", onLoadStart);
      media.addEventListener("loadedmetadata", onLoadedMetadata);
      media.addEventListener("canplay", onCanPlay);
      media.addEventListener("playing", onPlaying);
      media.addEventListener("play", onPlay);
      media.addEventListener("pause", onPause);
      media.addEventListener("timeupdate", onTimeUpdate);
      media.addEventListener("durationchange", onDurationChange);
      media.addEventListener("waiting", onWaiting);
      media.addEventListener("stalled", onStalled);
      media.addEventListener("seeking", onSeeking);
      media.addEventListener("seeked", onSeeked);
      media.addEventListener("ended", onEnded);
      media.addEventListener("error", onError);

      stallWatchdogTimerRef.current = window.setInterval(() => {
        if (media.paused || media.seeking || media.ended) {
          return;
        }

        const now = Date.now();
        if (lastProgressAtRef.current === 0) {
          lastProgressAtRef.current = now;
          return;
        }

        const silentForMs = now - lastProgressAtRef.current;
        if (silentForMs < vodSilentThresholdMs) {
          return;
        }

        const remaining = getBufferRemaining();
        if (!autoCompatibilityEscalatedRef.current && canUseVodCompatibilityRetry(resolvedPlaybackRef.current)) {
          autoCompatibilityEscalatedRef.current = true;
          void runCompatibilityRetry("Video ilerlemesi durdu, uyumluluk modu devreye aliniyor.", {
            resumeAt: media.currentTime,
            trigger: "auto"
          });
          return;
        }

        if (remaining > 6) {
          try {
            media.currentTime = clampPlaybackTime(media.currentTime + 0.08, Number.isFinite(media.duration) ? media.duration : Infinity);
            markPlaybackProgress(media.currentTime);
          } catch {
            // noop
          }
        }

        void recoverPlayback("Video ilerlemesi durdu, oynatma yenileniyor.", media.currentTime);
      }, vodWatchdogIntervalMs);

      return () => {
        media.removeEventListener("loadstart", onLoadStart);
        media.removeEventListener("loadedmetadata", onLoadedMetadata);
        media.removeEventListener("canplay", onCanPlay);
        media.removeEventListener("playing", onPlaying);
        media.removeEventListener("play", onPlay);
        media.removeEventListener("pause", onPause);
        media.removeEventListener("timeupdate", onTimeUpdate);
        media.removeEventListener("durationchange", onDurationChange);
        media.removeEventListener("waiting", onWaiting);
        media.removeEventListener("stalled", onStalled);
        media.removeEventListener("seeking", onSeeking);
        media.removeEventListener("seeked", onSeeked);
        media.removeEventListener("ended", onEnded);
        media.removeEventListener("error", onError);
        clearStallWatchdog();
      };
    }

    async function requestPlay() {
      try {
        await media.play();
        setInteractionRequiredSafe(false);
        setPausedSafe(false);
        debugVod("play-success");
        syncTimelineState();
      } catch (error) {
        debugVod("play-error", {
          message: getMediaErrorMessage(error, "play() hatasi"),
          name: error instanceof Error ? error.name : null
        });
        if (isAutoplayBlockedError(error)) {
          setStateSafe("idle");
          setInteractionRequiredSafe(true);
          setErrorSafe(null);
          setPausedSafe(true);
          return;
        }

        if (isPlayInterruptedError(error)) {
          // Some browsers can interrupt play() during source handoff.
          setStateSafe("buffering");
          return;
        }

        throw error;
      }
    }

    async function mountNative(url: string, resumeAt?: number) {
      teardownPlayer();
      const detachEvents = attachMediaEvents((targetTime) => {
        if (typeof targetTime === "number" && targetTime > 0) {
          media.currentTime = targetTime;
        }
      }, resumeAt);
      cleanupRef.current = () => {
        detachEvents();
      };
      media.muted = false;
      if (media.volume === 0) {
        media.volume = 1;
      }
      media.src = url;
      media.preload = "auto";
      media.playsInline = true;
      media.load();
      await requestPlay();
    }

    async function mountHls(url: string, resumeAt?: number) {
      if (media.canPlayType("application/vnd.apple.mpegurl")) {
        await mountNative(url, resumeAt);
        return;
      }

      const module = await import("hls.js");
      const HlsCtor = (module as { default?: new (config?: Record<string, unknown>) => unknown }).default;
      const HlsNamespace = module as {
        default?: {
          isSupported?: () => boolean;
          Events?: Record<string, string>;
        };
      };
      const isSupported = typeof HlsNamespace.default?.isSupported === "function" ? HlsNamespace.default.isSupported() : false;
      const hlsEvents = HlsNamespace.default?.Events;

      if (!HlsCtor || !isSupported || !hlsEvents) {
        await mountNative(url, resumeAt);
        return;
      }

      teardownPlayer();
      const detachEvents = attachMediaEvents((targetTime) => {
        if (typeof targetTime === "number" && targetTime > 0) {
          window.requestAnimationFrame(() => {
            media.currentTime = targetTime;
          });
        }
      }, resumeAt);
      const startPosition = typeof resumeAt === "number" && resumeAt > 0 ? resumeAt : -1;
      const hls = new HlsCtor({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 45,
        maxBufferLength: 90,
        maxMaxBufferLength: 180,
        maxBufferHole: 0.4,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.12,
        nudgeMaxRetry: 6,
        startFragPrefetch: true,
        startPosition,
        manifestLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 12_000,
            maxLoadTimeMs: 22_000,
            timeoutRetry: {
              maxNumRetry: 4,
              retryDelayMs: 500,
              maxRetryDelayMs: 4_000
            },
            errorRetry: {
              maxNumRetry: 4,
              retryDelayMs: 900,
              maxRetryDelayMs: 7_000
            }
          }
        },
        playlistLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 10_000,
            maxLoadTimeMs: 20_000,
            timeoutRetry: {
              maxNumRetry: 4,
              retryDelayMs: 500,
              maxRetryDelayMs: 4_000
            },
            errorRetry: {
              maxNumRetry: 4,
              retryDelayMs: 900,
              maxRetryDelayMs: 7_000
            }
          }
        },
        fragLoadPolicy: {
          default: {
            maxTimeToFirstByteMs: 12_000,
            maxLoadTimeMs: 24_000,
            timeoutRetry: {
              maxNumRetry: 4,
              retryDelayMs: 550,
              maxRetryDelayMs: 4_000
            },
            errorRetry: {
              maxNumRetry: 4,
              retryDelayMs: 1_000,
              maxRetryDelayMs: 8_000
            }
          }
        }
      }) as {
        attachMedia: (element: HTMLMediaElement) => void;
        loadSource: (source: string) => void;
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        startLoad?: (startPosition?: number) => void;
        recoverMediaError?: () => void;
        audioTrack?: number;
        destroy: () => void;
      };
      hlsControllerRef.current = {
        startLoad: (startPosition?: number) => hls.startLoad?.(startPosition),
        recoverMediaError: () => hls.recoverMediaError?.(),
        setAudioTrack: (trackIndex: number) => {
          if (typeof hls.audioTrack === "number") {
            hls.audioTrack = trackIndex;
          }
        },
        destroy: () => hls.destroy()
      };

      hls.on(hlsEvents.MEDIA_ATTACHED, () => {
        hls.loadSource(url);
      });

      hls.on(hlsEvents.MANIFEST_PARSED, () => {
        void requestPlay().catch((error) => {
          void failPlayback(getMediaErrorMessage(error, "Video oynatilamadi."));
        });
      });

      if (typeof hlsEvents.AUDIO_TRACKS_UPDATED === "string") {
        hls.on(hlsEvents.AUDIO_TRACKS_UPDATED, (_event, data) => {
          const knownTracks = resolvedPlaybackRef.current?.audioTracks ?? [];
          const nextTracks =
            knownTracks.length > 0
              ? knownTracks
              : ((data as { audioTracks?: Array<{ lang?: string; name?: string; default?: boolean }> } | undefined)
                  ?.audioTracks ?? []
                ).map((track, index) => ({
                  id: `hls-track-${index}`,
                  language: track.lang ?? null,
                  title: track.name ?? null,
                  channels: null,
                  isDefault: track.default === true
                }));

          audioTracksRef.current = nextTracks;
          setAudioTracks(nextTracks);

          if (nextTracks.length === 0) {
            return;
          }

          const preferredTrackId =
            preferredAudioTrackIdRef.current ??
            resolvedPlaybackRef.current?.selectedAudioTrackId ??
            resolvedPlaybackRef.current?.defaultAudioTrackId ??
            nextTracks.find((track) => track.isDefault)?.id ??
            nextTracks[0]?.id ??
            null;
          if (!preferredTrackId) {
            return;
          }

          const preferredIndex = nextTracks.findIndex((track) => track.id === preferredTrackId);
          if (preferredIndex < 0) {
            return;
          }

          preferredAudioTrackIdRef.current = preferredTrackId;
          activeAudioTrackIdRef.current = preferredTrackId;
          setSelectedAudioTrackId(preferredTrackId);
          if (typeof hls.audioTrack === "number" && hls.audioTrack !== preferredIndex) {
            hls.audioTrack = preferredIndex;
          }
        });
      }

      if (typeof hlsEvents.AUDIO_TRACK_SWITCHED === "string") {
        hls.on(hlsEvents.AUDIO_TRACK_SWITCHED, (_event, data) => {
          const switchedIndex = (data as { id?: number } | undefined)?.id;
          if (typeof switchedIndex !== "number" || switchedIndex < 0) {
            return;
          }
          const nextTrack = audioTracksRef.current[switchedIndex];
          if (!nextTrack) {
            return;
          }
          preferredAudioTrackIdRef.current = nextTrack.id;
          activeAudioTrackIdRef.current = nextTrack.id;
          setSelectedAudioTrackId(nextTrack.id);
          void reportVodEvent("audio-track-selected", {
            audioTrackId: nextTrack.id
          });
        });
      }

      hls.on(hlsEvents.ERROR, (_event, data) => {
        const errorData = data as { fatal?: boolean; details?: string; type?: string } | undefined;
        const normalizedType = `${errorData?.type ?? ""}`.toLowerCase();
        const normalizedDetail = `${errorData?.details ?? ""}`.toLowerCase();
        const isBufferStall =
          normalizedDetail.includes("bufferstalled") || normalizedDetail.includes("buffer_stalled");
        const isAudioCodecFailure =
          normalizedDetail.includes("manifestincompatiblecodecserror") ||
          normalizedDetail.includes("bufferincompatiblecodecserror") ||
          normalizedDetail.includes("bufferaddcodecerror") ||
          normalizedDetail.includes("audiotrackloaderror");

        if (!errorData?.fatal) {
          if (isBufferStall && getBufferRemaining() < 0.6) {
            void recoverPlayback("HLS buffer gecici olarak takildi.", media.currentTime);
          }
          return;
        }

        const now = Date.now();
        if (normalizedType.includes("network") && hlsControllerRef.current?.startLoad) {
          if (now - lastHlsNetworkRecoveryAtRef.current > 3_000) {
            lastHlsNetworkRecoveryAtRef.current = now;
            hlsControllerRef.current.startLoad(-1);
            void requestPlay().catch(() => undefined);
            return;
          }
        }

        if (normalizedType.includes("media") && hlsControllerRef.current?.recoverMediaError) {
          if (now - lastHlsMediaRecoveryAtRef.current > 5_000) {
            lastHlsMediaRecoveryAtRef.current = now;
            hlsControllerRef.current.recoverMediaError();
            void requestPlay().catch(() => undefined);
            return;
          }
        }

        if (isAudioCodecFailure) {
          const trackList = audioTracksRef.current;
          const currentIndex = typeof hls.audioTrack === "number" ? hls.audioTrack : -1;
          const fallbackIndex = trackList.length > 1 ? (currentIndex + 1 + trackList.length) % trackList.length : -1;
          if (fallbackIndex >= 0 && trackList[fallbackIndex]) {
            const fallbackTrack = trackList[fallbackIndex];
            preferredAudioTrackIdRef.current = fallbackTrack.id;
            activeAudioTrackIdRef.current = fallbackTrack.id;
            setSelectedAudioTrackId(fallbackTrack.id);
            if (typeof hls.audioTrack === "number") {
              hls.audioTrack = fallbackIndex;
            }
            void reportVodEvent("audio-track-switch-failed", {
              audioTrackId: fallbackTrack.id,
              errorCode: errorData.details ?? "audio-track-load-error",
              detail: {
                fromIndex: currentIndex,
                toIndex: fallbackIndex
              }
            });
          } else {
            void reportVodEvent("audio-track-switch-failed", {
              audioTrackId: activeAudioTrackIdRef.current,
              errorCode: errorData.details ?? "audio-track-load-error"
            });
          }
        }

        void recoverPlayback(errorData.details ?? "HLS akisi hata verdi.", media.currentTime);
      });

      hls.attachMedia(media);
      cleanupRef.current = () => {
        detachEvents();
        hlsControllerRef.current = null;
        try {
          hls.destroy();
        } catch {
          // noop
        }
      };
    }

    async function mountSource(playback: VodPlaybackRecord, resumeAt?: number) {
      if (!playback.url) {
        await failPlayback(playback.errorMessage ?? "VOD akisi hazir degil.");
        return;
      }

      setStateSafe("connecting");
      setErrorSafe(null);
      if (shouldUseHlsForVodPlayback(playback)) {
        await mountHls(playback.url, resumeAt);
        return;
      }

      try {
        debugVod("mount-native-attempt", {
          url: playback.url,
          transport: playback.transport,
          deliveryMode: playback.deliveryMode
        });
        await mountNative(playback.url, resumeAt);
      } catch (error) {
        const unsupportedSource = isUnsupportedSourceError(error);
        if (
          unsupportedSource &&
          !transcodeFallbackAttemptedRef.current &&
          playback.deliveryMode === "file_proxy"
        ) {
          transcodeFallbackAttemptedRef.current = true;
          debugVod("mount-native-request-transcode-fallback", {
            url: playback.url,
            transport: playback.transport,
            message: getMediaErrorMessage(error, "native mount hatasi")
          });
          const transcodePlayback = await resolvePlayback({ preferTranscode: true });
          if (transcodePlayback) {
            await mountSource(transcodePlayback, resumeAt);
            return;
          }
        }

        const shouldTryHlsFallback = unsupportedSource && shouldUseHlsForVodPlayback(playback);
        if (shouldTryHlsFallback) {
          debugVod("mount-native-fallback-hls", {
            reason: "unsupported-source",
            message: getMediaErrorMessage(error, "native mount hatasi")
          });
          await mountHls(playback.url, resumeAt);
          return;
        }

        throw error;
      }
    }

    compatibilityRetryHandlerRef.current = async () => {
      await runCompatibilityRetry("Uyumluluk modu kullanici tarafindan tetiklendi.", {
        resumeAt: media.currentTime,
        trigger: "manual"
      });
    };

    void (async () => {
      try {
        const playback = await resolvePlayback();
        if (!playback) {
          return;
        }
        await mountSource(playback);
      } catch (error) {
        await failPlayback(getMediaErrorMessage(error, "VOD oynatici hazirlanamadi."));
      }
    })();

    return () => {
      disposed = true;
      compatibilityRetryHandlerRef.current = null;
      compatibilityRetryingRef.current = false;
      teardownPlayer();
    };
  }, [item.id, item.kind, item.playbackAllowed, reportVodPlayback, resolveVodPlayback]);

  const continuePlayback = useCallback(async () => {
    const mediaElement = videoRef.current;
    if (!mediaElement) {
      return;
    }

    try {
      await mediaElement.play();
      setInteractionRequired(false);
      setPlayerError(null);
      setPlayerState("playing");
      setIsPaused(false);
    } catch (error) {
      if (isAutoplayBlockedError(error)) {
        setPlayerState("idle");
        setInteractionRequired(true);
        setPlayerError(null);
        setIsPaused(true);
        return;
      }
      if (isPlayInterruptedError(error)) {
        setPlayerState("buffering");
        setIsPaused(mediaElement.paused);
        return;
      }
      setPlayerError(getMediaErrorMessage(error, "Video oynatilamadi."));
      setInteractionRequired(false);
      setPlayerState("failed");
      setIsPaused(true);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement) {
      return;
    }

    try {
      mediaElement.pause();
      setIsPaused(true);
      setInteractionRequired(false);
    } catch {
      // noop
    }
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const mediaElement = videoRef.current;
    if (!mediaElement || !Number.isFinite(seconds) || seconds === 0) {
      return;
    }

    const mediaDuration =
      Number.isFinite(mediaElement.duration) && mediaElement.duration > 0 ? mediaElement.duration : duration;
    if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) {
      return;
    }

    const nextTime = clampPlaybackTime(mediaElement.currentTime + seconds, mediaDuration);
    if (Math.abs(nextTime - mediaElement.currentTime) < 0.05) {
      return;
    }

    try {
      mediaElement.currentTime = nextTime;
      setCurrentTime(nextTime);
      setCanSeek(true);
    } catch {
      // noop
    }
  }, [duration]);

  const togglePlayback = useCallback(async () => {
    const mediaElement = videoRef.current;
    if (!mediaElement) {
      return;
    }

    if (mediaElement.paused || mediaElement.ended) {
      await continuePlayback();
      return;
    }

    stopPlayback();
  }, [continuePlayback, stopPlayback]);

  const retryWithCompatibilityMode = useCallback(async () => {
    const handler = compatibilityRetryHandlerRef.current;
    if (!handler) {
      return;
    }

    await handler();
  }, []);

  const selectAudioTrack = useCallback(
    async (trackId: string) => {
      const normalizedTrackId = trackId.trim();
      if (!normalizedTrackId || normalizedTrackId === selectedAudioTrackId) {
        return;
      }

      preferredAudioTrackIdRef.current = normalizedTrackId;
      activeAudioTrackIdRef.current = normalizedTrackId;
      setSelectedAudioTrackId(normalizedTrackId);

      const selectedIndex = audioTracksRef.current.findIndex((track) => track.id === normalizedTrackId);
      if (selectedIndex >= 0 && hlsControllerRef.current?.setAudioTrack) {
        hlsControllerRef.current.setAudioTrack(selectedIndex);
        try {
          await reportVodPlayback(item.kind === "movie" ? "movie" : "episode", item.id, {
            event: "audio-track-selected",
            audioTrackId: normalizedTrackId,
            deliveryMode: resolvedPlaybackRef.current?.deliveryMode ?? null,
            sourceTransport: resolvedPlaybackRef.current?.transport ?? null,
            playerEngine: "hls.js",
            errorMessage: null
          });
        } catch {
          // noop
        }
        return;
      }

      const media = videoRef.current;
      const nativeAudioTracks = (
        media as
          | (HTMLVideoElement & {
              audioTracks?: {
                length: number;
                [index: number]: { enabled: boolean } | undefined;
              };
            })
          | null
      )?.audioTracks;
      if (
        selectedIndex >= 0 &&
        nativeAudioTracks &&
        typeof nativeAudioTracks.length === "number" &&
        nativeAudioTracks.length > selectedIndex
      ) {
        for (let index = 0; index < nativeAudioTracks.length; index += 1) {
          const nativeTrack = nativeAudioTracks[index];
          if (nativeTrack) {
            nativeTrack.enabled = index === selectedIndex;
          }
        }
        try {
          await reportVodPlayback(item.kind === "movie" ? "movie" : "episode", item.id, {
            event: "audio-track-selected",
            audioTrackId: normalizedTrackId,
            deliveryMode: resolvedPlaybackRef.current?.deliveryMode ?? null,
            sourceTransport: resolvedPlaybackRef.current?.transport ?? null,
            playerEngine: "native",
            errorMessage: null
          });
        } catch {
          // noop
        }
        return;
      }

      const resumeAt = media && Number.isFinite(media.currentTime) ? media.currentTime : 0;

      try {
        const refreshedPlayback = await resolveVodPlayback(item.kind === "movie" ? "movie" : "episode", item.id, {
          debugVod: vodDebugEnabledRef.current,
          audioTrackId: normalizedTrackId
        });

        if (!refreshedPlayback.canPlay || !refreshedPlayback.url) {
          throw new Error(refreshedPlayback.errorMessage ?? "Ses track degistirilemedi.");
        }

        resolvedPlaybackRef.current = refreshedPlayback;
        setResolvedPlayback(refreshedPlayback);
        const nextTracks = refreshedPlayback.audioTracks ?? [];
        audioTracksRef.current = nextTracks;
        setAudioTracks(nextTracks);
        setSelectedAudioTrackId(
          refreshedPlayback.selectedAudioTrackId ??
            refreshedPlayback.defaultAudioTrackId ??
            nextTracks.find((track) => track.isDefault)?.id ??
            nextTracks[0]?.id ??
            normalizedTrackId
        );

        if (media) {
          media.src = refreshedPlayback.url;
          media.load();
          if (resumeAt > 0 && Number.isFinite(media.duration) && media.duration > resumeAt + 0.1) {
            media.currentTime = resumeAt;
          }
          await media.play().catch(() => undefined);
        }

        await reportVodPlayback(item.kind === "movie" ? "movie" : "episode", item.id, {
          event: "audio-track-selected",
          audioTrackId: normalizedTrackId,
          deliveryMode: refreshedPlayback.deliveryMode,
          sourceTransport: refreshedPlayback.transport,
          playerEngine: hlsControllerRef.current ? "hls.js" : "native",
          errorMessage: null
        });
      } catch (error) {
        setPlayerError("Ses kanali degistirilemedi.");
        try {
          await reportVodPlayback(item.kind === "movie" ? "movie" : "episode", item.id, {
            event: "audio-track-switch-failed",
            audioTrackId: normalizedTrackId,
            deliveryMode: resolvedPlaybackRef.current?.deliveryMode ?? null,
            sourceTransport: resolvedPlaybackRef.current?.transport ?? null,
            playerEngine: hlsControllerRef.current ? "hls.js" : "native",
            errorCode: "manual-switch-failed",
            detail: {
              message: getMediaErrorMessage(error, "Ses track degistirilemedi.")
            },
            errorMessage: getMediaErrorMessage(error, "Ses track degistirilemedi.")
          });
        } catch {
          // noop
        }
      }
    },
    [item.id, item.kind, reportVodPlayback, resolveVodPlayback, selectedAudioTrackId]
  );

  const canRetryWithCompatibilityMode = canUseVodCompatibilityRetry(resolvedPlayback);

  return {
    videoRef,
    playerState,
    playerError,
    interactionRequired,
    resolvedPlayback,
    continuePlayback,
    stopPlayback,
    togglePlayback,
    retryWithCompatibilityMode,
    canRetryWithCompatibilityMode,
    compatibilityRetrying,
    seekBy,
    isPaused,
    currentTime,
    duration,
    canSeek,
    audioTracks,
    selectedAudioTrackId,
    selectAudioTrack
  };
}

function useVodMediaShortcuts({
  onTogglePlayback,
  onStopPlayback
}: {
  onTogglePlayback: () => Promise<void> | void;
  onStopPlayback: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "MediaPlayPause") {
        event.preventDefault();
        event.stopPropagation();
        void onTogglePlayback();
        return;
      }

      if (event.key === "MediaStop") {
        event.preventDefault();
        event.stopPropagation();
        onStopPlayback();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onStopPlayback, onTogglePlayback]);
}

function VodMiniControls({
  itemId,
  kind,
  canSeek,
  isPaused,
  controlsLocked,
  onSeekBackward,
  onSeekForward,
  onTogglePlayback
}: {
  itemId: string;
  kind: "movie" | "episode";
  canSeek: boolean;
  isPaused: boolean;
  controlsLocked: boolean;
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onTogglePlayback: () => Promise<void> | void;
}) {
  const controlRegion = "overlay-player-actions";

  return (
    <div className="vod-mini-controls" role="group" aria-label="Video mini kontrolleri">
      <button
        type="button"
        className="vod-mini-control"
        onClick={onSeekBackward}
        disabled={!canSeek || controlsLocked}
        aria-label="10 saniye geri sar"
        data-tv-focusable="true"
        data-tv-region={controlRegion}
        data-tv-focus-key={`${kind}-seek-back-${itemId}`}
      >
        <SeekBackwardGlyph />
        <span>-10s</span>
      </button>

      <button
        type="button"
        className="vod-mini-control is-primary"
        onClick={() => void onTogglePlayback()}
        disabled={controlsLocked}
        aria-label={isPaused ? "Oynat" : "Durdur"}
        data-tv-focusable="true"
        data-tv-region={controlRegion}
        data-tv-focus-key={`${kind}-toggle-${itemId}`}
      >
        {isPaused ? <PlayGlyph /> : <PauseGlyph />}
        <span>{isPaused ? "Oynat" : "Durdur"}</span>
      </button>

      <button
        type="button"
        className="vod-mini-control"
        onClick={onSeekForward}
        disabled={!canSeek || controlsLocked}
        aria-label="10 saniye ileri sar"
        data-tv-focusable="true"
        data-tv-region={controlRegion}
        data-tv-focus-key={`${kind}-seek-forward-${itemId}`}
      >
        <SeekForwardGlyph />
        <span>+10s</span>
      </button>
    </div>
  );
}

function MoviePlayerSurface({
  item,
  resolveVodPlayback,
  reportVodPlayback,
  onClose
}: {
  item: PlaybackItem;
  resolveVodPlayback: ViewerCoreHandle["resolveVodPlayback"];
  reportVodPlayback: ViewerCoreHandle["reportVodPlayback"];
  onClose: () => void;
}) {
  const {
    videoRef,
    playerState,
    playerError,
    interactionRequired,
    continuePlayback,
    stopPlayback,
    togglePlayback,
    seekBy,
    isPaused,
    canSeek,
    audioTracks,
    selectedAudioTrackId,
    selectAudioTrack
  } = useVodPlaybackController({
    item,
    resolveVodPlayback,
    reportVodPlayback
  });
  const showStatusBar = Boolean(playerError) || interactionRequired || audioTracks.length > 1;
  const controlsLocked = playerState === "resolving" || playerState === "connecting";

  useVodMediaShortcuts({
    onTogglePlayback: togglePlayback,
    onStopPlayback: stopPlayback
  });

  return (
    <div className="movie-player-shell">
      <div className="movie-player-stage">
        <button
          type="button"
          className="button secondary movie-player-back"
          onClick={onClose}
          data-tv-focusable="true"
          data-tv-region="overlay-player-actions"
          data-tv-focus-key={`movie-back-${item.id}`}
          data-tv-overlay-initial="true"
        >
          <ChevronLeftGlyph />
          <span>Geri</span>
        </button>

        <div className="movie-player-topbar">
          <span className="movie-player-kicker">Film</span>
          <div className="movie-player-copy">
            <strong>{item.title}</strong>
            {item.subtitle ? <span>{item.subtitle}</span> : null}
          </div>
        </div>

        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          poster={item.imageUrl ?? undefined}
          className="player-video movie-player-video"
        >
          Tarayici video elementini desteklemiyor.
        </video>

        <VodMiniControls
          itemId={item.id}
          kind="movie"
          canSeek={canSeek}
          isPaused={isPaused}
          controlsLocked={controlsLocked}
          onSeekBackward={() => seekBy(-10)}
          onSeekForward={() => seekBy(10)}
          onTogglePlayback={togglePlayback}
        />

        {showStatusBar ? (
          <div className="movie-player-status">
            {playerError ? <span className="movie-player-status-text">{playerError}</span> : null}
            {!playerError && interactionRequired ? (
              <span className="movie-player-status-text">Oynatmayi baslatmak icin dokunun.</span>
            ) : null}
            {audioTracks.length > 1 ? (
              <label className="movie-player-status-text">
                Ses:
                <select
                  value={selectedAudioTrackId ?? ""}
                  onChange={(event) => {
                    void selectAudioTrack(event.target.value);
                  }}
                  data-tv-focusable="true"
                  data-tv-region="overlay-player-actions"
                  data-tv-focus-key={`movie-audio-track-${item.id}`}
                >
                  {audioTracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.title ?? track.language ?? track.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        {interactionRequired ? (
          <button
            type="button"
            className="movie-play-overlay"
            onClick={() => void continuePlayback()}
            data-tv-focusable="true"
            data-tv-region="overlay-player-actions"
            data-tv-focus-key={`movie-play-${item.id}`}
          >
            Oynat
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EpisodePlayerSurface({
  item,
  resolveVodPlayback,
  reportVodPlayback,
  onClose,
  onRequestNext
}: {
  item: PlaybackItem;
  resolveVodPlayback: ViewerCoreHandle["resolveVodPlayback"];
  reportVodPlayback: ViewerCoreHandle["reportVodPlayback"];
  onClose: () => void;
  onRequestNext: (nextItem: PlaybackItem, options?: { reason: "ended" | "failed" }) => void;
}) {
  const autoNextCountdownSeconds = 5;
  const autoNextThresholdSeconds = 8;
  const autoSkipLimit = 5;
  const [nextCountdown, setNextCountdown] = useState<number | null>(null);
  const [queuedNextItem, setQueuedNextItem] = useState<PlaybackItem | null>(null);
  const [nextCountdownReason, setNextCountdownReason] = useState<"ended" | "failed" | null>(null);
  const nearEndProgressRef = useRef({
    time: 0,
    advancedAt: 0
  });
  const nextPlayableItem = findNextPlayableEpisode(item.nextItem);
  const autoSkipDepth = item.autoSkipDepth ?? 0;

  function startNextCountdown(
    reason: "ended" | "failed",
    remainingSeconds?: number,
    candidate?: PlaybackItem | null
  ) {
    const nextCandidate = candidate ?? nextPlayableItem;
    if (!nextCandidate) {
      return;
    }

    const fallback = autoNextCountdownSeconds;
    const normalizedSeconds =
      typeof remainingSeconds === "number" && Number.isFinite(remainingSeconds)
        ? Math.max(1, Math.min(fallback, Math.ceil(remainingSeconds)))
        : fallback;

    setNextCountdown((current) => {
      if (current === null) {
        return normalizedSeconds;
      }

      return Math.min(current, normalizedSeconds);
    });
    setQueuedNextItem((current) => current ?? nextCandidate);
    setNextCountdownReason((current) =>
      reason === "failed" ? "failed" : current ?? "ended"
    );
  }

  const {
    videoRef,
    playerState,
    playerError,
    interactionRequired,
    continuePlayback,
    stopPlayback,
    togglePlayback,
    seekBy,
    isPaused,
    canSeek,
    audioTracks,
    selectedAudioTrackId,
    selectAudioTrack
  } = useVodPlaybackController({
    item,
    resolveVodPlayback,
    reportVodPlayback,
    onEnded: () => {
      startNextCountdown("ended");
    }
  });
  const autoSkipLimitReached =
    playerState === "failed" && autoSkipDepth >= autoSkipLimit && Boolean(nextPlayableItem);
  const noNextEpisodeCandidate =
    playerState === "failed" && !nextPlayableItem;
  const showStatusBar =
    Boolean(playerError) ||
    interactionRequired ||
    audioTracks.length > 1 ||
    noNextEpisodeCandidate ||
    autoSkipLimitReached;
  const controlsLocked = playerState === "resolving" || playerState === "connecting";

  useVodMediaShortcuts({
    onTogglePlayback: togglePlayback,
    onStopPlayback: stopPlayback
  });

  useEffect(() => {
    setNextCountdown(null);
    setQueuedNextItem(null);
    setNextCountdownReason(null);
    nearEndProgressRef.current = {
      time: 0,
      advancedAt: Date.now()
    };
  }, [item.id]);

  useEffect(() => {
    if (!nextPlayableItem || nextCountdown !== null || playerState !== "playing") {
      return;
    }

    const timer = window.setInterval(() => {
      const media = videoRef.current;
      if (!media) {
        return;
      }
      if (media.paused || media.seeking) {
        return;
      }

      const { duration, currentTime } = media;
      if (!Number.isFinite(duration) || duration <= 0) {
        return;
      }

      const now = Date.now();
      if (nearEndProgressRef.current.advancedAt === 0) {
        nearEndProgressRef.current.advancedAt = now;
      }
      if (currentTime > nearEndProgressRef.current.time + 0.05) {
        nearEndProgressRef.current.time = currentTime;
        nearEndProgressRef.current.advancedAt = now;
      }

      const remaining = duration - currentTime;
      if (remaining > 0 && remaining <= autoNextThresholdSeconds) {
        startNextCountdown("ended", remaining, nextPlayableItem);
        return;
      }

      if (remaining >= 0 && remaining <= 2 && now - nearEndProgressRef.current.advancedAt > 2600) {
        startNextCountdown("ended", 1, nextPlayableItem);
      }
    }, 400);

    return () => window.clearInterval(timer);
  }, [nextPlayableItem, nextCountdown, playerState, videoRef]);

  useEffect(() => {
    if (playerState !== "failed" || !nextPlayableItem || autoSkipDepth >= autoSkipLimit) {
      return;
    }

    startNextCountdown("failed", 3, nextPlayableItem);
  }, [autoSkipDepth, nextPlayableItem, playerState]);

  useEffect(() => {
    if (nextCountdown === null || !queuedNextItem || !nextCountdownReason) {
      return;
    }

    if (nextCountdown <= 0) {
      onRequestNext(queuedNextItem, { reason: nextCountdownReason });
      return;
    }

    const timer = window.setTimeout(() => {
      setNextCountdown((value) => (value === null ? value : value - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [nextCountdown, nextCountdownReason, onRequestNext, queuedNextItem]);

  return (
    <div className="episode-player-shell">
      <div className="episode-player-stage">
        <button
          type="button"
          className="button secondary episode-player-back"
          onClick={onClose}
          data-tv-focusable="true"
          data-tv-region="overlay-player-actions"
          data-tv-focus-key={`episode-back-${item.id}`}
          data-tv-overlay-initial="true"
        >
          <ChevronLeftGlyph />
          <span>Geri</span>
        </button>

        <div className="episode-player-topbar">
          <span className="episode-player-kicker">Bolum</span>
          <div className="episode-player-copy">
            <strong>{item.title}</strong>
            {item.subtitle ? <span>{item.subtitle}</span> : null}
          </div>
        </div>

        <video
          ref={videoRef}
          controls
          autoPlay
          playsInline
          poster={item.imageUrl ?? undefined}
          className="player-video episode-player-video"
        >
          Tarayici video elementini desteklemiyor.
        </video>

        <VodMiniControls
          itemId={item.id}
          kind="episode"
          canSeek={canSeek}
          isPaused={isPaused}
          controlsLocked={controlsLocked}
          onSeekBackward={() => seekBy(-10)}
          onSeekForward={() => seekBy(10)}
          onTogglePlayback={togglePlayback}
        />

        {showStatusBar ? (
          <div className="episode-player-status">
            {playerError ? <span className="episode-player-status-text">{playerError}</span> : null}
            {!playerError && interactionRequired ? (
              <span className="episode-player-status-text">Oynatmayi baslatmak icin dokunun.</span>
            ) : null}
            {audioTracks.length > 1 ? (
              <label className="episode-player-status-text">
                Ses:
                <select
                  value={selectedAudioTrackId ?? ""}
                  onChange={(event) => {
                    void selectAudioTrack(event.target.value);
                  }}
                  data-tv-focusable="true"
                  data-tv-region="overlay-player-actions"
                  data-tv-focus-key={`episode-audio-track-${item.id}`}
                >
                  {audioTracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.title ?? track.language ?? track.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {noNextEpisodeCandidate ? (
              <span className="episode-player-status-text">Oynatilabilir sonraki bolum bulunamadi.</span>
            ) : null}
            {autoSkipLimitReached ? (
              <span className="episode-player-status-text">
                Art arda 5 bolum acilamadi. Otomatik sonraki bolum gecisi durduruldu.
              </span>
            ) : null}
          </div>
        ) : null}

        {interactionRequired ? (
          <button
            type="button"
            className="episode-play-overlay"
            onClick={() => void continuePlayback()}
            data-tv-focusable="true"
            data-tv-region="overlay-player-actions"
            data-tv-focus-key={`episode-play-${item.id}`}
          >
            Oynat
          </button>
        ) : null}

        {nextCountdown !== null && queuedNextItem ? (
          <div className="episode-player-countdown">
            <strong>{nextCountdownReason === "failed" ? "Bu bolum acilamadi" : "Sonraki bolum hazir"}</strong>
            <div>
              {queuedNextItem.title} {nextCountdown} saniye sonra{" "}
              {nextCountdownReason === "failed" ? "otomatik deneniyor." : "otomatik baslayacak."}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BlockedScreen({ whatsapp, telegram }: { whatsapp: string; telegram: string }) {
  return (
    <div className="content">
      <section className="hero-card">
        <span className="pill">Erisim Durdu</span>
        <h1>Hesabiniz su anda engelli</h1>
        <p className="muted">Destek ekibi ile iletisime gecerek tekrar aktivasyon talep edebilirsiniz.</p>
        <div className="button-row">
          <a className="button" href={whatsapp} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
          <a className="button secondary" href={telegram} target="_blank" rel="noreferrer">
            Telegram
          </a>
        </div>
      </section>
    </div>
  );
}

function HomeShell({ core }: { core: ViewerCoreHandle }) {
  const location = useLocation();
  const navigate = useNavigate();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [playingItem, setPlayingItem] = useState<PlaybackItem | null>(null);
  const [premiumPopupDismissed, setPremiumPopupDismissed] = useState(false);
  const [pendingPaymentPackage, setPendingPaymentPackage] = useState<PackageRecord | null>(null);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<PaymentMethodId | null>(null);
  const [selectedCryptoAssetId, setSelectedCryptoAssetId] = useState<CryptoAssetId | null>(null);
  const [paymentModalNotice, setPaymentModalNotice] = useState<string | null>(null);
  const paymentMethods = core.paymentMethods.filter((method) => method.enabled);
  const isPaymentModalOpen = Boolean(pendingPaymentPackage);
  const tvRouteKey = `${location.pathname}${playingItem ? "::overlay" : ""}${isPaymentModalOpen ? "::payment-modal" : ""}`;
  const me = core.me;
  const selectedPaymentMethod = selectedPaymentMethodId
    ? paymentMethods.find((method) => method.id === selectedPaymentMethodId) ?? null
    : null;
  const selectedCryptoAssets = buildCryptoAssets(
    selectedPaymentMethod?.id === "crypto" ? selectedPaymentMethod : null
  );
  const selectedCryptoAsset = selectedCryptoAssetId
    ? selectedCryptoAssets.find((asset) => asset.id === selectedCryptoAssetId) ?? null
    : null;

  function closePaymentMethodModal() {
    setPendingPaymentPackage(null);
    setSelectedPaymentMethodId(null);
    setSelectedCryptoAssetId(null);
    setPaymentModalNotice(null);
  }

  useTvNavigation({
    scopeRef: shellRef,
    routeKey: tvRouteKey,
    overlayOpen: Boolean(playingItem || isPaymentModalOpen),
    onBack: () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
        return true;
      }

      if (playingItem) {
        setPlayingItem(null);
        return true;
      }

      if (isPaymentModalOpen) {
        closePaymentMethodModal();
        return true;
      }

      return false;
    }
  });

  useEffect(() => {
    if (!playingItem && !isPaymentModalOpen) {
      return;
    }

    setPlayingItem(null);
    closePaymentMethodModal();
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname !== "/iletisim") {
      return;
    }

    void core.refreshMe().catch(() => undefined);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname !== "/paketler") {
      return;
    }

    void core.loadPaymentMethods().catch(() => undefined);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;

    if (playingItem || isPaymentModalOpen) {
      body.style.overflow = "hidden";
      documentElement.style.overflow = "hidden";
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isPaymentModalOpen, playingItem]);

  useEffect(() => {
    if (me?.user.hasActiveSubscription) {
      setPremiumPopupDismissed(false);
    }
  }, [me?.user.hasActiveSubscription]);

  useEffect(() => {
    if (!paymentModalNotice) {
      return;
    }

    const timer = setTimeout(() => setPaymentModalNotice(null), 1800);
    return () => clearTimeout(timer);
  }, [paymentModalNotice]);

  if (!me) {
    return <div className="content">Yukleniyor...</div>;
  }

  if (core.viewState === "blocked") {
    return <BlockedScreen whatsapp={me.contact.whatsapp} telegram={me.contact.telegram} />;
  }

  function openPaymentMethodModal(pkg: PackageRecord) {
    setSelectedPaymentMethodId(null);
    setSelectedCryptoAssetId(null);
    setPaymentModalNotice(null);
    setPendingPaymentPackage(pkg);
  }

  async function submitPaymentRequestWithMethod(_paymentMethodId: PaymentMethodId) {
    if (!pendingPaymentPackage) {
      return;
    }

    const packageSlug = pendingPaymentPackage.slug;
    closePaymentMethodModal();
    await core.requestPayment(packageSlug);
  }

  async function handleCopyPaymentValue(value: string | null | undefined, label: string) {
    const copyValue = toTextOrNull(value);
    if (!copyValue) {
      setPaymentModalNotice(`${label} bilgisi tanimli degil.`);
      return;
    }

    try {
      await copyText(copyValue);
      setPaymentModalNotice(`${label} kopyalandi.`);
    } catch {
      setPaymentModalNotice("Kopyalama su an desteklenmiyor.");
    }
  }

  const liveItems = core.catalogs.live.map<PlaybackItem>((channel: LiveChannel) => ({
    id: channel.id,
    kind: "live",
    title: channel.title,
    subtitle: channel.groupTitle,
    imageUrl: channel.logoUrl,
    artworkMode: "logo",
    streamUrl: channel.streamUrl,
    playbackAllowed: channel.playbackAllowed,
    transport: channel.transport,
    healthStatus: channel.healthStatus,
    isVerified: channel.isVerified,
    lastCheckedAt: channel.lastCheckedAt,
    nextItem: null
  }));

  const movieItems = core.catalogs.movies.map<PlaybackItem>((movie: MovieRecord) => ({
    id: movie.id,
    kind: "movie",
    title: movie.title,
    subtitle: movie.groupTitle,
    imageUrl: movie.posterUrl,
    artworkMode: "poster",
    streamUrl: movie.streamUrl,
    playbackAllowed: movie.playbackAllowed,
    nextItem: null
  }));

  const featuredSeriesItems: PlaybackItem[] = [];

  core.catalogs.series.forEach((series: SeriesRecord) => {
    const { featuredPlaybackItem } = buildSeriesPlaybackItems(series);
    if (featuredPlaybackItem) {
      featuredSeriesItems.push({
        ...featuredPlaybackItem,
        title: series.title,
        subtitle: `${series.seasonCount} sezon • ${series.episodeCount} bolum • ${series.groupTitle ?? "Seckin dizi"}`,
        nextItem: featuredPlaybackItem.nextItem
      });
    }
  });

  const movieKeywords = [
    "vizyon",
    "yeni",
    "4k",
    "aksiyon",
    "macera",
    "gerilim",
    "bilim",
    "savas",
    "epik"
  ];
  const seriesKeywords = ["populer", "premium", "yabanci", "yerli", "hit", "dram", "suclu", "macera"];
  const sportsKeywords = ["spor", "sports", "sport", "mac", "futbol", "uefa", "lig", "vip"];

  const movieRail = buildEditorialSelection(
    movieItems,
    10,
    (item, index) => {
      const text = normalizeText(`${item.title} ${item.subtitle ?? ""}`);
      return (
        (item.playbackAllowed ? 80 : 12) +
        (item.imageUrl ? 40 : 0) +
        countKeywordMatches(text, movieKeywords) * 15 +
        Math.max(0, 24 - index)
      );
    }
  );

  const seriesRail = buildEditorialSelection(
    featuredSeriesItems,
    10,
    (item, index) => {
      const text = normalizeText(`${item.title} ${item.subtitle ?? ""}`);
      return (
        (item.playbackAllowed ? 72 : 10) +
        (item.imageUrl ? 38 : 0) +
        countKeywordMatches(text, seriesKeywords) * 14 +
        Math.max(0, 20 - index)
      );
    }
  );

  const pinnedLiveItem = getPreferredLiveItem(liveItems, { preferSports: true });

  const liveRail = buildEditorialSelection(
    liveItems,
    10,
    (item, index) => {
      const text = normalizeText(`${item.title} ${item.subtitle ?? ""}`);
      const healthScore =
        item.healthStatus === "healthy" ? 54 : item.healthStatus === "degraded" ? 14 : item.healthStatus === "broken" ? -320 : 6;

      return (
        (item.playbackAllowed ? 85 : -260) +
        (item.imageUrl ? 24 : 0) +
        (item.isVerified ? 26 : 0) +
        healthScore +
        countKeywordMatches(text, sportsKeywords) * 12 +
        (isBeinVipChannel(item) ? 300 : isBeinSportsChannel(item) ? 180 : 0) +
        Math.max(0, 18 - index)
      );
    },
    pinnedLiveItem
  );

  const heroItem = movieRail[0] ?? seriesRail[0] ?? liveRail[0] ?? null;
  const subscriptionLabel =
    me.user.hasActiveSubscription && me.user.activePackage
      ? `${me.user.activePackage.title} • ${me.user.activePackage.remainingDays} gun`
      : "Paket aktif degil";
  const headerUserLabel = me.user.kryptoniteCode ?? core.codeLabel;
  return (
    <div ref={shellRef} className="shell">
      <ViewerHeader userLabel={headerUserLabel} onLogout={() => void core.logout()} />

      <main className="content shell-content">
        {core.notice ? <section className="notice-card">{core.notice}</section> : null}
        {core.error ? <section className="notice-card danger">{core.error}</section> : null}

        <Routes>
          <Route
            path="/"
            element={
              <HomeDashboard
                heroItem={heroItem}
                liveSpotlight={pinnedLiveItem}
                featuredMovies={movieRail}
                featuredSeries={seriesRail}
                featuredLive={liveRail}
                subscriptionLabel={subscriptionLabel}
                onPlay={setPlayingItem}
                onNavigate={(path) => navigate(path)}
              />
            }
          />
          <Route
            path="/canli-tv"
            element={
              <LiveTvPage
                items={liveItems}
                groups={core.catalogs.liveGroups}
                onApplyFilters={(search, group) => core.loadLiveCatalog({ search, group })}
                onLoadMore={(search, group) => core.loadMoreLive({ search, group })}
                hasMoreItems={core.catalogs.live.length < core.catalogs.livePagination.total}
                resolveLivePlayback={core.resolveLivePlayback}
                reportLivePlayback={core.reportLivePlayback}
              />
            }
          />
          <Route
            path="/filmler"
            element={
              <MoviesPage
                title="Filmler"
                items={movieItems}
                groups={core.catalogs.movieGroups}
                onApplyFilters={(search, group) => core.loadMoviesCatalog({ search, group })}
                onLoadMore={(search, group) => core.loadMoreMovies({ search, group })}
                hasMoreItems={core.catalogs.movies.length < core.catalogs.moviePagination.total}
                onPlay={setPlayingItem}
              />
            }
          />
          <Route
            path="/diziler"
            element={
              <SeriesGridPage
                title="Diziler"
                items={core.catalogs.series}
                groups={core.catalogs.seriesGroups}
                onApplyFilters={(search, group) => core.loadSeriesCatalog({ search, group })}
                onLoadMore={(search, group) => core.loadMoreSeries({ search, group })}
                hasMoreItems={core.catalogs.series.length < core.catalogs.seriesPagination.total}
                onOpenSeries={(seriesId) => navigate(`/diziler/${seriesId}`)}
              />
            }
          />
          <Route
            path="/diziler/:seriesId"
            element={
              <SeriesDetailPage
                seriesList={core.catalogs.series}
                onOpenPlayer={setPlayingItem}
                onBack={() => navigate("/diziler")}
              />
            }
          />
          <Route
            path="/paketler"
            element={
              <section className="panel-stack">
                <div className="section-header">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => navigate("/profil")}
                    data-tv-focusable="true"
                    data-tv-focus-key="profile-packages-back"
                  >
                    Geri
                  </button>
                  <h2 style={{ margin: 0 }}>Paketler</h2>
                </div>
                <p className="muted">Profil ekranina donup diger hesap islemlerini yonetebilirsiniz.</p>
                <section className="card-grid">
                  {core.packages.map((pkg) => (
                    <article key={pkg.id} className="panel-card panel-stack">
                      <span className="pill">{pkg.durationMonths} ay</span>
                      <h2>{pkg.title}</h2>
                      <p className="muted">
                        {pkg.priceLabel && pkg.priceLabel.trim().length > 0
                          ? `Fiyat: ${pkg.priceLabel}`
                          : "Fiyat bilgisi destek ekibinden alinir."}
                      </p>
                      <p className="muted">Paket onayi admin tarafinda baslatilir.</p>
                      <button className="button" onClick={() => openPaymentMethodModal(pkg)}>
                        Paket Al
                      </button>
                    </article>
                  ))}
                </section>
              </section>
            }
          />
          <Route
            path="/odemeler"
            element={
              <section className="panel-card panel-stack">
                <div className="section-header">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => navigate("/profil")}
                    data-tv-focusable="true"
                    data-tv-focus-key="profile-payments-back"
                  >
                    Geri
                  </button>
                  <h2>Odeme Bildirimi</h2>
                </div>
                <p className="muted">
                  Paket secimi sonrasinda odeme bildiriminiz burada listelenir. Onay sureci admin panelinde manuel olarak ilerler.
                </p>
                <div className="list">
                  {core.paymentRequests.map((payment) => (
                    <article key={payment.id} className="list-card">
                      <strong>{payment.packageTitle}</strong>
                      <div className="muted">{payment.status}</div>
                      <div className="muted">{new Date(payment.createdAt).toLocaleString("tr-TR")}</div>
                    </article>
                  ))}
                </div>
              </section>
            }
          />
          <Route
            path="/profil"
            element={
              <section className="panel-card panel-stack">
                <h2>Profil</h2>
                <p className="muted">Hesabinizla ilgili tum islemleri buradan yonetebilirsiniz.</p>
                <div className="settings-grid">
                  <article className="list-card panel-stack">
                    <strong>Profil Ayarlari</strong>
                    <p className="muted">Kullanici adi, paket durumu ve baglanti bilgilerinizi goruntuleyin.</p>
                    <button className="button secondary" onClick={() => navigate("/ayarlar")}>
                      Ayarlara Git
                    </button>
                  </article>
                  <article className="list-card panel-stack">
                    <strong>Paketler</strong>
                    <p className="muted">Admin tarafindan tanimlanan paketleri gorup satin alim talebi olusturun.</p>
                    <button className="button" onClick={() => navigate("/paketler")}>
                      Paketleri Gor
                    </button>
                  </article>
                  <article className="list-card panel-stack">
                    <strong>Odeme Bildirimi</strong>
                    <p className="muted">Gonderdiginiz odeme taleplerinin durumunu takip edin.</p>
                    <button className="button secondary" onClick={() => navigate("/odemeler")}>
                      Bildirimleri Gor
                    </button>
                  </article>
                  <article className="list-card panel-stack">
                    <strong>Iletisim</strong>
                    <p className="muted">Destek ekibine WhatsApp veya Telegram uzerinden hizli ulasin.</p>
                    <button className="button secondary" onClick={() => navigate("/iletisim")}>
                      Iletisime Gec
                    </button>
                  </article>
                </div>
              </section>
            }
          />
          <Route
            path="/profile"
            element={<Navigate to="/profil" replace />}
          />
          <Route
            path="/ayarlar"
            element={
              <section className="panel-card panel-stack">
                <div className="section-header">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => navigate("/profil")}
                    data-tv-focusable="true"
                    data-tv-focus-key="profile-settings-back"
                  >
                    Geri
                  </button>
                  <h2>Ayarlar</h2>
                </div>
                <div className="settings-grid">
                  <div className="list-card">
                    <strong>Kullanici Adi</strong>
                    <div className="muted">{me.user.kryptoniteCode ?? core.codeLabel}</div>
                  </div>
                  <div className="list-card">
                    <strong>Aktif Paket</strong>
                    <div className="muted">{me.user.activePackage ? me.user.activePackage.title : "Yok"}</div>
                  </div>
                  <div className="list-card">
                    <strong>Link Durumu</strong>
                    <div className="muted">{me.user.hasAssignedLink ? "Bagli" : "Admin atamasi bekleniyor"}</div>
                  </div>
                </div>
                <div className="button-row">
                  <button className="button" onClick={() => navigate("/paketler")}>
                    Paketler
                  </button>
                  <button className="button secondary" onClick={() => navigate("/odemeler")}>
                    Odeme Bildirimi
                  </button>
                  <button className="button secondary" onClick={() => navigate("/iletisim")}>
                    Iletisim
                  </button>
                </div>
              </section>
            }
          />
          <Route
            path="/iletisim"
            element={
              <section className="panel-card panel-stack">
                <div className="section-header">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => navigate("/profil")}
                    data-tv-focusable="true"
                    data-tv-focus-key="profile-contact-back"
                  >
                    Geri
                  </button>
                  <h2>Iletisim</h2>
                </div>
                <div className="button-row">
                  <a className="button" href={me.contact.whatsapp} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                  <a className="button secondary" href={me.contact.telegram} target="_blank" rel="noreferrer">
                    Telegram
                  </a>
                </div>
              </section>
            }
          />
        </Routes>

        {pendingPaymentPackage ? (
          <div className="modal payment-method-modal">
            <div className="modal-card payment-method-modal-card">
              <button
                type="button"
                className="premium-modal-close payment-method-modal-close"
                onClick={closePaymentMethodModal}
                aria-label="Kapat"
                data-tv-focusable="true"
                data-tv-region="overlay-actions"
                data-tv-focus-key="payment-modal-close"
                data-tv-overlay-initial={paymentMethods.length === 0 ? "true" : undefined}
              >
                ×
              </button>
              <span className="pill">Odeme Yontemi</span>
              <h2>{pendingPaymentPackage.title} paketi icin odeme yontemi secin</h2>
              <p className="muted">Odeme bildiriminiz onay surecine alinacaktir.</p>
              {paymentMethods.length > 0 ? (
                <>
                  <div className="payment-method-grid">
                    {paymentMethods.map((method, index) => (
                      <button
                        key={method.id}
                        type="button"
                        className="payment-method-option"
                        onClick={() => setSelectedPaymentMethodId(method.id)}
                        disabled={core.busy}
                        data-tv-focusable="true"
                        data-tv-region="overlay-actions"
                        data-tv-focus-key={`payment-method-${method.id}`}
                        data-tv-overlay-initial={index === 0 ? "true" : undefined}
                        data-tv-active={selectedPaymentMethod?.id === method.id ? "true" : undefined}
                      >
                        <strong>{method.label || paymentMethodLabelById[method.id]}</strong>
                        <span>{paymentMethodApprovalText}</span>
                      </button>
                    ))}
                  </div>

                  {!selectedPaymentMethod ? (
                    <div className="notice-card subtle">Devam etmek icin bir odeme yontemi secin.</div>
                  ) : null}

                  {selectedPaymentMethod ? (
                    <div className="payment-method-details">
                      {selectedPaymentMethod.id === "bank-transfer-eft" ? (
                        <>
                          <div className="payment-detail-row">
                            <div>
                              <small>Alici Adi</small>
                              <strong>{toTextOrNull(selectedPaymentMethod.bankTransfer?.recipientName) ?? "-"}</strong>
                            </div>
                            <button
                              type="button"
                              className="button secondary payment-copy-button"
                              onClick={() =>
                                void handleCopyPaymentValue(selectedPaymentMethod.bankTransfer?.recipientName, "Alici adi")
                              }
                              data-tv-focusable="true"
                              data-tv-region="overlay-actions"
                              data-tv-focus-key="payment-copy-recipient"
                            >
                              Kopyala
                            </button>
                          </div>
                          <div className="payment-detail-row">
                            <div>
                              <small>IBAN</small>
                              <strong>{toTextOrNull(selectedPaymentMethod.bankTransfer?.iban) ?? "-"}</strong>
                            </div>
                            <button
                              type="button"
                              className="button secondary payment-copy-button"
                              onClick={() => void handleCopyPaymentValue(selectedPaymentMethod.bankTransfer?.iban, "IBAN")}
                              data-tv-focusable="true"
                              data-tv-region="overlay-actions"
                              data-tv-focus-key="payment-copy-iban"
                            >
                              Kopyala
                            </button>
                          </div>
                          <div className="payment-detail-row">
                            <div>
                              <small>Banka</small>
                              <strong>{toTextOrNull(selectedPaymentMethod.bankTransfer?.bankName) ?? "-"}</strong>
                            </div>
                            <button
                              type="button"
                              className="button secondary payment-copy-button"
                              onClick={() =>
                                void handleCopyPaymentValue(selectedPaymentMethod.bankTransfer?.bankName, "Banka adi")
                              }
                              data-tv-focusable="true"
                              data-tv-region="overlay-actions"
                              data-tv-focus-key="payment-copy-bank-name"
                            >
                              Kopyala
                            </button>
                          </div>
                          <div className="payment-detail-row">
                            <div>
                              <small>Kullanici Kodu</small>
                              <strong>{headerUserLabel}</strong>
                            </div>
                            <button
                              type="button"
                              className="button secondary payment-copy-button"
                              onClick={() => void handleCopyPaymentValue(headerUserLabel, "Kullanici kodu")}
                              data-tv-focusable="true"
                              data-tv-region="overlay-actions"
                              data-tv-focus-key="payment-copy-user-code"
                            >
                              Kopyala
                            </button>
                          </div>
                        </>
                      ) : null}

                      {selectedPaymentMethod.id === "crypto" ? (
                        <>
                          <div className="crypto-asset-grid">
                            {selectedCryptoAssets.map((asset, index) => (
                              <button
                                key={asset.id}
                                type="button"
                                className="crypto-asset-chip"
                                onClick={() => setSelectedCryptoAssetId(asset.id)}
                                data-tv-focusable="true"
                                data-tv-region="overlay-actions"
                                data-tv-focus-key={`payment-crypto-${asset.id}`}
                                data-tv-active={selectedCryptoAssetId === asset.id ? "true" : undefined}
                                data-tv-overlay-initial={
                                  selectedPaymentMethod.id === "crypto" && index === 0 ? "true" : undefined
                                }
                              >
                                <span className="crypto-asset-symbol">
                                  <img src={asset.logoUrl} alt={`${asset.label} logo`} className="crypto-asset-logo" />
                                </span>
                                <span className="crypto-asset-label">{asset.label}</span>
                              </button>
                            ))}
                          </div>
                          <div className="payment-detail-row">
                            <div>
                              <small>
                                Cuzdan Adresi
                                {selectedCryptoAsset?.symbol ? ` (${selectedCryptoAsset.symbol})` : ""}
                              </small>
                              <strong>{toTextOrNull(selectedCryptoAsset?.walletAddress) ?? "-"}</strong>
                            </div>
                            <button
                              type="button"
                              className="button secondary payment-copy-button"
                              disabled={!selectedCryptoAsset}
                              onClick={() =>
                                void handleCopyPaymentValue(
                                  selectedCryptoAsset?.walletAddress,
                                  `${selectedCryptoAsset?.symbol ?? "Kripto"} adresi`
                                )
                              }
                              data-tv-focusable="true"
                              data-tv-region="overlay-actions"
                              data-tv-focus-key="payment-copy-crypto-wallet"
                            >
                              Kopyala
                            </button>
                          </div>
                        </>
                      ) : null}

                      {selectedPaymentMethod.id === "bank-card" ? (
                        <div className="notice-card subtle">
                          {selectedPaymentMethod.details?.trim() || paymentMethodApprovalText}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {paymentModalNotice ? <div className="notice-card subtle">{paymentModalNotice}</div> : null}

                  <button
                    type="button"
                    className="button"
                    disabled={core.busy || !selectedPaymentMethod}
                    onClick={() =>
                      selectedPaymentMethod ? void submitPaymentRequestWithMethod(selectedPaymentMethod.id) : undefined
                    }
                    data-tv-focusable="true"
                    data-tv-region="overlay-actions"
                    data-tv-focus-key="payment-submit-request"
                  >
                    Odeme Bildir
                  </button>
                </>
              ) : (
                <div className="notice-card danger">
                  Aktif odeme yontemi bulunamadi. Lutfen destek ekibiyle iletisime gecin.
                </div>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={closePaymentMethodModal}
                data-tv-focusable="true"
                data-tv-region="overlay-actions"
                data-tv-focus-key="payment-modal-cancel"
              >
                Vazgec
              </button>
            </div>
          </div>
        ) : null}

        {!pendingPaymentPackage && !me.user.hasActiveSubscription && !premiumPopupDismissed ? (
          <div className="modal">
            <div className="modal-card premium-modal-card">
              <button
                type="button"
                className="premium-modal-close"
                onClick={() => setPremiumPopupDismissed(true)}
                aria-label="Kapat"
              >
                ×
              </button>
              <span className="pill">Premium Erisim</span>
              <h2>Tum iceriklere erismek icin aktif bir paket satin alin</h2>
              <p className="muted">Giris basarili. Paketiniz aktif olunca kataloglarin tamami acilacak.</p>
              <div className="premium-modal-actions">
                <button className="button" onClick={() => void core.requestTrial("LG webOS cihazindan test talebi")}>
                  Test Yapmak Istiyorum
                </button>
                <a className="button secondary" href={me.contact.whatsapp} target="_blank" rel="noreferrer">
                  WhatsApp ile Iletisime Gec
                </a>
                <button className="button secondary" onClick={() => navigate("/paketler")}>
                  Paket Satin Al
                </button>
              </div>
              <button type="button" className="premium-modal-later" onClick={() => setPremiumPopupDismissed(true)}>
                Simdi degil, daha sonra hatirlat
              </button>
            </div>
          </div>
        ) : null}

      </main>

      <PlayerOverlay
        item={playingItem}
        onClose={() => setPlayingItem(null)}
        resolveLivePlayback={core.resolveLivePlayback}
        resolveVodPlayback={core.resolveVodPlayback}
        reportLivePlayback={core.reportLivePlayback}
        reportVodPlayback={core.reportVodPlayback}
      />
    </div>
  );
}

function ConnectedApp({ baseUrl }: { baseUrl: string }) {
  const location = useLocation();
  const [storage] = useState(() =>
    typeof window !== "undefined"
      ? createBrowserStorageAdapter(window.localStorage)
      : createInMemoryStorageAdapter()
  );

  const core = useViewerCore({
    baseUrl,
    storage,
    platform: "webos",
    defaultDeviceName: "LG webOS TV"
  });

  if (core.loading) {
    return <div className="content">Yukleniyor...</div>;
  }

  if (!core.session || !core.me) {
    return <AuthExperience core={core} />;
  }

  if (AUTH_ROUTE_PATHS.has(location.pathname)) {
    return <Navigate to="/" replace />;
  }

  return <HomeShell core={core} />;
}

function ApiConnectionScreen({
  title,
  message,
  baseUrl,
  busy,
  retryLabel,
  onRetry
}: {
  title: string;
  message: string;
  baseUrl: string | null;
  busy: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="content auth-screen-content">
      <section className="hero-card auth-screen-card">
        <span className="pill">Baglanti Kontrolu</span>
        <h1>{title}</h1>
        <p className="muted">API baglantisi kurulmadan uygulama acilamaz.</p>
        <div className="auth-warning active">
          <div className="auth-warning-icon">!</div>
          <div className="auth-warning-content">
            <strong>API Erisimi</strong>
            <p>{message}</p>
            <p>Hedef: {baseUrl ?? "tanimli degil"}</p>
          </div>
        </div>
        {onRetry ? (
          <button className="button button-large auth-primary-button" type="button" onClick={onRetry} disabled={busy}>
            {busy ? "Yeniden Kontrol Ediliyor" : retryLabel ?? "Yeniden Dene"}
          </button>
        ) : null}
      </section>
    </div>
  );
}

export function App() {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeAppConfig | null>(null);
  const [runtimeConfigLoaded, setRuntimeConfigLoaded] = useState(false);
  const [probeState, setProbeState] = useState<{
    status: "idle" | "checking" | "success" | "error";
    message: string | null;
  }>({
    status: "idle",
    message: null
  });
  const [probeAttempt, setProbeAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      const config = await loadRuntimeConfig();
      if (!active) {
        return;
      }

      setRuntimeConfig(config);
      setRuntimeConfigLoaded(true);
    })();

    return () => {
      active = false;
    };
  }, []);

  const resolvedApiBaseUrl = resolveApiBaseUrl(runtimeConfig);

  useEffect(() => {
    if (!runtimeConfigLoaded) {
      return;
    }

    if (!resolvedApiBaseUrl) {
      setProbeState({
        status: "error",
        message:
          "API adresi tanimli degil. app-config.json icine apiBaseUrl ekleyin veya VITE_API_BASE_URL ayarlayin."
      });
      return;
    }

    let active = true;
    setProbeState({
      status: "checking",
      message: null
    });

    void probeApiHealth(resolvedApiBaseUrl).then((result) => {
      if (!active) {
        return;
      }

      if (result.ok) {
        setProbeState({
          status: "success",
          message: null
        });
        return;
      }

      setProbeState({
        status: "error",
        message: result.message
      });
    });

    return () => {
      active = false;
    };
  }, [runtimeConfigLoaded, resolvedApiBaseUrl, probeAttempt]);

  if (!runtimeConfigLoaded || probeState.status === "idle" || probeState.status === "checking") {
    return <div className="content">Baglanti kontrol ediliyor...</div>;
  }

  if (!resolvedApiBaseUrl) {
    return (
      <ApiConnectionScreen
        title="API Ayari Eksik"
        message={probeState.message ?? "API adresi bulunamadi."}
        baseUrl={null}
        busy={false}
      />
    );
  }

  if (probeState.status === "error") {
    return (
      <ApiConnectionScreen
        title="API Baglantisi Kurulamadi"
        message={probeState.message ?? "API erisimi basarisiz."}
        baseUrl={resolvedApiBaseUrl}
        busy={false}
        onRetry={() => setProbeAttempt((value) => value + 1)}
      />
    );
  }

  return <ConnectedApp baseUrl={resolvedApiBaseUrl} />;
}
