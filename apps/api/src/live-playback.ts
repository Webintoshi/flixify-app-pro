import crypto from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import type {
  LiveDeliveryMode,
  LiveHealthStatus,
  LivePlaybackRecord,
  LiveTransport
} from "@flixify/contracts";

const DEFAULT_REQUEST_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  accept: "*/*",
  "accept-encoding": "identity"
};

const LIVE_NO_CACHE_HEADER = "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0, no-transform";
const RETRYABLE_UPSTREAM_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const HARD_FAIL_UPSTREAM_STATUS_CODES = new Set([400, 401, 403, 404, 410, 422]);
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_FETCH_ATTEMPTS = 3;
const MAX_FETCH_ATTEMPTS = 5;
const LIVE_MANIFEST_FETCH_POLICY = { timeoutMs: 5_000, maxAttempts: 3, initialBackoffMs: 220, maxBackoffMs: 1_100 };
const LIVE_SEGMENT_FETCH_POLICY = { timeoutMs: 9_000, maxAttempts: 4, initialBackoffMs: 280, maxBackoffMs: 2_000 };
const LIVE_FILE_FETCH_POLICY = { timeoutMs: 12_000, maxAttempts: 3, initialBackoffMs: 320, maxBackoffMs: 2_500 };
const DEFAULT_FETCH_POLICY = {
  timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  maxAttempts: DEFAULT_FETCH_ATTEMPTS,
  initialBackoffMs: 300,
  maxBackoffMs: 2_000
};

export function getContentLengthFromContentRange(contentRange: string | null) {
  if (!contentRange) {
    return null;
  }

  const match = /^bytes\s+(\d+)-(\d+)\/(?:\d+|\*)$/i.exec(contentRange.trim());
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  return String(end - start + 1);
}

type HlsProxyState = {
  rootUrl: string;
  assetToUrl: Map<string, string>;
  urlToAsset: Map<string, string>;
};

type LocalHlsState = {
  tempDir: string;
  manifestPath: string;
  process: ChildProcessWithoutNullStreams | null;
  mode: "copy" | "transcode" | null;
  preferTranscode: boolean;
  lastError: string | null;
  restartPromise: Promise<{ ok: boolean; errorMessage: string | null }> | null;
  restartCount: number;
  lastManifestSequence: number | null;
  lastManifestAdvanceAt: number | null;
  lastSegmentAt: number | null;
};

type ViewerLease = {
  token: string;
  diagnosticsSessionId: string;
  expiresAt: number;
  lastSeenAt: number;
};

type LiveRelaySession = {
  id: string;
  channelId: string;
  snapshotVersion: number;
  baseOrigin: string;
  sourceUrl: string;
  sourceTransport: LiveTransport;
  deliveryMode: LiveDeliveryMode;
  healthStatus: LiveHealthStatus;
  lastCheckedAt: string | null;
  isVerified: boolean;
  expiresAt: number;
  lastViewerAt: number;
  viewers: Map<string, ViewerLease>;
  proxyState: HlsProxyState | null;
  localState: LocalHlsState | null;
};

type LivePlaybackManagerOptions = {
  ffmpegBinary: string;
  sessionTtlMs: number;
  tempRoot?: string;
  onDiagnostic?: (input: {
    channelId: string;
    snapshotVersion: number;
    diagnosticsSessionId?: string | null;
    event: string;
    deliveryMode?: LiveDeliveryMode | null;
    sourceTransport?: LiveTransport | null;
    playerEngine?: string | null;
    stallReason?: string | null;
    errorCode?: string | null;
    upstreamStatus?: number | null;
    errorMessage?: string | null;
    detail?: Record<string, unknown> | null;
  }) => Promise<void> | void;
};

type CreateLivePlaybackInput = {
  channelId: string;
  snapshotVersion: number;
  sourceUrl: string | null;
  baseOrigin: string;
  sourceTransport: LiveTransport;
  healthStatus: LiveHealthStatus;
  lastCheckedAt: string | null;
  canPlay: boolean;
  isVerified: boolean;
  errorMessage: string | null;
  forceRelayRestart?: boolean;
  allowFileProxyFallback?: boolean;
  preferDirectProxy?: boolean;
  preferTranscode?: boolean;
};

type FetchUpstreamOptions = {
  rangeHeader?: string | null;
  timeoutMs?: number;
  maxAttempts?: number;
  kind?: "manifest" | "segment" | "file";
};

function isAuthorizedToken(expected: string, provided: string | undefined | null) {
  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

function createSessionUrl(baseOrigin: string, session: LiveRelaySession, viewerToken: string) {
  return `${baseOrigin}/live/playback/${session.id}/master.m3u8?token=${encodeURIComponent(viewerToken)}`;
}

function createFileUrl(baseOrigin: string, session: LiveRelaySession, viewerToken: string) {
  return `${baseOrigin}/live/playback/${session.id}/file?token=${encodeURIComponent(viewerToken)}`;
}

function sanitizeLocalAssetName(fileName: string) {
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) {
    return null;
  }

  return fileName;
}

