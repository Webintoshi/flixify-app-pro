import crypto from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable } from "node:stream";
import type { FastifyReply } from "fastify";
import type {
  VodAudioTrack,
  VodDeliveryMode,
  VodPlaybackKind,
  VodPlaybackRecord,
  VodTransport
} from "@flixify/contracts";

const DEFAULT_REQUEST_HEADERS = {
  "user-agent": "VLC/3.0.4 LibVLC/3.0.4",
  accept: "*/*",
  "accept-encoding": "identity"
};
const VOD_PLAYLIST_NO_CACHE_HEADER =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0, no-transform";
const RETRYABLE_UPSTREAM_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const HARD_FAIL_UPSTREAM_STATUS_CODES = new Set([400, 401, 403, 404, 410, 422]);
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_FETCH_ATTEMPTS = 3;
const MAX_FETCH_ATTEMPTS = 5;
const VOD_MANIFEST_FETCH_POLICY = { timeoutMs: 5_500, maxAttempts: 3, initialBackoffMs: 220, maxBackoffMs: 1_200 };
const VOD_SEGMENT_FETCH_POLICY = { timeoutMs: 9_000, maxAttempts: 4, initialBackoffMs: 280, maxBackoffMs: 2_000 };
const VOD_FILE_FETCH_POLICY = { timeoutMs: 12_000, maxAttempts: 3, initialBackoffMs: 320, maxBackoffMs: 2_500 };
const DEFAULT_FETCH_POLICY = {
  timeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  maxAttempts: DEFAULT_FETCH_ATTEMPTS,
  initialBackoffMs: 300,
  maxBackoffMs: 2_000
};
const VOD_AUDIO_NORMALIZE_FILTER = "aresample=async=1:min_hard_comp=0.100:first_pts=0,dynaudnorm=f=200:g=15";
const MAX_FFPROBE_TIMEOUT_MS = 12_000;

