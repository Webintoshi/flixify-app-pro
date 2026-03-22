import crypto from "node:crypto";
import type {
  NativePlaybackSource,
  NativePlaybackTransport,
  NativeVodDeliveryMode,
  NativeVodPlaybackSource,
  VodAudioTrack
} from "@flixify/contracts";

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

export function buildNativeVodPlaybackSource(input: {
  url: string;
  transport: NativePlaybackTransport;
  deliveryMode: NativeVodDeliveryMode;
  audioTracks?: VodAudioTrack[];
  defaultAudioTrackId?: string | null;
  selectedAudioTrackId?: string | null;
  cookie?: string | null;
  headers?: Record<string, string> | null;
  userAgent?: string | null;
  diagnosticsSessionId?: string | null;
  isVerified: boolean;
  lastCheckedAt?: string | null;
}): NativeVodPlaybackSource {
  return {
    ...buildNativePlaybackSource({
      url: input.url,
      transport: input.transport,
      cookie: input.cookie ?? null,
      headers: input.headers ?? null,
      userAgent: input.userAgent ?? null,
      diagnosticsSessionId: input.diagnosticsSessionId ?? null,
      isVerified: input.isVerified,
      lastCheckedAt: input.lastCheckedAt ?? null
    }),
    deliveryMode: input.deliveryMode,
    audioTracks: input.audioTracks ?? [],
    defaultAudioTrackId: input.defaultAudioTrackId ?? null,
    selectedAudioTrackId: input.selectedAudioTrackId ?? null
  };
}
