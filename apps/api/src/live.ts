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

async function probeUrl(url: string, redirects = 0, useRange = true): Promise<{
  ok: boolean;
  statusCode: number;
  finalUrl: string;
  transport: LiveTransport;
  errorMessage: string | null;
}> {
  return new Promise((resolve, reject) => {
    const request = getClient(url).get(
      url,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
          accept: "*/*",
          ...(useRange ? { range: "bytes=0-65535" } : {})
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
            const redirectUrl = new URL(location, url).toString();
            resolve(await probeUrl(redirectUrl, redirects + 1, useRange));
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
              resolve(await probeUrl(url, redirects, false));
              return;
            }

            response.resume();
            resolve({
              ok: false,
              statusCode,
              finalUrl,
              transport,
              errorMessage: `Upstream ${statusCode}`
            });
            return;
          }

          const firstChunkBytes = await readFirstChunk(response);
          if (useRange && firstChunkBytes === 0) {
            resolve(await probeUrl(url, redirects, false));
            return;
          }

          if (firstChunkBytes === 0) {
            resolve({
              ok: false,
              statusCode,
              finalUrl,
              transport,
              errorMessage: "Akistan veri okunamadi."
            });
            return;
          }

          resolve({
            ok: true,
            statusCode,
            finalUrl,
            transport,
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