function normalizeContentType(value: string | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function detectVodTransportFromParts(url: string, contentType?: string | null): VodTransport {
  const normalizedType = normalizeContentType(contentType ?? undefined);

  if (
    normalizedType.includes("application/vnd.apple.mpegurl") ||
    normalizedType.includes("application/x-mpegurl") ||
    /\.m3u8(?:$|\?)/i.test(url)
  ) {
    return "hls";
  }

  if (normalizedType.includes("video/mp4") || /\.mp4(?:$|\?)/i.test(url)) {
    return "mp4";
  }

  if (normalizedType.includes("video/x-matroska") || /\.mkv(?:$|\?)/i.test(url)) {
    return "mkv";
  }

  if (
    normalizedType.includes("video/x-msvideo") ||
    normalizedType.includes("video/avi") ||
    /\.avi(?:$|\?)/i.test(url)
  ) {
    return "avi";
  }

  return "unknown";
}

function isHlsManifest(url: string, contentType?: string | null) {
  return detectVodTransportFromParts(url, contentType) === "hls";
}

async function readFirstChunk(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array(0);
  }

  try {
    const result = await reader.read();
    return result.done ? new Uint8Array(0) : result.value;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
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

function mergeCookieHeaders(...cookieHeaders: Array<string | null | undefined>) {
  const cookieMap = new Map<string, string>();

  for (const cookieHeader of cookieHeaders) {
    if (!cookieHeader) {
      continue;
    }

    for (const cookie of cookieHeader.split(";")) {
      const normalized = cookie.trim();
      const separatorIndex = normalized.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      cookieMap.set(normalized.substring(0, separatorIndex).trim(), normalized);
    }
  }

  return cookieMap.size > 0 ? Array.from(cookieMap.values()).join("; ") : null;
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function hasByteRangeSupport(response: Response) {
  const acceptRanges = response.headers.get("accept-ranges")?.toLowerCase() ?? "";
  const contentRange = response.headers.get("content-range");
  return response.status === 206 || Boolean(contentRange) || (acceptRanges.length > 0 && acceptRanges !== "none");
}

function decodeChunkPreview(chunk: Uint8Array) {
  if (!chunk || chunk.byteLength === 0) {
    return "";
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(chunk.subarray(0, Math.min(chunk.byteLength, 2048))).trim();
}

function looksLikeHtmlPayload(contentType: string | null, preview: string) {
  const normalizedType = normalizeContentType(contentType ?? undefined);
  if (normalizedType.includes("text/html")) {
    return true;
  }

  const normalizedPreview = preview.toLowerCase();
  return (
    normalizedPreview.startsWith("<!doctype html") ||
    normalizedPreview.startsWith("<html") ||
    normalizedPreview.includes("<head") ||
    normalizedPreview.includes("<body")
  );
}

function detectTransportFromChunkBytes(chunk: Uint8Array, fallback: VodTransport) {
  if (!chunk || chunk.byteLength === 0) {
    return fallback;
  }

  const preview = decodeChunkPreview(chunk);
  if (preview.startsWith("#EXTM3U")) {
    return "hls";
  }

  if (chunk.byteLength >= 8) {
    const brand = String.fromCharCode(...chunk.subarray(4, 8));
    if (brand === "ftyp") {
      return "mp4";
    }
  }

  if (chunk.byteLength >= 4 && chunk[0] === 0x1a && chunk[1] === 0x45 && chunk[2] === 0xdf && chunk[3] === 0xa3) {
    return "mkv";
  }

  if (chunk.byteLength >= 12) {
    const riff = String.fromCharCode(...chunk.subarray(0, 4));
    const avi = String.fromCharCode(...chunk.subarray(8, 12));
    if (riff === "RIFF" && avi === "AVI ") {
      return "avi";
    }
  }

  return fallback;
}

export async function probeVodStream(url: string) {
  async function probeOnce(rangeHeader?: string) {
    const headers: Record<string, string> = {
      ...DEFAULT_REQUEST_HEADERS
    };
    if (rangeHeader) {
      headers.range = rangeHeader;
    }

    const response = await fetchWithTimeout(
      url,
      {
        headers,
        redirect: "follow"
      },
      10_000
    );

    const finalUrl = response.url || url;
    const transport = detectVodTransportFromParts(finalUrl, response.headers.get("content-type"));

    let cookie: string | null = null;
    if (response.headers.getSetCookie && typeof response.headers.getSetCookie === "function") {
      const setCookies = response.headers.getSetCookie();
      if (setCookies && setCookies.length > 0) {
        cookie = setCookies.map((c: string) => c.split(";")[0].trim()).join("; ");
      }
    }

    return {
      response,
      cookie,
      finalUrl,
      transport
    };
  }

  try {
    let { response, cookie, finalUrl, transport } = await probeOnce("bytes=0-65535");
    if (
      response.status === 400 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 405 ||
      response.status === 409 ||
      response.status === 416 ||
      response.status === 501
    ) {
      ({ response, finalUrl, transport, cookie } = await probeOnce());
    }

    if (response.status >= 400) {
      return {
        ok: false,
        statusCode: response.status,
        finalUrl,
        transport,
        cookie,
        supportsByteRange: hasByteRangeSupport(response),
        errorMessage: `Upstream ${response.status}`
      };
    }

    const firstChunk = await readFirstChunk(response);
    if (firstChunk.byteLength === 0) {
      return {
        ok: false,
        statusCode: response.status,
        finalUrl,
        transport,
        cookie,
        supportsByteRange: hasByteRangeSupport(response),
        errorMessage: "Akistan veri okunamadi."
      };
    }

    const preview = decodeChunkPreview(firstChunk);
    if (looksLikeHtmlPayload(response.headers.get("content-type"), preview)) {
      return {
        ok: false,
        statusCode: response.status,
        finalUrl,
        transport,
        cookie,
        supportsByteRange: hasByteRangeSupport(response),
        errorMessage: "VOD akisi gecici olarak kullanilamiyor. Html yaniti alindi."
      };
    }

    transport = detectTransportFromChunkBytes(firstChunk, transport);

    return {
      ok: true,
      statusCode: response.status,
      finalUrl,
      transport,
      cookie,
      supportsByteRange: hasByteRangeSupport(response),
      errorMessage: null
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      finalUrl: url,
      transport: detectVodTransportFromParts(url, null),
      cookie: null,
      supportsByteRange: false,
      errorMessage: error instanceof Error ? error.message : "VOD probe basarisiz."
    };
  }
}

type ProxyAssetState = {
  assetToUrl: Map<string, string>;
  urlToAsset: Map<string, string>;
  rootUrl: string;
};

export type SourceAudioTrack = {
  id: string;
  sourceStreamIndex: number;
  language: string | null;
  title: string | null;
  channels: number | null;
  sourceDefault: boolean;
};

export type VodMediaProfile = {
  containerTransport: VodTransport;
  primaryVideoCodec: string | null;
  audioCodecs: string[];
  audioTracks: SourceAudioTrack[];
};

type LocalHlsState = {
  tempDir: string;
  manifestPath: string;
  process: ChildProcessWithoutNullStreams | null;
  mode: "transcode" | null;
  lastError: string | null;
  startupFailed: boolean;
  sourceAudioTracks: SourceAudioTrack[];
  injectSilentAudioTrack: boolean;
  ownsTranscodeSlot: boolean;
};

type VodPlaybackSession = {
  id: string;
  token: string;
  userId: string;
  itemId: string;
  kind: VodPlaybackKind;
  baseOrigin: string;
  sourceUrl: string;
  sourceTransport: VodTransport;
  deliveryMode: VodDeliveryMode;
  expiresAt: number;
  isVerified: boolean;
  audioTracks: VodAudioTrack[];
  defaultAudioTrackId: string | null;
  selectedAudioTrackId: string | null;
  cookie: string | null;
  proxyState: ProxyAssetState | null;
  localState: LocalHlsState | null;
};

type CreateVodPlaybackInput = {
  userId: string;
  itemId: string;
  kind: VodPlaybackKind;
  sourceUrl: string;
  clientRuntime?: "browser" | "app" | "native";
  platform?: string | null;
  allowUnverifiedSource?: boolean;
  sourceTransportHint?: VodTransport;
  baseOrigin: string;
  cookie?: string | null;
  debug?: boolean;
  preferTranscode?: boolean;
  selectedAudioTrackId?: string | null;
};

type VodPlaybackManagerOptions = {
  ffmpegBinary: string;
  ffprobeBinary: string;
  sessionTtlMs: number;
  tempRoot?: string;
  maxConcurrentTranscodes?: number;
  onDiagnostic?: (input: {
    itemId: string;
    kind: VodPlaybackKind;
    event: string;
    deliveryMode?: VodDeliveryMode | null;
    sourceTransport?: VodTransport | null;
    playerEngine?: string | null;
    audioTrackId?: string | null;
    errorCode?: string | null;
    upstreamStatus?: number | null;
    errorMessage?: string | null;
    detail?: Record<string, unknown> | null;
  }) => Promise<void> | void;
};

export class VodPlaybackUnavailableError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 503) {
    super(message);
    this.name = "VodPlaybackUnavailableError";
    this.statusCode = statusCode;
  }
}

type FetchUpstreamOptions = {
  rangeHeader?: string | null;
  timeoutMs?: number;
  maxAttempts?: number;
  kind?: "manifest" | "segment" | "file";
};

function createSessionUrl(baseOrigin: string, session: VodPlaybackSession) {
  if (session.deliveryMode === "file_proxy") {
    return `${baseOrigin}/vod/playback/${session.id}/file?token=${encodeURIComponent(session.token)}`;
  }

  return `${baseOrigin}/vod/playback/${session.id}/master.m3u8?token=${encodeURIComponent(session.token)}`;
}

function manifestLineExists(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line.length > 0 && !line.startsWith("#"));
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

async function ensureDirectory(dirPath: string) {
  await fsp.mkdir(dirPath, { recursive: true });
}

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

function normalizeAudioLanguage(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.length > 32) {
    return normalized.slice(0, 32);
  }

  return normalized;
}

function normalizeAudioTitle(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length > 80) {
    return normalized.slice(0, 80);
  }

  return normalized;
}

function isTurkishLanguageTag(value: string | null | undefined) {
  const normalized = normalizeAudioLanguage(value);
  if (!normalized) {
    return false;
  }

  return (
    normalized === "tr" ||
    normalized === "tur" ||
    normalized === "tr-tr" ||
    normalized.startsWith("tr-")
  );
}

export function mapSourceTracksToVodAudioTracks(
  sourceTracks: SourceAudioTrack[],
  selectedTrackId: string | null
): VodAudioTrack[] {
  if (sourceTracks.length === 0) {
    return [];
  }

  return sourceTracks.map((track) => ({
    id: track.id,
    language: normalizeAudioLanguage(track.language),
    title: normalizeAudioTitle(track.title),
    channels: track.channels,
    isDefault: track.id === selectedTrackId
  }));
}

export function selectVodAudioTrackId(
  sourceTracks: SourceAudioTrack[],
  requestedTrackId?: string | null
) {
  if (sourceTracks.length === 0) {
    return {
      selectedTrackId: null,
      defaultTrackId: null
    };
  }

  if (requestedTrackId && sourceTracks.some((track) => track.id === requestedTrackId)) {
    return {
      selectedTrackId: requestedTrackId,
      defaultTrackId: requestedTrackId
    };
  }

  const turkishTrack = sourceTracks.find((track) => isTurkishLanguageTag(track.language));
  if (turkishTrack) {
    return {
      selectedTrackId: turkishTrack.id,
      defaultTrackId: turkishTrack.id
    };
  }

  const sourceDefaultTrack = sourceTracks.find((track) => track.sourceDefault);
  if (sourceDefaultTrack) {
    return {
      selectedTrackId: sourceDefaultTrack.id,
      defaultTrackId: sourceDefaultTrack.id
    };
  }

  const firstTrack = sourceTracks[0];
  return {
    selectedTrackId: firstTrack.id,
    defaultTrackId: firstTrack.id
  };
}

