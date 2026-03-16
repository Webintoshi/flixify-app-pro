import { z } from "zod";

export const packageDurationSchema = z.enum(["1m", "3m", "6m", "12m"]);
export type PackageDuration = z.infer<typeof packageDurationSchema>;

export const subscriptionStatusSchema = z.enum(["active", "expired", "cancelled"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const paymentRequestStatusSchema = z.enum(["pending-review", "approved", "rejected"]);
export type PaymentRequestStatus = z.infer<typeof paymentRequestStatusSchema>;

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

export const liveDeliveryModeSchema = z.enum(["hls_proxy", "hls_transmuxed", "hls_transcoded", "file_proxy"]);
export type LiveDeliveryMode = z.infer<typeof liveDeliveryModeSchema>;

export const vodPlaybackKindSchema = z.enum(["movie", "episode"]);
export type VodPlaybackKind = z.infer<typeof vodPlaybackKindSchema>;

export const vodTransportSchema = z.enum(["hls", "mp4", "mkv", "avi", "unknown"]);
export type VodTransport = z.infer<typeof vodTransportSchema>;

export const vodDeliveryModeSchema = z.enum(["hls_proxy", "file_proxy", "hls_transcoded"]);
export type VodDeliveryMode = z.infer<typeof vodDeliveryModeSchema>;

export const liveHealthStatusSchema = z.enum(["unknown", "healthy", "degraded", "broken"]);
export type LiveHealthStatus = z.infer<typeof liveHealthStatusSchema>;

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
  isActive: z.boolean(),
  createdAt: z.string()
});
export type PackageRecord = z.infer<typeof packageSchema>;

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
  lastCheckedAt: z.string().nullable()
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
  expiresAt: z.string().nullable(),
  canPlay: z.boolean(),
  isVerified: z.boolean(),
  errorMessage: z.string().nullable()
});
export type VodPlaybackRecord = z.infer<typeof vodPlaybackSchema>;

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