function getLocalContentType(filePath: string) {
  if (filePath.endsWith(".m3u8")) {
    return "application/vnd.apple.mpegurl";
  }

  if (filePath.endsWith(".ts")) {
    return "video/mp2t";
  }

  return "application/octet-stream";
}

function manifestLineExists(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !line.startsWith("#"));
}

export function parseManifestState(content: string) {
  const mediaSequenceMatch = /^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m.exec(content);
  const mediaSequence = mediaSequenceMatch ? Number(mediaSequenceMatch[1]) : null;
  const segmentCount = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#")).length;

  return {
    mediaSequence: Number.isFinite(mediaSequence) ? mediaSequence : null,
    segmentCount
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error: unknown) {
  if (error instanceof TypeError) {
    return true;
  }

  if (typeof error === "object" && error !== null && "name" in error) {
    return (error as { name?: string }).name === "AbortError";
  }

  return false;
}

function shouldRetryUpstreamStatus(statusCode: number) {
  return RETRYABLE_UPSTREAM_STATUS_CODES.has(statusCode);
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const numericSeconds = Number(normalized);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return Math.min(5_000, Math.round(numericSeconds * 1_000));
  }

  const retryAtMs = Date.parse(normalized);
  if (!Number.isFinite(retryAtMs)) {
    return null;
  }

  return Math.min(5_000, Math.max(0, retryAtMs - Date.now()));
}

function computeRetryDelayMs(
  attempt: number,
  policy: { initialBackoffMs: number; maxBackoffMs: number },
  retryAfterMs: number | null
) {
  const exponentialDelay = Math.min(policy.maxBackoffMs, policy.initialBackoffMs * Math.pow(2, attempt - 1));
  if (retryAfterMs === null) {
    return exponentialDelay;
  }
  return Math.min(policy.maxBackoffMs, Math.max(exponentialDelay, retryAfterMs));
}

function getUpstreamErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const normalized = error.message.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return fallback;
}

async function waitForFile(
  filePath: string,
  timeoutMs: number,
  predicate?: (content: string) => boolean
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    try {
      if (!predicate) {
        const stats = await fsp.stat(filePath);
        if (stats.size > 0) {
          return true;
        }
      } else {
        const content = await fsp.readFile(filePath, "utf8");
        if (predicate(content)) {
          return true;
        }
      }
    } catch {
      // File may not be ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return false;
}

async function removeDirectory(dirPath: string) {
  await fsp.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
}

function rewriteProxyManifest(content: string, parentUrl: string, session: LiveRelaySession, viewerToken: string) {
  if (!session.proxyState) {
    return content;
  }

  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }

      const absoluteUrl = new URL(trimmed, parentUrl).toString();
      const existingAsset = session.proxyState.urlToAsset.get(absoluteUrl);
      if (existingAsset) {
        return `${session.baseOrigin}/live/playback/${session.id}/assets/${existingAsset}?token=${encodeURIComponent(viewerToken)}`;
      }

      const assetId = crypto.randomBytes(12).toString("base64url");
      session.proxyState.urlToAsset.set(absoluteUrl, assetId);
      session.proxyState.assetToUrl.set(assetId, absoluteUrl);
      return `${session.baseOrigin}/live/playback/${session.id}/assets/${assetId}?token=${encodeURIComponent(viewerToken)}`;
    })
    .join("\n");
}

function rewriteLocalManifest(content: string, session: LiveRelaySession, viewerToken: string) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }

      return `${session.baseOrigin}/live/playback/${session.id}/files/${encodeURIComponent(trimmed)}?token=${encodeURIComponent(viewerToken)}`;
    })
    .join("\n");
}

async function streamFetchResponse(reply: FastifyReply, response: Response) {
  if (!response.body) {
    return reply.status(502).type("text/plain; charset=utf-8").send("Upstream akis okunamadi.");
  }

  const contentType = response.headers.get("content-type");
  const contentRange = response.headers.get("content-range");
  const contentEncoding = response.headers.get("content-encoding");

  if (contentType) {
    reply.header("content-type", contentType);
  }
  if (contentRange) {
    reply.header("content-range", contentRange);
    reply.status(206);
  }
  if (!contentEncoding || contentEncoding.toLowerCase() === "identity") {
    const nextContentLength = getContentLengthFromContentRange(contentRange);
    if (nextContentLength) {
      reply.header("content-length", nextContentLength);
    }
  }
  reply.header("cache-control", LIVE_NO_CACHE_HEADER);
  reply.header("pragma", "no-cache");
  reply.header("expires", "0");
  reply.header("surrogate-control", "no-store");
  reply.header("accept-ranges", "bytes");

  return reply.send(Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>));
}

