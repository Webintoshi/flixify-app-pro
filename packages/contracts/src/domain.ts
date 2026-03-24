import { z } from "zod";

export const packageDurationSchema = z.enum(["1m", "3m", "6m", "12m"]);
export type PackageDuration = z.infer<typeof packageDurationSchema>;

export const subscriptionStatusSchema = z.enum(["active", "expired", "cancelled"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const paymentRequestStatusSchema = z.enum(["pending-review", "approved", "rejected"]);
export type PaymentRequestStatus = z.infer<typeof paymentRequestStatusSchema>;

export const paymentMethodIdSchema = z.enum(["bank-transfer-eft", "crypto", "bank-card"]);
export type PaymentMethodId = z.infer<typeof paymentMethodIdSchema>;

export const trialRequestStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type TrialRequestStatus = z.infer<typeof trialRequestStatusSchema>;

export const m3uSourceStatusSchema = z.enum(["pending", "syncing", "ready", "error"]);
export type M3USourceStatus = z.infer<typeof m3uSourceStatusSchema>;

export const userStatusSchema = z.enum(["new", "active", "blocked"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const catalogKindSchema = z.enum(["live", "movie", "series"]);
export type CatalogKind = z.infer<typeof catalogKindSchema>;

export const liveTransportSchema = z.enum(["ts", "hls", "mp4", "mkv", "unknown"]);
export type LiveTransport = z.infer<typeof liveTransportSchema>;

export const nativePlaybackTransportSchema = z.enum(["ts", "hls", "mp4", "mkv", "avi", "unknown"]);
export type NativePlaybackTransport = z.infer<typeof nativePlaybackTransportSchema>;

export const liveDeliveryModeSchema = z.enum(["hls_proxy", "hls_transmuxed", "hls_transcoded", "file_proxy"]);
export type LiveDeliveryMode = z.infer<typeof liveDeliveryModeSchema>;

export const vodPlaybackKindSchema = z.enum(["movie", "episode"]);
export type VodPlaybackKind = z.infer<typeof vodPlaybackKindSchema>;

export const vodTransportSchema = z.enum(["hls", "mp4", "mkv", "avi", "unknown"]);
export type VodTransport = z.infer<typeof vodTransportSchema>;

export const vodDeliveryModeSchema = z.enum(["hls_proxy", "file_proxy", "hls_transcoded"]);
export type VodDeliveryMode = z.infer<typeof vodDeliveryModeSchema>;

export const nativeVodDeliveryModeSchema = z.enum(["direct", "hls_proxy", "file_proxy", "hls_transcoded"]);
export type NativeVodDeliveryMode = z.infer<typeof nativeVodDeliveryModeSchema>;

export const vodAudioTrackSchema = z.object({
  id: z.string().trim().min(1),
  language: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(1).nullable(),
  channels: z.number().int().positive().nullable(),
  isDefault: z.boolean()
});
export type VodAudioTrack = z.infer<typeof vodAudioTrackSchema>;

export const liveHealthStatusSchema = z.enum(["unknown", "healthy", "degraded", "broken"]);
export type LiveHealthStatus = z.infer<typeof liveHealthStatusSchema>;

export const clientRuntimeSchema = z.enum(["browser", "app", "native"]);
export type ClientRuntime = z.infer<typeof clientRuntimeSchema>;

export const playerEngineSchema = z.enum([
  "native",
  "hls.js",
  "mpegts.js",
  "relay",
  "libvlc",
  "unknown"
]);
export type PlayerEngine = z.infer<typeof playerEngineSchema>;

export const decoderModeSchema = z.enum(["hardware", "software"]);
export type DecoderMode = z.infer<typeof decoderModeSchema>;

export const userSummarySchema = z.object({
  id: z.string().uuid(),
  status: userStatusSchema,
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
  kryptoniteCode: z.string().regex(/^[A-Z0-9]{16}$/).nullable(),
  codeSuffix: z.string().length(4).nullable(),
  hasAssignedLink: z.boolean(),
  hasActiveSubscription: z.boolean(),
  activePackage: z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      duration: packageDurationSchema,
      endsAt: z.string(),
      remainingDays: z.number().int().nonnegative()
    })
    .nullable(),
  popup: z
    .object({
      required: z.boolean(),
      actions: z.array(z.enum(["free-trial", "contact", "buy-package"]))
    })
    .nullable()
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const packageSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  duration: packageDurationSchema,
  durationMonths: z.number().int().positive(),
  priceLabel: z.string().trim().max(120).nullable(),
  isActive: z.boolean(),
  createdAt: z.string()
});
export type PackageRecord = z.infer<typeof packageSchema>;

export const paymentMethodOptionSchema = z.object({
  id: paymentMethodIdSchema,
  label: z.string().min(2),
  enabled: z.boolean(),
  details: z.string().trim().max(2000).nullable(),
  bankTransfer: z
    .object({
      recipientName: z.string().trim().max(200).nullable(),
      iban: z.string().trim().max(120).nullable(),
      bankName: z.string().trim().max(200).nullable()
    })
    .nullable()
    .optional(),
  cryptoAssets: z
    .array(
      z.object({
        id: z.enum(["usdt-trc20", "tron", "sol", "btc", "usdc"]),
        label: z.string().trim().min(1).max(120),
        symbol: z.string().trim().min(1).max(20),
        walletAddress: z.string().trim().max(500).nullable()
      })
    )
    .optional()
});
export type PaymentMethodOption = z.infer<typeof paymentMethodOptionSchema>;

export const liveChannelSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  groupTitle: z.string().nullable(),
  logoUrl: z.string().url().nullable(),
  streamUrl: z.string().url().nullable(),
  playbackAllowed: z.boolean(),
  transport: liveTransportSchema,
  healthStatus: liveHealthStatusSchema,
  isVerified: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  variantGroupKey: z.string().nullable().optional(),
  qualityRank: z.number().int().nullable().optional()
});
export type LiveChannel = z.infer<typeof liveChannelSchema>;

