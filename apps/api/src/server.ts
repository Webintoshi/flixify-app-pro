import { readFile } from "node:fs/promises";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import {
  adminAssignM3USourceInputSchema,
  adminCreateSubscriptionInputSchema,
  adminReviewInputSchema,
  adminUpdateUserInputSchema,
  adminUpdatePackageStatusInputSchema,
  adminUpdateUserStatusInputSchema,
  adminUsersQuerySchema,
  appSettingsSchema,
  buildLiveVariantMetadata,
  livePlaybackEventInputSchema,
  loginByCodeInputSchema,
  paginationQuerySchema,
  paymentMethodSettingsSchema,
  paymentRequestInputSchema,
  refreshInputSchema,
  registerAnonInputSchema,
  trialRequestInputSchema,
  vodPlaybackEventInputSchema
} from "@flixify/contracts";
import type {
  LiveHealthStatus,
  LivePlaybackRecord,
  LiveTransport,
  VodPlaybackRecord
} from "@flixify/contracts";
import {
  activateSubscription,
  activateTestSubscription24Hours,
  approvePaymentRequest,
  assignM3USource,
  createDeviceSession,
  createPaymentRequest,
  createTrialRequest,
  createUser,
  findUserByCodeLookup,
  getEpisodeForPlayback,
  getAdminDashboard,
  getAdminUserDetail,
  getAppSettings,
  getLiveChannelForPlayback,
  getMovieForPlayback,
  getPaymentMethodSettings,
  getSessionById,
  getUserContext,
  getUserStatus,
  listAdminUsers,
  listDeviceSessionsForUser,
  listLiveCatalog,
  listM3USyncJobs,
  listMoviesCatalog,
  listM3USources,
  listMyPaymentRequests,
  listPublicPaymentMethods,
  listPackages,
  listPaymentRequests,
  listSeriesCatalog,
  listSubscriptions,
  listTrialRequests,
  resyncM3USource,
  revokeDeviceSessionForUser,
  rejectPaymentRequest,
  reviewTrialRequest,
  insertLivePlaybackDiagnostic,
  reportLivePlaybackEvent,
  reportVodPlaybackEvent,
  revokeSession,
  storePlainKryptoniteCode,
  softDeleteUser,
  touchDeviceSession,
  updateLiveChannelHealth,
  updateAppSettings,
  updatePaymentMethodSettings,
  updateAdminUser,
  updatePackageStatus,
  updateUserLogin,
  updateUserStatus
} from "./repository.js";
import {
  activateDemoSubscription,
  activateDemoTestSubscription24Hours,
  getDemoAdminDashboard,
  getDemoAdminUserDetail,
  assignDemoM3USource,
  createDemoPaymentRequest,
  createDemoTrialRequest,
  getDemoPaymentMethodSettings,
  getDemoMe,
  getDemoSession,
  getDemoSettings,
  listDemoAdminUsers,
  listDemoDeviceSessions,
  listDemoLiveCatalog,
  listDemoM3USyncJobs,
  listDemoMovieCatalog,
  listDemoM3USources,
  listDemoMyPaymentRequests,
  listDemoPublicPaymentMethods,
  listDemoPackages,
  listDemoPaymentRequests,
  listDemoSeriesCatalog,
  listDemoSubscriptions,
  listDemoTrialRequests,
  loginDemoUser,
  refreshDemoSession,
  resolveDemoVodPlayback,
  resyncDemoM3USource,
  registerDemoUser,
  revokeDemoDeviceSession,
  softDeleteDemoUser,
  updateDemoPaymentMethodSettings,
  updateDemoSettings,
  updateDemoPackageStatus,
  updateDemoUser,
  updateDemoUserStatus
} from "./demo-store.js";
import { env } from "./env.js";
import {
  createCodeLookup,
  generateKryptoniteCode,
  generateRefreshToken,
  hashSecret,
  signAccessToken,
  verifyAccessToken,
  verifyAdminToken,
  verifySecret
} from "./security.js";
import { pool } from "./db.js";
import { buildStreamUrl } from "./iptv.js";
import { detectLiveTransport, probeLiveStream } from "./live.js";
import { createLivePlaybackManager } from "./live-playback.js";
import { canUseAppDirectPlaybackFallback } from "./app-direct-fallback.js";
import {
  samePlaybackCredentials,
  shouldHonorSharedLive404Cooldown,
  type PlaybackCredentials
} from "./playback-credentials.js";
import {
  createVodPlaybackManager,
  mapSourceTracksToVodAudioTracks,
  probeVodMediaProfile,
  probeVodStream,
  selectVodAudioTrackId,
  VodPlaybackUnavailableError
} from "./vod.js";
import { API_CORS_CONFIG } from "./cors-config.js";
import { stripEmptyJsonContentType } from "./http-headers.js";
import {
  BlockedUserRouteError,
  classifyUserRouteError,
  isUserRouteAuthError,
  UnauthorizedUserRouteError
} from "./user-route-error.js";
import { buildNativePlaybackSource, buildNativeVodPlaybackSource } from "./native-playback.js";

type UserRequest = {
  userId: string;
  sessionId: string;
};

type AdminRequest = {
  adminId: string;
  email: string | null;
};

type ClientRuntime = "browser" | "app" | "native";
type VodTransport = "hls" | "mp4" | "mkv" | "avi" | "unknown";

type AppUpdateManifestEntry = {
  latestVersion: string;
  downloadUrl: string | null;
  notes: string | null;
};

type AppUpdateManifest = {
  platforms: Record<string, AppUpdateManifestEntry>;
};

const DEFAULT_APP_UPDATE_MANIFEST_URL = "https://app.flixify.pro/app-update-manifest.json";
const LOCAL_APP_UPDATE_MANIFEST_PATH = new URL("../../viewer-webos/public/app-update-manifest.json", import.meta.url);
const isDemoMode = env.APP_DEMO_MODE;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const appUpdateManifestCache: {
  expiresAt: number;
  value: AppUpdateManifest | null;
  inflight: Promise<AppUpdateManifest | null> | null;
} = {
  expiresAt: 0,
  value: null,
  inflight: null
};
const livePlaybackManager = createLivePlaybackManager({
  ffmpegBinary: env.FFMPEG_BINARY,
  sessionTtlMs: 5 * 60 * 1000,
  onDiagnostic: async (input) => {
    await insertLivePlaybackDiagnostic(input.channelId, input.snapshotVersion, input);

    if (input.event === "relay-ready") {
      await updateLiveChannelHealth(input.channelId, input.snapshotVersion, {
        status: "healthy",
        errorMessage: null,
        resetFailureCount: true,
        markSuccess: true,
        touchPlaybackRequest: true
      });
      return;
    }

    if (input.event === "relay-error" || input.event === "upstream-error") {
      const upstreamStatus = input.upstreamStatus ?? null;
      await updateLiveChannelHealth(input.channelId, input.snapshotVersion, {
        status: "degraded",
        errorMessage: input.errorMessage ?? "Canli relay gecici olarak hata verdi.",
        touchPlaybackRequest: true,
        skipFailureCountIncrement:
          typeof upstreamStatus === "number" && upstreamStatus >= 400 && upstreamStatus < 500
      });
    }
  }
});
const vodPlaybackManager = createVodPlaybackManager({
  ffmpegBinary: env.FFMPEG_BINARY,
  ffprobeBinary: env.FFPROBE_BINARY,
  sessionTtlMs: env.VOD_PLAYBACK_TTL_SECONDS * 1000,
  tempRoot: env.VOD_PLAYBACK_TEMP_DIR,
  maxConcurrentTranscodes: env.VOD_TRANSCODE_MAX_CONCURRENT,
  onDiagnostic: async (input) => {
    const parsedEvent = vodPlaybackEventInputSchema.shape.event.safeParse(input.event);
    if (!parsedEvent.success) {
      return;
    }

    await reportVodPlaybackEvent(input.itemId, input.kind, parsedEvent.data, {
      deliveryMode: input.deliveryMode ?? null,
      sourceTransport: input.sourceTransport ?? null,
      playerEngine: input.playerEngine ?? null,
      audioTrackId: input.audioTrackId ?? null,
      errorCode: input.errorCode ?? null,
      upstreamStatus: input.upstreamStatus ?? null,
      detail: input.detail ?? null,
      errorMessage: input.errorMessage ?? null
    });
  }
});

function createRateLimitKey(scope: string, value: string) {
  return `${scope}:${value}`;
}

function checkRateLimit(key: string, limit: number, windowMs: number) {
  const current = rateLimitStore.get(key);
  const now = Date.now();

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) {
    return false;
  }

  current.count += 1;
  return true;
}

async function resolveRequestUserId(request: FastifyRequest) {
  const token = getBearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }

  try {
    const payload = await verifyAccessToken(token);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

async function sendUserRouteError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  userId: string | null = null
) {
  const classifiedError = classifyUserRouteError(error);
  const resolvedUserId = userId ?? (await resolveRequestUserId(request));
  const route = request.routeOptions.url ?? request.url;

  if (classifiedError.statusClass === "runtime-error") {
    request.log.error(
      {
        err: error,
        route,
        requestId: request.id,
        userId: resolvedUserId,
        statusClass: classifiedError.statusClass
      },
      "User route runtime error"
    );
  } else {
    request.log.warn(
      {
        route,
        requestId: request.id,
        userId: resolvedUserId,
        statusClass: classifiedError.statusClass
      },
      "User route auth error"
    );
  }

  return reply.status(classifiedError.statusCode).send({ message: classifiedError.message });
}