function createDisabledPlaybackRecord(input: {
  channelId: string;
  sourceTransport: LiveTransport;
  healthStatus: LiveHealthStatus;
  lastCheckedAt: string | null;
  errorMessage: string;
}): LivePlaybackRecord {
  return {
    channelId: input.channelId,
    url: null,
    transport: input.sourceTransport,
    sourceTransport: input.sourceTransport,
    deliveryMode: input.sourceTransport === "hls" ? "hls_proxy" : "file_proxy",
    diagnosticsSessionId: null,
    healthStatus: input.healthStatus,
    lastCheckedAt: input.lastCheckedAt,
    expiresAt: null,
    canPlay: false,
    isVerified: false,
    errorMessage: input.errorMessage
  };
}

function buildReadyPlaybackRecord(session: LiveRelaySession, viewer: ViewerLease): LivePlaybackRecord {
  return {
    channelId: session.channelId,
    url:
      session.deliveryMode === "file_proxy"
        ? createFileUrl(session.baseOrigin, session, viewer.token)
        : createSessionUrl(session.baseOrigin, session, viewer.token),
    transport: session.deliveryMode === "file_proxy" ? session.sourceTransport : "hls",
    sourceTransport: session.sourceTransport,
    deliveryMode: session.deliveryMode,
    diagnosticsSessionId: viewer.diagnosticsSessionId,
    healthStatus: session.healthStatus,
    lastCheckedAt: session.lastCheckedAt,
    expiresAt: new Date(viewer.expiresAt).toISOString(),
    canPlay: true,
    isVerified: session.isVerified,
    errorMessage: null
  };
}

function buildRelayDetail(session: LiveRelaySession, extra?: Record<string, unknown> | null) {
  return {
    viewerCount: session.viewers.size,
    ffmpegMode: session.localState?.mode ?? null,
    ffmpegRestartCount: session.localState?.restartCount ?? 0,
    lastManifestSequence: session.localState?.lastManifestSequence ?? null,
    playlistAgeMs:
      session.localState?.lastManifestAdvanceAt ? Date.now() - session.localState.lastManifestAdvanceAt : null,
    lastSegmentAt: session.localState?.lastSegmentAt
      ? new Date(session.localState.lastSegmentAt).toISOString()
      : null,
    relayAttempted: session.deliveryMode !== "file_proxy",
    relayResult: session.deliveryMode === "file_proxy" ? "direct" : "relay",
    ...(extra ?? {})
  };
}

function createFfmpegArgs(sourceUrl: string, outputDir: string, transcode: boolean) {
  const segmentPattern = path.join(outputDir, "segment-%05d.ts");
  const manifestPath = path.join(outputDir, "index.m3u8");
  const baseArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-fflags",
    "+discardcorrupt+genpts",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_at_eof",
    "1",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_on_http_error",
    "4xx,5xx",
    "-reconnect_max_retries",
    "12",
    "-reconnect_delay_max",
    "10",
    "-reconnect_delay_total_max",
    "120",
    "-respect_retry_after",
    "1",
    "-rw_timeout",
    "20000000",
    "-thread_queue_size",
    "4096",
    "-analyzeduration",
    "8M",
    "-probesize",
    "8M",
    "-i",
    sourceUrl,
    "-map",
    "0:v:0?",
    "-map",
    "0:a:0?",
    "-dn",
    "-sn"
  ];

  const codecArgs = transcode
    ? [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "48",
        "-keyint_min",
        "48",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-b:a",
        "160k"
      ]
    : ["-c", "copy"];

  return [
    ...baseArgs,
    ...codecArgs,
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-flush_packets",
    "1",
    "-max_muxing_queue_size",
    "4096",
    "-start_number",
    "0",
    "-hls_time",
    "4",
    "-hls_list_size",
    "30",
    "-hls_delete_threshold",
    "12",
    "-hls_segment_type",
    "mpegts",
    "-hls_flags",
    "delete_segments+append_list+omit_endlist+independent_segments+program_date_time+temp_file",
    "-hls_allow_cache",
    "0",
    "-hls_segment_filename",
    segmentPattern,
    "-f",
    "hls",
    manifestPath
  ];
}