export const livePlaybackSchema = z.object({
  channelId: z.string().uuid(),
  url: z.string().url().nullable(),
  transport: liveTransportSchema,
  sourceTransport: liveTransportSchema,
  deliveryMode: liveDeliveryModeSchema,
  diagnosticsSessionId: z.string().uuid().nullable(),
  healthStatus: liveHealthStatusSchema,
  lastCheckedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  canPlay: z.boolean(),
  isVerified: z.boolean(),
  errorMessage: z.string().nullable()
});
export type LivePlaybackRecord = z.infer<typeof livePlaybackSchema>;

export const vodPlaybackSchema = z.object({
  itemId: z.string().uuid(),
  kind: vodPlaybackKindSchema,
  url: z.string().url().nullable(),
  transport: vodTransportSchema,
  deliveryMode: vodDeliveryModeSchema,
  audioTracks: z.array(vodAudioTrackSchema),
  defaultAudioTrackId: z.string().nullable(),
  selectedAudioTrackId: z.string().nullable(),
  expiresAt: z.string().nullable(),
  canPlay: z.boolean(),
  isVerified: z.boolean(),
  errorMessage: z.string().nullable()
});
export type VodPlaybackRecord = z.infer<typeof vodPlaybackSchema>;

export const nativePlaybackSourceSchema = z.object({
  url: z.string().url(),
  transport: nativePlaybackTransportSchema,
  headers: z.record(z.string(), z.string()),
  cookie: z.string().nullable(),
  userAgent: z.string().trim().min(1).nullable(),
  allowInsecureHttp: z.boolean(),
  diagnosticsSessionId: z.string().uuid(),
  variantGroupKey: z.string().nullable(),
  qualityRank: z.number().int().nullable(),
  isVerified: z.boolean(),
  lastCheckedAt: z.string().nullable()
});
export type NativePlaybackSource = z.infer<typeof nativePlaybackSourceSchema>;

export const nativeVodPlaybackSourceSchema = nativePlaybackSourceSchema.extend({
  deliveryMode: nativeVodDeliveryModeSchema,
  audioTracks: z.array(vodAudioTrackSchema),
  defaultAudioTrackId: z.string().nullable(),
  selectedAudioTrackId: z.string().nullable()
});
export type NativeVodPlaybackSource = z.infer<typeof nativeVodPlaybackSourceSchema>;

export const movieSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  posterUrl: z.string().url().nullable(),
  groupTitle: z.string().nullable(),
  streamUrl: z.string().url().nullable(),
  playbackAllowed: z.boolean()
});
export type MovieRecord = z.infer<typeof movieSchema>;

export const episodeSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  seasonNumber: z.number().int().positive(),
  episodeNumber: z.number().int().positive(),
  streamUrl: z.string().url().nullable(),
  playbackAllowed: z.boolean()
});
export type EpisodeRecord = z.infer<typeof episodeSchema>;

export const seriesSeasonSchema = z.object({
  seasonNumber: z.number().int().positive(),
  title: z.string(),
  episodeCount: z.number().int().nonnegative(),
  episodes: z.array(episodeSchema)
});
export type SeriesSeasonRecord = z.infer<typeof seriesSeasonSchema>;

export const seriesSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  posterUrl: z.string().url().nullable(),
  groupTitle: z.string().nullable(),
  seasonCount: z.number().int().nonnegative(),
  episodeCount: z.number().int().nonnegative(),
  featuredEpisode: episodeSchema.nullable(),
  seasons: z.array(seriesSeasonSchema)
});
export type SeriesRecord = z.infer<typeof seriesSchema>;

export const catalogGroupSchema = z.object({
  title: z.string(),
  count: z.number().int().nonnegative(),
  kind: catalogKindSchema
});
export type CatalogGroup = z.infer<typeof catalogGroupSchema>;

export const deviceSessionSchema = z.object({
  id: z.string().uuid(),
  deviceName: z.string().nullable(),
  platform: z.string().nullable(),
  expiresAt: z.string(),
  lastSeenAt: z.string(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  isCurrent: z.boolean()
});
export type DeviceSessionRecord = z.infer<typeof deviceSessionSchema>;

export const subscriptionRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: subscriptionStatusSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  packageTitle: z.string()
});
export type SubscriptionRecord = z.infer<typeof subscriptionRecordSchema>;

export const adminAuditLogSchema = z.object({
  id: z.string().uuid(),
  adminId: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  createdAt: z.string()
});
export type AdminAuditLogRecord = z.infer<typeof adminAuditLogSchema>;

export const m3uSyncJobRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userM3USourceId: z.string().uuid(),
  requestedByAdminId: z.string(),
  status: z.enum(["queued", "processing", "succeeded", "failed"]),
  snapshotVersion: z.number().int().nonnegative().nullable(),
  attemptCount: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string()
});
export type M3USyncJobRecord = z.infer<typeof m3uSyncJobRecordSchema>;

export const pagedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative()
  });
