import crypto from "node:crypto";
import type { NativePlaybackSource, NativePlaybackTransport } from "@flixify/contracts";

export const NATIVE_PLAYBACK_USER_AGENT = "VLC/3.0.4 LibVLC/3.0.4";

export function buildNativePlaybackSource(input: {
  url: string;
  transport: NativePlaybackTransport;
  cookie?: string | null;
  headers?: Record<string, string> | null;
  userAgent?: string | null;
  diagnosticsSessionId?: string | null;
  variantGroupKey?: string | null;
  qualityRank?: number | null;
  isVerified: boolean;
  lastCheckedAt?: string | null;
}): NativePlaybackSource {
  return {
    url: input.url,
    transport: input.transport,
    headers: input.headers ?? {},
    cookie: input.cookie ?? null,
    userAgent: input.userAgent ?? NATIVE_PLAYBACK_USER_AGENT,
    allowInsecureHttp: input.url.trim().toLowerCase().startsWith("http://"),
    diagnosticsSessionId: input.diagnosticsSessionId ?? crypto.randomUUID(),
    variantGroupKey: input.variantGroupKey ?? null,
    qualityRank: input.qualityRank ?? null,
    isVerified: input.isVerified,
    lastCheckedAt: input.lastCheckedAt ?? null
  };
}