function trimErrorMessage(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

export function createLivePlaybackManager(options: LivePlaybackManagerOptions) {
  const sessions = new Map<string, LiveRelaySession>();
  const sessionIdsByChannel = new Map<string, string>();
  const sessionTtlMs = Math.max(options.sessionTtlMs, 60_000);
  const tempRoot = options.tempRoot ?? path.join(os.tmpdir(), "flixify-live");
  let ffmpegAvailablePromise: Promise<boolean> | null = null;

  async function emitDiagnostic(input: {
    channelId: string;
    snapshotVersion: number;
    diagnosticsSessionId?: string | null;
    event: string;
    deliveryMode?: LiveDeliveryMode | null;
    sourceTransport?: LiveTransport | null;
    playerEngine?: string | null;
    stallReason?: string | null;
    errorCode?: string | null;
    upstreamStatus?: number | null;
    errorMessage?: string | null;
    detail?: Record<string, unknown> | null;
  }) {
    try {
      await options.onDiagnostic?.(input);
    } catch {
      // Diagnostics should not break playback.
    }
  }

  function checkFfmpegAvailability() {
    if (!ffmpegAvailablePromise) {
      ffmpegAvailablePromise = new Promise<boolean>((resolve) => {
        const child = spawn(options.ffmpegBinary, ["-version"], {
          stdio: ["ignore", "ignore", "ignore"]
        });

        child.once("error", () => resolve(false));
        child.once("close", (code) => resolve(code === 0));
      }).then((available) => {
        if (!available) {
          console.warn(`[live-playback] FFmpeg kullanilamadi: ${options.ffmpegBinary}`);
        }
        return available;
      });
    }

    return ffmpegAvailablePromise;
  }

  void checkFfmpegAvailability();
  void fsp.mkdir(tempRoot, { recursive: true }).catch(() => undefined);

  async function destroySession(session: LiveRelaySession) {
    sessions.delete(session.id);
    if (sessionIdsByChannel.get(session.channelId) === session.id) {
      sessionIdsByChannel.delete(session.channelId);
    }
    if (session.localState?.process && !session.localState.process.killed) {
      session.localState.process.kill("SIGKILL");
    }
    if (session.localState?.tempDir) {
      await removeDirectory(session.localState.tempDir);
    }
  }

  function touchViewer(session: LiveRelaySession, viewer: ViewerLease) {
    const nextExpiry = Date.now() + sessionTtlMs;
    viewer.expiresAt = nextExpiry;
    viewer.lastSeenAt = Date.now();
    session.expiresAt = nextExpiry;
    session.lastViewerAt = viewer.lastSeenAt;
  }

  async function cleanupExpiredSessions() {
    const now = Date.now();

    for (const session of sessions.values()) {
      for (const [token, viewer] of session.viewers.entries()) {
        if (viewer.expiresAt <= now) {
          session.viewers.delete(token);
        }
      }

      if (session.viewers.size === 0 && session.expiresAt <= now) {
        await destroySession(session);
      }
    }
  }

  const cleanupTimer = setInterval(() => {
    void cleanupExpiredSessions();
  }, 60_000);
  cleanupTimer.unref();

  function authorizeViewer(sessionId: string, token: string | undefined | null) {
    const session = sessions.get(sessionId);
    if (!session || !token) {
      return null;
    }

    const viewer = session.viewers.get(token);
    if (!viewer || !isAuthorizedToken(viewer.token, token)) {
      return null;
    }

    if (viewer.expiresAt <= Date.now()) {
      session.viewers.delete(token);
      return null;
    }

    touchViewer(session, viewer);
    return { session, viewer };
  }

  async function fetchUpstream(url: string, options: FetchUpstreamOptions = {}) {
    const headers: Record<string, string> = {
      ...DEFAULT_REQUEST_HEADERS
    };

    if (options.rangeHeader) {
      headers.range = options.rangeHeader;
    }

    if (options.kind === "manifest" || options.kind === "segment" || options.kind === "file") {
      headers["cache-control"] = "no-cache";
      headers.pragma = "no-cache";
    }

    const defaultPolicy =
      options.kind === "manifest"
        ? LIVE_MANIFEST_FETCH_POLICY
        : options.kind === "segment"
          ? LIVE_SEGMENT_FETCH_POLICY
          : options.kind === "file"
            ? LIVE_FILE_FETCH_POLICY
            : DEFAULT_FETCH_POLICY;
    const timeoutMs =
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
        ? Math.max(1_500, options.timeoutMs)
        : defaultPolicy.timeoutMs;
    const maxAttempts =
      typeof options.maxAttempts === "number" && Number.isFinite(options.maxAttempts)
        ? Math.max(1, Math.min(MAX_FETCH_ATTEMPTS, Math.floor(options.maxAttempts)))
        : defaultPolicy.maxAttempts;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetch(url, {
          headers,
          redirect: "follow",
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (HARD_FAIL_UPSTREAM_STATUS_CODES.has(response.status)) {
          return response;
        }

        if (attempt < maxAttempts && shouldRetryUpstreamStatus(response.status)) {
          if (response.body) {
            await response.body.cancel().catch(() => undefined);
          }
          const retryDelayMs = computeRetryDelayMs(
            attempt,
            defaultPolicy,
            parseRetryAfterMs(response.headers.get("retry-after"))
          );
          await sleep(retryDelayMs);
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableNetworkError(error)) {
          throw error;
        }
        await sleep(computeRetryDelayMs(attempt, defaultPolicy, null));
      }
    }

    throw lastError ?? new Error("Upstream fetch basarisiz.");
  }

  async function startFfmpegPipeline(session: LiveRelaySession, transcode: boolean) {
    if (!session.localState) {
      return {
        ok: false,
        errorMessage: "Local relay state bulunamadi."
      };
    }

    await removeDirectory(session.localState.tempDir);
    await fsp.mkdir(session.localState.tempDir, { recursive: true });

    const args = createFfmpegArgs(session.sourceUrl, session.localState.tempDir, transcode);
    let stderrOutput = "";

    const child = spawn(options.ffmpegBinary, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput = `${stderrOutput}${chunk.toString("utf8")}`.slice(-12_000);
    });

    session.localState.process = child;
    session.localState.mode = transcode ? "transcode" : "copy";
    session.localState.lastError = null;

    const ready = await Promise.race([
      waitForFile(session.localState.manifestPath, 15_000, manifestLineExists),
      new Promise<boolean>((resolve) => {
        child.once("error", () => resolve(false));
        child.once("close", () => resolve(false));
      })
    ]);

    if (!ready) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      session.localState.process = null;
      session.localState.lastError = trimErrorMessage(
        stderrOutput,
        transcode ? "Canli relay transcode baslatilamadi." : "Canli relay transmux baslatilamadi."
      );
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        event: "relay-error",
        deliveryMode: transcode ? "hls_transcoded" : "hls_transmuxed",
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        errorCode: "ffmpeg-start-failed",
        errorMessage: session.localState.lastError,
        detail: buildRelayDetail(session, {
          attemptedMode: transcode ? "transcode" : "copy"
        })
      });
      return {
        ok: false,
        errorMessage: session.localState.lastError
      };
    }

    child.on("close", (code) => {
      if (session.localState?.process === child) {
        session.localState.process = null;
      }
      if (code && session.localState) {
        session.localState.lastError = trimErrorMessage(stderrOutput, `FFmpeg cikis kodu ${code}`);
        void emitDiagnostic({
          channelId: session.channelId,
          snapshotVersion: session.snapshotVersion,
          event: "relay-error",
          deliveryMode: session.deliveryMode,
          sourceTransport: session.sourceTransport,
          playerEngine: "relay",
          errorCode: "ffmpeg-exit",
          errorMessage: session.localState.lastError,
          detail: buildRelayDetail(session, {
            exitCode: code
          })
        });
      }
    });

    child.on("error", (error) => {
      if (session.localState) {
        session.localState.lastError = error.message;
        session.localState.process = null;
      }
      void emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        event: "relay-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        errorCode: "ffmpeg-process-error",
        errorMessage: error.message
      });
    });

    await emitDiagnostic({
      channelId: session.channelId,
      snapshotVersion: session.snapshotVersion,
      event: "relay-ready",
      deliveryMode: transcode ? "hls_transcoded" : "hls_transmuxed",
      sourceTransport: session.sourceTransport,
      playerEngine: "relay",
      detail: buildRelayDetail(session, {
        mode: transcode ? "transcode" : "copy"
      })
    });

    return {
      ok: true,
      errorMessage: null
    };
  }

  async function prepareLocalSession(session: LiveRelaySession) {
    if (!session.localState) {
      return {
        ok: false,
        errorMessage: "Canli relay oturumu bulunamadi."
      };
    }

    const shouldPreferTranscode =
      session.localState?.preferTranscode === true ||
      (session.localState?.restartCount ?? 0) >= 2 ||
      session.localState?.mode === "transcode";
    const attempts = shouldPreferTranscode ? [true, false] : [false, true];
    let lastFailure = {
      ok: false,
      errorMessage: "Canli relay hazirlanamadi."
    };

    for (const transcode of attempts) {
      const attempt = await startFfmpegPipeline(session, transcode);
      if (attempt.ok) {
        session.deliveryMode = transcode ? "hls_transcoded" : "hls_transmuxed";
        return attempt;
      }
      lastFailure = attempt;
    }

    return {
      ok: false,
      errorMessage: lastFailure.errorMessage ?? "Canli relay hazirlanamadi."
    };
  }

  async function ensureLocalRelay(session: LiveRelaySession) {
    if (!session.localState) {
      return {
        ok: false,
        errorMessage: "Canli local relay bulunamadi."
      };
    }

    if (session.localState.restartPromise) {
      return session.localState.restartPromise;
    }

    const manifestReady = await waitForFile(session.localState.manifestPath, 100, manifestLineExists);
    let manifestFresh = false;

    if (manifestReady) {
      try {
        const stats = await fsp.stat(session.localState.manifestPath);
        manifestFresh = Date.now() - stats.mtimeMs <= 12_000;
      } catch {
        manifestFresh = false;
      }
    }

    if (session.localState.process && manifestReady && manifestFresh) {
      return {
        ok: true,
        errorMessage: null
      };
    }

    session.localState.restartPromise = (async () => {
      if (session.localState?.process && !session.localState.process.killed) {
        session.localState.process.kill("SIGKILL");
        session.localState.process = null;
      }
      if (session.localState) {
        session.localState.restartCount += 1;
      }

      return prepareLocalSession(session);
    })().finally(() => {
      if (session.localState) {
        session.localState.restartPromise = null;
      }
    });

    return session.localState.restartPromise;
  }

  async function createPlayback(input: CreateLivePlaybackInput): Promise<LivePlaybackRecord> {
    if (!input.canPlay || !input.sourceUrl) {
      return createDisabledPlaybackRecord({
        channelId: input.channelId,
        sourceTransport: input.sourceTransport,
        healthStatus: input.healthStatus,
        lastCheckedAt: input.lastCheckedAt,
        errorMessage: input.errorMessage ?? "Canli yayin gecici olarak kullanilamiyor."
      });
    }

    const preferDirectProxy = input.preferDirectProxy !== false;
    const wantsRelay = input.sourceTransport !== "hls" && !preferDirectProxy;

    let session = (() => {
      const existingSessionId = sessionIdsByChannel.get(input.channelId);
      return existingSessionId ? sessions.get(existingSessionId) ?? null : null;
    })();

    const needsFreshSession =
      !session ||
      session.sourceUrl !== input.sourceUrl ||
      session.sourceTransport !== input.sourceTransport ||
      (wantsRelay && session.localState === null && input.sourceTransport !== "hls") ||
      (!wantsRelay && session.localState !== null) ||
      (session.localState !== null &&
        input.preferTranscode === true &&
        session.localState.mode !== "transcode") ||
      (session.localState !== null && session.localState.process === null && session.localState.lastError !== null);

    if ((input.forceRelayRestart || needsFreshSession) && session) {
      await destroySession(session);
      session = null;
    }

    if (!session) {
      const canUseLocalRelay = wantsRelay ? await checkFfmpegAvailability() : false;
      const allowFileProxyFallback = input.allowFileProxyFallback === true;

      if (wantsRelay && !canUseLocalRelay && !allowFileProxyFallback) {
        return createDisabledPlaybackRecord({
          channelId: input.channelId,
          sourceTransport: input.sourceTransport,
          healthStatus: "degraded",
          lastCheckedAt: input.lastCheckedAt,
          errorMessage: "Canli relay icin FFmpeg gerekli."
        });
      }

      session = {
        id: crypto.randomUUID(),
        channelId: input.channelId,
        snapshotVersion: input.snapshotVersion,
        baseOrigin: input.baseOrigin,
        sourceUrl: input.sourceUrl,
        sourceTransport: input.sourceTransport,
        deliveryMode:
          input.sourceTransport === "hls"
            ? "hls_proxy"
            : wantsRelay && canUseLocalRelay
              ? "hls_transmuxed"
              : "file_proxy",
        healthStatus: input.healthStatus,
        lastCheckedAt: input.lastCheckedAt,
        isVerified: input.isVerified,
        expiresAt: Date.now() + sessionTtlMs,
        lastViewerAt: Date.now(),
        viewers: new Map(),
        proxyState:
          input.sourceTransport === "hls"
            ? {
                rootUrl: input.sourceUrl,
                assetToUrl: new Map(),
                urlToAsset: new Map()
              }
            : null,
        localState:
          input.sourceTransport === "hls" || !wantsRelay || !canUseLocalRelay
            ? null
            : {
                tempDir: await fsp.mkdtemp(path.join(tempRoot, "channel-")),
                manifestPath: path.join(os.tmpdir(), "flixify-live-placeholder.m3u8"),
                process: null,
                mode: null,
                preferTranscode: input.preferTranscode === true,
                lastError: null,
                restartPromise: null,
                restartCount: 0,
                lastManifestSequence: null,
                lastManifestAdvanceAt: null,
                lastSegmentAt: null
              }
      };

      if (session.localState) {
        session.localState.manifestPath = path.join(session.localState.tempDir, "index.m3u8");
        const prepared = await ensureLocalRelay(session);
        if (!prepared.ok) {
          const errorMessage = prepared.errorMessage ?? "Canli relay hazirlanamadi.";
          await destroySession(session);
          return createDisabledPlaybackRecord({
            channelId: input.channelId,
            sourceTransport: input.sourceTransport,
            healthStatus: "degraded",
            lastCheckedAt: input.lastCheckedAt,
            errorMessage
          });
        }
      }

      sessions.set(session.id, session);
      sessionIdsByChannel.set(session.channelId, session.id);

      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        event: "relay-started",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        detail: buildRelayDetail(session)
      });
    }

    session.baseOrigin = input.baseOrigin;
    session.snapshotVersion = input.snapshotVersion;
    session.healthStatus = input.healthStatus;
    session.lastCheckedAt = input.lastCheckedAt;
    session.isVerified = input.isVerified;
    session.expiresAt = Date.now() + sessionTtlMs;

    if (session.localState) {
      const prepared = await ensureLocalRelay(session);
      if (!prepared.ok) {
        return createDisabledPlaybackRecord({
          channelId: input.channelId,
          sourceTransport: input.sourceTransport,
          healthStatus: "degraded",
          lastCheckedAt: input.lastCheckedAt,
          errorMessage: prepared.errorMessage ?? "Canli relay hazirlanamadi."
        });
      }
    }

    const viewer: ViewerLease = {
      token: crypto.randomBytes(32).toString("base64url"),
      diagnosticsSessionId: crypto.randomUUID(),
      expiresAt: Date.now() + sessionTtlMs,
      lastSeenAt: Date.now()
    };
    session.viewers.set(viewer.token, viewer);
    touchViewer(session, viewer);

      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "viewer-attached",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        detail: buildRelayDetail(session)
      });

    return buildReadyPlaybackRecord(session, viewer);
  }

  async function sendManifest(reply: FastifyReply, sessionId: string, token: string | undefined) {
    const authorized = authorizeViewer(sessionId, token);
    if (!authorized) {
      return reply.status(403).type("text/plain; charset=utf-8").send("Canli playback oturumu gecersiz.");
    }

    const { session, viewer } = authorized;

    if (session.deliveryMode === "hls_proxy" && session.proxyState) {
      let response: Response;
      try {
        response = await fetchUpstream(session.proxyState.rootUrl, {
          kind: "manifest"
        });
      } catch (error) {
        const errorMessage = getUpstreamErrorMessage(error, "Canli manifest baglantisi zaman asimina ugradi.");
        await emitDiagnostic({
          channelId: session.channelId,
          snapshotVersion: session.snapshotVersion,
          diagnosticsSessionId: viewer.diagnosticsSessionId,
          event: "upstream-error",
          deliveryMode: session.deliveryMode,
          sourceTransport: session.sourceTransport,
          playerEngine: "relay",
          errorCode: "upstream-fetch-failed",
          errorMessage
        });
        return reply.status(502).type("text/plain; charset=utf-8").send("Canli manifest alinamadi.");
      }
      if (!response.ok) {
        await emitDiagnostic({
          channelId: session.channelId,
          snapshotVersion: session.snapshotVersion,
          diagnosticsSessionId: viewer.diagnosticsSessionId,
          event: "upstream-error",
          deliveryMode: session.deliveryMode,
          sourceTransport: session.sourceTransport,
          playerEngine: "relay",
          upstreamStatus: response.status,
          errorMessage: "Canli manifest alinamadi."
        });
        return reply.status(502).type("text/plain; charset=utf-8").send("Canli manifest alinamadi.");
      }

      const manifest = await response.text();
      if (session.localState) {
        const manifestState = parseManifestState(manifest);
        if (
          manifestState.mediaSequence !== null &&
          manifestState.mediaSequence !== session.localState.lastManifestSequence
        ) {
          session.localState.lastManifestSequence = manifestState.mediaSequence;
          session.localState.lastManifestAdvanceAt = Date.now();
        }
      }
      const rewritten = rewriteProxyManifest(manifest, response.url || session.proxyState.rootUrl, session, viewer.token);
      return reply
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", LIVE_NO_CACHE_HEADER)
        .header("pragma", "no-cache")
        .header("expires", "0")
        .header("surrogate-control", "no-store")
        .send(rewritten);
    }

    if (!session.localState) {
      return reply.status(404).type("text/plain; charset=utf-8").send("Canli manifest bulunamadi.");
    }

    const ensured = await ensureLocalRelay(session);
    if (!ensured.ok) {
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "relay-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        errorMessage: ensured.errorMessage ?? "Canli manifest hazir degil."
      });
      return reply.status(503).type("text/plain; charset=utf-8").send("Canli manifest hazir degil.");
    }

    const manifest = await fsp.readFile(session.localState.manifestPath, "utf8");
    const manifestState = parseManifestState(manifest);
    if (
      manifestState.mediaSequence !== null &&
      manifestState.mediaSequence !== session.localState.lastManifestSequence
    ) {
      session.localState.lastManifestSequence = manifestState.mediaSequence;
      session.localState.lastManifestAdvanceAt = Date.now();
    }
    return reply
      .header("content-type", "application/vnd.apple.mpegurl")
      .header("cache-control", LIVE_NO_CACHE_HEADER)
      .header("pragma", "no-cache")
      .header("expires", "0")
      .header("surrogate-control", "no-store")
      .send(rewriteLocalManifest(manifest, session, viewer.token));
  }

  async function sendAsset(reply: FastifyReply, sessionId: string, token: string | undefined, assetId: string) {
    const authorized = authorizeViewer(sessionId, token);
    if (!authorized) {
      return reply.status(403).type("text/plain; charset=utf-8").send("Canli playback oturumu gecersiz.");
    }

    const { session, viewer } = authorized;
    if (!session.proxyState) {
      return reply.status(404).type("text/plain; charset=utf-8").send("Canli asset bulunamadi.");
    }

    const targetUrl = session.proxyState.assetToUrl.get(assetId);
    if (!targetUrl) {
      return reply.status(404).type("text/plain; charset=utf-8").send("Canli asset bulunamadi.");
    }

    let response: Response;
    try {
      response = await fetchUpstream(targetUrl, {
        kind: "segment"
      });
    } catch (error) {
      const errorMessage = getUpstreamErrorMessage(error, "Canli asset baglantisi zaman asimina ugradi.");
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "upstream-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        errorCode: "upstream-fetch-failed",
        errorMessage
      });
      return reply.status(502).type("text/plain; charset=utf-8").send("Canli asset alinamadi.");
    }
    if (!response.ok) {
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "upstream-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        upstreamStatus: response.status,
        errorMessage: "Canli asset alinamadi."
      });
      return reply.status(502).type("text/plain; charset=utf-8").send("Canli asset alinamadi.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/vnd.apple.mpegurl") || contentType.includes("application/x-mpegurl")) {
      const manifest = await response.text();
      const rewritten = rewriteProxyManifest(manifest, response.url || targetUrl, session, viewer.token);
      return reply
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", LIVE_NO_CACHE_HEADER)
        .header("pragma", "no-cache")
        .header("expires", "0")
        .header("surrogate-control", "no-store")
        .send(rewritten);
    }

    return streamFetchResponse(reply, response);
  }

  async function sendLocalAsset(reply: FastifyReply, sessionId: string, token: string | undefined, fileName: string) {
    const authorized = authorizeViewer(sessionId, token);
    if (!authorized) {
      return reply.status(403).type("text/plain; charset=utf-8").send("Canli playback oturumu gecersiz.");
    }

    const { session, viewer } = authorized;
    if (!session.localState) {
      return reply.status(404).type("text/plain; charset=utf-8").send("Canli dosyasi bulunamadi.");
    }

    const safeFileName = sanitizeLocalAssetName(decodeURIComponent(fileName));
    if (!safeFileName) {
      return reply.status(404).type("text/plain; charset=utf-8").send("Canli dosyasi bulunamadi.");
    }

    const ensured = await ensureLocalRelay(session);
    if (!ensured.ok) {
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "relay-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        errorMessage: ensured.errorMessage ?? "Canli relay segmentleri hazir degil."
      });
      return reply.status(503).type("text/plain; charset=utf-8").send("Canli relay segmentleri hazir degil.");
    }

    const filePath = path.join(session.localState.tempDir, safeFileName);
    const exists = await waitForFile(
      filePath,
      safeFileName.endsWith(".m3u8") ? 4_000 : 8_000,
      safeFileName.endsWith(".m3u8") ? manifestLineExists : undefined
    );

    if (!exists) {
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "relay-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        errorCode: "segment-missing",
        errorMessage: "Canli segment bulunamadi.",
        detail: {
          fileName: safeFileName
        }
      });
      return reply.status(404).type("text/plain; charset=utf-8").send("Canli dosyasi henuz hazir degil.");
    }

    if (safeFileName.endsWith(".m3u8")) {
      const manifest = await fsp.readFile(filePath, "utf8");
      const manifestState = parseManifestState(manifest);
      if (
        manifestState.mediaSequence !== null &&
        manifestState.mediaSequence !== session.localState.lastManifestSequence
      ) {
        session.localState.lastManifestSequence = manifestState.mediaSequence;
        session.localState.lastManifestAdvanceAt = Date.now();
      }
      return reply
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", LIVE_NO_CACHE_HEADER)
        .header("pragma", "no-cache")
        .header("expires", "0")
        .header("surrogate-control", "no-store")
        .send(rewriteLocalManifest(manifest, session, viewer.token));
    }

    reply.header("content-type", getLocalContentType(filePath));
    reply.header("cache-control", LIVE_NO_CACHE_HEADER);
    reply.header("pragma", "no-cache");
    reply.header("expires", "0");
    reply.header("surrogate-control", "no-store");
    session.localState.lastSegmentAt = Date.now();
    return reply.send(fs.createReadStream(filePath));
  }

  async function sendFile(
    reply: FastifyReply,
    sessionId: string,
    token: string | undefined,
    rangeHeader?: string | null
  ) {
    const authorized = authorizeViewer(sessionId, token);
    if (!authorized) {
      return reply.status(403).type("text/plain; charset=utf-8").send("Canli playback oturumu gecersiz.");
    }

    const { session, viewer } = authorized;
    let response: Response;
    try {
      response = await fetchUpstream(session.sourceUrl, {
        rangeHeader,
        kind: "file"
      });
    } catch (error) {
      const errorMessage = getUpstreamErrorMessage(error, "Canli kaynak baglantisi zaman asimina ugradi.");
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "upstream-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        errorCode: "upstream-fetch-failed",
        errorMessage
      });
      return reply.status(502).type("text/plain; charset=utf-8").send("Canli akis alinamadi.");
    }
    if (!response.ok && response.status !== 206) {
      await emitDiagnostic({
        channelId: session.channelId,
        snapshotVersion: session.snapshotVersion,
        diagnosticsSessionId: viewer.diagnosticsSessionId,
        event: "upstream-error",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        upstreamStatus: response.status,
        errorMessage: "Canli kaynak dosyasi alinamadi."
      });
      return reply.status(502).type("text/plain; charset=utf-8").send("Canli akis alinamadi.");
    }

    return streamFetchResponse(reply, response);
  }

  async function dispose() {
    clearInterval(cleanupTimer);
    const activeSessions = [...sessions.values()];
    sessions.clear();
    sessionIdsByChannel.clear();
    for (const session of activeSessions) {
      await destroySession(session);
    }
  }

  return {
    createPlayback,
    sendManifest,
    sendAsset,
    sendLocalAsset,
    sendFile,
    dispose
  };
}