function getRequestBaseOrigin(request: FastifyRequest) {
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const protocol =
    typeof forwardedProtocol === "string" && forwardedProtocol.length > 0
      ? forwardedProtocol.split(",")[0]?.trim()
      : request.protocol;
  const host =
    typeof forwardedHost === "string" && forwardedHost.length > 0
      ? forwardedHost.split(",")[0]?.trim()
      : request.headers.host ?? `localhost:${env.API_PORT}`;

  return `${protocol ?? "http"}://${host}`;
}

function getBearerToken(authorization?: string) {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length);
}

function buildStreamCandidates(
  baseUrl: string,
  streamPath: string,
  primaryCredentials: PlaybackCredentials | null,
  fallbackCredentials: PlaybackCredentials | null
) {
  const candidates: PlaybackCredentials[] = [];

  if (primaryCredentials) {
    candidates.push(primaryCredentials);
  }

  if (
    fallbackCredentials &&
    !candidates.some((item) => samePlaybackCredentials(item, fallbackCredentials))
  ) {
    candidates.push(fallbackCredentials);
  }

  const resolvedCandidates: Array<{ credentials: PlaybackCredentials; url: string }> = [];
  for (const credentials of candidates) {
    try {
      resolvedCandidates.push({
        credentials,
        url: buildStreamUrl(baseUrl, credentials.username, credentials.password, streamPath)
      });
    } catch (error) {
      console.warn("[playback] stream candidate skip edildi", {
        error: error instanceof Error ? error.message : String(error ?? "unknown"),
        streamPath
      });
    }
  }

  return resolvedCandidates;
}

function normalizeClientRuntime(value: unknown): ClientRuntime {
  if (typeof value !== "string") {
    return "browser";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "app") {
    return "app";
  }

  if (normalized === "native") {
    return "native";
  }

  return "browser";
}

function extractUpstreamStatus(errorMessage: string | null | undefined) {
  if (typeof errorMessage !== "string") {
    return null;
  }

  const match = /^upstream\s+(\d{3})$/i.exec(errorMessage.trim());
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function resolveLiveSourceUrl(input: {
  baseUrl: string;
  streamPath: string;
  primaryCredentials: PlaybackCredentials | null;
  fallbackCredentials: PlaybackCredentials | null;
  fallbackTransport: LiveTransport;
}) {
  const candidates = buildStreamCandidates(
    input.baseUrl,
    input.streamPath,
    input.primaryCredentials,
    input.fallbackCredentials
  );

  if (candidates.length === 0) {
    return {
      ok: false,
      sourceUrl: null,
      transport: input.fallbackTransport,
      errorMessage: "Canli yayin kimlik bilgileri eksik.",
      cookie: null,
      isVerified: false
    };
  }

  let lastError = "Canli yayin kaynagi dogrulanamadi.";
  let lastTransport = input.fallbackTransport;
  let sawNetworkLikeFailure = false;
  let sawPotentialFalseNegativeHttpFailure = false;
  const firstCandidateUrl = candidates[0]?.url ?? null;

  for (const candidate of candidates) {
    const probe = await probeLiveStream(candidate.url);
    if (probe.transport !== "unknown") {
      lastTransport = probe.transport;
    }
    if (probe.ok) {
      return {
        ok: true,
        sourceUrl: candidate.url,
        transport: probe.transport === "unknown" ? input.fallbackTransport : probe.transport,
        cookie: probe.cookie,
        errorMessage: null,
        isVerified: true
      };
    }
    if (probe.statusCode === 0) {
      sawNetworkLikeFailure = true;
    }
    if ([401, 403, 405, 416, 429].includes(probe.statusCode)) {
      sawPotentialFalseNegativeHttpFailure = true;
    }
    lastError = probe.errorMessage ?? lastError;
  }

  const allowOptimisticSourceAttempt =
    Boolean(firstCandidateUrl) && (sawNetworkLikeFailure || sawPotentialFalseNegativeHttpFailure);
  if (allowOptimisticSourceAttempt) {
    return {
      ok: true,
      sourceUrl: firstCandidateUrl,
      transport: lastTransport === "unknown" ? input.fallbackTransport : lastTransport,
      cookie: null,
      errorMessage: lastError,
      isVerified: false
    };
  }

  return {
    ok: false,
    sourceUrl: firstCandidateUrl,
    transport: lastTransport === "unknown" ? input.fallbackTransport : lastTransport,
    cookie: null,
    errorMessage: lastError,
    isVerified: false
  };
}

async function resolveVodSourceUrl(input: {
  baseUrl: string;
  streamPath: string;
  primaryCredentials: PlaybackCredentials | null;
  fallbackCredentials: PlaybackCredentials | null;
}) {
  const candidates = buildStreamCandidates(
    input.baseUrl,
    input.streamPath,
    input.primaryCredentials,
    input.fallbackCredentials
  );

  if (candidates.length === 0) {
    return {
      ok: false,
      sourceUrl: null,
      transport: "unknown" as const,
      cookie: null,
      errorMessage: "VOD kimlik bilgileri eksik.",
      isVerified: false
    };
  }

  let lastError = "VOD kaynagi dogrulanamadi.";
  let lastTransport: "hls" | "mp4" | "mkv" | "avi" | "unknown" = "unknown";
  let sawNetworkLikeFailure = false;
  let sawPotentialFalseNegativeHttpFailure = false;
  let firstCandidateUrl: string | null = candidates[0]?.url ?? null;

  for (const candidate of candidates) {
    const probe = await probeVodStream(candidate.url);
    lastTransport = probe.transport;
    if (probe.ok) {
      return {
        ok: true,
        sourceUrl: candidate.url,
        transport: probe.transport,
        cookie: probe.cookie,
        errorMessage: null,
        isVerified: true
      };
    }
    if (probe.statusCode === 0) {
      sawNetworkLikeFailure = true;
    }
    if ([401, 403, 405, 416, 429].includes(probe.statusCode)) {
      sawPotentialFalseNegativeHttpFailure = true;
    }
    lastError = probe.errorMessage ?? lastError;
  }

  const allowOptimisticSourceAttempt =
    Boolean(firstCandidateUrl) && (sawNetworkLikeFailure || sawPotentialFalseNegativeHttpFailure);
  if (allowOptimisticSourceAttempt) {
    return {
      ok: true,
      sourceUrl: firstCandidateUrl,
      transport: lastTransport,
      cookie: null,
      errorMessage: lastError,
      isVerified: false
    };
  }

  return {
    ok: false,
    sourceUrl: firstCandidateUrl,
    transport: lastTransport,
    cookie: null,
    errorMessage: lastError,
    isVerified: false
  };
}

function buildDisabledLivePlaybackRecord(input: {
  channelId: string;
  transport: LiveTransport;
  healthStatus: LiveHealthStatus | null;
  lastCheckedAt: string | null;
  isVerified: boolean;
  errorMessage: string;
}): LivePlaybackRecord {
  return {
    channelId: input.channelId,
    url: null,
    transport: input.transport,
    sourceTransport: input.transport,
    deliveryMode: input.transport === "hls" ? "hls_proxy" : "file_proxy",
    diagnosticsSessionId: null,
    healthStatus: input.healthStatus ?? "unknown",
    lastCheckedAt: input.lastCheckedAt,
    expiresAt: null,
    canPlay: false,
    isVerified: input.isVerified,
    errorMessage: input.errorMessage
  };
}

function buildDirectLivePlaybackFallback(input: {
  channelId: string;
  sourceUrl: string;
  transport: LiveTransport;
  healthStatus: LiveHealthStatus | null;
  lastCheckedAt: string | null;
  isVerified: boolean;
}): LivePlaybackRecord {
  return {
    channelId: input.channelId,
    url: input.sourceUrl,
    transport: input.transport,
    sourceTransport: input.transport,
    deliveryMode: input.transport === "hls" ? "hls_proxy" : "file_proxy",
    diagnosticsSessionId: null,
    healthStatus: input.healthStatus ?? "unknown",
    lastCheckedAt: input.lastCheckedAt,
    expiresAt: null,
    canPlay: true,
    isVerified: input.isVerified,
    errorMessage: null
  };
}

function buildDisabledVodPlaybackRecord(input: {
  itemId: string;
  kind: "movie" | "episode";
  transport: VodTransport;
  errorMessage: string;
}) {
  return {
    itemId: input.itemId,
    kind: input.kind,
    url: null,
    transport: input.transport,
    deliveryMode: "hls_transcoded" as const,
    audioTracks: [],
    defaultAudioTrackId: null,
    selectedAudioTrackId: null,
    expiresAt: null,
    canPlay: false,
    isVerified: false,
    errorMessage: input.errorMessage
  };
}

function guessVodTransportFromPath(streamPath: string): VodTransport {
  const normalized = streamPath.toLowerCase();
  if (normalized.includes(".m3u8")) {
    return "hls";
  }
  if (normalized.includes(".mp4")) {
    return "mp4";
  }
  if (normalized.includes(".mkv")) {
    return "mkv";
  }
  if (normalized.includes(".avi")) {
    return "avi";
  }
  return "unknown";
}

function buildDirectVodPlaybackFallback(input: {
  itemId: string;
  kind: "movie" | "episode";
  sourceUrl: string;
  transport: VodTransport;
  isVerified: boolean;
}) {
  return {
    itemId: input.itemId,
    kind: input.kind,
    url: input.sourceUrl,
    transport: input.transport,
    deliveryMode: input.transport === "hls" ? ("hls_proxy" as const) : ("file_proxy" as const),
    audioTracks: [],
    defaultAudioTrackId: null,
    selectedAudioTrackId: null,
    expiresAt: null,
    canPlay: true,
    isVerified: input.isVerified,
    errorMessage: null
  };
}

function canUseVodDirectPlaybackFallback(input: {
  clientRuntime: ClientRuntime;
  platform: string | null;
  transport: VodTransport;
  sourceUrl: string | null | undefined;
}) {
  if (!canUseAppDirectPlaybackFallback(input.clientRuntime, input.sourceUrl)) {
    return false;
  }

  if (input.transport === "hls") {
    return true;
  }

  return false;
}

function replyWithNativePlaybackError(
  reply: FastifyReply,
  statusCode: number,
  message: string
) {
  return reply.status(statusCode).send({ message });
}

function buildNativeLivePlaybackResponse(input: {
  url: string;
  transport: LiveTransport;
  cookie?: string | null;
  diagnosticsSessionId?: string | null;
  variantGroupKey?: string | null;
  qualityRank?: number | null;
  isVerified: boolean;
  lastCheckedAt?: string | null;
}) {
  return buildNativePlaybackSource({
    url: input.url,
    transport: input.transport,
    cookie: input.cookie ?? null,
    diagnosticsSessionId: input.diagnosticsSessionId ?? null,
    variantGroupKey: input.variantGroupKey ?? null,
    qualityRank: input.qualityRank ?? null,
    isVerified: input.isVerified,
    lastCheckedAt: input.lastCheckedAt ?? null
  });
}

function buildNativeVodPlaybackResponse(input: {
  url: string;
  transport: VodTransport;
  deliveryMode: "direct" | "hls_proxy" | "file_proxy" | "hls_transcoded";
  audioTracks?: Array<{
    id: string;
    language: string | null;
    title: string | null;
    channels: number | null;
    isDefault: boolean;
  }>;
  defaultAudioTrackId?: string | null;
  selectedAudioTrackId?: string | null;
  cookie?: string | null;
  diagnosticsSessionId?: string | null;
  isVerified: boolean;
  lastCheckedAt?: string | null;
}) {
  return buildNativeVodPlaybackSource({
    url: input.url,
    transport: input.transport,
    deliveryMode: input.deliveryMode,
    audioTracks: input.audioTracks ?? [],
    defaultAudioTrackId: input.defaultAudioTrackId ?? null,
    selectedAudioTrackId: input.selectedAudioTrackId ?? null,
    cookie: input.cookie ?? null,
    diagnosticsSessionId: input.diagnosticsSessionId ?? null,
    isVerified: input.isVerified,
    lastCheckedAt: input.lastCheckedAt ?? null
  });
}

function isWebOsPlaybackPlatform(platform: string | null) {
  return typeof platform === "string" && platform.startsWith("webos");
}

function normalizeOptionalText(value: unknown, maxLength = 2000) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeDownloadUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeManifestPlatformMap(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const platforms: Record<string, AppUpdateManifestEntry> = {};

  for (const [platformKey, rawEntry] of entries) {
    if (!rawEntry || typeof rawEntry !== "object") {
      continue;
    }

    const latestVersion = normalizeOptionalText((rawEntry as Record<string, unknown>).latestVersion, 120);
    if (!latestVersion) {
      continue;
    }

    const normalizedPlatform = platformKey.trim().toLowerCase();
    if (!normalizedPlatform) {
      continue;
    }

    platforms[normalizedPlatform] = {
      latestVersion,
      downloadUrl: normalizeDownloadUrl((rawEntry as Record<string, unknown>).downloadUrl),
      notes: normalizeOptionalText((rawEntry as Record<string, unknown>).notes, 2_000)
    };
  }

  return Object.keys(platforms).length > 0 ? platforms : null;
}

function normalizeAppUpdateManifest(value: unknown): AppUpdateManifest | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const topLevel = value as Record<string, unknown>;
  const directPlatforms = normalizeManifestPlatformMap(topLevel.platforms);
  if (directPlatforms) {
    return { platforms: directPlatforms };
  }

  const fallbackPlatforms = normalizeManifestPlatformMap(topLevel);
  if (fallbackPlatforms) {
    return { platforms: fallbackPlatforms };
  }

  return null;
}

