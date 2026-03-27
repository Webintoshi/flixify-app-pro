import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import sharp from "sharp";
import { env } from "./env.js";

export const LIVE_LOGO_PROXY_PATH = "/artwork/live-logo";
export const LIVE_LOGO_PROXY_TTL_SECONDS = 24 * 60 * 60;
export const LIVE_LOGO_PROXY_TIMEOUT_MS = 5_000;
export const LIVE_LOGO_PROXY_MAX_REDIRECTS = 3;
export const LIVE_LOGO_PROXY_MAX_BYTES = 2 * 1024 * 1024;

const LIVE_LOGO_PROXY_PURPOSE = "live-logo";
const ARTWORK_PROXY_ACCEPT_HEADER =
  "image/jpeg,image/png,image/webp,image/gif,image/apng,image/svg+xml,image/*;q=0.8,*/*;q=0.5";
const SAFE_NATIVE_ARTWORK_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/tiff",
  "image/x-tga",
  "image/x-portable-bitmap",
  "image/x-portable-graymap",
  "image/x-portable-pixmap",
  "image/x-portable-anymap",
  "image/wbmp"
]);
const blockedAddressList = new BlockList();

blockedAddressList.addAddress("0.0.0.0", "ipv4");
blockedAddressList.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddressList.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddressList.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddressList.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddressList.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddressList.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddressList.addSubnet("::", 128, "ipv6");
blockedAddressList.addSubnet("::1", 128, "ipv6");
blockedAddressList.addSubnet("fc00::", 7, "ipv6");
blockedAddressList.addSubnet("fe80::", 10, "ipv6");

export class LiveLogoProxyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "LiveLogoProxyError";
  }
}

function normalizeHostname(hostname: string) {
  const trimmed = hostname.trim().toLowerCase();
  const withoutBrackets = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  const zoneIndex = withoutBrackets.indexOf("%");
  return zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets;
}

function isBlockedIpAddress(address: string) {
  const normalized = normalizeHostname(address);
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedIpv4?.[1]) {
    return isBlockedIpAddress(mappedIpv4[1]);
  }

  const family = isIP(normalized);
  if (family === 0) {
    return false;
  }

  return blockedAddressList.check(normalized, family === 6 ? "ipv6" : "ipv4");
}

export function isBlockedArtworkHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return true;
  }

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  return isBlockedIpAddress(normalized);
}