type FfprobeStream = {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  disposition?: {
    default?: number;
  };
  tags?: {
    language?: string;
    title?: string;
  };
};

type FfprobeFormat = {
  format_name?: string;
};

function normalizeCodecName(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function resolveTransportFromFormatName(value: string | null | undefined, fallbackTransport: VodTransport): VodTransport {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return fallbackTransport;
  }

  if (
    normalized.includes("hls") ||
    normalized.includes("applehttp") ||
    normalized.includes("mpegurl")
  ) {
    return "hls";
  }
  if (normalized.includes("mp4") || normalized.includes("mov")) {
    return "mp4";
  }
  if (normalized.includes("matroska") || normalized.includes("webm")) {
    return "mkv";
  }
  if (normalized.includes("avi")) {
    return "avi";
  }

  return fallbackTransport;
}

function mapFfprobeAudioTracks(streams: FfprobeStream[]) {
  return streams
    .filter((stream) => stream.codec_type === "audio")
    .map((stream, outputIndex) => {
      const streamIndex =
        typeof stream.index === "number" && Number.isFinite(stream.index)
          ? stream.index
          : outputIndex;
      return {
        id: `a${streamIndex}`,
        sourceStreamIndex: streamIndex,
        language: normalizeAudioLanguage(stream.tags?.language),
        title: normalizeAudioTitle(stream.tags?.title),
        channels:
          typeof stream.channels === "number" && Number.isFinite(stream.channels) && stream.channels > 0
            ? Math.floor(stream.channels)
            : null,
        sourceDefault: stream.disposition?.default === 1
      } satisfies SourceAudioTrack;
    })
    .sort((left, right) => left.sourceStreamIndex - right.sourceStreamIndex);
}

export function parseVodMediaProfile(
  payload: string | { streams?: FfprobeStream[]; format?: FfprobeFormat },
  fallbackTransport: VodTransport
): VodMediaProfile | null {
  try {
    const parsed =
      typeof payload === "string"
        ? (JSON.parse(payload) as { streams?: FfprobeStream[]; format?: FfprobeFormat })
        : payload;
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const primaryVideoStream = streams.find((stream) => stream.codec_type === "video");
    const audioTracks = mapFfprobeAudioTracks(streams);
    const audioCodecs = [...new Set(
      streams
        .filter((stream) => stream.codec_type === "audio")
        .map((stream) => normalizeCodecName(stream.codec_name))
        .filter((codec): codec is string => codec !== null)
    )];

    return {
      containerTransport: resolveTransportFromFormatName(parsed.format?.format_name, fallbackTransport),
      primaryVideoCodec: normalizeCodecName(primaryVideoStream?.codec_name),
      audioCodecs,
      audioTracks
    };
  } catch {
    return null;
  }
}

export async function probeVodMediaProfile(
  ffprobeBinary: string,
  sourceUrl: string,
  fallbackTransport: VodTransport
) {
  const args = [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-show_entries",
    "format=format_name:stream=index,codec_type,codec_name,channels:stream_tags=language,title:stream_disposition=default",
    "-of",
    "json",
    "-user_agent",
    "VLC/3.0.4 LibVLC/3.0.4",
    sourceUrl
  ];

  return new Promise<VodMediaProfile | null>((resolve) => {
    let stdoutOutput = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const child = spawn(ffprobeBinary, args, {
      stdio: ["ignore", "pipe", "ignore"]
    });

    const finish = (profile: VodMediaProfile | null) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve(profile);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutOutput = `${stdoutOutput}${chunk.toString("utf8")}`.slice(-512_000);
    });

    child.once("error", () => finish(null));

    child.once("close", (code) => {
      if (code !== 0) {
        finish(null);
        return;
      }

      finish(parseVodMediaProfile(stdoutOutput, fallbackTransport));
    });

    timer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
      finish(null);
    }, MAX_FFPROBE_TIMEOUT_MS);
  });
}

function buildDisabledPlaybackRecord(input: {
  itemId: string;
  kind: VodPlaybackKind;
  transport: VodTransport;
  deliveryMode: VodDeliveryMode;
  errorMessage: string;
}): VodPlaybackRecord {
  return {
    itemId: input.itemId,
    kind: input.kind,
    url: null,
    transport: input.transport,
    deliveryMode: input.deliveryMode,
    audioTracks: [],
    defaultAudioTrackId: null,
    selectedAudioTrackId: null,
    expiresAt: null,
    canPlay: false,
    isVerified: false,
    errorMessage: input.errorMessage
  };
}

function buildReadyPlaybackRecord(session: VodPlaybackSession): VodPlaybackRecord {
  return {
    itemId: session.itemId,
    kind: session.kind,
    url: createSessionUrl(session.baseOrigin, session),
    transport: session.deliveryMode === "file_proxy" ? session.sourceTransport : "hls",
    deliveryMode: session.deliveryMode,
    audioTracks: session.audioTracks,
    defaultAudioTrackId: session.defaultAudioTrackId,
    selectedAudioTrackId: session.selectedAudioTrackId,
    expiresAt: new Date(session.expiresAt).toISOString(),
    canPlay: true,
    isVerified: session.isVerified,
    errorMessage: null
  };
}

async function removeDirectory(dirPath: string) {
  await fsp.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
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

  if (filePath.endsWith(".mp4")) {
    return "video/mp4";
  }

  return "application/octet-stream";
}

function rewriteLocalManifest(content: string, session: VodPlaybackSession) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }

      return `${session.baseOrigin}/vod/playback/${session.id}/files/${encodeURIComponent(trimmed)}?token=${encodeURIComponent(session.token)}`;
    })
    .join("\n");
}

function getOrCreateAssetId(session: VodPlaybackSession, url: string) {
  if (!session.proxyState) {
    throw new Error("Proxy state bulunamadi.");
  }

  const existing = session.proxyState.urlToAsset.get(url);
  if (existing) {
    return existing;
  }

  const assetId = crypto.randomBytes(12).toString("base64url");
  session.proxyState.urlToAsset.set(url, assetId);
  session.proxyState.assetToUrl.set(assetId, url);
  return assetId;
}

function rewriteProxyManifest(content: string, parentUrl: string, session: VodPlaybackSession) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }

      const targetUrl = new URL(trimmed, parentUrl).toString();
      const assetId = getOrCreateAssetId(session, targetUrl);
      return `${session.baseOrigin}/vod/playback/${session.id}/assets/${assetId}?token=${encodeURIComponent(session.token)}`;
    })
    .join("\n");
}