function resolvePlatformAliases(platform: string) {
  const normalized = platform.trim().toLowerCase();
  const aliases = [normalized];

  if (normalized.startsWith("windows")) {
    aliases.push("windows-desktop");
  }
  if (normalized.startsWith("webos")) {
    aliases.push("webos-app");
  }
  if (normalized.startsWith("mac")) {
    aliases.push("macos-desktop");
  }
  if (normalized.includes("desktop")) {
    aliases.push("desktop");
  }
  aliases.push("default");

  return [...new Set(aliases)];
}

function resolveAppUpdateEntry(manifest: AppUpdateManifest | null, platform: string) {
  if (!manifest) {
    return null;
  }

  const aliases = resolvePlatformAliases(platform);
  for (const alias of aliases) {
    const entry = manifest.platforms[alias];
    if (entry) {
      return entry;
    }
  }

  return null;
}

function parseVersionParts(value: string) {
  const normalized = value.trim().split("+")[0]?.split("-")[0]?.trim() ?? "";
  if (!/^\d+(?:\.\d+){0,4}$/.test(normalized)) {
    return null;
  }

  return normalized.split(".").map((part) => Number.parseInt(part, 10));
}

function isUpdateAvailable(currentVersion: string | null, latestVersion: string | null) {
  if (!currentVersion || !latestVersion) {
    return false;
  }

  const currentParts = parseVersionParts(currentVersion);
  const latestParts = parseVersionParts(latestVersion);

  if (!currentParts || !latestParts) {
    return currentVersion.trim() !== latestVersion.trim();
  }

  const length = Math.max(currentParts.length, latestParts.length);
  for (let index = 0; index < length; index += 1) {
    const current = currentParts[index] ?? 0;
    const latest = latestParts[index] ?? 0;
    if (latest > current) {
      return true;
    }
    if (latest < current) {
      return false;
    }
  }

  return false;
}

async function readLocalAppUpdateManifest() {
  try {
    const raw = await readFile(LOCAL_APP_UPDATE_MANIFEST_PATH, "utf8");
    const manifest = normalizeAppUpdateManifest(JSON.parse(raw));
    if (!manifest) {
      console.warn("[app-update] local manifest formati gecersiz");
    }
    return manifest;
  } catch (error) {
    console.warn("[app-update] local manifest okunamadi", {
      error: error instanceof Error ? error.message : String(error ?? "unknown")
    });
    return null;
  }
}

async function fetchAppUpdateManifest() {
  const manifestUrl = env.APP_UPDATE_MANIFEST_URL ?? DEFAULT_APP_UPDATE_MANIFEST_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = manifestUrl
      ? await fetch(manifestUrl, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            accept: "application/json"
          }
        })
      : null;

    if (!response) {
      return await readLocalAppUpdateManifest();
    }

    if (!response.ok) {
      console.warn("[app-update] manifest okunamadi", {
        status: response.status
      });
      return await readLocalAppUpdateManifest();
    }

    const parsed = await response.json();
    const manifest = normalizeAppUpdateManifest(parsed);
    if (!manifest) {
      console.warn("[app-update] manifest formati gecersiz");
      return await readLocalAppUpdateManifest();
    }
    return manifest;
  } catch (error) {
    console.warn("[app-update] manifest fetch hatasi", {
      error: error instanceof Error ? error.message : String(error ?? "unknown")
    });
    return await readLocalAppUpdateManifest();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadAppUpdateManifest() {
  const now = Date.now();
  if (appUpdateManifestCache.value && appUpdateManifestCache.expiresAt > now) {
    return appUpdateManifestCache.value;
  }

  if (!appUpdateManifestCache.inflight) {
    appUpdateManifestCache.inflight = fetchAppUpdateManifest()
      .then((manifest) => {
        appUpdateManifestCache.value = manifest;
        appUpdateManifestCache.expiresAt =
          Date.now() + Math.max(30_000, env.APP_UPDATE_CACHE_TTL_SECONDS * 1_000);
        return manifest;
      })
      .finally(() => {
        appUpdateManifestCache.inflight = null;
      });
  }

  return appUpdateManifestCache.inflight;
}

async function issueSession(userId: string, input: { deviceName?: string; platform?: string }) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = await hashSecret(refreshToken);
  const sessionId = await createDeviceSession(
    userId,
    refreshTokenHash,
    input.deviceName,
    input.platform
  );

  if (!sessionId) {
    throw new Error("Session could not be created");
  }

  const accessToken = await signAccessToken({ userId, sessionId });
  const userContext = await getUserContext(userId);

  return {
    accessToken,
    refreshToken: `${sessionId}.${refreshToken}`,
    user: userContext.summary
  };
}

async function authenticateUser(authorization?: string): Promise<UserRequest> {
  const token = getBearerToken(authorization);
  if (!token) {
    throw new UnauthorizedUserRouteError();
  }

  const payload = await verifyAccessToken(token);
  if (!payload.sub || !payload.sid) {
    throw new UnauthorizedUserRouteError();
  }

  if (isDemoMode) {
    const me = getDemoMe(payload.sub);
    if (!me || me.user.status === "blocked") {
      throw new BlockedUserRouteError();
    }

    const session = getDemoSession(payload.sid, payload.sub);
    if (!session) {
      throw new UnauthorizedUserRouteError();
    }

    return {
      userId: payload.sub,
      sessionId: payload.sid
    };
  }

  const userStatus = await getUserStatus(payload.sub);
  if (!userStatus) {
    throw new UnauthorizedUserRouteError();
  }
  if (userStatus === "blocked") {
    throw new BlockedUserRouteError();
  }

  const session = await getSessionById(payload.sid);
  if (!session || session.revoked_at || session.user_id !== payload.sub) {
    throw new UnauthorizedUserRouteError();
  }

  await touchDeviceSession(session.id);

  return {
    userId: payload.sub,
    sessionId: payload.sid
  };
}