function normalizeArtworkSourceUrl(sourceUrl: string) {
  try {
    const parsed = new URL(sourceUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function encodeSourceUrl(sourceUrl: string) {
  return Buffer.from(sourceUrl, "utf8").toString("base64url");
}

function decodeSourceUrl(encodedSourceUrl: string) {
  try {
    return Buffer.from(encodedSourceUrl, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function createSignaturePayload(encodedSourceUrl: string, expiresAt: number) {
  return `${LIVE_LOGO_PROXY_PURPOSE}:${encodedSourceUrl}:${expiresAt}`;
}

function signEncodedSourceUrl(encodedSourceUrl: string, expiresAt: number) {
  return crypto.createHmac("sha256", env.APP_JWT_SECRET).update(createSignaturePayload(encodedSourceUrl, expiresAt)).digest("hex");
}

function isValidSignature(encodedSourceUrl: string, expiresAt: number, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = signEncodedSourceUrl(encodedSourceUrl, expiresAt);
  return crypto.timingSafeEqual(Buffer.from(signature.toLowerCase(), "utf8"), Buffer.from(expected, "utf8"));
}

export function createSignedLiveLogoUrl(
  sourceUrl: string | null | undefined,
  origin: string,
  options: { nowMs?: number; ttlSeconds?: number } = {}
) {
  const normalizedSourceUrl = typeof sourceUrl === "string" ? normalizeArtworkSourceUrl(sourceUrl.trim()) : null;
  if (!normalizedSourceUrl) {
    return null;
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(origin);
  } catch {
    return null;
  }

  const nowMs = options.nowMs ?? Date.now();
  const ttlSeconds = options.ttlSeconds ?? LIVE_LOGO_PROXY_TTL_SECONDS;
  const expiresAt = Math.floor(nowMs / 1000) + ttlSeconds;
  const encodedSourceUrl = encodeSourceUrl(normalizedSourceUrl);
  const signedUrl = new URL(LIVE_LOGO_PROXY_PATH, baseUrl);

  signedUrl.searchParams.set("u", encodedSourceUrl);
  signedUrl.searchParams.set("exp", String(expiresAt));
  signedUrl.searchParams.set("sig", signEncodedSourceUrl(encodedSourceUrl, expiresAt));

  return signedUrl.toString();
}

export function createCatalogArtworkUrl(input: {
  sourceUrl: string | null | undefined;
  origin: string;
  clientRuntime?: "browser" | "app" | "native";
  options?: { nowMs?: number; ttlSeconds?: number };
}) {
  const trimmed = typeof input.sourceUrl === "string" ? input.sourceUrl.trim() : "";
  const normalizedSourceUrl = trimmed ? normalizeArtworkSourceUrl(trimmed) : null;
  if (normalizedSourceUrl) {
    const parsed = new URL(normalizedSourceUrl);
    if (isBlockedArtworkHostname(parsed.hostname)) {
      return input.clientRuntime === "browser" ? null : normalizedSourceUrl;
    }
  }

  const signedUrl = createSignedLiveLogoUrl(input.sourceUrl, input.origin, input.options);
  if (signedUrl) {
    return signedUrl;
  }

  if (input.clientRuntime === "browser") {
    return null;
  }

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("//")) {
    return trimmed;
  }

  return normalizedSourceUrl;
}

export function signLiveLogoItems<T extends { logoUrl: string | null }>(
  items: readonly T[],
  origin: string,
  options: { nowMs?: number; ttlSeconds?: number } = {}
) {
  return items.map((item) => ({
    ...item,
    logoUrl: createSignedLiveLogoUrl(item.logoUrl, origin, options)
  }));
}

function readSingleQueryValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function verifySignedLiveLogoQuery(query: Record<string, unknown>, nowMs = Date.now()) {
  const encodedSourceUrl = readSingleQueryValue(query.u);
  const expiresAtValue = readSingleQueryValue(query.exp);
  const signature = readSingleQueryValue(query.sig);

  if (!encodedSourceUrl || !expiresAtValue || !signature) {
    return {
      ok: false as const,
      error: new LiveLogoProxyError("Eksik logo parametreleri.", 400)
    };
  }

  const expiresAt = Number.parseInt(expiresAtValue, 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return {
      ok: false as const,
      error: new LiveLogoProxyError("Gecersiz logo suresi.", 400)
    };
  }

  if (!isValidSignature(encodedSourceUrl, expiresAt, signature)) {
    return {
      ok: false as const,
      error: new LiveLogoProxyError("Logo imzasi gecersiz.", 403)
    };
  }

  if (Math.floor(nowMs / 1000) > expiresAt) {
    return {
      ok: false as const,
      error: new LiveLogoProxyError("Logo baglantisinin suresi dolmus.", 403)
    };
  }

  const decodedSourceUrl = decodeSourceUrl(encodedSourceUrl);
  const normalizedSourceUrl = decodedSourceUrl ? normalizeArtworkSourceUrl(decodedSourceUrl) : null;
  if (!normalizedSourceUrl) {
    return {
      ok: false as const,
      error: new LiveLogoProxyError("Gecersiz logo adresi.", 400)
    };
  }

  return {
    ok: true as const,
    value: {
      sourceUrl: normalizedSourceUrl,
      expiresAt
    }
  };
}

async function assertAllowedArtworkUrl(sourceUrl: string) {
  const parsed = new URL(sourceUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new LiveLogoProxyError("Desteklenmeyen logo protokolu.", 400);
  }
  if (parsed.username || parsed.password) {
    throw new LiveLogoProxyError("Kimlik bilgisi iceren logo adreslerine izin verilmiyor.", 403);
  }

  if (isBlockedArtworkHostname(parsed.hostname)) {
    throw new LiveLogoProxyError("Yerel veya ozel ağa yonelen logo adreslerine izin verilmiyor.", 403);
  }

  const lookupResults = await lookup(parsed.hostname, {
    all: true,
    verbatim: true
  });

  if (lookupResults.length === 0 || lookupResults.some((result) => isBlockedIpAddress(result.address))) {
    throw new LiveLogoProxyError("Logo adresi guvenli bir hedefe cozumlenmedi.", 403);
  }

  return parsed;
}

function isRedirectStatus(statusCode: number) {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function normalizeArtworkContentType(contentType: string) {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

async function normalizeArtworkForNativeClient(body: Buffer, contentType: string) {
  const normalizedContentType = normalizeArtworkContentType(contentType);
  if (!normalizedContentType.startsWith("image/")) {
    throw new LiveLogoProxyError("Logo kaynagi gorsel donmedi.", 502);
  }

  if (SAFE_NATIVE_ARTWORK_TYPES.has(normalizedContentType)) {
    return {
      body,
      contentType,
      transformed: false
    };
  }

  try {
    const convertedBody = await sharp(body, { animated: true }).png().toBuffer();
    return {
      body: convertedBody,
      contentType: "image/png",
      transformed: true
    };
  } catch {
    return {
      body,
      contentType,
      transformed: false
    };
  }
}

export async function fetchLiveLogoFromUpstream(
  sourceUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxRedirects?: number;
    maxBytes?: number;
  } = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? LIVE_LOGO_PROXY_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? LIVE_LOGO_PROXY_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? LIVE_LOGO_PROXY_MAX_BYTES;

  let currentUrl = await assertAllowedArtworkUrl(sourceUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: abortController.signal,
        headers: {
          accept: ARTWORK_PROXY_ACCEPT_HEADER
        }
      });
    } catch (error) {
      throw new LiveLogoProxyError(
        error instanceof Error && error.name === "AbortError"
          ? "Logo istegi zaman asimina ugradi."
          : "Logo kaynagina ulasilamadi.",
        502
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (isRedirectStatus(response.status)) {
      const redirectLocation = response.headers.get("location");
      if (!redirectLocation) {
        throw new LiveLogoProxyError("Logo yonlendirmesi gecersiz.", 502);
      }
      if (redirectCount >= maxRedirects) {
        throw new LiveLogoProxyError("Logo istegi cok fazla yonlendirildi.", 502);
      }
      currentUrl = await assertAllowedArtworkUrl(new URL(redirectLocation, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new LiveLogoProxyError(`Logo kaynagi ${response.status} dondu.`, 502);
    }

    const contentType = response.headers.get("content-type")?.trim() ?? "";
    const normalizedContentType = normalizeArtworkContentType(contentType);
    if (!normalizedContentType.startsWith("image/")) {
      throw new LiveLogoProxyError("Logo kaynagi gorsel donmedi.", 502);
    }

    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new LiveLogoProxyError("Logo dosyasi cok buyuk.", 502);
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) {
      throw new LiveLogoProxyError("Logo cevabi bos geldi.", 502);
    }
    if (body.length > maxBytes) {
      throw new LiveLogoProxyError("Logo dosyasi cok buyuk.", 502);
    }

    const normalizedArtwork = await normalizeArtworkForNativeClient(body, contentType);

    return {
      body: normalizedArtwork.body,
      contentType: normalizedArtwork.contentType,
      etag: normalizedArtwork.transformed ? null : response.headers.get("etag"),
      lastModified: normalizedArtwork.transformed ? null : response.headers.get("last-modified")
    };
  }

  throw new LiveLogoProxyError("Logo istegi tamamlanamadi.", 502);
}