async function streamFetchResponse(
  reply: FastifyReply,
  response: Response,
  options: { fallbackContentType?: string } = {}
) {
  if (!response.body) {
    return reply.status(502).type("text/plain; charset=utf-8").send("Upstream akisi okunamadi.");
  }

  const rawContentType = response.headers.get("content-type");
  const normalizedType = normalizeContentType(rawContentType ?? undefined);
  const contentType =
    !normalizedType || normalizedType === "application/octet-stream"
      ? options.fallbackContentType ?? rawContentType
      : rawContentType;
  const contentRange = response.headers.get("content-range");
  const contentLength = response.headers.get("content-length");
  const contentEncoding = response.headers.get("content-encoding");
  const cacheControl = response.headers.get("cache-control");

  reply.status(response.status);

  if (contentType) {
    reply.header("content-type", contentType);
  }
  if (contentRange) {
    reply.header("content-range", contentRange);
  }
  if (
    contentLength &&
    (!contentEncoding || contentEncoding.toLowerCase() === "identity")
  ) {
    reply.header("content-length", contentLength);
  }
  reply.header("cache-control", cacheControl ?? "private, max-age=30, no-transform");
  reply.header("accept-ranges", "bytes");

  return reply.send(Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>));
}

function getFallbackContentTypeForTransport(transport: VodTransport) {
  if (transport === "hls") {
    return "application/vnd.apple.mpegurl";
  }
  if (transport === "mp4") {
    return "video/mp4";
  }
  if (transport === "mkv") {
    return "video/x-matroska";
  }
  if (transport === "avi") {
    return "video/x-msvideo";
  }
  return "application/octet-stream";
}

export type VodTranscodeDecisionInput = {
  transport: VodTransport;
  supportsByteRange: boolean;
  preferTranscode: boolean;
  clientRuntime?: "browser" | "app" | "native";
  platform?: string | null;
  mediaProfile?: VodMediaProfile | null;
  selectedAudioTrackId?: string | null;
  debugPassthrough?: boolean;
};

export type VodTranscodeDecision = {
  needsTranscode: boolean;
  useFileProxy: boolean;
  requiresFfmpeg: boolean;
  deliveryMode: VodDeliveryMode;
};

function normalizePlaybackPlatform(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function isInstalledAppRuntime(clientRuntime: VodTranscodeDecisionInput["clientRuntime"]) {
  return clientRuntime === "app" || clientRuntime === "native";
}

function isNativeDesktopPlaybackRuntime(input: VodTranscodeDecisionInput) {
  return input.clientRuntime === "native" && isDesktopPlaybackPlatform(normalizePlaybackPlatform(input.platform));
}

function shouldForceNativeAudioTrackTranscode(input: VodTranscodeDecisionInput) {
  if (!isNativeDesktopPlaybackRuntime(input)) {
    return false;
  }

  const requestedTrackId = input.selectedAudioTrackId?.trim() ?? "";
  if (!requestedTrackId) {
    return false;
  }

  return (input.mediaProfile?.audioTracks.length ?? 0) > 1;
}

function canUseNativeDesktopFileProxy(input: VodTranscodeDecisionInput, effectiveTransport: VodTransport) {
  if (!isNativeDesktopPlaybackRuntime(input)) {
    return false;
  }

  if (effectiveTransport === "hls" || effectiveTransport === "unknown") {
    return false;
  }

  if (shouldForceNativeAudioTrackTranscode(input)) {
    return false;
  }

  return true;
}

function resolveEffectiveTransport(input: VodTranscodeDecisionInput) {
  return input.mediaProfile?.containerTransport && input.mediaProfile.containerTransport !== "unknown"
    ? input.mediaProfile.containerTransport
    : input.transport;
}

function isDesktopPlaybackPlatform(platform: string | null) {
  if (!platform) {
    return false;
  }

  return (
    platform.startsWith("windows") ||
    platform.startsWith("macos") ||
    platform.startsWith("linux") ||
    platform.includes("desktop")
  );
}

function isSafeDirectVideoCodec(codec: string | null) {
  return codec === "h264" || codec === "avc1";
}

function isSafeDirectAudioCodec(codec: string) {
  return codec === "aac" || codec === "mp3";
}

function isDirectSafeInstalledMp4(input: VodTranscodeDecisionInput) {
  if (!input.supportsByteRange) {
    return false;
  }

  const mediaProfile = input.mediaProfile;
  if (!mediaProfile || mediaProfile.containerTransport !== "mp4") {
    return false;
  }

  if (!isSafeDirectVideoCodec(mediaProfile.primaryVideoCodec)) {
    return false;
  }

  if (mediaProfile.audioCodecs.length === 0) {
    return false;
  }

  return mediaProfile.audioCodecs.every((codec) => isSafeDirectAudioCodec(codec));
}

export function resolveVodTranscodeDecision(input: VodTranscodeDecisionInput): VodTranscodeDecision {
  if (input.preferTranscode) {
    return {
      needsTranscode: true,
      useFileProxy: false,
      requiresFfmpeg: true,
      deliveryMode: "hls_transcoded"
    };
  }

  const effectiveTransport = resolveEffectiveTransport(input);

  if (isInstalledAppRuntime(input.clientRuntime)) {
    const platform = normalizePlaybackPlatform(input.platform);
    if (effectiveTransport === "hls") {
      return {
        needsTranscode: false,
        useFileProxy: false,
        requiresFfmpeg: false,
        deliveryMode: "hls_proxy"
      };
    }

    if (canUseNativeDesktopFileProxy(input, effectiveTransport)) {
      return {
        needsTranscode: false,
        useFileProxy: true,
        requiresFfmpeg: false,
        deliveryMode: "file_proxy"
      };
    }

    const safeInstalledPlatform = isDesktopPlaybackPlatform(platform);
    if (safeInstalledPlatform && effectiveTransport === "mp4" && isDirectSafeInstalledMp4(input)) {
      return {
        needsTranscode: false,
        useFileProxy: true,
        requiresFfmpeg: false,
        deliveryMode: "file_proxy"
      };
    }

    return {
      needsTranscode: true,
      useFileProxy: false,
      requiresFfmpeg: true,
      deliveryMode: "hls_transcoded"
    };
  }

  const debugPassthrough = input.debugPassthrough === true;
  if (debugPassthrough && effectiveTransport === "hls") {
    return {
      needsTranscode: false,
      useFileProxy: false,
      requiresFfmpeg: false,
      deliveryMode: "hls_proxy"
    };
  }

  return {
    needsTranscode: true,
    useFileProxy: false,
    requiresFfmpeg: true,
    deliveryMode: "hls_transcoded"
  };
}

export function createFfmpegArgs(input: {
  sourceUrl: string;
  outputDir: string;
  sourceAudioTracks: SourceAudioTrack[];
  selectedAudioTrackId: string | null;
  injectSilentAudioTrack: boolean;
}) {
  const segmentPattern = path.join(input.outputDir, "segment-%05d.ts");
  const manifestPath = path.join(input.outputDir, "index.m3u8");
  const effectiveAudioTracks = input.injectSilentAudioTrack
    ? [
        {
          id: "fallback-silence-0",
          sourceStreamIndex: 0,
          language: "und",
          title: "Fallback Stereo",
          channels: 2,
          sourceDefault: true
        } satisfies SourceAudioTrack
      ]
    : input.sourceAudioTracks;

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostats",
    "-fflags",
    "+discardcorrupt",
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
    "8",
    "-reconnect_delay_max",
    "8",
    "-reconnect_delay_total_max",
    "45",
    "-rw_timeout",
    "15000000",
    "-user_agent",
    DEFAULT_REQUEST_HEADERS["user-agent"],
    "-headers",
    "Accept: */*\r\n",
    "-i",
    input.sourceUrl
  ];

  if (input.injectSilentAudioTrack) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo"
    );
  }

  args.push("-map", "0:v:0?");
  if (input.injectSilentAudioTrack) {
    args.push("-map", "1:a:0");
  } else {
    args.push("-map", "0:a?");
  }

  args.push(
    "-dn",
    "-sn",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "96",
    "-keyint_min",
    "48",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-profile:a",
    "aac_low",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-b:a",
    "160k",
    "-filter:a",
    VOD_AUDIO_NORMALIZE_FILTER
  );

  for (let index = 0; index < effectiveAudioTracks.length; index += 1) {
    const track = effectiveAudioTracks[index];
    const normalizedLanguage = normalizeAudioLanguage(track.language) ?? "und";
    const normalizedTitle = normalizeAudioTitle(track.title);
    const isDefaultTrack = track.id === input.selectedAudioTrackId || (!input.selectedAudioTrackId && index === 0);

    args.push("-metadata:s:a:" + index, `language=${normalizedLanguage}`);
    if (normalizedTitle) {
      args.push("-metadata:s:a:" + index, `title=${normalizedTitle}`);
    }
    args.push("-disposition:a:" + index, isDefaultTrack ? "default" : "0");
  }

  args.push(
    "-max_muxing_queue_size",
    "4096",
    "-start_number",
    "0",
    "-hls_time",
    "4",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "mpegts",
    "-hls_flags",
    "independent_segments+temp_file",
    "-hls_segment_filename",
    segmentPattern,
    "-f",
    "hls",
    manifestPath
  );

  return args;
}

