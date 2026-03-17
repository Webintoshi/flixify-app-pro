import type { IncomingHttpHeaders } from "node:http";

const METHODS_WITHOUT_BODY = new Set([
  "GET",
  "HEAD",
  "DELETE",
  "OPTIONS"
]);

function getFirstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function shouldStripEmptyJsonContentType(
  method: string | undefined,
  headers: IncomingHttpHeaders
) {
  const normalizedMethod = (method ?? "").toUpperCase();
  if (!METHODS_WITHOUT_BODY.has(normalizedMethod)) {
    return false;
  }

  const contentType = getFirstHeaderValue(headers["content-type"])?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return false;
  }

  const transferEncoding = getFirstHeaderValue(headers["transfer-encoding"]);
  if (typeof transferEncoding === "string" && transferEncoding.trim().length > 0) {
    return false;
  }

  const contentLengthRaw = getFirstHeaderValue(headers["content-length"]);
  if (!contentLengthRaw) {
    return true;
  }

  const contentLength = Number.parseInt(contentLengthRaw, 10);
  if (Number.isNaN(contentLength)) {
    return false;
  }

  return contentLength <= 0;
}

export function stripEmptyJsonContentType(
  method: string | undefined,
  headers: IncomingHttpHeaders
) {
  if (shouldStripEmptyJsonContentType(method, headers)) {
    delete headers["content-type"];
  }
}
