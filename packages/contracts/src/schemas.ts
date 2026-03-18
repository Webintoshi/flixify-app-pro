import { z } from "zod";
import {
  adminAuditLogSchema,
  catalogGroupSchema,
  deviceSessionSchema,
  liveChannelSchema,
  livePlaybackSchema,
  m3uSyncJobRecordSchema,
  movieSchema,
  packageSchema,
  paymentMethodOptionSchema,
  pagedResponseSchema,
  seriesSchema,
  subscriptionRecordSchema,
  userSummarySchema,
  vodPlaybackSchema
} from "./domain";

export const registerAnonInputSchema = z.object({
  deviceName: z.string().max(120).optional(),
  platform: z.string().max(60).optional()
});

export const loginByCodeInputSchema = registerAnonInputSchema.extend({
  code: z.string().trim().regex(/^[A-Z0-9]{16}$/)
});

export const refreshInputSchema = z.object({
  refreshToken: z.string().min(32)
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: userSummarySchema,
  kryptoniteCode: z.string().regex(/^[A-Z0-9]{16}$/).nullable()
});

export const paymentRequestInputSchema = z.object({
  packageSlug: z.string().min(2)
});

export const paymentMethodSettingsSchema = z.object({
  bankTransferEftEnabled: z.boolean(),
  bankTransferEftDetails: z.string().trim().max(2000).nullable(),
  bankTransferRecipientName: z.string().trim().max(200).nullable(),
  bankTransferIban: z.string().trim().max(120).nullable(),
  bankTransferBankName: z.string().trim().max(200).nullable(),
  cryptoEnabled: z.boolean(),
  cryptoDetails: z.string().trim().max(2000).nullable(),
  cryptoWalletUsdtTrc20: z.string().trim().max(500).nullable(),
  cryptoWalletTron: z.string().trim().max(500).nullable(),
  cryptoWalletSol: z.string().trim().max(500).nullable(),
  cryptoWalletBtc: z.string().trim().max(500).nullable(),
  cryptoWalletUsdc: z.string().trim().max(500).nullable(),
  bankCardEnabled: z.boolean(),
  bankCardDetails: z.string().trim().max(2000).nullable()
});

export const trialRequestInputSchema = z.object({
  note: z.string().trim().max(500).optional()
});

export const livePlaybackEventInputSchema = z.object({
  event: z.enum(["playing", "stalled", "recovered", "failed"]),
  diagnosticsSessionId: z.string().uuid().nullable().optional(),
  deliveryMode: z.enum(["hls_proxy", "hls_transmuxed", "hls_transcoded", "file_proxy"]).nullable().optional(),
  sourceTransport: z.enum(["ts", "hls", "mp4", "mkv", "unknown"]).nullable().optional(),
  playerEngine: z.enum(["native", "hls.js", "mpegts.js", "relay", "unknown"]).nullable().optional(),
  uptimeMs: z.number().int().nonnegative().nullable().optional(),
  bufferedSeconds: z.number().nonnegative().nullable().optional(),
  currentTime: z.number().nonnegative().nullable().optional(),
  readyState: z.number().int().min(0).max(4).nullable().optional(),
  networkState: z.number().int().min(0).max(3).nullable().optional(),
  stallReason: z.string().trim().max(500).nullable().optional(),
  errorCode: z.string().trim().max(120).nullable().optional(),
  upstreamStatus: z.number().int().min(100).max(599).nullable().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
  errorMessage: z.string().trim().max(500).nullable().optional()
});

export const vodPlaybackEventInputSchema = z.object({
  event: z.enum([
    "session-created",
    "audio-track-selected",
    "audio-track-switch-failed",
    "no-audio-detected",
    "transcode-started",
    "transcode-failed",
    "playback-failed",
    "recovered"
  ]),
  diagnosticsSessionId: z.string().uuid().nullable().optional(),
  deliveryMode: z.enum(["hls_proxy", "file_proxy", "hls_transcoded"]).nullable().optional(),
  sourceTransport: z.enum(["hls", "mp4", "mkv", "avi", "unknown"]).nullable().optional(),
  playerEngine: z.enum(["native", "hls.js", "mpegts.js", "relay", "unknown"]).nullable().optional(),
  uptimeMs: z.number().int().nonnegative().nullable().optional(),
  bufferedSeconds: z.number().nonnegative().nullable().optional(),
  currentTime: z.number().nonnegative().nullable().optional(),
  readyState: z.number().int().min(0).max(4).nullable().optional(),
  networkState: z.number().int().min(0).max(3).nullable().optional(),
  audioTrackId: z.string().trim().max(120).nullable().optional(),
  errorCode: z.string().trim().max(120).nullable().optional(),
  upstreamStatus: z.number().int().min(100).max(599).nullable().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
  errorMessage: z.string().trim().max(500).nullable().optional()
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  group: z.string().trim().max(120).optional()
});

export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["new", "active", "blocked", "deleted"]).optional(),
  m3u: z.enum(["assigned", "unassigned"]).optional(),
  includeDeleted: z.coerce.boolean().default(false)
});

