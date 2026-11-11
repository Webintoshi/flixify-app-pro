import { withTrialCountdown } from "./trial-countdown.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DeviceLoginCrypto, DeviceLoginService, redactDeviceLinkedPayload } from "./device-login.js";
import { DeviceLoginStore } from "./device-login-store.js";
import { registerDeviceLoginRoutes } from "./device-login-routes.js";
import { PhoneAuthCrypto,PhoneAuthService } from './phone-auth.js';
import { PostgresOtpAuthStore, PostgresPhoneAuthStore } from './phone-auth-store.js';
import { emailAuthAccounts, phoneAuthAccounts } from './phone-auth-accounts.js';
import { VatanSmsWhatsAppSender } from './phone-auth-vatansms.js';
import { registerPhoneAuthRoutes } from './phone-auth-routes.js';
import { EmailAuthService } from "./email-auth.js";
import { registerEmailAuthRoutes } from "./email-auth-routes.js";
import { ResendEmailSender } from "./email-auth-resend.js";
import { SmtpEmailSender } from "./email-auth-smtp.js";
import {RememberedRefreshCrypto,RememberedSessionError,RememberedSessionStore,sessionHasExpired} from './remembered-session.js';
import crypto from "node:crypto";
import { TrialUnavailableError } from "./access-history.js";
import { buildBrowserDirectOnlyPlayback, buildBrowserDirectPlayback } from "./browser-direct-playback.js";
import {
  buildBrowserDirectVodPlayback,
  buildOptimisticBrowserDirectVodPlayback
} from "./browser-direct-vod.js";
import { registerAccountLibrary } from "./account-library.js";
import { AccountVodCatalog, useAccountVod } from "./account-vod.js";
import { shouldUseAccountMovieCatalog } from "./vod-catalog-filter.js";
import { AdultMoviePreferenceStore, deriveMoviePolicy } from "./adult-movie-preferences.js";
import { createAdultMovieActivator, createPostgresUserLock, registerAdultMovieRoutes } from "./adult-movie-routes.js";
import { ResellerProvider } from "./entitlement-provider.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import Stripe from "stripe";
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
import { canUseClientIpPlayback } from "./client-playback-access.js";
import { registerPersonalLibrary } from "./personal-library.js";
import { WelcomeOfferStore } from "./welcome-offer-store.js";
import { registerWelcomeOfferRoutes } from "./welcome-offer-routes.js";
import { registerAnalyticsRuntime } from "./analytics-runtime.js";
import { derivePersonalProviderSession } from "./personal-provider-session.js";
import { loadLiveChannelPolicy } from "./live-channel-policy.js";
import type {
  LiveChannel,
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
  AutoTrialRegistrationRateLimitError,
  RegistrationInstallationLimitError,
  findActiveUserByInstallationId,
  getEpisodeForPlayback,
  getAdminDashboard,
  getAdminUserDetail,
  getAppSettings,
  getAccessHistory,
  getLiveChannelForPlayback,
  getMovieForPlayback,
  getPaymentMethodSettings,
  getReferralSummary,
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
import { apiCache, closeCacheRuntime } from "./cache-runtime.js";
const accountVodCatalog = new AccountVodCatalog({ cache: apiCache });
import { liveCatalogPageKey } from "./cache-policy.js";
import { getCachedLiveCatalog, personalizeLiveCatalog, sanitizeLiveCatalogForCache } from "./catalog-cache.js";
import {
  createCodeLookup,
  generateKryptoniteCode,
  generateRefreshToken,
  hashSecret,
  signAccessToken,
  signAdminToken,
  verifyAccessToken,
  verifyAdminToken,
  verifySecret
} from "./security.js";
import { pool } from "./db.js";
import { buildStreamUrl } from "./iptv.js";
import { buildBrowserMediaGatewayUrl, isBrowserMediaGatewayUrl, shouldPreferSharedCredentialsForBrowserGateway } from "./browser-media-gateway.js";
import { detectLiveTransport, probeLiveStream } from "./live.js";
import { createLivePlaybackManager } from "./live-playback.js";
import { canUseAppDirectPlaybackFallback } from "./app-direct-fallback.js";
import { resolveAccountDirectPrivateCdnUrl } from "./private-cdn-direct.js";
import { selectVodProxy, vodFetch } from "./vod-proxy.js";
import {
  samePlaybackCredentials,
  shouldHonorSharedLive404Cooldown,
  type PlaybackCredentials
} from "./playback-credentials.js";
import {
  createVodPlaybackManager,
  probeVodStream,
  VodPlaybackUnavailableError
} from "./vod.js";
import { API_CORS_CONFIG } from "./cors-config.js";
import { stripEmptyJsonContentType } from "./http-headers.js";
import {
  createCatalogArtworkUrl,
  fetchLiveLogoFromUpstream,
  LIVE_LOGO_PROXY_PATH,
  LiveLogoProxyError,
  verifySignedLiveLogoQuery
} from "./live-logo.js";
import {
  BlockedUserRouteError,
  classifyUserRouteError,
  isUserRouteAuthError,
  UnauthorizedUserRouteError
} from "./user-route-error.js";
import { buildNativePlaybackSource, buildNativeVodPlaybackSource } from "./native-playback.js";
import { createStripeBillingApi, createStripeInvoiceReader } from "./stripe-billing-api.js";
import { registerStripeBillingRoutes, type StripeBillingRouteApi } from "./stripe-billing-routes.js";
import { stripeBillingRuntime } from "./stripe-billing-runtime.js";
import { StripeBillingStore } from "./stripe-billing-store.js";
import { fulfillPaidInvoice } from "./stripe-entitlement.js";
import { registerStripeWebhook, type StripeWebhookEvent } from "./stripe-webhook.js";
import { StripePaymentStore } from "./stripe-payment-store.js";
import { fulfillPaidCheckout } from "./stripe-payment.js";
import { createStripePaymentReader } from "./stripe-payment-api.js";

type UserRequest = {
  userId: string;
  sessionId: string;
  authMethod?: "account_code" | "device_link" | "phone_otp" | "email_otp";
};

const linkedViewerRequests = new WeakSet<FastifyRequest>();
const deviceLoginStore = new DeviceLoginStore(pool);
const rememberedSessionStore=new RememberedSessionStore(pool,new RememberedRefreshCrypto(env.APP_JWT_SECRET));
async function prepareDeviceLoginSession(userId: string) {
  const id = randomUUID();
  const secret = generateRefreshToken();
  const refreshHash = await hashSecret(secret);
  const accessToken = await signAccessToken({ userId, sessionId: id });
  return { id, refreshHash, accessToken, refreshToken: `${id}.${secret}` };
}
const deviceLoginService = new DeviceLoginService(deviceLoginStore, new DeviceLoginCrypto(env.APP_JWT_SECRET), prepareDeviceLoginSession,{localVerificationOrigin:env.DEVICE_LOGIN_LOCAL_WEB_ORIGIN});
const phoneAuthStore=new PostgresPhoneAuthStore(pool);
const phoneAuthService=!env.APP_DEMO_MODE&&env.PHONE_AUTH_ENABLED&&env.PHONE_AUTH_SECRET&&env.VATANSMS_WHATSAPP_API_KEY&&env.VATANSMS_WHATSAPP_REG_ID
  ?new PhoneAuthService(phoneAuthStore,new PhoneAuthCrypto(env.PHONE_AUTH_SECRET),new VatanSmsWhatsAppSender({apiKey:env.VATANSMS_WHATSAPP_API_KEY,regId:env.VATANSMS_WHATSAPP_REG_ID,baseUrl:env.VATANSMS_WHATSAPP_BASE_URL},fetch,env.PHONE_AUTH_PROVIDER_DIAGNOSTICS?value=>console.warn(JSON.stringify({operation:'phone-auth-provider',...value})):undefined),phoneAuthAccounts):null;
const emailAuthStore = env.emailAuth ? new PostgresOtpAuthStore(pool, "email") : null;
const emailAuthService = env.emailAuth && emailAuthStore
  ? new EmailAuthService(
      emailAuthStore,
      new PhoneAuthCrypto(env.emailAuth.secret, "email"),
      env.emailAuth.transport === "smtp" ? new SmtpEmailSender(env.emailAuth) : new ResendEmailSender(env.emailAuth),
      emailAuthAccounts
    )
  : null;

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

const LOCAL_APP_UPDATE_MANIFEST_PATH = new URL("../../../data/app-update-manifest.json", import.meta.url);
const isDemoMode = env.APP_DEMO_MODE;
const adultMovieStore = new AdultMoviePreferenceStore(pool);
const adultMovieCanaryIds = new Set(env.ADULT_MOVIES_CANARY_USER_IDS.split(",").map(id=>id.trim()).filter(Boolean));
const knownAdultCategoryIds = env.ADULT_MOVIES_CATEGORY_IDS.split(",").filter(Boolean);
const adultMovieProvider = env.XM_RESELLER_API_URL && env.XM_RESELLER_API_KEY
  ? new ResellerProvider({baseUrl:env.XM_RESELLER_API_URL,apiKey:env.XM_RESELLER_API_KEY})
  : null;
const stripeRuntime = stripeBillingRuntime(env);
const stripeClient = stripeRuntime ? new Stripe(stripeRuntime.secretKey) : null;
const stripeBillingStore = new StripeBillingStore(pool);
const stripePaymentStore = new StripePaymentStore(pool);
const adultMovieEnabled = Boolean(env.ADULT_MOVIES_ENABLED && !isDemoMode && adultMovieProvider);
const accountVodProxyConfigured = Boolean((process.env.VOD_PROXY_URLS ?? "").trim());
const useAdultSafeMovieCatalog = (runtime:unknown,userId:string,policy:{visible:boolean;reconcileRequired?:boolean}) =>
 (runtime==="browser" && shouldUseAccountMovieCatalog(accountVodProxyConfigured,policy)) || useAccountVod(runtime,userId);
const canUseAdultMovies = (userId:string) =>
  adultMovieEnabled && (adultMovieCanaryIds.has(userId) || adultMovieCanaryIds.has("*"));
const hiddenMoviePolicy = {visible:false,revision:0,adultCategoryIds:[]};
const getAdultMoviePolicy = async (userId:string) =>
  deriveMoviePolicy(await adultMovieStore.get(userId),canUseAdultMovies(userId));
const adultMovieActivator = adultMovieProvider ? createAdultMovieActivator({
  withUserLock:createPostgresUserLock(pool),
  store:adultMovieStore,provider:adultMovieProvider,catalog:accountVodCatalog,knownAdultCategoryIds
}) : null;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const MULTI_ACCOUNT_BLOCK_MESSAGE =
  "Bu cihaz veya tarayıcıda yalnızca bir kez hesap oluşturabilirsiniz. Mevcut hesabınızla giriş yapın veya destekle iletişime geçin.";
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

function getDatabaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getDatabaseConstraint(error: unknown) {
  if (!error || typeof error !== "object" || !("constraint" in error)) {
    return null;
  }

  const constraint = (error as { constraint?: unknown }).constraint;
  return typeof constraint === "string" ? constraint : null;
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

function signLiveCatalogResponse<T extends { items: LiveChannel[] }>(
  payload: T,
  request: FastifyRequest,
  hideStreamUrls = false
): T {
  const requestOrigin = getRequestBaseOrigin(request);
  const clientRuntime = normalizeClientRuntime(request.headers["x-flixify-client-runtime"]);
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      streamUrl: hideStreamUrls ? null : item.streamUrl,
      logoUrl: createCatalogArtworkUrl({
        sourceUrl: item.logoUrl,
        origin: requestOrigin,
        clientRuntime
      })
    }))
  };
}