function trimErrorMessage(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function sanitizePlaybackErrorMessage(
  value: string | null | undefined,
  fallback = "VOD kaynagi gecici olarak acilamadi."
) {
  const normalized = trimErrorMessage(value, fallback);
  const statusMatch = /\b(401|403|404|410|422|429|500|502|503|504)\b/.exec(normalized);
  if (statusMatch?.[1]) {
    return `Upstream ${statusMatch[1]}`;
  }

  const lowered = normalized.toLowerCase();
  if (lowered.includes("timeout") || lowered.includes("timed out")) {
    return "Upstream zaman asimi.";
  }
  if (lowered.includes("connection refused")) {
    return "Kaynak sunucu baglantiyi reddetti.";
  }
  if (lowered.includes("name or service not known") || lowered.includes("could not resolve")) {
    return "Kaynak sunucu adresi cozumlenemedi.";
  }

  return fallback;
}

export function createVodPlaybackManager(options: VodPlaybackManagerOptions) {
  const sessions = new Map<string, VodPlaybackSession>();
  const sessionTtlMs = Math.max(options.sessionTtlMs, 60_000);
  const tempRoot = options.tempRoot ?? path.join(os.tmpdir(), "flixify-vod");
  const maxConcurrentTranscodes = Math.max(1, options.maxConcurrentTranscodes ?? 2);
  let ffmpegAvailablePromise: Promise<boolean> | null = null;
  let activeTranscodeCount = 0;

  async function emitDiagnostic(input: {
    itemId: string;
    kind: VodPlaybackKind;
    event: string;
    deliveryMode?: VodDeliveryMode | null;
    sourceTransport?: VodTransport | null;
    playerEngine?: string | null;
    audioTrackId?: string | null;
    errorCode?: string | null;
    upstreamStatus?: number | null;
    errorMessage?: string | null;
    detail?: Record<string, unknown> | null;
  }) {
    try {
      await options.onDiagnostic?.(input);
    } catch {
      // Diagnostics should never block playback startup.
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
          console.warn(`[vod-playback] FFmpeg kullanilamadi: ${options.ffmpegBinary}`);
        }
        return available;
      });
    }

    return ffmpegAvailablePromise;
  }

  function releaseTranscodeSlot(localState: LocalHlsState | null | undefined) {
    if (!localState || !localState.ownsTranscodeSlot) {
      return;
    }

    localState.ownsTranscodeSlot = false;
    activeTranscodeCount = Math.max(0, activeTranscodeCount - 1);
  }

  async function destroySession(session: VodPlaybackSession) {
    sessions.delete(session.id);
    if (session.localState?.process && !session.localState.process.killed) {
      session.localState.process.kill("SIGKILL");
    }
    releaseTranscodeSlot(session.localState);
    if (session.localState?.tempDir) {
      await removeDirectory(session.localState.tempDir);
    }
  }

  async function cleanupExpiredSessions() {
    const expired = [...sessions.values()].filter((session) => session.expiresAt <= Date.now());
    for (const session of expired) {
      await destroySession(session);
    }
  }

  const cleanupTimer = setInterval(() => {
    void cleanupExpiredSessions();
  }, 60_000);
  cleanupTimer.unref();

  function touchSession(session: VodPlaybackSession) {
    session.expiresAt = Date.now() + sessionTtlMs;
  }

  async function startFfmpegPipeline(session: VodPlaybackSession) {
    if (!session.localState) {
      throw new Error("Local HLS state bulunamadi.");
    }

    if (activeTranscodeCount >= maxConcurrentTranscodes) {
      throw new VodPlaybackUnavailableError(
        `VOD transcode kapasitesi dolu (aktif: ${activeTranscodeCount}/${maxConcurrentTranscodes}). Lutfen 10-20 sn sonra tekrar deneyin.`,
        503
      );
    }

    activeTranscodeCount += 1;
    session.localState.ownsTranscodeSlot = true;
    try {
      await removeDirectory(session.localState.tempDir);
      await fsp.mkdir(session.localState.tempDir, { recursive: true });
    } catch (error) {
      releaseTranscodeSlot(session.localState);
      throw error;
    }

    const args = createFfmpegArgs({
      sourceUrl: session.sourceUrl,
      outputDir: session.localState.tempDir,
      sourceAudioTracks: session.localState.sourceAudioTracks,
      selectedAudioTrackId: session.selectedAudioTrackId,
      injectSilentAudioTrack: session.localState.injectSilentAudioTrack
    });
    let stderrOutput = "";

    await emitDiagnostic({
      itemId: session.itemId,
      kind: session.kind,
      event: "transcode-started",
      deliveryMode: session.deliveryMode,
      sourceTransport: session.sourceTransport,
      playerEngine: "relay",
      audioTrackId: session.selectedAudioTrackId,
      detail: {
        activeTranscodeCount,
        maxConcurrentTranscodes,
        audioTrackCount: session.audioTracks.length,
        injectSilentAudioTrack: session.localState.injectSilentAudioTrack
      }
    });

    const child = spawn(options.ffmpegBinary, args, {
      stdio: ["ignore", "ignore", "pipe"]
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput = `${stderrOutput}${chunk.toString("utf8")}`.slice(-8_000);
    });

    session.localState.process = child;
    session.localState.mode = "transcode";
    session.localState.lastError = null;
    session.localState.startupFailed = false;

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
      session.localState.startupFailed = true;
      session.localState.lastError = sanitizePlaybackErrorMessage(
        stderrOutput,
        "VOD kaynagi gecici olarak acilamadi."
      );
      releaseTranscodeSlot(session.localState);
      await emitDiagnostic({
        itemId: session.itemId,
        kind: session.kind,
        event: "transcode-failed",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        audioTrackId: session.selectedAudioTrackId,
        errorCode: "ffmpeg-startup-failed",
        errorMessage: session.localState.lastError,
        detail: {
          stderr: stderrOutput.slice(-2_000)
        }
      });
      return false;
    }

    child.on("close", (code) => {
      if (session.localState?.process === child) {
        session.localState.process = null;
      }
      if (code && session.localState && !session.localState.startupFailed) {
        session.localState.lastError = sanitizePlaybackErrorMessage(
          stderrOutput,
          `FFmpeg cikis kodu ${code}`
        );
        void emitDiagnostic({
          itemId: session.itemId,
          kind: session.kind,
          event: "transcode-failed",
          deliveryMode: session.deliveryMode,
          sourceTransport: session.sourceTransport,
          playerEngine: "relay",
          audioTrackId: session.selectedAudioTrackId,
          errorCode: "ffmpeg-exit",
          errorMessage: session.localState.lastError,
          detail: {
            exitCode: code
          }
        });
      }
      releaseTranscodeSlot(session.localState);
    });

    child.on("error", (error) => {
      if (session.localState) {
        session.localState.lastError = sanitizePlaybackErrorMessage(error.message);
        session.localState.process = null;
      }
      releaseTranscodeSlot(session.localState);
      void emitDiagnostic({
        itemId: session.itemId,
        kind: session.kind,
        event: "transcode-failed",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        playerEngine: "relay",
        audioTrackId: session.selectedAudioTrackId,
        errorCode: "ffmpeg-spawn-error",
        errorMessage: error.message
      });
    });

    return true;
  }

  async function prepareLocalSession(session: VodPlaybackSession) {
    if (!session.localState) {
      throw new Error("Local HLS state bulunamadi.");
    }

    const transcodeReady = await startFfmpegPipeline(session);
    if (transcodeReady) {
      return {
        ok: true,
        errorMessage: null
      };
    }

    return {
      ok: false,
      errorMessage: session.localState.lastError ?? "VOD akisi HLS formatina donusturulemedi."
    };
  }

  async function createPlayback(input: CreateVodPlaybackInput): Promise<VodPlaybackRecord> {
    const debugEnabled = input.debug === true || process.env.FLIXIFY_VOD_DEBUG === "1";
    const debugLog = (event: string, detail?: Record<string, unknown>) => {
      if (!debugEnabled) {
        return;
      }
      console.info("[vod-debug]", {
        event,
        userId: input.userId,
        itemId: input.itemId,
        kind: input.kind,
        ...(detail ?? {})
      });
    };

    const probe = await probeVodStream(input.sourceUrl);
    debugLog("probe-result", {
      ok: probe.ok,
      statusCode: probe.statusCode,
      finalUrl: probe.finalUrl,
      transport: probe.transport,
      supportsByteRange: probe.supportsByteRange,
      errorMessage: probe.errorMessage
    });
    const allowUnverifiedSource = input.allowUnverifiedSource === true;
    if ((!probe.ok || !probe.finalUrl) && !allowUnverifiedSource) {
      return buildDisabledPlaybackRecord({
        itemId: input.itemId,
        kind: input.kind,
        transport: probe.transport,
        deliveryMode: "hls_transcoded",
        errorMessage: probe.errorMessage ?? "VOD kaynagi dogrulanamadi."
      });
    }

    const effectiveSourceUrl = probe.finalUrl ?? input.sourceUrl;
    const effectiveTransport =
      probe.transport !== "unknown" ? probe.transport : (input.sourceTransportHint ?? "unknown");
    const isVerified = probe.ok && Boolean(probe.finalUrl);
    const supportsByteRange = isVerified ? probe.supportsByteRange : false;
    const mediaProfile = await probeVodMediaProfile(options.ffprobeBinary, effectiveSourceUrl, effectiveTransport);

    if (!isVerified && allowUnverifiedSource) {
      debugLog("probe-bypassed", {
        sourceUrl: input.sourceUrl,
        transportHint: input.sourceTransportHint ?? "unknown",
        probeError: probe.errorMessage
      });
    }

    debugLog("media-profile", {
      platform: input.platform ?? null,
      clientRuntime: input.clientRuntime ?? "browser",
      effectiveTransport,
      profileTransport: mediaProfile?.containerTransport ?? null,
      primaryVideoCodec: mediaProfile?.primaryVideoCodec ?? null,
      audioCodecs: mediaProfile?.audioCodecs ?? [],
      audioTrackCount: mediaProfile?.audioTracks.length ?? 0
    });

    const decision = resolveVodTranscodeDecision({
      transport: effectiveTransport,
      supportsByteRange,
      preferTranscode: input.preferTranscode === true,
      clientRuntime: input.clientRuntime,
      platform: input.platform,
      mediaProfile,
      selectedAudioTrackId: input.selectedAudioTrackId,
      debugPassthrough: debugEnabled
    });
    const canUseFfmpeg = decision.requiresFfmpeg ? await checkFfmpegAvailability() : true;

    if (decision.requiresFfmpeg && !canUseFfmpeg) {
      debugLog("unsupported-without-ffmpeg", {
        transport: effectiveTransport,
        preferTranscode: input.preferTranscode === true
      });
      return buildDisabledPlaybackRecord({
        itemId: input.itemId,
        kind: input.kind,
        transport: effectiveTransport,
        deliveryMode: "hls_transcoded",
        errorMessage: "Uyumluluk modu icin FFmpeg gerekli. Sunucuda FFmpeg bulunamadi."
      });
    }

    const deliveryMode: VodDeliveryMode = decision.deliveryMode;
    const shouldTranscode = deliveryMode === "hls_transcoded";
    const sourceAudioTracks = shouldTranscode ? (mediaProfile?.audioTracks ?? []) : [];
    const injectSilentAudioTrack = shouldTranscode && mediaProfile !== null && sourceAudioTracks.length === 0;
    const audioSelection = shouldTranscode
      ? selectVodAudioTrackId(sourceAudioTracks, input.selectedAudioTrackId)
      : { selectedTrackId: null, defaultTrackId: null };
    const audioTracks = shouldTranscode
      ? mapSourceTracksToVodAudioTracks(sourceAudioTracks, audioSelection.selectedTrackId)
      : [];

    await ensureDirectory(tempRoot);

    const session: VodPlaybackSession = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(32).toString("base64url"),
      userId: input.userId,
      itemId: input.itemId,
      kind: input.kind,
      baseOrigin: input.baseOrigin,
      sourceUrl: effectiveSourceUrl,
      cookie: mergeCookieHeaders(input.cookie, probe.cookie),
      sourceTransport: effectiveTransport,
      deliveryMode,
      expiresAt: Date.now() + sessionTtlMs,
      isVerified,
      audioTracks,
      defaultAudioTrackId: audioSelection.defaultTrackId,
      selectedAudioTrackId: audioSelection.selectedTrackId,
      proxyState:
        deliveryMode === "hls_proxy"
          ? {
              rootUrl: effectiveSourceUrl,
              assetToUrl: new Map(),
              urlToAsset: new Map()
            }
          : null,
      localState:
        deliveryMode !== "hls_transcoded"
          ? null
          : {
              tempDir: await fsp.mkdtemp(path.join(tempRoot, "session-")),
              manifestPath: path.join(tempRoot, "placeholder"),
              process: null,
              mode: null,
              lastError: null,
              startupFailed: false,
              sourceAudioTracks,
              injectSilentAudioTrack,
              ownsTranscodeSlot: false
            }
    };

    debugLog("session-created", {
      sourceTransport: session.sourceTransport,
      deliveryMode: session.deliveryMode,
      canUseFfmpeg,
      audioTrackCount: audioTracks.length,
      selectedAudioTrackId: session.selectedAudioTrackId,
      defaultAudioTrackId: session.defaultAudioTrackId,
      injectSilentAudioTrack
    });

    await emitDiagnostic({
      itemId: session.itemId,
      kind: session.kind,
      event: "session-created",
      deliveryMode: session.deliveryMode,
      sourceTransport: session.sourceTransport,
      audioTrackId: session.selectedAudioTrackId,
      detail: {
        audioTrackCount: session.audioTracks.length,
        defaultAudioTrackId: session.defaultAudioTrackId,
        selectedAudioTrackId: session.selectedAudioTrackId
      }
    });

    if (injectSilentAudioTrack) {
      await emitDiagnostic({
        itemId: session.itemId,
        kind: session.kind,
        event: "no-audio-detected",
        deliveryMode: session.deliveryMode,
        sourceTransport: session.sourceTransport,
        audioTrackId: session.selectedAudioTrackId
      });
    }

    if (session.localState) {
      session.localState.manifestPath = path.join(session.localState.tempDir, "index.m3u8");
      let prepared: { ok: boolean; errorMessage: string | null };
      try {
        prepared = await prepareLocalSession(session);
      } catch (error) {
        if (error instanceof VodPlaybackUnavailableError) {
          await destroySession(session);
          throw error;
        }
        const message = getUpstreamErrorMessage(error, "VOD transcode baslatilamadi.");
        await destroySession(session);
        return buildDisabledPlaybackRecord({
          itemId: input.itemId,
          kind: input.kind,
          transport: effectiveTransport,
          deliveryMode: "hls_transcoded",
          errorMessage: message
        });
      }
      if (!prepared.ok) {
        await destroySession(session);
        return buildDisabledPlaybackRecord({
          itemId: input.itemId,
          kind: input.kind,
          transport: effectiveTransport,
          deliveryMode: "hls_transcoded",
          errorMessage: prepared.errorMessage ?? "VOD akisi HLS formatina donusturulemedi."
        });
      }
    }

    sessions.set(session.id, session);

    return buildReadyPlaybackRecord(session);
  }

  function authorizeSession(sessionId: string, token: string | undefined | null) {
    const session = sessions.get(sessionId);
    if (!session || !isAuthorizedToken(session.token, token)) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      void destroySession(session);
      return null;
    }

    touchSession(session);
    return session;
  }

  async function fetchUpstream(session: VodPlaybackSession, url: string, options: FetchUpstreamOptions = {}) {
    const headers: Record<string, string> = {
      ...DEFAULT_REQUEST_HEADERS
    };

    if (session.cookie) {
      headers.cookie = session.cookie;
    }

    if (options.rangeHeader) {
      headers.range = options.rangeHeader;
    }

    if (options.kind === "manifest" || options.kind === "segment") {
      headers["cache-control"] = "no-cache";
      headers.pragma = "no-cache";
    }

    const defaultPolicy =
      options.kind === "manifest"
        ? VOD_MANIFEST_FETCH_POLICY
        : options.kind === "segment"
          ? VOD_SEGMENT_FETCH_POLICY
          : options.kind === "file"
            ? VOD_FILE_FETCH_POLICY
            : DEFAULT_FETCH_POLICY;
    const timeoutMs =
      typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
        ? Math.max(2_000, options.timeoutMs)
        : defaultPolicy.timeoutMs;
    const maxAttempts =
      typeof options.maxAttempts === "number" && Number.isFinite(options.maxAttempts)
        ? Math.max(1, Math.min(MAX_FETCH_ATTEMPTS, Math.floor(options.maxAttempts)))
        : defaultPolicy.maxAttempts;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout(
          url,
          {
            headers,
            redirect: "follow"
          },
          timeoutMs
        );

        if (response.headers.getSetCookie && typeof response.headers.getSetCookie === "function") {
          const setCookies = response.headers.getSetCookie();
          if (setCookies && setCookies.length > 0) {
            session.cookie = mergeCookieHeaders(
              session.cookie,
              ...setCookies.map((cookie) => cookie.split(";")[0]?.trim() ?? null)
            );
          }
        }

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
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableNetworkError(error)) {
          throw error;
        }
        await sleep(computeRetryDelayMs(attempt, defaultPolicy, null));
      }
    }

    throw lastError ?? new Error("Upstream fetch basarisiz.");
  }

  async function sendManifest(reply: FastifyReply, sessionId: string, token: string | undefined) {
    const session = authorizeSession(sessionId, token);
    if (!session) {
      return reply.status(403).type("text/plain; charset=utf-8").send("VOD oturumu gecersiz.");
    }

    if (session.deliveryMode === "hls_proxy" && session.proxyState) {
      let response: Response;
      try {
        response = await fetchUpstream(session, session.proxyState.rootUrl, {
          kind: "manifest"
        });
      } catch (error) {
        return reply
          .status(502)
          .type("text/plain; charset=utf-8")
          .send(getUpstreamErrorMessage(error, "Upstream HLS manifest alinamadi."));
      }
      if (!response.ok) {
        return reply.status(502).type("text/plain; charset=utf-8").send("Upstream HLS manifest alinamadi.");
      }

      const manifest = await response.text();
      const rewritten = rewriteProxyManifest(manifest, response.url || session.proxyState.rootUrl, session);
      return reply
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", VOD_PLAYLIST_NO_CACHE_HEADER)
        .header("pragma", "no-cache")
        .header("expires", "0")
        .send(rewritten);
    }

    if (!session.localState) {
      return reply.status(404).type("text/plain; charset=utf-8").send("VOD manifest bulunamadi.");
    }

    const ready = await waitForFile(session.localState.manifestPath, 8_000, manifestLineExists);
    if (!ready) {
      return reply.status(503).type("text/plain; charset=utf-8").send("VOD manifest henuz hazir degil.");
    }

    const manifest = await fsp.readFile(session.localState.manifestPath, "utf8");
    return reply
      .header("content-type", "application/vnd.apple.mpegurl")
      .header("cache-control", VOD_PLAYLIST_NO_CACHE_HEADER)
      .header("pragma", "no-cache")
      .header("expires", "0")
      .send(rewriteLocalManifest(manifest, session));
  }

  async function sendProxyAsset(reply: FastifyReply, sessionId: string, token: string | undefined, assetId: string) {
    const session = authorizeSession(sessionId, token);
    if (!session || !session.proxyState) {
      return reply.status(403).type("text/plain; charset=utf-8").send("VOD oturumu gecersiz.");
    }

    const targetUrl = session.proxyState.assetToUrl.get(assetId);
    if (!targetUrl) {
      return reply.status(404).type("text/plain; charset=utf-8").send("VOD asset bulunamadi.");
    }

    let response: Response;
    try {
      response = await fetchUpstream(session, targetUrl, {
        kind: "segment"
      });
    } catch (error) {
      return reply
        .status(502)
        .type("text/plain; charset=utf-8")
        .send(getUpstreamErrorMessage(error, "Upstream VOD asset alinamadi."));
    }
    if (!response.ok) {
      return reply.status(502).type("text/plain; charset=utf-8").send("Upstream VOD asset alinamadi.");
    }

    const contentType = response.headers.get("content-type");
    if (isHlsManifest(response.url || targetUrl, contentType)) {
      const manifest = await response.text();
      const rewritten = rewriteProxyManifest(manifest, response.url || targetUrl, session);
      return reply
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", VOD_PLAYLIST_NO_CACHE_HEADER)
        .header("pragma", "no-cache")
        .header("expires", "0")
        .send(rewritten);
    }

    return streamFetchResponse(reply, response);
  }

  async function sendLocalAsset(reply: FastifyReply, sessionId: string, token: string | undefined, fileName: string) {
    const session = authorizeSession(sessionId, token);
    if (!session || !session.localState) {
      return reply.status(403).type("text/plain; charset=utf-8").send("VOD oturumu gecersiz.");
    }

    const safeFileName = sanitizeLocalAssetName(decodeURIComponent(fileName));
    if (!safeFileName) {
      return reply.status(404).type("text/plain; charset=utf-8").send("VOD dosyasi bulunamadi.");
    }

    const filePath = path.join(session.localState.tempDir, safeFileName);
    const exists = await waitForFile(
      filePath,
      safeFileName.endsWith(".m3u8") ? 8_000 : 12_000,
      safeFileName.endsWith(".m3u8") ? manifestLineExists : undefined
    );

    if (!exists) {
      return reply.status(404).type("text/plain; charset=utf-8").send("VOD dosyasi henuz hazir degil.");
    }

    if (safeFileName.endsWith(".m3u8")) {
      const manifest = await fsp.readFile(filePath, "utf8");
      return reply
        .header("content-type", "application/vnd.apple.mpegurl")
        .header("cache-control", VOD_PLAYLIST_NO_CACHE_HEADER)
        .header("pragma", "no-cache")
        .header("expires", "0")
        .send(rewriteLocalManifest(manifest, session));
    }

    reply.header("content-type", getLocalContentType(filePath));
    reply.header("cache-control", "private, max-age=30");
    return reply.send(fs.createReadStream(filePath));
  }

  async function sendFile(
    reply: FastifyReply,
    sessionId: string,
    token: string | undefined,
    rangeHeader?: string | null
  ) {
    const session = authorizeSession(sessionId, token);
    if (!session) {
      return reply.status(403).type("text/plain; charset=utf-8").send("VOD oturumu gecersiz.");
    }

    let response: Response;
    try {
      response = await fetchUpstream(session, session.sourceUrl, {
        rangeHeader,
        kind: "file"
      });
    } catch (error) {
      return reply
        .status(502)
        .type("text/plain; charset=utf-8")
        .send(getUpstreamErrorMessage(error, "Upstream VOD dosyasi alinamadi."));
    }
    if (rangeHeader && [405, 409, 416].includes(response.status)) {
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      try {
        response = await fetchUpstream(session, session.sourceUrl, {
          kind: "file"
        });
      } catch (error) {
        return reply
          .status(502)
          .type("text/plain; charset=utf-8")
          .send(getUpstreamErrorMessage(error, "Upstream VOD dosyasi alinamadi."));
      }
    }
    if (!response.ok && response.status !== 206) {
      return reply.status(502).type("text/plain; charset=utf-8").send("Upstream VOD dosyasi alinamadi.");
    }

    if (process.env.FLIXIFY_VOD_DEBUG === "1") {
      console.info("[vod-debug]", {
        event: "file-proxy-response",
        sessionId,
        sourceTransport: session.sourceTransport,
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
        contentEncoding: response.headers.get("content-encoding")
      });
    }

    return streamFetchResponse(reply, response, {
      fallbackContentType: getFallbackContentTypeForTransport(session.sourceTransport)
    });
  }

  async function dispose() {
    clearInterval(cleanupTimer);
    const activeSessions = [...sessions.values()];
    sessions.clear();
    for (const session of activeSessions) {
      await destroySession(session);
    }
  }

  return {
    createPlayback,
    sendManifest,
    sendProxyAsset,
    sendLocalAsset,
    sendFile,
    dispose
  };
}