export const adminAssignM3USourceInputSchema = z
  .object({
    sourceUrl: z.string().url().optional(),
    username: z.string().trim().min(1).max(120).optional(),
    password: z.string().trim().min(1).max(120).optional()
  })
  .refine((value) => Boolean(value.sourceUrl) || (Boolean(value.username) && Boolean(value.password)), {
    message: "Kaynak URL veya IPTV kullanici adi/sifresi gonderilmeli."
  });

export const adminCreateSubscriptionInputSchema = z.object({
  packageSlug: z.string().min(2)
});

export const adminReviewInputSchema = z.object({
  note: z.string().trim().max(500).optional()
});

export const adminUpdateUserStatusInputSchema = z.object({
  status: z.enum(["new", "active", "blocked"])
});

export const adminUpdateUserInputSchema = z
  .object({
    status: z.enum(["new", "active", "blocked"]).optional(),
    notes: z.string().trim().max(500).nullable().optional()
  })
  .refine((value) => value.status !== undefined || value.notes !== undefined, {
    message: "En az bir alan gonderilmeli."
  });

export const adminUpdatePackageStatusInputSchema = z.object({
  isActive: z.boolean()
});

export const appSettingsSchema = z.object({
  supportWhatsappUrl: z.string().url(),
  supportTelegramUrl: z.string().url(),
  salesPortalUrl: z.string().url().nullable(),
  heroTitle: z.string().min(3),
  heroSubtitle: z.string().min(3),
  sharedPlaylistUrl: z.string().url().nullable(),
  sharedSourceStatus: z.enum(["pending", "syncing", "ready", "error"]).nullable().optional(),
  sharedSourceSnapshotVersion: z.number().int().nonnegative().nullable().optional(),
  sharedSourceLastSuccessfulSyncAt: z.string().nullable().optional(),
  sharedSourceLastError: z.string().nullable().optional()
});

export const meResponseSchema = z.object({
  user: userSummarySchema,
  contact: z.object({
    whatsapp: z.string().url(),
    telegram: z.string().url()
  })
});

export const liveCatalogResponseSchema = pagedResponseSchema(liveChannelSchema).extend({
  groups: z.array(catalogGroupSchema)
});
export const movieCatalogResponseSchema = pagedResponseSchema(movieSchema).extend({
  groups: z.array(catalogGroupSchema)
});
export const seriesCatalogResponseSchema = pagedResponseSchema(seriesSchema).extend({
  groups: z.array(catalogGroupSchema)
});
export const packagesResponseSchema = z.object({
  items: z.array(packageSchema)
});

export const paymentMethodsResponseSchema = z.object({
  items: z.array(paymentMethodOptionSchema)
});

export const adminUserListItemSchema = userSummarySchema.extend({
  notes: z.string().nullable(),
  deletedAt: z.string().nullable(),
  subscriptionEndsAt: z.string().nullable(),
  remainingDays: z.number().int().nullable(),
  packageStatus: z.enum(["active", "expired", "none"]),
  m3uAssigned: z.boolean(),
  currentSourceStatus: z.string().nullable()
});
export const adminUsersResponseSchema = pagedResponseSchema(adminUserListItemSchema);

export const paymentRequestRecordSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending-review", "approved", "rejected"]),
  packageTitle: z.string(),
  createdAt: z.string(),
  userId: z.string().uuid()
});

export const trialRequestRecordSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string(),
  userId: z.string().uuid(),
  note: z.string().nullable()
});

export const deviceSessionsResponseSchema = z.object({
  items: z.array(deviceSessionSchema)
});

export const adminDashboardSchema = z.object({
  usersTotal: z.number().int().nonnegative(),
  usersBlocked: z.number().int().nonnegative(),
  usersWaitingForLink: z.number().int().nonnegative(),
  activeSubscriptions: z.number().int().nonnegative(),
  pendingPaymentRequests: z.number().int().nonnegative(),
  pendingTrialRequests: z.number().int().nonnegative(),
  queuedM3UJobs: z.number().int().nonnegative(),
  failedM3UJobs: z.number().int().nonnegative(),
  liveHealthyChannels: z.number().int().nonnegative(),
  liveDegradedChannels: z.number().int().nonnegative(),
  liveBrokenChannels: z.number().int().nonnegative(),
  liveLastError: z.string().nullable()
});

export const adminUserDetailSchema = z.object({
  summary: adminUserListItemSchema,
  currentSourceStatus: z.string().nullable(),
  currentSourceUrl: z.string().nullable(),
  iptvUsername: z.string().nullable().optional(),
  iptvPassword: z.string().nullable().optional(),
  snapshotVersion: z.number().int().nonnegative(),
  deviceSessions: z.array(deviceSessionSchema),
  paymentRequests: z.array(paymentRequestRecordSchema),
  trialRequests: z.array(trialRequestRecordSchema),
  subscriptions: z.array(subscriptionRecordSchema),
  auditLogs: z.array(adminAuditLogSchema)
});

export const adminM3UJobsResponseSchema = z.object({
  items: z.array(m3uSyncJobRecordSchema)
});

export const livePlaybackResponseSchema = livePlaybackSchema;
export const vodPlaybackResponseSchema = vodPlaybackSchema;