function signMovieCatalogResponse<T extends { items: Array<{ posterUrl: string | null }> }>(
  payload: T,
  request: FastifyRequest
): T {
  const requestOrigin = getRequestBaseOrigin(request);
  const clientRuntime = normalizeClientRuntime(request.headers["x-flixify-client-runtime"]);
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      posterUrl: createCatalogArtworkUrl({
        sourceUrl: item.posterUrl,
        origin: requestOrigin,
        clientRuntime
      })
    }))
  };
}

function signSeriesCatalogResponse<T extends { items: Array<{ posterUrl: string | null }> }>(
  payload: T,
  request: FastifyRequest
): T {
  const requestOrigin = getRequestBaseOrigin(request);
  const clientRuntime = normalizeClientRuntime(request.headers["x-flixify-client-runtime"]);
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      posterUrl: createCatalogArtworkUrl({
        sourceUrl: item.posterUrl,
        origin: requestOrigin,
        clientRuntime
      })
    }))
  };
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

function buildPersonalVodSourceUrl(
  baseUrl: string,
  streamPath: string,
  primaryCredentials: PlaybackCredentials | null,
  sharedCredentials: PlaybackCredentials | null
) {
  if (!primaryCredentials || samePlaybackCredentials(primaryCredentials, sharedCredentials)) {
    return null;
  }
  return buildStreamCandidates(baseUrl, streamPath, primaryCredentials, null)[0]?.url ?? null;
}

function getScopedPlaybackCredentials(userContext: Awaited<ReturnType<typeof getUserContext>>) {
  const shared = userContext.sharedReferenceCredentials;
  const primary = userContext.iptvCredentials;
  const trial = userContext.isThreeHourTrial;
  return {
    primary: trial && samePlaybackCredentials(primary, shared) ? null : primary,
    fallback: trial ? null : shared
  };
}