async function authenticateAdmin(authorization?: string): Promise<AdminRequest> {
  const token = getBearerToken(authorization);
  if (!token) {
    throw new Error("Unauthorized");
  }

  return verifyAdminToken(token);
}

export function buildServer() {
  const app = Fastify({
    logger: true
  });

  app.register(cors, API_CORS_CONFIG);

  app.addHook("onRequest", async (request) => {
    stripEmptyJsonContentType(request.raw.method, request.raw.headers);
  });

  app.addHook("onClose", async () => {
    await livePlaybackManager.dispose();
    await vodPlaybackManager.dispose();
  });

  app.get("/health", async (_request, reply) => {
    if (isDemoMode) {
      return {
        ok: true,
        mode: "demo",
        database: "skipped",
        supabaseAuth: "configured"
      };
    }

    try {
      await pool.query("select 1");
      return {
        ok: true,
        database: "up",
        supabaseAuth: "configured"
      };
    } catch (error) {
      reply.status(503);
      return {
        ok: false,
        database: "down",
        supabaseAuth: "configured",
        error: error instanceof Error ? error.message : "Unknown database error"
      };
    }
  });

  app.get("/settings/public", async (request, reply) => {
    try {
      const settings = isDemoMode ? getDemoSettings() : await getAppSettings();
      return {
        supportWhatsappUrl: settings.supportWhatsappUrl,
        supportTelegramUrl: settings.supportTelegramUrl,
        salesPortalUrl: settings.salesPortalUrl,
        heroTitle: settings.heroTitle,
        heroSubtitle: settings.heroSubtitle
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: "Ayarlar alinamadi." });
    }
  });

  app.get("/payment-methods/public", async (request, reply) => {
    try {
      if (isDemoMode) {
        return {
          items: listDemoPublicPaymentMethods()
        };
      }

      return {
        items: await listPublicPaymentMethods()
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: "Odeme yontemleri alinamadi." });
    }
  });

  app.post("/auth/register-anon", async (request, reply) => {
    const payload = registerAnonInputSchema.parse(request.body);
    const requestIp = request.ip || "unknown";

    if (!checkRateLimit(createRateLimitKey("register", requestIp), 10, 60_000)) {
      return reply.status(429).send({ message: "Cok fazla kayit denemesi. Lutfen biraz sonra tekrar deneyin." });
    }

    if (isDemoMode) {
      return registerDemoUser(payload);
    }

    let rawCode = "";
    let userId = "";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateKryptoniteCode();
      const codeLookup = createCodeLookup(candidate);
      const collision = await findUserByCodeLookup(codeLookup);
      if (!collision) {
        rawCode = candidate;
        userId = await createUser(codeLookup, await hashSecret(candidate), candidate.slice(-4), candidate);
        break;
      }
    }

    if (!rawCode || !userId) {
      return reply.status(500).send({ message: "Kullanici olusturulamadi." });
    }

    await updateUserLogin(userId);
    const session = await issueSession(userId, payload);

    return {
      ...session,
      kryptoniteCode: rawCode
    };
  });

  app.post("/auth/login-by-code", async (request, reply) => {
    const payload = loginByCodeInputSchema.parse(request.body);
    const requestIp = request.ip || "unknown";

    if (!checkRateLimit(createRateLimitKey("login", `${requestIp}:${payload.code}`), 8, 60_000)) {
      return reply.status(429).send({ message: "Cok fazla giris denemesi. Lutfen biraz sonra tekrar deneyin." });
    }

    if (isDemoMode) {
      const session = await loginDemoUser(payload.code, payload);
      if (!session) {
        return reply.status(401).send({ message: "Kriptonit kod gecersiz." });
      }
      if (session.user.status === "blocked") {
        return reply.status(403).send({ message: "Kullanici engellendi. Destek ile iletisime gecin." });
      }
      return session;
    }

    const foundUser = await findUserByCodeLookup(createCodeLookup(payload.code));

    if (!foundUser || !(await verifySecret(payload.code, foundUser.code_hash))) {
      return reply.status(401).send({ message: "Kriptonit kod gecersiz." });
    }

    if (foundUser.status === "blocked") {
      return reply.status(403).send({ message: "Kullanici engellendi. Destek ile iletisime gecin." });
    }

    if (foundUser.kryptonite_code !== payload.code) {
      await storePlainKryptoniteCode(foundUser.id, payload.code);
    }

    await updateUserLogin(foundUser.id);
    const session = await issueSession(foundUser.id, payload);

    return {
      ...session,
      kryptoniteCode: payload.code
    };
  });

  app.post("/auth/refresh", async (request, reply) => {
    const payload = refreshInputSchema.parse(request.body);
    const requestIp = request.ip || "unknown";

    if (!checkRateLimit(createRateLimitKey("refresh", requestIp), 20, 60_000)) {
      return reply.status(429).send({ message: "Cok fazla oturum yenileme denemesi. Lutfen tekrar deneyin." });
    }

    if (isDemoMode) {
      const session = await refreshDemoSession(payload.refreshToken);
      if (!session) {
        return reply.status(401).send({
          message: "Oturum yenilenemedi.",
          reason: "invalid-refresh"
        });
      }
      return session;
    }

    let sessionId = "";

    const token = payload.refreshToken;
    const [encodedSessionId] = token.split(".");
    sessionId = encodedSessionId || "";
    if (!sessionId) {
      return reply.status(401).send({
        message: "Refresh token gecersiz.",
        reason: "invalid-refresh"
      });
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return reply.status(401).send({
        message: "Oturum yenilenemedi.",
        reason: "invalid-refresh"
      });
    }
    if (session.revoked_at) {
      return reply.status(401).send({
        message: "Oturum yenilenemedi.",
        reason: "revoked"
      });
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      return reply.status(401).send({
        message: "Oturum suresi doldu.",
        reason: "expired"
      });
    }

    const userStatus = await getUserStatus(session.user_id);
    if (!userStatus || userStatus === "blocked") {
      return reply.status(403).send({ message: "Kullanici engellendi. Destek ile iletisime gecin." });
    }

    const rawSecret = token.slice(sessionId.length + 1);
    const matches = await verifySecret(rawSecret, session.refresh_token_hash);
    if (!matches) {
      return reply.status(401).send({
        message: "Oturum yenilenemedi.",
        reason: "invalid-refresh"
      });
    }

    await revokeSession(session.id);
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = await hashSecret(refreshToken);
    const newSessionId = await createDeviceSession(session.user_id, refreshTokenHash);
    if (!newSessionId) {
      return reply.status(500).send({ message: "Yeni oturum acilamadi." });
    }

    const accessToken = await signAccessToken({ userId: session.user_id, sessionId: newSessionId });
    const userContext = await getUserContext(session.user_id);

    return {
      accessToken,
      refreshToken: `${newSessionId}.${refreshToken}`,
      user: userContext.summary,
      kryptoniteCode: userContext.summary.kryptoniteCode ?? null
    };
  });

  app.get("/me", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me) {
          return reply.status(404).send({ message: "Kullanici bulunamadi." });
        }
        return me;
      }

      const userContext = await getUserContext(auth.userId);
      const settings = await getAppSettings();

      return {
        user: userContext.summary,
        contact: {
          whatsapp: settings.supportWhatsappUrl,
          telegram: settings.supportTelegramUrl
        }
      };
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/app-update/check", async (request, reply) => {
    try {
      await authenticateUser(request.headers.authorization);
      const rawQuery = request.query as Record<string, unknown> | undefined;
      const rawPlatform = normalizeOptionalText(rawQuery?.platform, 80) ?? "unknown";
      const platform = rawPlatform.trim().toLowerCase();
      const appVersion = normalizeOptionalText(rawQuery?.appVersion, 120);
      const manifest = await loadAppUpdateManifest();
      const matchedEntry = resolveAppUpdateEntry(manifest, platform);

      return {
        platform,
        appVersion,
        latestVersion: matchedEntry?.latestVersion ?? null,
        updateAvailable: isUpdateAvailable(appVersion, matchedEntry?.latestVersion ?? null),
        downloadUrl: matchedEntry?.downloadUrl ?? null,
        notes: matchedEntry?.notes ?? null,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/device-sessions", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      if (isDemoMode) {
        return {
          items: listDemoDeviceSessions(auth.userId, auth.sessionId)
        };
      }

      return {
        items: await listDeviceSessionsForUser(auth.userId, auth.sessionId)
      };
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.post("/me/device-sessions/:sessionId/revoke", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { sessionId } = request.params as { sessionId: string };

      if (isDemoMode) {
        revokeDemoDeviceSession(auth.userId, sessionId);
        return { ok: true };
      }

      await revokeDeviceSessionForUser(auth.userId, sessionId);
      return { ok: true };
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/catalog/live", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const query = paginationQuerySchema.parse(request.query);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }
        return listDemoLiveCatalog(auth.userId, query.page, query.pageSize, query.search, query.group);
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      return listLiveCatalog(
        userContext.snapshotVersion,
        query.page,
        query.pageSize,
        query.search,
        query.group,
        {
          baseUrl: userContext.playbackBaseUrl,
          credentials: userContext.iptvCredentials,
          canPlay: userContext.canPlay
        }
      );
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/live/:channelId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { channelId } = request.params as { channelId: string };
      const rawQuery = request.query as Record<string, unknown> | undefined;
      const clientRuntime = normalizeClientRuntime(rawQuery?.clientRuntime);
      const forceRelayRestart =
        rawQuery?.forceRelayRestart === true ||
        rawQuery?.forceRelayRestart === "true" ||
        rawQuery?.forceRelayRestart === "1";
      const debugFileProxy =
        rawQuery?.debugFileProxy === true ||
        rawQuery?.debugFileProxy === "true" ||
        rawQuery?.debugFileProxy === "1";
      const preferRelay =
        rawQuery?.preferRelay === undefined
          ? clientRuntime === "browser"
          : rawQuery?.preferRelay === true ||
            rawQuery?.preferRelay === "true" ||
            rawQuery?.preferRelay === "1";
      const preferTranscode =
        rawQuery?.preferTranscode === true ||
        rawQuery?.preferTranscode === "true" ||
        rawQuery?.preferTranscode === "1";
      const audioTrackId =
        typeof rawQuery?.audioTrackId === "string" && rawQuery.audioTrackId.trim().length > 0
          ? rawQuery.audioTrackId.trim().slice(0, 120)
          : null;

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }
        const liveCatalog = listDemoLiveCatalog(auth.userId, 1, 200, undefined, undefined);
        const channel = liveCatalog.items.find((item) => item.id === channelId);
        if (!channel) {
          return reply.status(404).send({ message: "Canli kanal bulunamadi." });
        }
        try {
          const playback = await livePlaybackManager.createPlayback({
            channelId,
            snapshotVersion: 1,
            sourceUrl: channel.playbackAllowed ? channel.streamUrl : null,
            baseOrigin: getRequestBaseOrigin(request),
            sourceTransport: channel.transport,
            healthStatus: channel.healthStatus,
            lastCheckedAt: channel.lastCheckedAt,
            canPlay: channel.playbackAllowed,
            isVerified: channel.isVerified,
            errorMessage: null,
            forceRelayRestart,
            allowFileProxyFallback: debugFileProxy,
            preferDirectProxy: !preferRelay,
            preferTranscode
          });

          if (
            clientRuntime === "app" &&
            !playback.canPlay &&
            channel.playbackAllowed &&
            typeof channel.streamUrl === "string"
          ) {
            return buildDirectLivePlaybackFallback({
              channelId,
              sourceUrl: channel.streamUrl,
              transport: channel.transport,
              healthStatus: channel.healthStatus,
              lastCheckedAt: channel.lastCheckedAt,
              isVerified: channel.isVerified
            });
          }

          return playback;
        } catch (error) {
          request.log.warn(
            {
              err: error,
              channelId,
              clientRuntime
            },
            "Demo live playback manager error"
          );

          if (clientRuntime === "app" && channel.playbackAllowed && typeof channel.streamUrl === "string") {
            return buildDirectLivePlaybackFallback({
              channelId,
              sourceUrl: channel.streamUrl,
              transport: channel.transport,
              healthStatus: channel.healthStatus,
              lastCheckedAt: channel.lastCheckedAt,
              isVerified: channel.isVerified
            });
          }

          return buildDisabledLivePlaybackRecord({
            channelId,
            transport: channel.transport,
            healthStatus: channel.healthStatus,
            lastCheckedAt: channel.lastCheckedAt,
            isVerified: channel.isVerified,
            errorMessage: "Canli yayin gecici olarak kullanilamiyor."
          });
        }
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      const channel = await getLiveChannelForPlayback(userContext.snapshotVersion, channelId);
      if (!channel) {
        return reply.status(404).send({ message: "Canli kanal bulunamadi." });
      }

      const cooldownMs = 5 * 60 * 1000;
      const normalizedLastError = typeof channel.last_error === "string" ? channel.last_error.trim().toLowerCase() : "";
      const shouldHonorRecent404Failure = shouldHonorSharedLive404Cooldown(
        userContext.iptvCredentials,
        userContext.sharedReferenceCredentials
      );
      const isRecent404Failure =
        shouldHonorRecent404Failure &&
        channel.health_status === "broken" &&
        normalizedLastError.includes("upstream 404") &&
        typeof channel.last_checked_at === "string" &&
        Date.now() - new Date(channel.last_checked_at).getTime() <= cooldownMs;

      if (isRecent404Failure) {
        return buildDisabledLivePlaybackRecord({
          channelId,
          transport: channel.transport,
          healthStatus: channel.health_status,
          lastCheckedAt: channel.last_checked_at,
          isVerified: false,
          errorMessage: "Canli yayin kaynagi gecici olarak kullanilamiyor."
        });
      }

      if (
        !userContext.playbackBaseUrl ||
        (!userContext.iptvCredentials && !userContext.sharedReferenceCredentials)
      ) {
        return {
          channelId,
          url: null,
          transport: channel.transport,
          sourceTransport: channel.transport,
          deliveryMode: channel.transport === "hls" ? "hls_proxy" : "file_proxy",
          diagnosticsSessionId: null,
          healthStatus: channel.health_status ?? "unknown",
          lastCheckedAt: channel.last_checked_at,
          expiresAt: null,
          canPlay: false,
          isVerified: Boolean(channel.last_checked_at),
          errorMessage: "Canli yayin kaynagi hazir degil."
        };
      }

      const resolved = userContext.canPlay
        ? await resolveLiveSourceUrl({
            baseUrl: userContext.playbackBaseUrl,
            streamPath: channel.stream_path,
            primaryCredentials: userContext.iptvCredentials,
            fallbackCredentials: userContext.sharedReferenceCredentials,
            fallbackTransport: channel.transport
          })
        : {
            ok: false,
            sourceUrl: null,
            transport: channel.transport,
            errorMessage: "Canli yayin icin aktif paket gerekiyor."
          };

      const checkedAt = new Date().toISOString();
      const transport = resolved.transport;
      const errorMessage = resolved.errorMessage;
      const upstreamStatus = extractUpstreamStatus(errorMessage);
      const skipFailureCountIncrement =
        typeof upstreamStatus === "number" && [405, 416, 429].includes(upstreamStatus);
      const currentFailureCount = channel.failure_count ?? 0;
      const nextFailureCount =
        resolved.ok || skipFailureCountIncrement ? currentFailureCount : currentFailureCount + 1;
      const healthStatus = resolved.ok
        ? "healthy"
        : skipFailureCountIncrement
          ? channel.health_status ?? "unknown"
          : nextFailureCount >= 5
            ? "broken"
            : "degraded";

      const canAttemptPlayback = Boolean(userContext.canPlay) && Boolean(resolved.sourceUrl);
      const optimisticProbeFallback =
        canAttemptPlayback &&
        !resolved.ok &&
        typeof upstreamStatus === "number" &&
        [401, 403, 405, 416, 429].includes(upstreamStatus);

      if (userContext.canPlay) {
        await updateLiveChannelHealth(channel.id, channel.snapshot_version, {
          status: healthStatus,
          errorMessage,
          resetFailureCount: resolved.ok,
          markSuccess: resolved.ok,
          touchPlaybackRequest: true,
          skipFailureCountIncrement
        });
      }

      const canPlay = Boolean(userContext.canPlay) && (resolved.ok || optimisticProbeFallback);

      let playback: LivePlaybackRecord;
      try {
        playback = await livePlaybackManager.createPlayback({
          channelId,
          snapshotVersion: channel.snapshot_version,
          sourceUrl: canPlay ? resolved.sourceUrl : null,
          cookie: canPlay ? resolved.cookie : null,
          baseOrigin: getRequestBaseOrigin(request),
          sourceTransport: transport,
          healthStatus,
          lastCheckedAt: checkedAt,
          canPlay,
          isVerified: resolved.isVerified,
          errorMessage: canPlay ? null : errorMessage ?? "Canli yayin gecici olarak kullanilamiyor.",
          forceRelayRestart,
          allowFileProxyFallback: debugFileProxy || optimisticProbeFallback,
          preferDirectProxy: !preferRelay,
          preferTranscode
        });
      } catch (error) {
        request.log.warn(
          {
            err: error,
            channelId,
            clientRuntime
          },
          "Live playback manager error"
        );

        playback = buildDisabledLivePlaybackRecord({
          channelId,
          transport,
          healthStatus,
          lastCheckedAt: checkedAt,
          isVerified: resolved.isVerified,
          errorMessage: "Canli yayin gecici olarak kullanilamiyor."
        });
      }

      if (
        !playback.canPlay &&
        userContext.canPlay &&
        typeof resolved.sourceUrl === "string" &&
        (canUseAppDirectPlaybackFallback(clientRuntime, resolved.sourceUrl) ||
          upstreamStatus !== 404)
      ) {
        return buildDirectLivePlaybackFallback({
          channelId,
          sourceUrl: resolved.sourceUrl,
          transport,
          healthStatus,
          lastCheckedAt: checkedAt,
          isVerified: resolved.isVerified
        });
      }

      if (!playback.canPlay) {
        await updateLiveChannelHealth(channel.id, channel.snapshot_version, {
          status: healthStatus === "broken" ? "broken" : "degraded",
          errorMessage: playback.errorMessage ?? "Canli relay hazirlanamadi.",
          touchPlaybackRequest: true
        });
      }

      return playback;
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/native/live/:channelId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { channelId } = request.params as { channelId: string };

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return replyWithNativePlaybackError(reply, 403, "Icerik baglantisi atanmadi.");
        }

        const liveCatalog = listDemoLiveCatalog(auth.userId, 1, 200, undefined, undefined);
        const channel = liveCatalog.items.find((item) => item.id === channelId);
        if (!channel) {
          return replyWithNativePlaybackError(reply, 404, "Canli kanal bulunamadi.");
        }
        if (!channel.playbackAllowed || typeof channel.streamUrl !== "string") {
          return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
        }

        const variantMetadata = buildLiveVariantMetadata(channel.title);
        const transport =
          channel.transport ?? detectLiveTransport(channel.streamUrl) ?? "unknown";

        return buildNativeLivePlaybackResponse({
          url: channel.streamUrl,
          transport,
          variantGroupKey: channel.variantGroupKey ?? variantMetadata.variantGroupKey,
          qualityRank: channel.qualityRank ?? variantMetadata.qualityRank,
          isVerified: channel.isVerified ?? true,
          lastCheckedAt: channel.lastCheckedAt ?? null
        });
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return replyWithNativePlaybackError(reply, 403, "Icerik baglantisi atanmadi.");
      }
      if (!userContext.canPlay) {
        return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
      }

      const channel = await getLiveChannelForPlayback(userContext.snapshotVersion, channelId);
      if (!channel) {
        return replyWithNativePlaybackError(reply, 404, "Canli kanal bulunamadi.");
      }

      if (
        !userContext.playbackBaseUrl ||
        (!userContext.iptvCredentials && !userContext.sharedReferenceCredentials)
      ) {
        return replyWithNativePlaybackError(reply, 503, "Canli yayin kaynagi hazir degil.");
      }

      const resolved = await resolveLiveSourceUrl({
        baseUrl: userContext.playbackBaseUrl,
        streamPath: channel.stream_path,
        primaryCredentials: userContext.iptvCredentials,
        fallbackCredentials: userContext.sharedReferenceCredentials,
        fallbackTransport: channel.transport
      });
      const checkedAt = new Date().toISOString();
      const errorMessage = resolved.errorMessage;
      const upstreamStatus = extractUpstreamStatus(errorMessage);
      const allowOptimisticNativeDirect =
        !resolved.ok &&
        typeof resolved.sourceUrl === "string" &&
        canUseAppDirectPlaybackFallback("native", resolved.sourceUrl);
      const skipFailureCountIncrement =
        typeof upstreamStatus === "number" && [405, 416, 429].includes(upstreamStatus);
      const currentFailureCount = channel.failure_count ?? 0;
      const nextFailureCount =
        resolved.ok || skipFailureCountIncrement ? currentFailureCount : currentFailureCount + 1;
      const healthStatus = resolved.ok
        ? "healthy"
        : skipFailureCountIncrement
          ? channel.health_status ?? "unknown"
          : nextFailureCount >= 5
            ? "broken"
            : "degraded";

      if (resolved.ok) {
        await updateLiveChannelHealth(channel.id, channel.snapshot_version, {
          status: healthStatus,
          errorMessage,
          resetFailureCount: true,
          markSuccess: true,
          touchPlaybackRequest: true,
          skipFailureCountIncrement
        });
      } else if (!allowOptimisticNativeDirect) {
        await updateLiveChannelHealth(channel.id, channel.snapshot_version, {
          status: healthStatus,
          errorMessage,
          resetFailureCount: false,
          markSuccess: false,
          touchPlaybackRequest: true,
          skipFailureCountIncrement
        });
      }

      if ((!resolved.ok || !resolved.sourceUrl) && !allowOptimisticNativeDirect) {
        return replyWithNativePlaybackError(
          reply,
          resolved.sourceUrl ? 502 : 503,
          resolved.errorMessage ?? "Canli yayin kaynagi dogrudan acilamadi."
        );
      }

      const variantMetadata = buildLiveVariantMetadata(channel.title);
      return buildNativeLivePlaybackResponse({
        url: resolved.sourceUrl,
        transport: resolved.transport,
        cookie: resolved.cookie,
        variantGroupKey: channel.variant_group_key ?? variantMetadata.variantGroupKey,
        qualityRank: channel.quality_rank ?? variantMetadata.qualityRank,
        isVerified: resolved.ok && resolved.isVerified,
        lastCheckedAt: checkedAt
      });
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.post("/me/live/:channelId/health", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { channelId } = request.params as { channelId: string };
      const payload = livePlaybackEventInputSchema.parse(request.body);

      if (isDemoMode) {
        return { ok: true };
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      const channel = await getLiveChannelForPlayback(userContext.snapshotVersion, channelId);
      if (!channel) {
        return reply.status(404).send({ message: "Canli kanal bulunamadi." });
      }

      await reportLivePlaybackEvent(channel.id, channel.snapshot_version, payload.event, payload);
      return { ok: true };
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/catalog/movies", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const query = paginationQuerySchema.parse(request.query);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }
        return listDemoMovieCatalog(auth.userId, query.page, query.pageSize, query.search, query.group);
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      return listMoviesCatalog(
        userContext.snapshotVersion,
        query.page,
        query.pageSize,
        query.search,
        query.group,
        {
          baseUrl: userContext.playbackBaseUrl,
          credentials: userContext.iptvCredentials,
          canPlay: userContext.canPlay
        }
      );
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/catalog/series", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const query = paginationQuerySchema.parse(request.query);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }
        return listDemoSeriesCatalog(auth.userId, query.page, query.pageSize, query.search, query.group);
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      return listSeriesCatalog(
        userContext.snapshotVersion,
        query.page,
        query.pageSize,
        query.search,
        query.group,
        {
          baseUrl: userContext.playbackBaseUrl,
          credentials: userContext.iptvCredentials,
          canPlay: userContext.canPlay
        }
      );
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/vod/:kind/:itemId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { kind, itemId } = request.params as { kind: string; itemId: string };
      const rawQuery = request.query as Record<string, unknown> | undefined;
      const clientRuntime = normalizeClientRuntime(rawQuery?.clientRuntime);
      const platform = normalizeOptionalText(rawQuery?.platform, 80)?.trim().toLowerCase() ?? null;
      const debugVod =
        rawQuery?.debugVod === true ||
        rawQuery?.debugVod === "true" ||
        rawQuery?.debugVod === "1";
      const preferTranscode =
        rawQuery?.preferTranscode === undefined
          ? clientRuntime === "browser"
          : rawQuery?.preferTranscode === true ||
            rawQuery?.preferTranscode === "true" ||
            rawQuery?.preferTranscode === "1";
      const audioTrackId =
        typeof rawQuery?.audioTrackId === "string" && rawQuery.audioTrackId.trim().length > 0
          ? rawQuery.audioTrackId.trim().slice(0, 120)
          : null;

      if (kind !== "movie" && kind !== "episode") {
        return reply.status(400).send({ message: "VOD turu gecersiz." });
      }

      const baseOrigin = getRequestBaseOrigin(request);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }

        return resolveDemoVodPlayback(auth.userId, kind, itemId, baseOrigin);
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      const record =
        kind === "movie"
          ? await getMovieForPlayback(userContext.snapshotVersion, itemId)
          : await getEpisodeForPlayback(userContext.snapshotVersion, itemId);

      if (!record) {
        return reply.status(404).send({ message: kind === "movie" ? "Film bulunamadi." : "Bolum bulunamadi." });
      }

      if (!userContext.canPlay) {
        return {
          itemId,
          kind,
          url: null,
          transport: "unknown",
          deliveryMode: "hls_transcoded",
          audioTracks: [],
          defaultAudioTrackId: null,
          selectedAudioTrackId: null,
          expiresAt: null,
          canPlay: false,
          isVerified: false,
          errorMessage: "Bu icerigi oynatmak icin aktif paket gerekir."
        };
      }

      if (
        !userContext.playbackBaseUrl ||
        (!userContext.iptvCredentials && !userContext.sharedReferenceCredentials)
      ) {
        return buildDisabledVodPlaybackRecord({
          itemId,
          kind,
          transport: "unknown",
          errorMessage: "VOD kaynagi hazir degil."
        });
      }

      const directSourceUrlFromCandidates =
        buildStreamCandidates(
          userContext.playbackBaseUrl,
          record.stream_path,
          userContext.iptvCredentials,
          userContext.sharedReferenceCredentials
        )[0]?.url ?? null;

      let resolved: Awaited<ReturnType<typeof resolveVodSourceUrl>>;
      try {
        resolved = await resolveVodSourceUrl({
          baseUrl: userContext.playbackBaseUrl,
          streamPath: record.stream_path,
          primaryCredentials: userContext.iptvCredentials,
          fallbackCredentials: userContext.sharedReferenceCredentials
        });
      } catch (error) {
        request.log.warn(
          {
            err: error,
            itemId,
            kind,
            clientRuntime
          },
          "VOD source resolve error"
        );

        if (
          canUseVodDirectPlaybackFallback({
            clientRuntime,
            platform,
            transport: guessVodTransportFromPath(record.stream_path),
            sourceUrl: directSourceUrlFromCandidates
          })
        ) {
          return buildDirectVodPlaybackFallback({
            itemId,
            kind,
            sourceUrl: directSourceUrlFromCandidates,
            transport: guessVodTransportFromPath(record.stream_path),
            isVerified: false
          });
        }

        return buildDisabledVodPlaybackRecord({
          itemId,
          kind,
          transport: guessVodTransportFromPath(record.stream_path),
          errorMessage: "VOD kaynagi gecici olarak hazirlanamadi."
        });
      }

      if (!resolved.sourceUrl) {
        if (
          canUseVodDirectPlaybackFallback({
            clientRuntime,
            platform,
            transport: resolved.transport,
            sourceUrl: directSourceUrlFromCandidates
          })
        ) {
          return buildDirectVodPlaybackFallback({
            itemId,
            kind,
            sourceUrl: directSourceUrlFromCandidates,
            transport: resolved.transport,
            isVerified: false
          });
        }

        return buildDisabledVodPlaybackRecord({
          itemId,
          kind,
          transport: resolved.transport,
          errorMessage: resolved.errorMessage ?? "VOD kaynagi hazir degil."
        });
      }

      const resolvedUpstreamStatus = extractUpstreamStatus(resolved.errorMessage);
      let playback: VodPlaybackRecord;
      try {
        playback = await vodPlaybackManager.createPlayback({
          userId: auth.userId,
          itemId: itemId,
          kind,
          sourceUrl: resolved.sourceUrl,
          baseOrigin,
          clientRuntime,
          platform,
          debug: debugVod,
          preferTranscode,
          allowUnverifiedSource: resolved.isVerified === false,
          sourceTransportHint: resolved.transport,
          selectedAudioTrackId: audioTrackId
        });
      } catch (error) {
        request.log.warn(
          {
            err: error,
            itemId,
            kind,
            clientRuntime
          },
          "VOD playback manager error"
        );

        const message =
          error instanceof VodPlaybackUnavailableError && error.message.trim().length > 0
            ? error.message.trim()
            : "VOD akisi gecici olarak hazirlanamadi.";

        playback = buildDisabledVodPlaybackRecord({
          itemId,
          kind,
          transport: resolved.transport,
          errorMessage: message
        });
      }

      if (playback.canPlay) {
        return playback;
      }

      if (
        canUseVodDirectPlaybackFallback({
          clientRuntime,
          platform,
          transport: resolved.transport,
          sourceUrl: resolved.sourceUrl
        })
      ) {
        return buildDirectVodPlaybackFallback({
          itemId,
          kind,
          sourceUrl: resolved.sourceUrl,
          transport: resolved.transport,
          isVerified: resolved.isVerified
        });
      }

      return playback;
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/native/vod/:kind/:itemId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { kind, itemId } = request.params as { kind: string; itemId: string };
      const rawQuery = request.query as Record<string, unknown> | undefined;
      const platform = normalizeOptionalText(rawQuery?.platform, 80)?.trim().toLowerCase() ?? null;
      const audioTrackId =
        typeof rawQuery?.audioTrackId === "string" && rawQuery.audioTrackId.trim().length > 0
          ? rawQuery.audioTrackId.trim().slice(0, 120)
          : null;

      if (kind !== "movie" && kind !== "episode") {
        return replyWithNativePlaybackError(reply, 400, "VOD turu gecersiz.");
      }
      if (!platform) {
        return replyWithNativePlaybackError(reply, 400, "Native VOD playback icin platform zorunludur.");
      }

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return replyWithNativePlaybackError(reply, 403, "Icerik baglantisi atanmadi.");
        }

        const playback = resolveDemoVodPlayback(auth.userId, kind, itemId, getRequestBaseOrigin(request));
        if (!playback.canPlay || typeof playback.url !== "string") {
          return replyWithNativePlaybackError(
            reply,
            playback.errorMessage?.includes("aktif paket") ? 403 : 503,
            playback.errorMessage ?? "VOD kaynagi dogrudan acilamadi."
          );
        }

        return buildNativeVodPlaybackResponse({
          url: playback.url,
          transport: playback.transport,
          deliveryMode: "direct",
          audioTracks: [],
          defaultAudioTrackId: null,
          selectedAudioTrackId: null,
          isVerified: playback.isVerified,
          lastCheckedAt: null
        });
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return replyWithNativePlaybackError(reply, 403, "Icerik baglantisi atanmadi.");
      }
      if (!userContext.canPlay) {
        return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
      }

      const record =
        kind === "movie"
          ? await getMovieForPlayback(userContext.snapshotVersion, itemId)
          : await getEpisodeForPlayback(userContext.snapshotVersion, itemId);

      if (!record) {
        return replyWithNativePlaybackError(
          reply,
          404,
          kind === "movie" ? "Film bulunamadi." : "Bolum bulunamadi."
        );
      }

      if (
        !userContext.playbackBaseUrl ||
        (!userContext.iptvCredentials && !userContext.sharedReferenceCredentials)
      ) {
        return replyWithNativePlaybackError(reply, 503, "VOD kaynagi hazir degil.");
      }

      const resolved = await resolveVodSourceUrl({
        baseUrl: userContext.playbackBaseUrl,
        streamPath: record.stream_path,
        primaryCredentials: userContext.iptvCredentials,
        fallbackCredentials: userContext.sharedReferenceCredentials
      });

      const allowOptimisticNativeDirect =
        !resolved.ok &&
        typeof resolved.sourceUrl === "string" &&
        canUseAppDirectPlaybackFallback("native", resolved.sourceUrl);

      if ((!resolved.ok || !resolved.sourceUrl) && !allowOptimisticNativeDirect) {
        return replyWithNativePlaybackError(
          reply,
          resolved.sourceUrl ? 502 : 503,
          resolved.errorMessage ?? "VOD kaynagi dogrudan acilamadi."
        );
      }

      if (isWebOsPlaybackPlatform(platform)) {
        const playback = await vodPlaybackManager.createPlayback({
          userId: auth.userId,
          itemId,
          kind,
          sourceUrl: resolved.sourceUrl!,
          baseOrigin: getRequestBaseOrigin(request),
          clientRuntime: "native",
          platform,
          allowUnverifiedSource: resolved.isVerified === false || allowOptimisticNativeDirect,
          sourceTransportHint: resolved.transport,
          selectedAudioTrackId: audioTrackId
        });

        if (!playback.canPlay || !playback.url) {
          return replyWithNativePlaybackError(
            reply,
            503,
            playback.errorMessage ?? "webOS VOD kaynagi native playback icin hazirlanamadi."
          );
        }

        return buildNativeVodPlaybackResponse({
          url: playback.url,
          transport: playback.transport,
          deliveryMode: playback.deliveryMode,
          audioTracks: playback.audioTracks,
          defaultAudioTrackId: playback.defaultAudioTrackId,
          selectedAudioTrackId: playback.selectedAudioTrackId,
          isVerified: playback.isVerified,
          lastCheckedAt: playback.expiresAt ?? new Date().toISOString()
        });
      }

      if (allowOptimisticNativeDirect) {
        return buildNativeVodPlaybackResponse({
          url: resolved.sourceUrl!,
          transport: resolved.transport,
          deliveryMode: "direct",
          audioTracks: [],
          defaultAudioTrackId: null,
          selectedAudioTrackId: null,
          cookie: resolved.cookie,
          isVerified: false,
          lastCheckedAt: new Date().toISOString()
        });
      }

      const mediaProfile = await probeVodMediaProfile(env.FFPROBE_BINARY, resolved.sourceUrl, resolved.transport);
      const audioSelection = selectVodAudioTrackId(mediaProfile?.audioTracks ?? [], audioTrackId);
      const audioTracks = mapSourceTracksToVodAudioTracks(
        mediaProfile?.audioTracks ?? [],
        audioSelection.selectedTrackId
      );

      return buildNativeVodPlaybackResponse({
        url: resolved.sourceUrl,
        transport: resolved.transport,
        deliveryMode: "direct",
        audioTracks,
        defaultAudioTrackId: audioSelection.defaultTrackId,
        selectedAudioTrackId: audioSelection.selectedTrackId,
        cookie: resolved.cookie,
        isVerified: resolved.isVerified,
        lastCheckedAt: new Date().toISOString()
      });
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.post("/me/vod/:kind/:itemId/health", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { kind, itemId } = request.params as { kind: string; itemId: string };
      const payload = vodPlaybackEventInputSchema.parse(request.body);

      if (kind !== "movie" && kind !== "episode") {
        return reply.status(400).send({ message: "VOD turu gecersiz." });
      }

      if (isDemoMode) {
        return { ok: true };
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      const existingItem =
        kind === "movie"
          ? await getMovieForPlayback(userContext.snapshotVersion, itemId)
          : await getEpisodeForPlayback(userContext.snapshotVersion, itemId);

      if (!existingItem) {
        return reply.status(404).send({ message: kind === "movie" ? "Film bulunamadi." : "Bolum bulunamadi." });
      }

      await reportVodPlaybackEvent(itemId, kind, payload.event, payload);
      return { ok: true };
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/vod/playback/:sessionId/master.m3u8", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    return vodPlaybackManager.sendManifest(reply, sessionId, token);
  });

  app.get("/vod/playback/:sessionId/assets/:assetId", async (request, reply) => {
    const { sessionId, assetId } = request.params as { sessionId: string; assetId: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    return vodPlaybackManager.sendProxyAsset(reply, sessionId, token, assetId);
  });

  app.get("/vod/playback/:sessionId/files/:fileName", async (request, reply) => {
    const { sessionId, fileName } = request.params as { sessionId: string; fileName: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    return vodPlaybackManager.sendLocalAsset(reply, sessionId, token, fileName);
  });

  app.get("/vod/playback/:sessionId/file", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    const rangeHeader = typeof request.headers.range === "string" ? request.headers.range : null;
    return vodPlaybackManager.sendFile(reply, sessionId, token, rangeHeader);
  });

  app.get("/live/playback/:sessionId/master.m3u8", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    return livePlaybackManager.sendManifest(reply, sessionId, token);
  });

  app.get("/live/playback/:sessionId/assets/:assetId", async (request, reply) => {
    const { sessionId, assetId } = request.params as { sessionId: string; assetId: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    return livePlaybackManager.sendAsset(reply, sessionId, token, assetId);
  });

  app.get("/live/playback/:sessionId/files/:fileName", async (request, reply) => {
    const { sessionId, fileName } = request.params as { sessionId: string; fileName: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    return livePlaybackManager.sendLocalAsset(reply, sessionId, token, fileName);
  });

  app.get("/live/playback/:sessionId/file", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    const rangeHeader = typeof request.headers.range === "string" ? request.headers.range : null;
    return livePlaybackManager.sendFile(reply, sessionId, token, rangeHeader);
  });

  app.post("/me/payment-requests", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const payload = paymentRequestInputSchema.parse(request.body);

      if (isDemoMode) {
        createDemoPaymentRequest(auth.userId, payload.packageSlug);
        return { ok: true };
      }

      await createPaymentRequest(auth.userId, payload.packageSlug);
      return { ok: true };
    } catch (error) {
      if (isUserRouteAuthError(error)) {
        return sendUserRouteError(request, reply, error);
      }
      request.log.error(error);
      return reply.status(400).send({ message: "Odeme talebi olusturulamadi." });
    }
  });

  app.get("/me/payment-requests", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      if (isDemoMode) {
        return {
          items: listDemoMyPaymentRequests(auth.userId)
        };
      }
      return {
        items: await listMyPaymentRequests(auth.userId)
      };
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.post("/me/trial-request", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const payload = trialRequestInputSchema.parse(request.body);

      if (isDemoMode) {
        createDemoTrialRequest(auth.userId, payload.note);
        return { ok: true };
      }

      await createTrialRequest(auth.userId, payload.note);
      return { ok: true };
    } catch (error) {
      if (isUserRouteAuthError(error)) {
        return sendUserRouteError(request, reply, error);
      }
      request.log.error(error);
      return reply.status(400).send({ message: "Deneme talebi olusturulamadi." });
    }
  });

  app.get("/admin/packages/public", async () => ({
    items: isDemoMode ? listDemoPackages().filter((item) => item.isActive) : await listPackages({ onlyActive: true })
  }));

  app.get("/admin/users", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      const query = adminUsersQuerySchema.parse(request.query);
      if (isDemoMode) {
        return listDemoAdminUsers(query.page, query.pageSize, {
          search: query.search,
          status: query.status,
          m3u: query.m3u,
          includeDeleted: query.includeDeleted
        });
      }
      return listAdminUsers(query.page, query.pageSize, {
        search: query.search,
        status: query.status,
        m3u: query.m3u,
        includeDeleted: query.includeDeleted
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.get("/admin/dashboard", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      return isDemoMode ? getDemoAdminDashboard() : getAdminDashboard();
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.get("/admin/users/:userId", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      const { userId } = request.params as { userId: string };
      if (isDemoMode) {
        const detail = getDemoAdminUserDetail(userId);
        if (!detail) {
          return reply.status(404).send({ message: "Kullanici bulunamadi." });
        }
        return detail;
      }
      return getAdminUserDetail(userId);
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.get("/admin/users/:userId/device-sessions", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      const { userId } = request.params as { userId: string };
      return {
        items: isDemoMode ? listDemoDeviceSessions(userId) : await listDeviceSessionsForUser(userId)
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.patch("/admin/users/:userId/status", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { userId } = request.params as { userId: string };
      const payload = adminUpdateUserStatusInputSchema.parse(request.body);

      if (isDemoMode) {
        updateDemoUserStatus(userId, payload.status);
        return { ok: true };
      }

      await updateUserStatus(userId, payload.status, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Kullanici durumu guncellenemedi." });
    }
  });

  app.patch("/admin/users/:userId", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { userId } = request.params as { userId: string };
      const payload = adminUpdateUserInputSchema.parse(request.body);

      if (isDemoMode) {
        updateDemoUser(userId, payload);
        return { ok: true };
      }

      await updateAdminUser(userId, payload, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Kullanici guncellenemedi." });
    }
  });

  app.delete("/admin/users/:userId", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { userId } = request.params as { userId: string };

      if (isDemoMode) {
        softDeleteDemoUser(userId);
        return { ok: true };
      }

      await softDeleteUser(userId, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Kullanici silinemedi." });
    }
  });

  app.get("/admin/packages", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      if (isDemoMode) {
        return {
          items: listDemoPackages()
        };
      }
      return {
        items: await listPackages()
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.patch("/admin/packages/:packageId", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { packageId } = request.params as { packageId: string };
      const payload = adminUpdatePackageStatusInputSchema.parse(request.body);

      if (isDemoMode) {
        updateDemoPackageStatus(packageId, payload);
        return { ok: true };
      }

      await updatePackageStatus(packageId, payload, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Paket bilgisi guncellenemedi." });
    }
  });

  app.post("/admin/users/:userId/m3u-source", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const payload = adminAssignM3USourceInputSchema.parse(request.body);
      const { userId } = request.params as { userId: string };

      if (isDemoMode) {
        assignDemoM3USource(userId, payload.sourceUrl ?? "");
        return { ok: true };
      }

      await assignM3USource(userId, payload, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "M3U kaynagi atanamadi." });
    }
  });

  app.post("/admin/users/:userId/subscriptions", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const payload = adminCreateSubscriptionInputSchema.parse(request.body);
      const { userId } = request.params as { userId: string };

      if (isDemoMode) {
        activateDemoSubscription(userId, payload.packageSlug);
        return { ok: true };
      }

      await activateSubscription(userId, payload.packageSlug, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Paket aktive edilemedi." });
    }
  });

  app.post("/admin/users/:userId/subscriptions/test-24h", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { userId } = request.params as { userId: string };

      if (isDemoMode) {
        activateDemoTestSubscription24Hours(userId);
        return { ok: true };
      }

      await activateTestSubscription24Hours(userId, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "24 saat test yayini aktive edilemedi." });
    }
  });

  app.get("/admin/payment-requests", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      if (isDemoMode) {
        return {
          items: listDemoPaymentRequests()
        };
      }
      return {
        items: await listPaymentRequests()
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.get("/admin/m3u-sources", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      if (isDemoMode) {
        return {
          items: listDemoM3USources()
        };
      }
      return {
        items: await listM3USources()
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.get("/admin/m3u-jobs", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      return {
        items: isDemoMode ? listDemoM3USyncJobs() : await listM3USyncJobs()
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.post("/admin/m3u-sources/:sourceId/resync", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { sourceId } = request.params as { sourceId: string };
      if (isDemoMode) {
        resyncDemoM3USource(sourceId);
        return { ok: true };
      }
      await resyncM3USource(sourceId, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "M3U senkronu tekrar baslatilamadi." });
    }
  });

  app.get("/admin/subscriptions", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      if (isDemoMode) {
        return {
          items: listDemoSubscriptions()
        };
      }
      return {
        items: await listSubscriptions()
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.post("/admin/payment-requests/:id/approve", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { id } = request.params as { id: string };
      if (isDemoMode) {
        return { ok: true };
      }
      await approvePaymentRequest(id, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Talep onaylanamadi." });
    }
  });

  app.post("/admin/payment-requests/:id/reject", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { id } = request.params as { id: string };
      const payload = adminReviewInputSchema.parse(request.body);
      if (isDemoMode) {
        return { ok: true };
      }
      await rejectPaymentRequest(id, admin.adminId, payload.note);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Talep reddedilemedi." });
    }
  });

  app.get("/admin/trial-requests", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      if (isDemoMode) {
        return {
          items: listDemoTrialRequests()
        };
      }
      return {
        items: await listTrialRequests()
      };
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.post("/admin/trial-requests/:id/approve", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { id } = request.params as { id: string };
      const payload = adminReviewInputSchema.parse(request.body);
      if (isDemoMode) {
        return { ok: true };
      }
      await reviewTrialRequest(id, "approved", admin.adminId, payload.note);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Talep onaylanamadi." });
    }
  });

  app.post("/admin/trial-requests/:id/reject", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const { id } = request.params as { id: string };
      const payload = adminReviewInputSchema.parse(request.body);
      if (isDemoMode) {
        return { ok: true };
      }
      await reviewTrialRequest(id, "rejected", admin.adminId, payload.note);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Talep reddedilemedi." });
    }
  });

  app.get("/admin/payment-methods", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      if (isDemoMode) {
        return getDemoPaymentMethodSettings();
      }
      return getPaymentMethodSettings();
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.put("/admin/payment-methods", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const payload = paymentMethodSettingsSchema.parse(request.body);
      if (isDemoMode) {
        updateDemoPaymentMethodSettings(payload);
        return { ok: true };
      }
      await updatePaymentMethodSettings(payload, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Odeme yontemleri kaydedilemedi." });
    }
  });

  app.get("/admin/settings", async (request, reply) => {
    try {
      await authenticateAdmin(request.headers.authorization);
      if (isDemoMode) {
        return getDemoSettings();
      }
      return getAppSettings();
    } catch (error) {
      request.log.error(error);
      return reply.status(401).send({ message: "Admin yetkisi gerekli." });
    }
  });

  app.put("/admin/settings", async (request, reply) => {
    try {
      const admin = await authenticateAdmin(request.headers.authorization);
      const payload = appSettingsSchema.parse(request.body);
      if (isDemoMode) {
        updateDemoSettings(payload);
        return { ok: true };
      }
      await updateAppSettings(payload, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Ayarlar kaydedilemedi." });
    }
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}

const app = buildServer();

app
  .listen({
    port: env.API_PORT,
    host: "0.0.0.0"
  })
  .catch(async (error) => {
    app.log.error(error);
    await app.close();
    process.exit(1);
  });
