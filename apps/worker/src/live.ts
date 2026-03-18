import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import { spawn } from "node:child_process";

export type LiveTransport = "ts" | "hls" | "mp4" | "mkv" | "unknown";
export type LiveProbeFailureCategory =
  | "hard-http"
  | "upstream-http"
  | "empty-stream"
  | "transport-unknown"
  | "audio-missing"
  | "probe-timeout"
  | "network"
  | "unknown";

export type LiveProbeResult = {
  ok: boolean;
  transport: LiveTransport;
  errorMessage: string | null;
  statusCode: number | null;
  failureCategory: LiveProbeFailureCategory | null;
  hasAudio: boolean | null;
};

const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const AUDIO_PROBE_TIMEOUT_MS = 8000;
const FFPROBE_BINARY = process.env.FFPROBE_BINARY?.trim() || "ffprobe";

let ffprobeAvailabilityPromise: Promise<boolean> | null = null;

function getClient(url: string) {
  return url.startsWith("https:") ? https : http;
}

function normalizeContentType(value: string | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function trimErrorMessage(value: string, fallback: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeFailureCategory(statusCode: number): LiveProbeFailureCategory {
  if (statusCode >= 400 && statusCode < 500) {
    return "hard-http";
  }
  return "upstream-http";
}

export function detectLiveTransport(url: string, contentType?: string | null): LiveTransport {
  const normalizedType = normalizeContentType(contentType ?? undefined);

  if (
    normalizedType.includes("application/vnd.apple.mpegurl") ||
    normalizedType.includes("application/x-mpegurl") ||
    /\.m3u8(?:$|\?)/i.test(url)
  ) {
    return "hls";
  }

  if (normalizedType.includes("video/mp2t") || /\.ts(?:$|\?)/i.test(url)) {
    return "ts";
  }

  if (normalizedType.includes("video/mp4") || /\.mp4(?:$|\?)/i.test(url)) {
    return "mp4";
  }

  if (
    normalizedType.includes("video/x-matroska") ||
    normalizedType.includes("application/octet-stream") ||
    /\.mkv(?:$|\?)/i.test(url)
  ) {
    return /\.mkv(?:$|\?)/i.test(url) ? "mkv" : "unknown";
  }

  return "unknown";
}

function resolveRedirectUrl(currentUrl: string, location: string) {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}

function readFirstChunk(response: IncomingMessage) {
  return new Promise<number>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      response.removeAllListeners("data");
      response.removeAllListeners("error");
      response.removeAllListeners("end");
      response.removeAllListeners("close");
    };

    response.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      response.destroy();
      resolve(chunk.length);
    });

    response.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(0);
    });

    response.on("close", () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(0);
    });

    response.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    });
  });
}

async function isFfprobeAvailable() {
  if (!ffprobeAvailabilityPromise) {
    ffprobeAvailabilityPromise = new Promise<boolean>((resolve) => {
      const child = spawn(FFPROBE_BINARY, ["-version"], {
        stdio: ["ignore", "ignore", "ignore"]
      });
      child.once("error", () => resolve(false));
      child.once("close", (code) => resolve(code === 0));
    });
  }
  return ffprobeAvailabilityPromise;
}

async function probeAudioTrackPresence(url: string): Promise<{ hasAudio: boolean | null }> {
  const available = await isFfprobeAvailable();
  if (!available) {
    return { hasAudio: null };
  }

  return new Promise((resolve) => {
    let timedOut = false;
    let stdoutOutput = "";
    let stderrOutput = "";
    const child = spawn(
      FFPROBE_BINARY,
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "json",
        "-rw_timeout",
        "12000000",
        url
      ],
      {
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, AUDIO_PROBE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutOutput = `${stdoutOutput}${chunk.toString("utf8")}`.slice(-32_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrOutput = `${stderrOutput}${chunk.toString("utf8")}`.slice(-8_000);
    });

    child.once("error", () => {
      clearTimeout(timeout);
      resolve({ hasAudio: null });
    });

    child.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolve({ hasAudio: null });
        return;
      }

      if (code !== 0) {
        const normalizedError = trimErrorMessage(stderrOutput, "Audio stream probe basarisiz.");
        const lowered = normalizedError.toLowerCase();
        if (lowered.includes("unauthorized") || lowered.includes("forbidden") || lowered.includes("404")) {
          resolve({ hasAudio: null });
          return;
        }
        resolve({ hasAudio: null });
        return;
      }

      try {
        const parsed = JSON.parse(stdoutOutput) as { streams?: unknown[] };
        resolve({ hasAudio: Array.isArray(parsed.streams) && parsed.streams.length > 0 });
      } catch {
        resolve({ hasAudio: null });
      }
    });
  });
}