function hasCurrentPlaybackAccess(userContext: Awaited<ReturnType<typeof getUserContext>>) {
  if (!userContext.canPlay) {
    return false;
  }
  if (!userContext.accessUntil) {
    return !userContext.isThreeHourTrial;
  }
  const deadline = Date.parse(userContext.accessUntil);
  return Number.isFinite(deadline) && deadline > Date.now();
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

function normalizeLiveCacheProfile(value: unknown): "fast" | "safe" {
  return typeof value === "string" && value.trim().toLowerCase() === "safe" ? "safe" : "fast";
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

function hasOptimisticDirectPlaybackMessage(errorMessage: string | null | undefined) {
  if (typeof errorMessage !== "string") {
    return false;
  }

  const normalized = errorMessage.trim().toLowerCase();
  if (!normalized.length) {
    return false;
  }

  const patterns = [
    "ip_ban",
    "ip ban",
    "not authorized",
    "not authorised",
    "ip address is not authorized",
    "ip address is not authorised",
    "subscription has expired",
    "expired",
    "user_expired",
    "user expired",
    "access denied",
    "forbidden",
    "unauthorized",
    "unauthorised"
  ];

  return patterns.some((pattern) => normalized.includes(pattern));
}

async function resolveLiveSourceUrl(input: {
  baseUrl: string;
  streamPath: string;
  primaryCredentials: PlaybackCredentials | null;
  fallbackCredentials: PlaybackCredentials | null;
  fallbackTransport: LiveTransport;
  clientRuntime?: ClientRuntime;
  gatewayBaseUrl?: string | null;
  preferRelay?: boolean;
}) {
  const preferSharedCredentials = shouldPreferSharedCredentialsForBrowserGateway({
    clientRuntime: input.clientRuntime ?? "app",
    gatewayBaseUrl: input.gatewayBaseUrl,
    preferRelay: input.preferRelay
  });
  const candidates = buildStreamCandidates(
    input.baseUrl,
    input.streamPath,
    preferSharedCredentials ? input.fallbackCredentials : input.primaryCredentials,
    preferSharedCredentials ? input.primaryCredentials : input.fallbackCredentials
  ).map((candidate) => ({
    ...candidate,
    url: buildBrowserMediaGatewayUrl({
      clientRuntime: input.clientRuntime ?? "app",
      sourceUrl: candidate.url,
      gatewayBaseUrl: input.gatewayBaseUrl
    })
  }));

  if (candidates.length === 0) {
    return {
      ok: false,
      sourceUrl: null,
      transport: input.fallbackTransport,
      statusCode: 0,
      errorMessage: "Canli yayin kimlik bilgileri eksik.",
      cookie: null,
      isVerified: false
    };
  }

  let lastError = "Canli yayin kaynagi dogrulanamadi.";
  let lastTransport = input.fallbackTransport;
  let lastStatusCode = 0;
  let sawNetworkLikeFailure = false;
  let sawPotentialFalseNegativeHttpFailure = false;
  let sawPotentialFalseNegativeTextualFailure = false;
  const firstCandidateUrl = candidates[0]?.url ?? null;

  for (const candidate of candidates) {
    const probe = await probeLiveStream(candidate.url);
    if (probe.transport !== "unknown") {
      lastTransport = probe.transport;
    }
    lastStatusCode = probe.statusCode;
    if (probe.ok) {
      return {
        ok: true,
        sourceUrl: candidate.url,
        transport: probe.transport === "unknown" ? input.fallbackTransport : probe.transport,
        statusCode: probe.statusCode,
        cookie: probe.cookie,
        errorMessage: null,
        isVerified: true
      };
    }
    if (probe.statusCode === 0) {
      sawNetworkLikeFailure = true;
    }
    if (
      [401, 403, 405, 416, 429].includes(probe.statusCode) &&
      /^upstream\s+\d{3}$/i.test(probe.errorMessage?.trim() ?? "")
    ) {
      sawPotentialFalseNegativeHttpFailure = true;
    }
    if (hasOptimisticDirectPlaybackMessage(probe.errorMessage)) {
      sawPotentialFalseNegativeTextualFailure = true;
    }
    lastError = probe.errorMessage ?? lastError;
  }

  const allowOptimisticSourceAttempt =
    Boolean(firstCandidateUrl) &&
    (sawNetworkLikeFailure ||
      sawPotentialFalseNegativeHttpFailure ||
      sawPotentialFalseNegativeTextualFailure);
  if (allowOptimisticSourceAttempt) {
    return {
      ok: true,
      sourceUrl: firstCandidateUrl,
      transport: lastTransport === "unknown" ? input.fallbackTransport : lastTransport,
      statusCode: lastStatusCode,
      cookie: null,
      errorMessage: lastError,
      isVerified: false
    };
  }

  return {
    ok: false,
    sourceUrl: firstCandidateUrl,
    transport: lastTransport === "unknown" ? input.fallbackTransport : lastTransport,
    statusCode: lastStatusCode,
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
  let firstCandidateCookie: string | null = null;

  for (const candidate of candidates) {
    const probe = await probeVodStream(candidate.url);
    const resolvedCandidateUrl = probe.finalUrl || candidate.url;
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
    if (firstCandidateUrl === candidate.url) {
      firstCandidateUrl = resolvedCandidateUrl;
      firstCandidateCookie = probe.cookie;
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
      cookie: firstCandidateCookie,
      errorMessage: lastError,
      isVerified: false
    };
  }

  return {
    ok: false,
    sourceUrl: firstCandidateUrl,
    transport: lastTransport,
    cookie: firstCandidateCookie,
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

function isHttpsVodSourceUrl(sourceUrl: string | null): sourceUrl is string {
  if (!sourceUrl) return false;
  try {
    return new URL(sourceUrl).protocol === "https:";
  } catch {
    return false;
  }
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

  if (
    input.clientRuntime === "native" &&
    input.platform &&
    (input.platform.startsWith("windows") ||
      input.platform.startsWith("macos") ||
      input.platform.startsWith("linux") ||
      input.platform.includes("desktop")) &&
    input.transport !== "unknown"
  ) {
    return true;
  }

  return false;
}

function shouldRescueNativeVodToDirect(message: string | null | undefined) {
  const normalized = (message ?? "").trim().toLowerCase();
  if (!normalized.length) {
    return false;
  }

  return (
    normalized.includes("ip_ban") ||
    normalized.includes("not authorized") ||
    normalized.includes("json yaniti") ||
    normalized.includes("html yaniti") ||
    normalized.includes("status 401") ||
    normalized.includes("status 403")
  );
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
  const manifestUrl = env.APP_UPDATE_MANIFEST_URL?.trim() || null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    if (!manifestUrl) {
      return await readLocalAppUpdateManifest();
    }

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

async function authenticateUser(authorization?: string, request?: FastifyRequest): Promise<UserRequest> {
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
  if (!session || session.revoked_at || session.user_id !== payload.sub || sessionHasExpired(session.expires_at)) {
    throw new UnauthorizedUserRouteError();
  }

  if (session.auth_method === "device_link") {
    if (!session.family_id || !await deviceLoginStore.activate(payload.sub, session.id, session.family_id)) throw new UnauthorizedUserRouteError();
    if (request) linkedViewerRequests.add(request);
  }
  if (request && (session.auth_method === "phone_otp" || session.auth_method === "email_otp")) linkedViewerRequests.add(request);
  await touchDeviceSession(session.id);

  return {
    userId: payload.sub,
    sessionId: payload.sid,
    authMethod: session.auth_method
  };
}

async function authenticateAdmin(authorization?: string): Promise<AdminRequest> {
  const token = getBearerToken(authorization);
  if (!token) {
    throw new Error("Unauthorized");
  }

  if (isDemoMode) {
    return {
      adminId: "demo-admin",
      email: env.adminEmails[0] ?? "admin@flixify.local"
    };
  }

  return verifyAdminToken(token);
}

export function buildServer() {
  const app = Fastify({
    logger: true,
    trustProxy: env.TRUSTED_PROXY_CIDRS
  });

  app.register(cors, API_CORS_CONFIG);
  app.addHook("preSerialization", async (request, _reply, payload) =>
    linkedViewerRequests.has(request) ? redactDeviceLinkedPayload(payload) : payload);
  registerDeviceLoginRoutes(app, { service: deviceLoginService, authenticate: authenticateUser, enabled: !isDemoMode,...(env.DEVICE_LOGIN_LOCAL_WEB_ORIGIN?{allowedOrigins:[env.DEVICE_LOGIN_LOCAL_WEB_ORIGIN]}:{}) });
  registerPhoneAuthRoutes(app,{service:phoneAuthService,enabled:env.PHONE_AUTH_ENABLED&&!isDemoMode,localOnly:env.PHONE_AUTH_LOCAL_ONLY,allowedOrigins:env.PHONE_AUTH_ALLOWED_ORIGINS,authenticate:authenticateUser});
  registerEmailAuthRoutes(app, { service: emailAuthService, authenticate: authenticateUser });
  const deviceLoginCleanup = isDemoMode ? null : setInterval(() => {
    deviceLoginStore.cleanup().catch(() => app.log.warn({ operation: "device-login-cleanup" }, "Cihaz baglama temizligi kullanilamiyor."));
  }, 60_000);
  deviceLoginCleanup?.unref();
  const phoneAuthCleanup=phoneAuthService?setInterval(()=>{phoneAuthStore.cleanup().catch(()=>app.log.warn({operation:'phone-auth-cleanup'},'Dogrulama temizligi tamamlanamadi.'));},60_000):null;
  phoneAuthCleanup?.unref();
  const emailAuthCleanup = emailAuthStore ? setInterval(() => {
    emailAuthStore.cleanup().catch(() => app.log.warn({ operation: "email-auth-cleanup" }, "E-posta doğrulama temizliği tamamlanamadı."));
  }, 60_000) : null;
  emailAuthCleanup?.unref();
  const rememberedSessionCleanup=isDemoMode?null:setInterval(()=>{rememberedSessionStore.cleanup().catch(()=>app.log.warn({operation:'remembered-session-cleanup'},'Oturum yenileme temizligi tamamlanamadi.'));},60_000);
  rememberedSessionCleanup?.unref();
  app.addHook('onClose',async()=>{if(rememberedSessionCleanup)clearInterval(rememberedSessionCleanup);});
  app.addHook('onClose',async()=>{if(phoneAuthCleanup)clearInterval(phoneAuthCleanup);});
  app.addHook("onClose", async () => { if (emailAuthCleanup) clearInterval(emailAuthCleanup); });
  app.addHook("onClose", async () => { if (deviceLoginCleanup) clearInterval(deviceLoginCleanup); });
  registerAccountLibrary(app, { vod: accountVodCatalog, moviePolicy:getAdultMoviePolicy,
    forceAccountMovieVod:policy=>shouldUseAccountMovieCatalog(accountVodProxyConfigured,policy),
    authenticate: authenticateUser, sendError: sendUserRouteError, origin: getRequestBaseOrigin });
  registerAdultMovieRoutes(app,{
    authenticate:authenticateUser,context:getUserContext,get:adultMovieStore.get.bind(adultMovieStore),
    set:(userId,visible,context)=>{
      if(!adultMovieActivator)throw Error("adult_provider_unavailable");
      return adultMovieActivator.set(userId,visible,context);
    },
    available:canUseAdultMovies,sendError:sendUserRouteError
  });

  const disabledStripeApi: StripeBillingRouteApi = {
    createCustomer: async () => { throw new Error('checkout_unavailable'); },
    createCheckoutSession: async () => { throw new Error('checkout_unavailable'); },
    createPortalSession: async () => { throw new Error('billing_unavailable'); }
  };
  const stripeBillingApi = stripeClient && stripeRuntime ? createStripeBillingApi(stripeClient, stripeRuntime) : disabledStripeApi;
  const processStripePayment = async (sessionId: string) => {
    if (!stripeClient || !stripeRuntime || !adultMovieProvider) return;
    await fulfillPaidCheckout(sessionId, {
      liveMode: stripeRuntime.liveMode,
      allowedTestUserIds: stripeRuntime.allowedTestUserIds,
      billing: createStripePaymentReader(stripeClient),
      store: stripePaymentStore,
      customerStore: stripePaymentStore,
      provider: adultMovieProvider
    });
  };
  const wakeStripePayment = (sessionId: string) => {
    setImmediate(() => { void processStripePayment(sessionId).catch(() => app.log.error('Stripe payment requires operator review')); });
  };
  registerStripeBillingRoutes(app, {
    enabled: Boolean(stripeRuntime?.checkoutEnabled && stripeClient && adultMovieProvider && !isDemoMode),
    portalEnabled: Boolean(stripeRuntime && stripeClient && !isDemoMode),
    liveMode: stripeRuntime?.liveMode ?? false,
    allowedTestUserIds: stripeRuntime?.allowedTestUserIds,
    priceIds: stripeRuntime?.priceIds ?? { '1-ay': '', '3-ay': '', '6-ay': '', '12-ay': '' },
    authenticate: authenticateUser,
    store: stripeBillingStore,
    stripe: stripeBillingApi,
    paymentStatus: async (userId, sessionId) => {
      const liveMode = stripeRuntime?.liveMode ?? false;
      const local = await stripePaymentStore.status(sessionId, userId, liveMode);
      if (!local) return null;
      if (local.status === 'active' || local.status === 'review_required' || local.status === 'expired') return local;
      if (!stripeBillingApi.retrieveCheckoutSession) throw new Error('billing_unavailable');
      const session = await stripeBillingApi.retrieveCheckoutSession(sessionId);
      const customerId = await stripeBillingStore.customerFor(userId, liveMode);
      if (session.id !== sessionId || session.userId !== userId || session.liveMode !== liveMode ||
          session.customerId !== customerId || session.mode !== 'payment') return {status:'review_required'};
      if (session.status === 'expired' && session.paymentStatus === 'unpaid') {
        await stripePaymentStore.expire(sessionId, userId, liveMode);
        return {status:'expired',packageSlug:local.packageSlug};
      }
      if (session.status === 'complete' && session.paymentStatus === 'paid') {
        await stripePaymentStore.enqueue(sessionId, liveMode);
        wakeStripePayment(sessionId);
        return {status:'processing',packageSlug:local.packageSlug};
      }
      return {status:'awaiting_payment',packageSlug:local.packageSlug};
    },
    verifyProviderPackage: async (providerPackageId, months, users) => {
      if (!adultMovieProvider) return false;
      try {
        const selected = (await adultMovieProvider.listPackages()).find(pkg => pkg.id === providerPackageId);
        return Boolean(selected && !selected.isTrial && (selected.unit === 'months' ? selected.duration : selected.unit === 'years' ? selected.duration * 12 : 0) === months && selected.maxConnections === users);
      } catch {
        return false;
      }
    }
  });
  let stripePollTimer: ReturnType<typeof setInterval> | null = null;
  if (stripeClient && stripeRuntime) {
    const invoiceReader = createStripeInvoiceReader(stripeClient);
    const processStripeInvoice = async (invoiceId: string) => {
      if (!adultMovieProvider) {
        if (await stripeBillingStore.claim(invoiceId)) await stripeBillingStore.review(invoiceId, 'provider_not_configured');
        return;
      }
      await fulfillPaidInvoice(invoiceId, {
        store: stripeBillingStore,
        provider: adultMovieProvider,
        billing: invoiceReader,
        priceIds: stripeRuntime.priceIds,
        liveMode: stripeRuntime.liveMode,
        allowedTestUserIds: stripeRuntime.allowedTestUserIds
      });
    };
    const wake = (invoiceId: string) => {
      setImmediate(() => { void processStripeInvoice(invoiceId).catch(() => app.log.error('Stripe invoice requires operator review')); });
    };
    registerStripeWebhook(app, {
      liveMode: stripeRuntime.liveMode,
      verify: (rawBody, signature) => stripeClient.webhooks.constructEvent(rawBody, signature, stripeRuntime.webhookSecret) as unknown as StripeWebhookEvent,
      store: stripeBillingStore,
      wake,
      paymentStore: stripePaymentStore,
      wakePayment: wakeStripePayment
    });
    stripePollTimer = setInterval(() => {
      void (async () => {
        await stripePaymentStore.markStaleClaimsForReview();
        for (const sessionId of await stripePaymentStore.pendingSessionIds()) await processStripePayment(sessionId);
        await stripeBillingStore.markStaleClaimsForReview();
        for (const invoiceId of await stripeBillingStore.pendingInvoiceIds()) await processStripeInvoice(invoiceId);
      })().catch(() => app.log.error('Stripe invoice queue check failed'));
    }, 60000);
    stripePollTimer.unref();
  }

  app.addHook("onRequest", async (request) => {
    stripEmptyJsonContentType(request.raw.method, request.raw.headers);
  });

  app.addHook("onClose", async () => {
    if (stripePollTimer) clearInterval(stripePollTimer);
    await livePlaybackManager.dispose();
    await vodPlaybackManager.dispose();
    await closeCacheRuntime();
  });

  app.get(LIVE_LOGO_PROXY_PATH, async (request, reply) => {
    const verifiedQuery = verifySignedLiveLogoQuery((request.query as Record<string, unknown> | undefined) ?? {});
    if (!verifiedQuery.ok) {
      return reply.status(verifiedQuery.error.statusCode).send({ message: verifiedQuery.error.message });
    }

    try {
      const proxiedLogo = await fetchLiveLogoFromUpstream(verifiedQuery.value.sourceUrl);

      reply.header("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
      reply.header("x-content-type-options", "nosniff");
      if (proxiedLogo.etag) {
        reply.header("etag", proxiedLogo.etag);
      }
      if (proxiedLogo.lastModified) {
        reply.header("last-modified", proxiedLogo.lastModified);
      }

      return reply.type(proxiedLogo.contentType).send(proxiedLogo.body);
    } catch (error) {
      const resolvedError =
        error instanceof LiveLogoProxyError ? error : new LiveLogoProxyError("Logo servisi hatasi.", 502);
      if (resolvedError.statusCode === 404) {
        reply.header("cache-control", "public, max-age=3600");
      }
      return reply.status(resolvedError.statusCode).send({ message: resolvedError.message });
    }
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
      const schema = await pool.query<{ trial_jobs: string | null; trial_ip_quota: string | null; lifetime_ip: string | null; lifetime_installations: string | null }>(`
        select to_regclass('public.auto_trial_provision_jobs')::text as trial_jobs,
               to_regclass('public.registration_trial_ip_quota')::text as trial_ip_quota,
               to_regclass('public.registration_ip_lifetime_quota')::text as lifetime_ip,
               to_regclass('public.registration_installation_claims')::text as lifetime_installations
      `);
      if (!schema.rows[0]?.trial_jobs || !schema.rows[0]?.trial_ip_quota || !schema.rows[0]?.lifetime_ip || !schema.rows[0]?.lifetime_installations) {
        throw new Error("Automatic trial database schema is missing.");
      }
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

  const rejectUnverifiedRegistration = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.header("cache-control", "no-store").status(410).send({
      reason: "phone_verification_required",
      message: "Yeni hesap oluşturmak için WhatsApp doğrulamasını kullanın."
    });
  };
  app.post("/auth/register-anon", {
    onRequest: rejectUnverifiedRegistration
  }, rejectUnverifiedRegistration);

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

    try {
      const token=payload.refreshToken;
      const [sessionId,rawSecret,...extra]=token.split('.');
      if(!sessionId||!rawSecret||extra.length||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId))return reply.status(401).send({reason:'invalid-refresh',message:'Oturum yenilenemedi.'});
      const session=await getSessionById(sessionId);
      if(!session)return reply.status(401).send({reason:'invalid-refresh',message:'Oturum yenilenemedi.'});
      const userStatus=await getUserStatus(session.user_id);
      if(!userStatus)return reply.status(403).send({reason:'account-deleted',message:'Bu hesaba şu anda giriş yapılamıyor.'});
      if(userStatus==='blocked')return reply.status(403).send({reason:'account-blocked',message:'Bu hesaba şu anda giriş yapılamıyor.'});
      if(!await verifySecret(rawSecret,session.refresh_token_hash))return reply.status(401).send({reason:'invalid-refresh',message:'Oturum yenilenemedi.'});
      const prepared=await prepareDeviceLoginSession(session.user_id);
      const rotated=await rememberedSessionStore.rotate({id:session.id,userId:session.user_id,refreshHash:session.refresh_token_hash},prepared);
      if(rotated.authMethod!=='account_code')linkedViewerRequests.add(request);
      const context=await getUserContext(session.user_id);
      return {accessToken:rotated.accessToken,refreshToken:rotated.refreshToken,user:context.summary,kryptoniteCode:rotated.authMethod==='account_code'?(context.summary.kryptoniteCode??null):null};
    } catch(error) {
      if(error instanceof RememberedSessionError)return reply.status(error.statusCode).send({reason:error.reason,message:'Oturum yenilenemedi.'});
      request.log.warn({operation:'session-refresh',statusClass:'transient'},'Oturum yenileme geçici olarak tamamlanamadı.');
      return reply.status(503).send({reason:'temporarily-unavailable',message:'Bağlantı şu anda yenilenemiyor. Lütfen tekrar deneyin.'});
    }
  });

  app.get("/me", async (request, reply) => {
    reply.header("cache-control", "private, no-store, max-age=0");
    try {
      const auth = await authenticateUser(request.headers.authorization, request);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me) {
          return reply.status(404).send({ message: "Kullanici bulunamadi." });
        }
        return withTrialCountdown(me, {
          summary: me.user,
          isThreeHourTrial: me.user.activePackage?.title === "3 Saat Deneme",
          accessUntil: me.user.activePackage?.endsAt ?? null,
          trialProviderExpiresAt: null
        });
      }

      const userContext = await getUserContext(auth.userId);
      const settings = await getAppSettings();

      return withTrialCountdown({
        user: { ...userContext.summary, accessHistory: await getAccessHistory(auth.userId) },
        contact: {
          whatsapp: settings.supportWhatsappUrl,
          telegram: settings.supportTelegramUrl
        }
      }, userContext);
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get('/me/referrals', async (request, reply) => {
    try {
      reply.header('cache-control', 'private, no-store');
      const auth = await authenticateUser(request.headers.authorization, request);
      if (isDemoMode) return { code: null, qualified: 0, towardNext: 0, earnedMonths: 0, pendingRewards: 0 };
      return await getReferralSummary(auth.userId);
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  registerPersonalLibrary(app, { authenticate: authenticateUser, context: (id) => getUserContext(id), secret: env.APP_JWT_SECRET, demo: isDemoMode, classify: classifyUserRouteError });
  if (!isDemoMode) registerWelcomeOfferRoutes(app, { authenticate: authenticateUser, store: new WelcomeOfferStore(pool) });
  if (!isDemoMode) registerAnalyticsRuntime(app, { authenticate: authenticateUser, pool });

  app.get("/me/provider-session", async (request, reply) => {
    reply.header("cache-control", "private, no-store, max-age=0");
    reply.header("pragma", "no-cache");
    reply.header("vary", "Authorization, Origin");
    try {
      const auth = await authenticateUser(request.headers.authorization, request);
      if (isDemoMode) {
        return reply.status(403).send({ message: "Kisisel yayin erisimi kullanilamiyor." });
      }
      const context = await getUserContext(auth.userId);
      const session = derivePersonalProviderSession(auth.userId, context, env.APP_JWT_SECRET);
      if (!session) {
        return reply.status(403).send({ message: "Kisisel yayin erisimi kullanilamiyor." });
      }
      const livePolicy = await loadLiveChannelPolicy(session.providerOrigin, request.log);
      return livePolicy ? { ...session, livePolicy } : session;
    } catch (error) {
      // Repository errors may contain provider credentials. Classify without serializing the error.
      const classified = classifyUserRouteError(error);
      request.log.warn({ statusClass: classified.statusClass }, "Personal provider session unavailable");
      return reply.status(classified.statusCode).send({ message: classified.message });
    }
  });

  app.get("/me/app-update/check", async (request, reply) => {
    try {
      reply.header("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      await authenticateUser(request.headers.authorization, request);
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
      const auth = await authenticateUser(request.headers.authorization, request);
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
      const auth = await authenticateUser(request.headers.authorization, request);
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
      const auth = await authenticateUser(request.headers.authorization, request);
      const query = paginationQuerySchema.parse(request.query);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }
        return signLiveCatalogResponse(
          listDemoLiveCatalog(auth.userId, query.page, query.pageSize, query.search, query.group),
          request
        );
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      const playbackCredentials = getScopedPlaybackCredentials(userContext);
      const cacheKey = liveCatalogPageKey({
        snapshotVersion: userContext.snapshotVersion,
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        group: query.group
      });
      const cachedCatalog = await getCachedLiveCatalog(apiCache, cacheKey, async () =>
        sanitizeLiveCatalogForCache(
          await listLiveCatalog(
            userContext.snapshotVersion,
            query.page,
            query.pageSize,
            query.search,
            query.group
          )
        )
      );
      return signLiveCatalogResponse(
        personalizeLiveCatalog(cachedCatalog, userContext.canPlay && Boolean(playbackCredentials.primary || playbackCredentials.fallback)),
        request,
        userContext.isThreeHourTrial
      );
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/live/:channelId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization, request);
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
      const preferVideoTranscode =
        rawQuery?.preferVideoTranscode === true ||
        rawQuery?.preferVideoTranscode === "true" ||
        rawQuery?.preferVideoTranscode === "1";
      const cacheProfile = normalizeLiveCacheProfile(rawQuery?.cacheProfile);
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
            preferTranscode,
            preferVideoTranscode,
            cacheProfile
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
      const playbackCredentials = getScopedPlaybackCredentials(userContext);
      if (userContext.isThreeHourTrial && !playbackCredentials.primary) {
        return reply.status(403).send({ message: "Deneme hatti hazir degil." });
      }

      const channel = await getLiveChannelForPlayback(userContext.snapshotVersion, channelId);
      if (!channel) {
        return reply.status(404).send({ message: "Canli kanal bulunamadi." });
      }

      const personalDirectSourceUrl = userContext.playbackBaseUrl
        ? buildPersonalVodSourceUrl(userContext.playbackBaseUrl, channel.stream_path,
            playbackCredentials.primary, userContext.sharedReferenceCredentials)
        : null;
      let canonicalDirectLiveUrl: URL | null = null;
      try {
        canonicalDirectLiveUrl = personalDirectSourceUrl ? new URL(personalDirectSourceUrl) : null;
      } catch {
        // Invalid provider URLs cannot be offered as browser direct playback.
      }
      const directExtension = canonicalDirectLiveUrl?.pathname.match(/\.(m3u8|ts|mp4|mkv)$/i)?.[1]?.toLowerCase();
      const directTransport = directExtension === "m3u8" ? "hls" : directExtension;
      if (
        clientRuntime === "browser" &&
        rawQuery?.direct !== "0" &&
        canUseClientIpPlayback(userContext) &&
        isHttpsVodSourceUrl(personalDirectSourceUrl) &&
        (directTransport === "hls" || directTransport === "ts" || directTransport === "mp4" || directTransport === "mkv")
      ) {
        return {
          ...buildDirectLivePlaybackFallback({
            channelId,
            sourceUrl: personalDirectSourceUrl,
            transport: directTransport,
            healthStatus: channel.health_status,
            lastCheckedAt: channel.last_checked_at,
            isVerified: false
          }),
          deliveryMode: "direct_provider" as const,
          expiresAt: userContext.accessUntil
        };
      }

      const cooldownMs = 5 * 60 * 1000;
      const normalizedLastError = typeof channel.last_error === "string" ? channel.last_error.trim().toLowerCase() : "";
      const shouldHonorRecent404Failure = shouldHonorSharedLive404Cooldown(
        playbackCredentials.primary,
        playbackCredentials.fallback
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

      const directOnlyPlayback = buildBrowserDirectOnlyPlayback({
        userId: auth.userId,
        canPlay: userContext.canPlay,
        preferRelay,
        mode: env.BROWSER_DIRECT_PROVIDER_MODE,
        percentage: env.BROWSER_DIRECT_PROVIDER_PERCENT,
        canaryUserIds: env.BROWSER_DIRECT_PROVIDER_USER_IDS,
        canaryLineUsername: env.BROWSER_DIRECT_PROVIDER_LINE_USERNAME,
        allowedSourceHosts: env.BROWSER_DIRECT_PROVIDER_SOURCE_HOSTS,
        allowHls: env.BROWSER_DIRECT_PROVIDER_HLS_ENABLED,
        playbackBaseUrl: userContext.playbackBaseUrl ?? "",
        channelId,
        clientRuntime,
        transport: channel.transport,
        credentials: userContext.iptvCredentials,
        streamPath: channel.stream_path,
        healthStatus: channel.health_status,
        lastCheckedAt: channel.last_checked_at
      });
      if (directOnlyPlayback) {
        reply.header("cache-control", "private, no-store");
        return directOnlyPlayback;
      }

      if (
        !userContext.playbackBaseUrl ||
        (!playbackCredentials.primary && !playbackCredentials.fallback)
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

      if (!preferRelay && userContext.canPlay && userContext.iptvCredentials) {
        const browserDirectPlayback = buildBrowserDirectPlayback({
          userId: auth.userId,
          canPlay: userContext.canPlay,
          preferRelay,
          mode: env.BROWSER_DIRECT_PROVIDER_MODE,
          percentage: env.BROWSER_DIRECT_PROVIDER_PERCENT,
          canaryUserIds: env.BROWSER_DIRECT_PROVIDER_USER_IDS,
          canaryLineUsername: env.BROWSER_DIRECT_PROVIDER_LINE_USERNAME,
          allowedSourceHosts: env.BROWSER_DIRECT_PROVIDER_SOURCE_HOSTS,
          allowHls: env.BROWSER_DIRECT_PROVIDER_HLS_ENABLED,
          playbackBaseUrl: userContext.playbackBaseUrl,
          channelId,
          clientRuntime,
          transport: channel.transport,
          credentials: userContext.iptvCredentials,
          streamPath: channel.stream_path,
          healthStatus: channel.health_status,
          lastCheckedAt: channel.last_checked_at
        });
        if (browserDirectPlayback) {
          reply.header("cache-control", "private, no-store");
          return browserDirectPlayback;
        }

        let directSourceUrl: string | null = null;
        try {
          directSourceUrl = buildStreamUrl(
            userContext.playbackBaseUrl,
            userContext.iptvCredentials.username,
            userContext.iptvCredentials.password,
            channel.stream_path
          );
        } catch {
          // The normal playback path below owns malformed source errors.
        }

        if (directSourceUrl) {
          const directPrivateCdnUrl = await resolveAccountDirectPrivateCdnUrl({
            userId: auth.userId,
            configuredUserIds: env.PRIVATE_CDN_DIRECT_USER_IDS,
            clientRuntime,
            candidates: [
              {
                sourceUrl: directSourceUrl,
                forbiddenValues: [
                  userContext.iptvCredentials.username,
                  userContext.iptvCredentials.password
                ]
              }
            ],
            proxyUrl: selectVodProxy(auth.userId),
            allowedHosts: env.PRIVATE_CDN_DIRECT_HOSTS,
            fetchThroughProxy: vodFetch
          });

          if (directPrivateCdnUrl) {
            return buildDirectLivePlaybackFallback({
              channelId,
              sourceUrl: directPrivateCdnUrl,
              transport: channel.transport,
              healthStatus: channel.health_status,
              lastCheckedAt: new Date().toISOString(),
              isVerified: true
            });
          }
        }
      }

      const resolved = userContext.canPlay
        ? await resolveLiveSourceUrl({
            baseUrl: userContext.playbackBaseUrl,
            streamPath: channel.stream_path,
            primaryCredentials: playbackCredentials.primary,
            fallbackCredentials: playbackCredentials.fallback,
            fallbackTransport: channel.transport,
            clientRuntime,
            gatewayBaseUrl: env.PUBLIC_MEDIA_GATEWAY_URL,
            preferRelay
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
      const optimisticDirectMessage = hasOptimisticDirectPlaybackMessage(errorMessage);
      const skipFailureCountIncrement =
        optimisticDirectMessage ||
        (typeof upstreamStatus === "number" && [405, 416, 429].includes(upstreamStatus));
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
        (optimisticDirectMessage ||
          (typeof upstreamStatus === "number" && [401, 403, 405, 416, 429].includes(upstreamStatus)));

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

      const canPlay = hasCurrentPlaybackAccess(userContext) && (resolved.ok || optimisticProbeFallback);

      if (
        !preferRelay &&
        canPlay &&
        clientRuntime === "browser" &&
        isBrowserMediaGatewayUrl(resolved.sourceUrl, env.PUBLIC_MEDIA_GATEWAY_URL)
      ) {
        return buildDirectLivePlaybackFallback({
          channelId,
          sourceUrl: resolved.sourceUrl!,
          transport,
          healthStatus,
          lastCheckedAt: checkedAt,
          isVerified: resolved.isVerified
        });
      }

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
          accessUntil: userContext.accessUntil,
          isVerified: resolved.isVerified,
          errorMessage: canPlay ? null : errorMessage ?? "Canli yayin gecici olarak kullanilamiyor.",
          forceRelayRestart,
          allowFileProxyFallback: debugFileProxy || optimisticProbeFallback,
          preferDirectProxy: !preferRelay,
          preferTranscode,
          preferVideoTranscode,
          cacheProfile
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
        !preferRelay &&
        !playback.canPlay &&
        !userContext.isThreeHourTrial &&
        hasCurrentPlaybackAccess(userContext) &&
        typeof resolved.sourceUrl === "string" &&
        (optimisticProbeFallback ||
          optimisticDirectMessage ||
          (typeof upstreamStatus === "number" &&
            upstreamStatus !== 404 &&
            canUseAppDirectPlaybackFallback(clientRuntime, resolved.sourceUrl)))
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

      if (!hasCurrentPlaybackAccess(userContext)) {
        return buildDisabledLivePlaybackRecord({
          channelId,
          transport,
          healthStatus,
          lastCheckedAt: checkedAt,
          isVerified: resolved.isVerified,
          errorMessage: "Canli yayin icin aktif paket gerekiyor."
        });
      }

      return playback;
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/native/live/:channelId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization, request);
      const { channelId } = request.params as { channelId: string };
      const rawQuery = request.query as Record<string, unknown> | undefined;
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
          ? true
          : rawQuery?.preferRelay === true ||
            rawQuery?.preferRelay === "true" ||
            rawQuery?.preferRelay === "1";
      const preferTranscode =
        rawQuery?.preferTranscode === true ||
        rawQuery?.preferTranscode === "true" ||
        rawQuery?.preferTranscode === "1";
      const preferVideoTranscode =
        rawQuery?.preferVideoTranscode === true ||
        rawQuery?.preferVideoTranscode === "true" ||
        rawQuery?.preferVideoTranscode === "1";
      const cacheProfile = normalizeLiveCacheProfile(rawQuery?.cacheProfile);

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
        const transport = channel.transport ?? detectLiveTransport(channel.streamUrl) ?? "unknown";

        try {
          const playback = await livePlaybackManager.createPlayback({
            channelId,
            snapshotVersion: 1,
            sourceUrl: channel.streamUrl,
            baseOrigin: getRequestBaseOrigin(request),
            sourceTransport: transport,
            healthStatus: channel.healthStatus,
            lastCheckedAt: channel.lastCheckedAt,
            canPlay: true,
            isVerified: channel.isVerified,
            errorMessage: null,
            forceRelayRestart,
            allowFileProxyFallback: debugFileProxy,
            preferDirectProxy: !preferRelay,
            preferTranscode,
            preferVideoTranscode,
            cacheProfile
          });

          if (playback.canPlay && typeof playback.url === "string") {
            return buildNativeLivePlaybackResponse({
              url: playback.url,
              transport: playback.transport,
              diagnosticsSessionId: playback.diagnosticsSessionId,
              variantGroupKey: channel.variantGroupKey ?? variantMetadata.variantGroupKey,
              qualityRank: channel.qualityRank ?? variantMetadata.qualityRank,
              isVerified: playback.isVerified,
              lastCheckedAt: playback.lastCheckedAt ?? channel.lastCheckedAt ?? null
            });
          }
        } catch (error) {
          request.log.warn({ err: error, channelId }, "Demo native live playback manager error");
        }

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
      if (!hasCurrentPlaybackAccess(userContext)) {
        return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
      }
      const playbackCredentials = getScopedPlaybackCredentials(userContext);
      if (userContext.isThreeHourTrial && !playbackCredentials.primary) {
        return replyWithNativePlaybackError(reply, 403, "Deneme hatti hazir degil.");
      }

      const channel = await getLiveChannelForPlayback(userContext.snapshotVersion, channelId);
      if (!channel) {
        return replyWithNativePlaybackError(reply, 404, "Canli kanal bulunamadi.");
      }

      if (
        !userContext.playbackBaseUrl ||
        (!playbackCredentials.primary && !playbackCredentials.fallback)
      ) {
        return replyWithNativePlaybackError(reply, 503, "Canli yayin kaynagi hazir degil.");
      }

      const resolved = await resolveLiveSourceUrl({
        baseUrl: userContext.playbackBaseUrl,
        streamPath: channel.stream_path,
        primaryCredentials: playbackCredentials.primary,
        fallbackCredentials: playbackCredentials.fallback,
        fallbackTransport: channel.transport
      });
      if (!hasCurrentPlaybackAccess(userContext)) {
        return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
      }
      const checkedAt = new Date().toISOString();
      const errorMessage = resolved.errorMessage;
      const upstreamStatus = extractUpstreamStatus(errorMessage);
      const optimisticDirectMessage = hasOptimisticDirectPlaybackMessage(errorMessage);
      const allowOptimisticNativeDirect =
        !resolved.ok &&
        typeof resolved.sourceUrl === "string" &&
        canUseAppDirectPlaybackFallback("native", resolved.sourceUrl) &&
        (resolved.statusCode === 0 ||
          optimisticDirectMessage ||
          (typeof upstreamStatus === "number" && [401, 403, 405, 416, 429].includes(upstreamStatus)));
      const skipFailureCountIncrement =
        optimisticDirectMessage ||
        (typeof upstreamStatus === "number" && [405, 416, 429].includes(upstreamStatus));
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
      const canAttemptRelay = Boolean(resolved.sourceUrl) && (resolved.ok || allowOptimisticNativeDirect);

      try {
        const playback = await livePlaybackManager.createPlayback({
          channelId,
          snapshotVersion: channel.snapshot_version,
          sourceUrl: canAttemptRelay ? resolved.sourceUrl : null,
          cookie: canAttemptRelay ? resolved.cookie : null,
          baseOrigin: getRequestBaseOrigin(request),
          sourceTransport: resolved.transport,
          healthStatus,
          lastCheckedAt: checkedAt,
          canPlay: canAttemptRelay,
          accessUntil: userContext.accessUntil,
          isVerified: resolved.isVerified,
          errorMessage: canAttemptRelay ? null : errorMessage ?? "Canli yayin gecici olarak kullanilamiyor.",
          forceRelayRestart,
          allowFileProxyFallback: true,
          preferDirectProxy: !preferRelay,
          preferTranscode,
          preferVideoTranscode,
          cacheProfile
        });

        if (playback.canPlay && typeof playback.url === "string" && hasCurrentPlaybackAccess(userContext)) {
          return buildNativeLivePlaybackResponse({
            url: playback.url,
            transport: playback.transport,
            diagnosticsSessionId: playback.diagnosticsSessionId,
            variantGroupKey: channel.variant_group_key ?? variantMetadata.variantGroupKey,
            qualityRank: channel.quality_rank ?? variantMetadata.qualityRank,
            isVerified: playback.isVerified,
            lastCheckedAt: playback.lastCheckedAt ?? checkedAt
          });
        }
      } catch (error) {
        request.log.warn(
          {
            err: error,
            channelId
          },
          "Native live playback manager error"
        );
      }

      if (!hasCurrentPlaybackAccess(userContext)) {
        return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
      }

      if (userContext.isThreeHourTrial) {
        return replyWithNativePlaybackError(reply, 503, "Canli relay hazirlanamadi.");
      }

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
      const auth = await authenticateUser(request.headers.authorization, request);
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
      const auth = await authenticateUser(request.headers.authorization, request);
      const query = paginationQuerySchema.parse(request.query);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }
        return signMovieCatalogResponse(
          listDemoMovieCatalog(auth.userId, query.page, query.pageSize, query.search, query.group),
          request
        );
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      const moviePolicy=await getAdultMoviePolicy(auth.userId);
      if(useAdultSafeMovieCatalog(request.headers["x-flixify-client-runtime"],auth.userId,moviePolicy)) {
        reply.header("cache-control","private, no-store");
        return signMovieCatalogResponse(await accountVodCatalog.list(auth.userId,userContext,"movie",query,moviePolicy),request);
      }
      return signMovieCatalogResponse(
        await listMoviesCatalog(
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
        ),
        request
      );
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/catalog/series", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization, request);
      const query = paginationQuerySchema.parse(request.query);

      if (isDemoMode) {
        const me = getDemoMe(auth.userId);
        if (!me?.user.hasAssignedLink) {
          return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
        }
        return signSeriesCatalogResponse(
          listDemoSeriesCatalog(auth.userId, query.page, query.pageSize, query.search, query.group),
          request
        );
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      if(useAccountVod(request.headers["x-flixify-client-runtime"],auth.userId)) {
        reply.header("cache-control","private, no-store");
        return signSeriesCatalogResponse(await accountVodCatalog.list(auth.userId,userContext,"series",query),request);
      }
      return signSeriesCatalogResponse(
        await listSeriesCatalog(
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
        ),
        request
      );
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.get("/me/vod/:kind/:itemId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization, request);
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
      const playbackCredentials = getScopedPlaybackCredentials(userContext);
      if (userContext.isThreeHourTrial && !playbackCredentials.primary) {
        return reply.status(403).send({ message: "Deneme hatti hazir degil." });
      }

      const moviePolicy=kind==="movie"?await getAdultMoviePolicy(auth.userId):hiddenMoviePolicy;
      if((kind==="movie"?useAdultSafeMovieCatalog(request.headers["x-flixify-client-runtime"],auth.userId,moviePolicy):useAccountVod(request.headers["x-flixify-client-runtime"],auth.userId))) {
        if(!hasCurrentPlaybackAccess(userContext))return buildDisabledVodPlaybackRecord({itemId,kind,transport:"unknown",errorMessage:"Bu içerik için aktif paket gerekir."});
        const source=await accountVodCatalog.source(auth.userId,userContext,kind,itemId,moviePolicy);
        if(!source)return reply.code(404).send({message:"İçerik güncel hesabınızda bulunamadı. İçerik detayını yeniden açın."});
        if(!hasCurrentPlaybackAccess(userContext))return buildDisabledVodPlaybackRecord({itemId,kind,transport:"unknown",errorMessage:"Bu içerik için aktif paket gerekir."});
        reply.header("cache-control","private, no-store");
        if(!userContext.isThreeHourTrial && (rawQuery?.compatibilityProbe === "1" || rawQuery?.compatibilityProbe === true)) {
          return vodPlaybackManager.inspectBrowserCompatibility({
            sourceUrl: source.url,
            proxyUrl: source.proxyUrl
          });
        }
        if (
          !userContext.isThreeHourTrial &&
          rawQuery?.vodDirect === "1" && rawQuery?.direct !== "0" && rawQuery?.direct !== false &&
          !audioTrackId && !(preferTranscode && rawQuery?.preferTranscode !== undefined)
        ) {
          const directPlayback = buildOptimisticBrowserDirectVodPlayback({
            itemId,
            kind,
            sourceUrl: source.url,
            credentials: userContext.iptvCredentials!
          });
          if (directPlayback) return directPlayback;
        }
        const playback=await vodPlaybackManager.createPlayback({userId:auth.userId,itemId,kind,sourceUrl:source.url,proxyUrl:source.proxyUrl,baseOrigin,clientRuntime:"browser",platform,preferTranscode:rawQuery?.preferTranscode!==undefined && preferTranscode,allowBrowserFileProxy:true,selectedAudioTrackId:audioTrackId,accessUntil:userContext.isThreeHourTrial?userContext.accessUntil:null});
        if(!hasCurrentPlaybackAccess(userContext))return buildDisabledVodPlaybackRecord({itemId,kind,transport:"unknown",errorMessage:"Bu içerik için aktif paket gerekir."});
        if(userContext.isThreeHourTrial)return playback;
        // Only the updated web player advertises automatic direct-to-proxy fallback.
        // Cached older web bundles continue receiving the working proxy URL.
        if(rawQuery?.vodDirect !== "1" || rawQuery?.direct === "0" || rawQuery?.direct === false || audioTrackId || (preferTranscode && rawQuery?.preferTranscode !== undefined)) return playback;
        return buildBrowserDirectVodPlayback({kind,sourceUrl:source.url,credentials:userContext.iptvCredentials!,playback}) ?? playback;
      }
      const record =
        kind === "movie"
          ? await getMovieForPlayback(userContext.snapshotVersion, itemId)
          : await getEpisodeForPlayback(userContext.snapshotVersion, itemId);

      if (!record) {
        return reply.status(404).send({ message: kind === "movie" ? "Film bulunamadi." : "Bolum bulunamadi." });
      }

      if (!hasCurrentPlaybackAccess(userContext)) {
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
        (!playbackCredentials.primary && !playbackCredentials.fallback)
      ) {
        return buildDisabledVodPlaybackRecord({
          itemId,
          kind,
          transport: "unknown",
          errorMessage: "VOD kaynagi hazir degil."
        });
      }

      const personalDirectSourceUrl = buildPersonalVodSourceUrl(
        userContext.playbackBaseUrl,
        record.stream_path,
        playbackCredentials.primary,
        userContext.sharedReferenceCredentials
      );

      let canonicalDirectUrl: URL | null = null;
      try {
        canonicalDirectUrl = personalDirectSourceUrl ? new URL(personalDirectSourceUrl) : null;
      } catch {
        // Invalid provider URLs cannot be offered as browser direct playback.
      }
      const directExtension = canonicalDirectUrl?.pathname.match(/\.(m3u8|mp4|mkv)$/i)?.[1]?.toLowerCase();
      const directTransport = directExtension === "m3u8" ? "hls" : directExtension;
      if (
        clientRuntime === "browser" &&
        (rawQuery?.vodDirect === "1" || rawQuery?.direct === "1") &&
        rawQuery?.direct !== "0" &&
        canUseClientIpPlayback(userContext) &&
        canonicalDirectUrl?.protocol === "https:" &&
        personalDirectSourceUrl !== null &&
        hasCurrentPlaybackAccess(userContext)
      ) {
        if (directTransport !== "hls" && directTransport !== "mp4" && directTransport !== "mkv") {
          return buildDisabledVodPlaybackRecord({
            itemId,
            kind,
            transport: /\.avi$/i.test(canonicalDirectUrl.pathname) ? "avi" : "unknown",
            errorMessage: "Bu video formati tarayicida desteklenmiyor."
          });
        }
        return {
          ...buildDirectVodPlaybackFallback({
            itemId,
            kind,
            sourceUrl: personalDirectSourceUrl,
            transport: directTransport,
            isVerified: false
          }),
          deliveryMode: "direct_provider" as const,
          expiresAt: userContext.accessUntil
        };
      }

      let resolved: Awaited<ReturnType<typeof resolveVodSourceUrl>>;
      try {
        resolved = await resolveVodSourceUrl({
          baseUrl: userContext.playbackBaseUrl,
          streamPath: record.stream_path,
          primaryCredentials: playbackCredentials.primary,
          fallbackCredentials: playbackCredentials.fallback
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
          !userContext.isThreeHourTrial && personalDirectSourceUrl && hasCurrentPlaybackAccess(userContext) && canUseVodDirectPlaybackFallback({
            clientRuntime,
            platform,
            transport: guessVodTransportFromPath(record.stream_path),
            sourceUrl: personalDirectSourceUrl
          })
        ) {
          return buildDirectVodPlaybackFallback({
            itemId,
            kind,
            sourceUrl: personalDirectSourceUrl,
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
          !userContext.isThreeHourTrial && personalDirectSourceUrl && hasCurrentPlaybackAccess(userContext) && canUseVodDirectPlaybackFallback({
            clientRuntime,
            platform,
            transport: resolved.transport,
            sourceUrl: personalDirectSourceUrl
          })
        ) {
          return buildDirectVodPlaybackFallback({
            itemId,
            kind,
            sourceUrl: personalDirectSourceUrl,
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
          accessUntil: userContext.accessUntil,
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

      if (!hasCurrentPlaybackAccess(userContext)) {
        return buildDisabledVodPlaybackRecord({
          itemId,
          kind,
          transport: resolved.transport,
          errorMessage: "Bu icerigi oynatmak icin aktif paket gerekir."
        });
      }

      if (playback.canPlay) {
        return playback;
      }

      if (
        !userContext.isThreeHourTrial && personalDirectSourceUrl && hasCurrentPlaybackAccess(userContext) && canUseVodDirectPlaybackFallback({
          clientRuntime,
          platform,
          transport: resolved.transport,
          sourceUrl: personalDirectSourceUrl
        })
      ) {
        return buildDirectVodPlaybackFallback({
          itemId,
          kind,
          sourceUrl: personalDirectSourceUrl,
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
      const auth = await authenticateUser(request.headers.authorization, request);
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
      if (!hasCurrentPlaybackAccess(userContext)) {
        return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
      }
      const playbackCredentials = getScopedPlaybackCredentials(userContext);
      if (userContext.isThreeHourTrial && !playbackCredentials.primary) {
        return replyWithNativePlaybackError(reply, 403, "Deneme hatti hazir degil.");
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
        (!playbackCredentials.primary && !playbackCredentials.fallback)
      ) {
        return replyWithNativePlaybackError(reply, 503, "VOD kaynagi hazir degil.");
      }

      const personalDirectSourceUrl = buildPersonalVodSourceUrl(
        userContext.playbackBaseUrl,
        record.stream_path,
        playbackCredentials.primary,
        userContext.sharedReferenceCredentials
      );

      const resolved = await resolveVodSourceUrl({
        baseUrl: userContext.playbackBaseUrl,
        streamPath: record.stream_path,
        primaryCredentials: playbackCredentials.primary,
        fallbackCredentials: playbackCredentials.fallback
      });
      if (!hasCurrentPlaybackAccess(userContext)) {
        return replyWithNativePlaybackError(reply, 403, "Bu icerigi oynatmak icin aktif paket gerekir.");
      }

      const allowOptimisticNativeDirect =
        !userContext.isThreeHourTrial &&
        !resolved.ok &&
        typeof personalDirectSourceUrl === "string" &&
        canUseVodDirectPlaybackFallback({
          clientRuntime: "native",
          platform,
          transport: resolved.transport,
          sourceUrl: personalDirectSourceUrl
        });

      if ((!resolved.ok || !resolved.sourceUrl) && !allowOptimisticNativeDirect) {
        return replyWithNativePlaybackError(
          reply,
          resolved.sourceUrl ? 502 : 503,
          resolved.errorMessage ?? "VOD kaynagi dogrudan acilamadi."
        );
      }

      if (allowOptimisticNativeDirect && personalDirectSourceUrl) {
        return buildNativeVodPlaybackResponse({
          url: personalDirectSourceUrl,
          transport: resolved.transport,
          deliveryMode: "direct",
          audioTracks: [],
          defaultAudioTrackId: null,
          selectedAudioTrackId: null,
          cookie: resolved.cookie,
          isVerified: false,
          lastCheckedAt: null
        });
      }

      const baseOrigin = getRequestBaseOrigin(request);
      let playback: VodPlaybackRecord;
      try {
        playback = await vodPlaybackManager.createPlayback({
          userId: auth.userId,
          itemId,
          kind,
          sourceUrl: resolved.sourceUrl!,
          baseOrigin,
          clientRuntime: "native",
          platform,
          cookie: resolved.cookie,
          allowUnverifiedSource: resolved.isVerified === false,
          sourceTransportHint: resolved.transport,
          accessUntil: userContext.accessUntil,
          selectedAudioTrackId: audioTrackId
        });
      } catch (error) {
        request.log.warn(
          {
            err: error,
            itemId,
            kind,
            platform
          },
          "Native VOD playback manager error"
        );

        const message =
          error instanceof VodPlaybackUnavailableError && error.message.trim().length > 0
            ? error.message.trim()
            : "VOD akisi native playback icin hazirlanamadi.";

        playback = buildDisabledVodPlaybackRecord({
          itemId,
          kind,
          transport: resolved.transport,
          errorMessage: message
        });
      }

      const shouldFallbackToDirect =
        !userContext.isThreeHourTrial &&
        typeof personalDirectSourceUrl === "string" &&
        canUseVodDirectPlaybackFallback({
          clientRuntime: "native",
          platform,
          transport: resolved.transport,
          sourceUrl: personalDirectSourceUrl
        }) &&
        shouldRescueNativeVodToDirect(playback.errorMessage);

      if (shouldFallbackToDirect && personalDirectSourceUrl && hasCurrentPlaybackAccess(userContext)) {
        return buildNativeVodPlaybackResponse({
          url: personalDirectSourceUrl,
          transport: resolved.transport,
          deliveryMode: "direct",
          audioTracks: [],
          defaultAudioTrackId: null,
          selectedAudioTrackId: null,
          cookie: resolved.cookie,
          isVerified: false,
          lastCheckedAt: null
        });
      }

      if (playback.canPlay && playback.url && hasCurrentPlaybackAccess(userContext)) {
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

      return replyWithNativePlaybackError(
        reply,
        503,
        playback.errorMessage ?? "VOD kaynagi native playback icin hazirlanamadi."
      );
    } catch (error) {
      return sendUserRouteError(request, reply, error);
    }
  });

  app.post("/me/vod/:kind/:itemId/health", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization, request);
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

  app.post("/live/playback/:sessionId/release", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { token } = (request.query as { token?: string } | undefined) ?? {};
    const released = await livePlaybackManager.releaseViewer(sessionId, token);
    return released ? reply.status(204).send() : reply.status(404).send({ message: "Canli oturum bulunamadi." });
  });

  app.post("/me/payment-requests", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization, request);
      const payload = paymentRequestInputSchema.parse(request.body);

      if (isDemoMode) {
        createDemoPaymentRequest(auth.userId, payload.packageSlug, payload.paymentMethodId, payload.cryptoAssetId ?? null);
        return { ok: true };
      }

      await createPaymentRequest(auth.userId, payload.packageSlug, payload.paymentMethodId, payload.cryptoAssetId ?? null);
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
      const auth = await authenticateUser(request.headers.authorization, request);
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
      const auth = await authenticateUser(request.headers.authorization, request);
      const payload = trialRequestInputSchema.parse(request.body);

      if (isDemoMode) {
        createDemoTrialRequest(auth.userId, payload.note);
        return { ok: true };
      }

      await createTrialRequest(auth.userId, payload.note);
      return { ok: true };
    } catch (error) {
      if (error instanceof TrialUnavailableError) {
        return reply.status(409).send({ code: "TRIAL_UNAVAILABLE", message: "Deneme hakkı bu hesap için daha önce kullanılmış veya talep edilmiş. Paketleri inceleyebilirsin." });
      }
      if (isUserRouteAuthError(error)) {
        return sendUserRouteError(request, reply, error);
      }
      request.log.error(error);
      return reply.status(400).send({ message: "Deneme talebi olusturulamadi." });
    }
  });

  app.post("/admin/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string } | undefined;
    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;

    const configuredPassword = process.env.ADMIN_PASSWORD;
    if (!configuredPassword) {
      return reply.status(503).send({ message: "Yönetici girişi yapılandırılmadı." });
    }

    if (!email || !password) {
      return reply.status(400).send({ message: "E-posta ve şifre zorunludur." });
    }

    if (!env.adminEmails.includes(email)) {
      if (!checkRateLimit(createRateLimitKey("admin-login", request.ip || "unknown"), 5, 60_000)) {
        return reply.status(429).send({ message: "Çok fazla giriş denemesi. Bir dakika sonra tekrar deneyin." });
      }
      return reply.status(401).send({ message: "Yetkisiz e-posta adresi." });
    }

    const enteredDigest = crypto.createHash("sha256").update(password).digest();
    const expectedDigest = crypto.createHash("sha256").update(configuredPassword).digest();
    if (!crypto.timingSafeEqual(enteredDigest, expectedDigest)) {
      if (!checkRateLimit(createRateLimitKey("admin-login", request.ip || "unknown"), 5, 60_000)) {
        return reply.status(429).send({ message: "Çok fazla giriş denemesi. Bir dakika sonra tekrar deneyin." });
      }
      return reply.status(401).send({ message: "Hatalı şifre." });
    }

    const token = await signAdminToken({ email });
    return {
      accessToken: token,
      email
    };
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

function isDirectExecution() {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return path.resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
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
}
