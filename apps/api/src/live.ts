import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { LiveHealthStatus, LiveTransport } from "@flixify/contracts";

const REQUEST_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

function getClient(url: string) {
  return url.startsWith("https:") ? https : http;
}

function normalizeContentType(value: string | undefined) {
  return value?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function detectTransportFromParts(url: string, contentType?: string | null): LiveTransport {
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

function readFirstChunk(response: IncomingMessage) {
  return new Promise<Buffer | null>((resolve, reject) => {
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
      resolve(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    response.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(null);
    });

    response.on("close", () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(null);
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

function extractEmbeddedUpstreamStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const status = (payload as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) && status >= 400 ? status : null;
}

function extractStructuredErrorMessage(
  chunk: Buffer | null,
  contentType: string | string[] | undefined
): { statusCode: number | null; errorMessage: string | null } {
  if (!chunk || chunk.length === 0) {
    return {
      statusCode: null,
      errorMessage: null
    };
  }

  const normalizedType = normalizeContentType(typeof contentType === "string" ? contentType : contentType?.[0]);
  const text = chunk.toString("utf8").trim();
  if (!text) {
    return {
      statusCode: null,
      errorMessage: null
    };
  }

  const looksTextual =
    normalizedType.includes("application/json") ||
    normalizedType.startsWith("text/") ||
    text.startsWith("{") ||
    text.startsWith("[") ||
    text.startsWith("<");

  if (!looksTextual) {
    return {
      statusCode: null,
      errorMessage: null
    };
  }

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const payload = JSON.parse(text) as { error?: unknown; message?: unknown; status?: unknown };
      const embeddedStatus = extractEmbeddedUpstreamStatus(payload);
      const message =
        typeof payload.message === "string"
          ? payload.message.trim()
          : typeof payload.error === "string"
            ? payload.error.trim()
            : "";

      if (embeddedStatus !== null || message) {
        return {
          statusCode: embeddedStatus,
          errorMessage: message || (embeddedStatus !== null ? `Upstream ${embeddedStatus}` : "Upstream JSON hata dondu.")
        };
      }
    } catch {
      return {
        statusCode: null,
        errorMessage: normalizedType.includes("application/json") ? "Upstream JSON hata dondu." : null
      };
    }
  }

  if (normalizedType.startsWith("text/") || text.startsWith("<")) {
    return {
      statusCode: null,
      errorMessage: text.slice(0, 160)
    };
  }

  return {
    statusCode: null,
    errorMessage: null
  };
}

async function probeUrl(url: string, redirects = 0, useRange = true, accumulatedCookies: string[] = []): Promise<{
  ok: boolean;
  statusCode: number;
  finalUrl: string;
  transport: LiveTransport;
  cookie: string | null;
  errorMessage: string | null;
}> {
  return new Promise((resolve, reject) => {
    const request = getClient(url).get(
      url,
      {
        headers: {
          "user-agent": "VLC/3.0.4 LibVLC/3.0.4",
          accept: "*/*",
          ...(accumulatedCookies.length > 0 ? { cookie: accumulatedCookies.join("; ") } : {}),
          ...(useRange ? { range: "bytes=0-65535" } : {})
        }
      },
      async (response) => {
        try {
          const statusCode = response.statusCode ?? 0;
          const setCookieHeaders = response.headers["set-cookie"];
          if (Array.isArray(setCookieHeaders)) {
            for (const c of setCookieHeaders) {
              const baseCookie = c.split(";")[0];
              if (baseCookie) accumulatedCookies.push(baseCookie.trim());
            }
          }
          const locationHeader = response.headers.location;

          if (
            [301, 302, 303, 307, 308].includes(statusCode) &&
            locationHeader &&
            redirects < MAX_REDIRECTS
          ) {
            response.resume();
            const redirectUrl = new URL(locationHeader, url).toString();
            resolve(await probeUrl(redirectUrl, redirects + 1, useRange, accumulatedCookies));
            return;
          }

          const finalUrl = url;
          const transport = detectTransportFromParts(
            finalUrl,
            typeof response.headers["content-type"] === "string"
              ? response.headers["content-type"]
              : null
          );

          if (statusCode >= 400) {
            if (
              useRange &&
              [400, 403, 404, 405, 416, 501].includes(statusCode)
            ) {
              response.resume();
              resolve(await probeUrl(url, redirects, false, accumulatedCookies));
              return;
            }

            response.resume();
            resolve({
              ok: false,
              statusCode,
              finalUrl,
              transport,
              cookie: null,
              errorMessage: `Upstream ${statusCode}`
            });
            return;
          }

          const firstChunk = await readFirstChunk(response);
          if (useRange && (!firstChunk || firstChunk.length === 0)) {
            resolve(await probeUrl(url, redirects, false, accumulatedCookies));
            return;
          }

          if (!firstChunk || firstChunk.length === 0) {
            resolve({
              ok: false,
              statusCode,
              finalUrl,
              transport,
              cookie: null,
              errorMessage: "Akistan veri okunamadi."
            });
            return;
          }

          const structuredError = extractStructuredErrorMessage(firstChunk, response.headers["content-type"]);
          if (structuredError.errorMessage) {
            resolve({
              ok: false,
              statusCode: structuredError.statusCode ?? statusCode,
              finalUrl,
              transport,
              cookie: accumulatedCookies.length > 0 ? accumulatedCookies.join("; ") : null,
              errorMessage: structuredError.errorMessage
            });
            return;
          }

          resolve({
            ok: true,
            statusCode,
            finalUrl,
            transport,
            cookie: accumulatedCookies.length > 0 ? accumulatedCookies.join("; ") : null,
            errorMessage: null
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

export function detectLiveTransport(url: string, contentType?: string | null): LiveTransport {
  return detectTransportFromParts(url, contentType);
}

export async function probeLiveStream(url: string) {
  try {
    return await probeUrl(url);
  } catch (error) {
    return {
      ok: false,
      statusCode: 0,
      finalUrl: url,
      transport: detectTransportFromParts(url),
      cookie: null,
      errorMessage: error instanceof Error ? error.message : "Canli yayin probe basarisiz."
    };
  }
}

export function computeHealthStatus(failureCount: number): LiveHealthStatus {
  if (failureCount >= 12) {
    return "broken";
  }
  if (failureCount >= 4) {
    return "degraded";
  }
  return failureCount > 0 ? "degraded" : "healthy";
}