async function probeUrl(url: string, redirects = 0): Promise<LiveProbeResult> {
  return new Promise((resolve, reject) => {
    const request = getClient(url).get(
      url,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
          accept: "*/*",
          range: "bytes=0-65535"
        }
      },
      async (response) => {
        try {
          const statusCode = response.statusCode ?? 0;
          const location = response.headers.location;
          if (
            [301, 302, 303, 307, 308].includes(statusCode) &&
            location &&
            redirects < MAX_REDIRECTS
          ) {
            response.resume();
            const nextUrl = resolveRedirectUrl(url, location);
            if (!nextUrl) {
              resolve({
                ok: false,
                transport: detectLiveTransport(url),
                errorMessage: "Redirect URL cozumlenemedi.",
                statusCode,
                failureCategory: "unknown",
                hasAudio: null
              });
              return;
            }
            resolve(await probeUrl(nextUrl, redirects + 1));
            return;
          }

          const transport = detectLiveTransport(
            url,
            typeof response.headers["content-type"] === "string"
              ? response.headers["content-type"]
              : null
          );

          if (statusCode >= 400) {
            response.resume();
            resolve({
              ok: false,
              transport,
              errorMessage: `Upstream ${statusCode}`,
              statusCode,
              failureCategory: normalizeFailureCategory(statusCode),
              hasAudio: null
            });
            return;
          }

          const firstChunkBytes = await readFirstChunk(response);
          if (transport === "unknown" || firstChunkBytes === 0) {
            resolve({
              ok: false,
              transport,
              errorMessage: firstChunkBytes === 0 ? "Akistan veri okunamadi." : "Transport taninamadi.",
              statusCode: statusCode || null,
              failureCategory: firstChunkBytes === 0 ? "empty-stream" : "transport-unknown",
              hasAudio: null
            });
            return;
          }

          const audioProbe = await probeAudioTrackPresence(url);
          if (audioProbe.hasAudio === false) {
            resolve({
              ok: false,
              transport,
              errorMessage: "Yayinda ses izi bulunamadi.",
              statusCode: statusCode || null,
              failureCategory: "audio-missing",
              hasAudio: false
            });
            return;
          }

          resolve({
            ok: true,
            transport,
            errorMessage: null,
            statusCode: statusCode || null,
            failureCategory: null,
            hasAudio: audioProbe.hasAudio
          });
        } catch (error) {
          reject(error);
        }
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Canli yayin probe timeout."));
    });
    request.on("error", reject);
  });
}

export async function probeLiveStream(url: string) {
  try {
    return await probeUrl(url);
  } catch (error) {
    const normalizedMessage =
      error instanceof Error ? trimErrorMessage(error.message, "Canli yayin probe basarisiz.") : "Canli yayin probe basarisiz.";
    const normalizedLower = normalizedMessage.toLowerCase();
    return {
      ok: false,
      transport: detectLiveTransport(url),
      errorMessage: normalizedMessage,
      statusCode: null,
      failureCategory: normalizedLower.includes("timeout") ? "probe-timeout" : "network",
      hasAudio: null
    };
  }
}

export function classifyLiveProbeHealth(probe: Pick<LiveProbeResult, "ok" | "failureCategory">) {
  if (probe.ok) {
    return "healthy" as const;
  }

  if (
    probe.failureCategory === "hard-http" ||
    probe.failureCategory === "audio-missing" ||
    probe.failureCategory === "empty-stream" ||
    probe.failureCategory === "transport-unknown"
  ) {
    return "broken" as const;
  }

  return "degraded" as const;
}
