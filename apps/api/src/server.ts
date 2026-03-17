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
  livePlaybackEventInputSchema,
  loginByCodeInputSchema,
  paginationQuerySchema,
  paymentRequestInputSchema,
  refreshInputSchema,
  registerAnonInputSchema,
  trialRequestInputSchema
} from "@flixify/contracts";
import type { LiveTransport } from "@flixify/contracts";
import {
  activateSubscription,
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
  revokeSession,
  storePlainKryptoniteCode,
  softDeleteUser,
  touchDeviceSession,
  updateLiveChannelHealth,
  updateAppSettings,
  updateAdminUser,
  updatePackageStatus,
  updateUserLogin,
  updateUserStatus
} from "./repository.js";
import {
  activateDemoSubscription,
  getDemoAdminDashboard,
  getDemoAdminUserDetail,
  assignDemoM3USource,
  createDemoPaymentRequest,
  createDemoTrialRequest,
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
import { probeLiveStream } from "./live.js";
import { createLivePlaybackManager } from "./live-playback.js";
import { createVodPlaybackManager, probeVodStream } from "./vod.js";
import { API_CORS_CONFIG } from "./cors-config.js";
import { stripEmptyJsonContentType } from "./http-headers.js";

type UserRequest = {
  userId: string;
  sessionId: string;
};

type AdminRequest = {
  adminId: string;
  email: string | null;
};

type PlaybackCredentials = {
  username: string;
  password: string;
};

const isDemoMode = env.APP_DEMO_MODE;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
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
  sessionTtlMs: env.VOD_PLAYBACK_TTL_SECONDS * 1000,
  tempRoot: env.VOD_PLAYBACK_TEMP_DIR
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

function isBlockedError(error: unknown) {
  return error instanceof Error && error.message === "Blocked";
}

function sendUserAuthError(reply: FastifyReply, error: unknown) {
  if (isBlockedError(error)) {
    return reply.status(403).send({ message: "Kullanici engellendi. Destek ekibi ile iletisim kurun." });
  }

  return reply.status(401).send({ message: "Yetkisiz." });
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

function sameCredentials(
  left: PlaybackCredentials | null | undefined,
  right: PlaybackCredentials | null | undefined
) {
  if (!left || !right) {
    return false;
  }

  return left.username === right.username && left.password === right.password;
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

  if (fallbackCredentials && !candidates.some((item) => sameCredentials(item, fallbackCredentials))) {
    candidates.push(fallbackCredentials);
  }

  return candidates.map((credentials) => ({
    credentials,
    url: buildStreamUrl(baseUrl, credentials.username, credentials.password, streamPath)
  }));
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

function shouldAllowDirectVodFallback(errorMessage: string | null | undefined) {
  if (typeof errorMessage !== "string") {
    return false;
  }

  const normalized = errorMessage.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/^upstream\s+(401|403|404|410|429|5\d\d)$/i.test(normalized)) {
    return true;
  }

  return (
    normalized.includes("html donuyor") ||
    normalized.includes("akistan veri okunamadi") ||
    normalized.includes("dogrulanamadi")
  );
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
      errorMessage: "Canli yayin kimlik bilgileri eksik."
    };
  }

  let lastError = "Canli yayin kaynagi dogrulanamadi.";
  let lastTransport = input.fallbackTransport;

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
        errorMessage: null
      };
    }
    lastError = probe.errorMessage ?? lastError;
  }

  return {
    ok: false,
    sourceUrl: candidates[0]?.url ?? null,
    transport: lastTransport,
    errorMessage: lastError
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
      errorMessage: "VOD kimlik bilgileri eksik."
    };
  }

  let lastError = "VOD kaynagi dogrulanamadi.";
  let lastTransport = "unknown" as const;

  for (const candidate of candidates) {
    const probe = await probeVodStream(candidate.url);
    lastTransport = probe.transport;
    if (probe.ok) {
      return {
        ok: true,
        sourceUrl: candidate.url,
        transport: probe.transport,
        errorMessage: null
      };
    }
    lastError = probe.errorMessage ?? lastError;
  }

  return {
    ok: false,
    sourceUrl: candidates[0]?.url ?? null,
    transport: lastTransport,
    errorMessage: lastError
  };
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
    throw new Error("Unauthorized");
  }

  const payload = await verifyAccessToken(token);
  if (!payload.sub || !payload.sid) {
    throw new Error("Unauthorized");
  }

  if (isDemoMode) {
    const me = getDemoMe(payload.sub);
    if (!me || me.user.status === "blocked") {
      throw new Error("Blocked");
    }

    const session = getDemoSession(payload.sid, payload.sub);
    if (!session) {
      throw new Error("Unauthorized");
    }

    return {
      userId: payload.sub,
      sessionId: payload.sid
    };
  }

  const userStatus = await getUserStatus(payload.sub);
  if (!userStatus || userStatus === "blocked") {
    throw new Error("Blocked");
  }

  const session = await getSessionById(payload.sid);
  if (!session || session.revoked_at || session.user_id !== payload.sub) {
    throw new Error("Unauthorized");
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
        return reply.status(401).send({ message: "Oturum yenilenemedi." });
      }
      return session;
    }

    let sessionId = "";

    const token = payload.refreshToken;
    const [encodedSessionId] = token.split(".");
    sessionId = encodedSessionId || "";
    if (!sessionId) {
      return reply.status(401).send({ message: "Refresh token gecersiz." });
    }

    const session = await getSessionById(sessionId);
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
      return reply.status(401).send({ message: "Oturum yenilenemedi." });
    }

    const userStatus = await getUserStatus(session.user_id);
    if (!userStatus || userStatus === "blocked") {
      return reply.status(403).send({ message: "Kullanici engellendi. Destek ile iletisime gecin." });
    }

    const rawSecret = token.slice(sessionId.length + 1);
    const matches = await verifySecret(rawSecret, session.refresh_token_hash);
    if (!matches) {
      return reply.status(401).send({ message: "Oturum yenilenemedi." });
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
    }
  });

  app.get("/me/live/:channelId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
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
        rawQuery?.preferRelay === true ||
        rawQuery?.preferRelay === "true" ||
        rawQuery?.preferRelay === "1";
      const preferTranscode =
        rawQuery?.preferTranscode === true ||
        rawQuery?.preferTranscode === "true" ||
        rawQuery?.preferTranscode === "1";

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
        return livePlaybackManager.createPlayback({
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
      }

      const userContext = await getUserContext(auth.userId);
      if (!userContext.canViewCatalog) {
        return reply.status(403).send({ message: "Icerik baglantisi atanmadi." });
      }

      const channel = await getLiveChannelForPlayback(userContext.snapshotVersion, channelId);
      if (!channel) {
        return reply.status(404).send({ message: "Canli kanal bulunamadi." });
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
        typeof upstreamStatus === "number" && upstreamStatus >= 400 && upstreamStatus < 500;
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
        upstreamStatus >= 400 &&
        upstreamStatus < 500;

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

      if (optimisticProbeFallback && resolved.sourceUrl) {
        return {
          channelId,
          url: resolved.sourceUrl,
          transport,
          sourceTransport: transport,
          deliveryMode: transport === "hls" ? "hls_proxy" : "file_proxy",
          diagnosticsSessionId: null,
          healthStatus,
          lastCheckedAt: checkedAt,
          expiresAt: null,
          canPlay: true,
          isVerified: false,
          errorMessage: null
        };
      }

      const playback = await livePlaybackManager.createPlayback({
        channelId,
        snapshotVersion: channel.snapshot_version,
        sourceUrl: canPlay ? resolved.sourceUrl : null,
        baseOrigin: getRequestBaseOrigin(request),
        sourceTransport: transport,
        healthStatus,
        lastCheckedAt: checkedAt,
        canPlay,
        isVerified: resolved.ok,
        errorMessage: canPlay ? null : errorMessage ?? "Canli yayin gecici olarak kullanilamiyor.",
        forceRelayRestart,
        allowFileProxyFallback: debugFileProxy,
        preferDirectProxy: !preferRelay,
        preferTranscode
      });

      if (!playback.canPlay) {
        await updateLiveChannelHealth(channel.id, channel.snapshot_version, {
          status: "degraded",
          errorMessage: playback.errorMessage ?? "Canli relay hazirlanamadi.",
          touchPlaybackRequest: true
        });
      }

      return playback;
    } catch (error) {
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
    }
  });

  app.get("/me/vod/:kind/:itemId/playback", async (request, reply) => {
    try {
      const auth = await authenticateUser(request.headers.authorization);
      const { kind, itemId } = request.params as { kind: string; itemId: string };
      const rawQuery = request.query as Record<string, unknown> | undefined;
      const debugVod =
        rawQuery?.debugVod === true ||
        rawQuery?.debugVod === "true" ||
        rawQuery?.debugVod === "1";
      const preferTranscode =
        rawQuery?.preferTranscode === true ||
        rawQuery?.preferTranscode === "true" ||
        rawQuery?.preferTranscode === "1";

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
          deliveryMode: "file_proxy",
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
        return {
          itemId,
          kind,
          url: null,
          transport: "unknown",
          deliveryMode: "file_proxy",
          expiresAt: null,
          canPlay: false,
          isVerified: false,
          errorMessage: "VOD kaynagi hazir degil."
        };
      }

      const resolved = await resolveVodSourceUrl({
        baseUrl: userContext.playbackBaseUrl,
        streamPath: record.stream_path,
        primaryCredentials: userContext.iptvCredentials,
        fallbackCredentials: userContext.sharedReferenceCredentials
      });

      if (!resolved.ok || !resolved.sourceUrl) {
        if (resolved.sourceUrl && shouldAllowDirectVodFallback(resolved.errorMessage)) {
          return {
            itemId,
            kind,
            url: resolved.sourceUrl,
            transport: resolved.transport,
            deliveryMode: "file_proxy",
            expiresAt: null,
            canPlay: true,
            isVerified: false,
            errorMessage: null
          };
        }

        return {
          itemId,
          kind,
          url: null,
          transport: resolved.transport,
          deliveryMode: "file_proxy",
          expiresAt: null,
          canPlay: false,
          isVerified: false,
          errorMessage: resolved.errorMessage ?? "VOD kaynagi hazir degil."
        };
      }

      return vodPlaybackManager.createPlayback({
        userId: auth.userId,
        itemId,
        kind,
        sourceUrl: resolved.sourceUrl,
        baseOrigin,
        debug: debugVod,
        preferTranscode
      });
    } catch (error) {
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      if (error instanceof Error && (error.message === "Unauthorized" || error.message === "Blocked")) {
        return sendUserAuthError(reply, error);
      }
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
      request.log.error(error);
      return sendUserAuthError(reply, error);
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
      request.log.error(error);
      if (error instanceof Error && (error.message === "Unauthorized" || error.message === "Blocked")) {
        return sendUserAuthError(reply, error);
      }
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
        updateDemoPackageStatus(packageId, payload.isActive);
        return { ok: true };
      }

      await updatePackageStatus(packageId, payload.isActive, admin.adminId);
      return { ok: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(400).send({ message: "Paket durumu guncellenemedi." });
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
