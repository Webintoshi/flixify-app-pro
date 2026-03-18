import type { QueryResultRow } from "pg";
import type { PoolClient } from "pg";
import type {
  AdminAuditLogRecord,
  CatalogGroup,
  DeviceSessionRecord,
  LiveHealthStatus,
  LivePlaybackRecord,
  LiveTransport,
  LiveChannel,
  MovieRecord,
  PaymentMethodOption,
  PackageDuration,
  PackageRecord,
  SeriesSeasonRecord,
  SeriesRecord,
  SubscriptionRecord,
  UserSummary,
  VodPlaybackKind
} from "@flixify/contracts";
import { dedupeMovieCatalogEntries } from "@flixify/contracts";
import { buildPlaylistUrl, buildStreamUrl, parsePlaylistUrl, type PlaylistConfig } from "./iptv.js";
import { query, withTransaction } from "./db.js";
import { addPackageDuration, calculateRemainingDays } from "./time.js";

type UserContextRow = QueryResultRow & {
  id: string;
  status: "new" | "active" | "blocked";
  created_at: string;
  last_login_at: string | null;
  kryptonite_code: string | null;
  code_suffix: string | null;
  notes?: string | null;
  deleted_at?: string | null;
  source_status: string | null;
  current_snapshot_version: number | null;
  source_base_url: string | null;
  source_playlist_path: string | null;
  source_playlist_suffix: string | null;
  source_reference_username: string | null;
  source_reference_password: string | null;
  iptv_username: string | null;
  iptv_password: string | null;
  package_id: string | null;
  package_title: string | null;
  package_duration: PackageDuration | null;
  ends_at: string | null;
};

type DeviceSessionRow = QueryResultRow & {
  id: string;
  device_name: string | null;
  platform: string | null;
  expires_at: string;
  last_seen_at: string;
  revoked_at: string | null;
  created_at: string;
};

type AuditLogRow = QueryResultRow & {
  id: string;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
};

type AppSettingsRow = QueryResultRow & {
  support_whatsapp_url: string | null;
  support_telegram_url: string | null;
  sales_portal_url: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  bank_transfer_eft_enabled: boolean | null;
  bank_transfer_eft_details: string | null;
  bank_transfer_recipient_name: string | null;
  bank_transfer_iban: string | null;
  bank_transfer_bank_name: string | null;
  crypto_enabled: boolean | null;
  crypto_details: string | null;
  crypto_wallet_usdt_trc20: string | null;
  crypto_wallet_tron: string | null;
  crypto_wallet_sol: string | null;
  crypto_wallet_btc: string | null;
  crypto_wallet_usdc: string | null;
  bank_card_enabled: boolean | null;
  bank_card_details: string | null;
  shared_source_base_url: string | null;
  shared_source_playlist_path: string | null;
  shared_source_playlist_suffix: string | null;
  shared_source_reference_username: string | null;
  shared_source_reference_password: string | null;
  shared_source_status: "pending" | "syncing" | "ready" | "error" | null;
  shared_source_snapshot_version: number | null;
  shared_source_last_successful_sync_at: string | null;
  shared_source_last_error: string | null;
};

type SharedLiveChannelRow = QueryResultRow & {
  id: string;
  snapshot_version: number;
  title: string;
  group_title: string | null;
  logo_url: string | null;
  stream_path: string;
  transport: LiveTransport;
  country_code: string | null;
  country_confidence: "high" | "medium" | "unknown" | null;
  country_match_reason: "prefix" | "tr_strong_group" | "tr_balanced_multi_signal" | "none" | null;
  health_status: LiveHealthStatus | null;
  last_checked_at: string | null;
  failure_count: number | null;
  last_error: string | null;
};

type PaymentMethodSettings = {
  bankTransferEftEnabled: boolean;
  bankTransferEftDetails: string | null;
  bankTransferRecipientName: string | null;
  bankTransferIban: string | null;
  bankTransferBankName: string | null;
  cryptoEnabled: boolean;
  cryptoDetails: string | null;
  cryptoWalletUsdtTrc20: string | null;
  cryptoWalletTron: string | null;
  cryptoWalletSol: string | null;
  cryptoWalletBtc: string | null;
  cryptoWalletUsdc: string | null;
  bankCardEnabled: boolean;
  bankCardDetails: string | null;
};

const PAYMENT_METHOD_COLUMNS_SQL = `
  alter table public.app_settings
  add column if not exists bank_transfer_eft_enabled boolean not null default true,
  add column if not exists bank_transfer_eft_details text,
  add column if not exists bank_transfer_recipient_name text,
  add column if not exists bank_transfer_iban text,
  add column if not exists bank_transfer_bank_name text,
  add column if not exists crypto_enabled boolean not null default true,
  add column if not exists crypto_details text,
  add column if not exists crypto_wallet_usdt_trc20 text,
  add column if not exists crypto_wallet_tron text,
  add column if not exists crypto_wallet_sol text,
  add column if not exists crypto_wallet_btc text,
  add column if not exists crypto_wallet_usdc text,
  add column if not exists bank_card_enabled boolean not null default true,
  add column if not exists bank_card_details text;
`;

const PACKAGE_PRICE_COLUMN_SQL = `
  alter table public.packages
  add column if not exists price_label text;
`;

export type UserContext = {
  summary: UserSummary;
  snapshotVersion: number;
  canViewCatalog: boolean;
  canPlay: boolean;
  sourceStatus: string | null;
  playbackBaseUrl: string | null;
  iptvCredentials: { username: string; password: string } | null;
  sharedReferenceCredentials: { username: string; password: string } | null;
};

type AdminUserFilters = {
  search?: string;
  status?: "new" | "active" | "blocked" | "deleted";
  m3u?: "assigned" | "unassigned";
  includeDeleted?: boolean;
};

function normalizeLiveHealthStatus(status: LiveHealthStatus | null | undefined): LiveHealthStatus {
  return status ?? "unknown";
}

function liveHealthPriority(status: LiveHealthStatus | null | undefined) {
  switch (normalizeLiveHealthStatus(status)) {
    case "healthy":
      return 0;
    case "unknown":
      return 1;
    case "degraded":
      return 2;
    case "broken":
      return 3;
    default:
      return 4;
  }
}

function getSharedPlaylistConfig(
  row:
    | Pick<
        UserContextRow,
        | "source_base_url"
        | "source_playlist_path"
        | "source_playlist_suffix"
        | "source_reference_username"
        | "source_reference_password"
      >
    | Pick<
        AppSettingsRow,
        | "shared_source_base_url"
        | "shared_source_playlist_path"
        | "shared_source_playlist_suffix"
        | "shared_source_reference_username"
        | "shared_source_reference_password"
      >
) {
  const baseUrl = "source_base_url" in row ? row.source_base_url : row.shared_source_base_url;
  const playlistPath =
    "source_playlist_path" in row ? row.source_playlist_path : row.shared_source_playlist_path;
  const playlistSuffix =
    "source_playlist_suffix" in row ? row.source_playlist_suffix : row.shared_source_playlist_suffix;
  const username =
    "source_reference_username" in row
      ? row.source_reference_username
      : row.shared_source_reference_username;
  const password =
    "source_reference_password" in row
      ? row.source_reference_password
      : row.shared_source_reference_password;

  if (!baseUrl || !playlistPath || !playlistSuffix || !username || !password) {
    return null;
  }

  return {
    baseUrl,
    playlistPath,
    playlistSuffix,
    username,
    password
  } satisfies PlaylistConfig;
}

function mapPaymentMethodSettings(row: AppSettingsRow | null | undefined): PaymentMethodSettings {
  return {
    bankTransferEftEnabled: row?.bank_transfer_eft_enabled ?? true,
    bankTransferEftDetails: row?.bank_transfer_eft_details ?? null,
    bankTransferRecipientName: row?.bank_transfer_recipient_name ?? null,
    bankTransferIban: row?.bank_transfer_iban ?? null,
    bankTransferBankName: row?.bank_transfer_bank_name ?? null,
    cryptoEnabled: row?.crypto_enabled ?? true,
    cryptoDetails: row?.crypto_details ?? null,
    cryptoWalletUsdtTrc20: row?.crypto_wallet_usdt_trc20 ?? null,
    cryptoWalletTron: row?.crypto_wallet_tron ?? null,
    cryptoWalletSol: row?.crypto_wallet_sol ?? null,
    cryptoWalletBtc: row?.crypto_wallet_btc ?? null,
    cryptoWalletUsdc: row?.crypto_wallet_usdc ?? null,
    bankCardEnabled: row?.bank_card_enabled ?? true,
    bankCardDetails: row?.bank_card_details ?? null
  };
}

function mapPaymentMethodsForViewer(settings: PaymentMethodSettings): PaymentMethodOption[] {
  return [
    {
      id: "bank-transfer-eft",
      label: "Banka Havale / EFT",
      enabled: settings.bankTransferEftEnabled,
      details: settings.bankTransferEftDetails,
      bankTransfer: {
        recipientName: settings.bankTransferRecipientName,
        iban: settings.bankTransferIban,
        bankName: settings.bankTransferBankName
      }
    },
    {
      id: "crypto",
      label: "Kripto",
      enabled: settings.cryptoEnabled,
      details: settings.cryptoDetails,
      cryptoAssets: [
        {
          id: "usdt-trc20",
          label: "Tether",
          symbol: "USDT",
          walletAddress: settings.cryptoWalletUsdtTrc20
        },
        {
          id: "tron",
          label: "Tron",
          symbol: "TRX",
          walletAddress: settings.cryptoWalletTron
        },
        {
          id: "sol",
          label: "Sol",
          symbol: "SOL",
          walletAddress: settings.cryptoWalletSol
        },
        {
          id: "btc",
          label: "BTC",
          symbol: "BTC",
          walletAddress: settings.cryptoWalletBtc
        },
        {
          id: "usdc",
          label: "USDC",
          symbol: "USDC",
          walletAddress: settings.cryptoWalletUsdc
        }
      ]
    },
    {
      id: "bank-card",
      label: "Banka Karti",
      enabled: settings.bankCardEnabled,
      details: settings.bankCardDetails
    }
  ];
}

function isMissingPaymentMethodColumnsError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: string; message?: string };
  if (maybeError.code === "42703") {
    return true;
  }

  const message = typeof maybeError.message === "string" ? maybeError.message : "";
  return (
    message.includes("bank_transfer_eft_enabled") ||
    message.includes("bank_transfer_eft_details") ||
    message.includes("bank_transfer_recipient_name") ||
    message.includes("bank_transfer_iban") ||
    message.includes("bank_transfer_bank_name") ||
    message.includes("crypto_enabled") ||
    message.includes("crypto_details") ||
    message.includes("crypto_wallet_usdt_trc20") ||
    message.includes("crypto_wallet_tron") ||
    message.includes("crypto_wallet_sol") ||
    message.includes("crypto_wallet_btc") ||
    message.includes("crypto_wallet_usdc") ||
    message.includes("bank_card_enabled") ||
    message.includes("bank_card_details")
  );
}

function isMissingPackagePriceColumnError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: string; message?: string };
  if (maybeError.code === "42703") {
    return true;
  }

  const message = typeof maybeError.message === "string" ? maybeError.message : "";
  return message.includes("price_label");
}

function hasAssignedSource(row: Pick<UserContextRow, "iptv_username" | "iptv_password" | "source_base_url">) {
  return Boolean(row.iptv_username && row.iptv_password && row.source_base_url);
}

function getCurrentSourceUrl(row: Pick<UserContextRow, "iptv_username" | "iptv_password"> & Parameters<typeof getSharedPlaylistConfig>[0]) {
  const config = getSharedPlaylistConfig(row);
  if (!config || !row.iptv_username || !row.iptv_password) {
    return null;
  }

  return buildPlaylistUrl({
    ...config,
    username: row.iptv_username,
    password: row.iptv_password
  });
}

function mapUserSummary(row: UserContextRow): UserSummary {
  const hasAssignedLink = hasAssignedSource(row);
  const hasActiveSubscription = row.status !== "blocked" && Boolean(row.package_id && row.ends_at);

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    kryptoniteCode: row.kryptonite_code,
    codeSuffix: row.code_suffix,
    hasAssignedLink,
    hasActiveSubscription,
    activePackage:
      row.package_id && row.package_title && row.package_duration && row.ends_at
        ? {
            id: row.package_id,
            title: row.package_title,
            duration: row.package_duration,
            endsAt: row.ends_at,
            remainingDays: calculateRemainingDays(row.ends_at)
          }
        : null,
    popup:
      !hasAssignedLink && row.status !== "blocked"
        ? {
            required: true,
            actions: ["free-trial", "contact", "buy-package"]
          }
        : null
  };
}

function mapAdminUserListItem(row: UserContextRow) {
  const summary = mapUserSummary(row);

  return {
    ...summary,
    notes: row.notes ?? null,
    deletedAt: row.deleted_at ?? null,
    subscriptionEndsAt: row.ends_at ?? null,
    remainingDays: summary.activePackage?.remainingDays ?? null,
    packageStatus: summary.activePackage ? "active" : "none",
    m3uAssigned: summary.hasAssignedLink,
    currentSourceStatus: row.source_status
  };
}

function mapDeviceSession(row: DeviceSessionRow, currentSessionId: string | null): DeviceSessionRecord {
  return {
    id: row.id,
    deviceName: row.device_name,
    platform: row.platform,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    isCurrent: currentSessionId === row.id
  };
}

function mapAuditLog(row: AuditLogRow): AdminAuditLogRecord {
  return {
    id: row.id,
    adminId: row.admin_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: row.created_at
  };
}

function mapLiveChannel(
  row: SharedLiveChannelRow,
  playback?: PlaybackContext
): LiveChannel {
  const healthStatus = normalizeLiveHealthStatus(row.health_status);
  const canPlay = Boolean(playback?.canPlay);

  return {
    id: row.id,
    title: row.title,
    groupTitle: row.group_title,
    logoUrl: row.logo_url,
    streamUrl:
      canPlay && playback?.baseUrl && playback.credentials
        ? buildStreamUrl(
            playback.baseUrl,
            playback.credentials.username,
            playback.credentials.password,
            row.stream_path
          )
        : null,
    playbackAllowed: canPlay,
    transport: row.transport,
    healthStatus,
    isVerified: Boolean(row.last_checked_at),
    lastCheckedAt: row.last_checked_at
  };
}

export async function findUserByCodeLookup(codeLookup: string) {
  const result = await query<{
    id: string;
    code_hash: string;
    status: "new" | "active" | "blocked";
    kryptonite_code: string | null;
  }>(
    "select id, code_hash, status, kryptonite_code from public.users where code_lookup = $1 and deleted_at is null limit 1",
    [codeLookup]
  );
  return result.rows[0] ?? null;
}

export async function createUser(
  codeLookup: string,
  codeHash: string,
  codeSuffix: string | null,
  kryptoniteCode: string | null
) {
  const result = await query<{ id: string }>(
    "insert into public.users (code_lookup, code_hash, code_suffix, kryptonite_code, status) values ($1, $2, $3, $4, 'new') returning id",
    [codeLookup, codeHash, codeSuffix, kryptoniteCode]
  );
  return result.rows[0]?.id;
}

export async function storePlainKryptoniteCode(userId: string, kryptoniteCode: string) {
  await query(
    `
      update public.users
      set kryptonite_code = $2,
          code_suffix = $3,
          updated_at = timezone('utc', now())
      where id = $1
    `,
    [userId, kryptoniteCode, kryptoniteCode.slice(-4)]
  );
}

export async function updateUserLogin(userId: string) {
  await query("update public.users set last_login_at = timezone('utc', now()) where id = $1", [
    userId
  ]);
}

export async function createDeviceSession(
  userId: string,
  refreshTokenHash: string,
  deviceName?: string,
  platform?: string
) {
  const result = await query<{ id: string }>(
    `
      insert into public.device_sessions (
        user_id,
        device_name,
        platform,
        refresh_token_hash,
        expires_at
      ) values ($1, $2, $3, $4, timezone('utc', now()) + interval '30 days')
      returning id
    `,
    [userId, deviceName ?? null, platform ?? null, refreshTokenHash]
  );

  return result.rows[0]?.id;
}

export async function getSessionById(sessionId: string) {
  const result = await query<{
    id: string;
    user_id: string;
    refresh_token_hash: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `
      select id, user_id, refresh_token_hash, expires_at, revoked_at
      from public.device_sessions
      where id = $1
      limit 1
    `,
    [sessionId]
  );
  return result.rows[0] ?? null;
}

export async function revokeSession(sessionId: string) {
  await query(
    "update public.device_sessions set revoked_at = timezone('utc', now()) where id = $1",
    [sessionId]
  );
}

async function getUserContextRow(userId: string, includeDeleted = false): Promise<UserContextRow> {
  const result = await query<UserContextRow>(
    `
      select
        u.id,
        u.status,
        u.created_at,
        u.last_login_at,
        u.kryptonite_code,
        u.code_suffix,
        u.notes,
        u.deleted_at,
        settings.shared_source_status as source_status,
        settings.shared_source_snapshot_version as current_snapshot_version,
        settings.shared_source_base_url as source_base_url,
        settings.shared_source_playlist_path as source_playlist_path,
        settings.shared_source_playlist_suffix as source_playlist_suffix,
        settings.shared_source_reference_username as source_reference_username,
        settings.shared_source_reference_password as source_reference_password,
        cred.username as iptv_username,
        cred.password as iptv_password,
        sub.package_id,
        sub.package_title,
        sub.package_duration,
        sub.ends_at
      from public.users u
      left join public.app_settings settings on settings.id = true
      left join public.user_iptv_credentials cred on cred.user_id = u.id
      left join lateral (
        select
          s.package_id,
          case
            when s.end_reason = 'trial-24h' then '24 Saat Test'
            else p.title
          end as package_title,
          p.duration as package_duration,
          s.ends_at
        from public.subscriptions s
        join public.packages p on p.id = s.package_id
        where s.user_id = u.id
          and s.status = 'active'
          and s.ends_at > timezone('utc', now())
        order by s.ends_at desc
        limit 1
      ) sub on true
      where u.id = $1
        and ($2::boolean = true or u.deleted_at is null)
      limit 1
    `,
    [userId, includeDeleted]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("User not found");
  }

  return row;
}

export async function getUserContext(userId: string): Promise<UserContext> {
  const row = await getUserContextRow(userId);
  const hasAssignedLink = hasAssignedSource(row);
  const hasSnapshot = Boolean(row.current_snapshot_version && row.current_snapshot_version > 0);
  const sourceReady =
    hasSnapshot &&
    (row.source_status === "ready" ||
      row.source_status === "syncing" ||
      row.source_status === "error");
  const playbackBaseUrl = row.source_base_url ?? null;

  return {
    summary: mapUserSummary(row),
    snapshotVersion: row.current_snapshot_version ?? 0,
    canViewCatalog: row.status !== "blocked" && hasAssignedLink && sourceReady,
    canPlay: row.status !== "blocked" && hasAssignedLink && sourceReady && Boolean(row.package_id && row.ends_at),
    sourceStatus: row.source_status,
    playbackBaseUrl,
    iptvCredentials:
      row.iptv_username && row.iptv_password
        ? {
            username: row.iptv_username,
            password: row.iptv_password
          }
        : null,
    sharedReferenceCredentials:
      row.source_reference_username && row.source_reference_password
        ? {
            username: row.source_reference_username,
            password: row.source_reference_password
          }
        : null
  };
}

export async function getUserStatus(userId: string) {
  const result = await query<{ status: "new" | "active" | "blocked" }>(
    "select status from public.users where id = $1 and deleted_at is null limit 1",
    [userId]
  );
  return result.rows[0]?.status ?? null;
}

export async function touchDeviceSession(sessionId: string) {
  await query(
    "update public.device_sessions set last_seen_at = timezone('utc', now()) where id = $1",
    [sessionId]
  );
}

export async function listPackages({ onlyActive = false } = {}) {
  const clauses = onlyActive ? "where is_active = true" : "";
  const sql = `select id, slug, title, duration, duration_months, price_label, is_active, created_at from public.packages ${clauses} order by duration_months asc`;
  try {
    const result = await query<{
      id: string;
      slug: string;
      title: string;
      duration: PackageDuration;
      duration_months: number;
      price_label: string | null;
      is_active: boolean;
      created_at: string;
    }>(sql);

    return result.rows.map<PackageRecord>((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      duration: row.duration,
      durationMonths: row.duration_months,
      priceLabel: row.price_label ?? null,
      isActive: row.is_active,
      createdAt: row.created_at
    }));
  } catch (error) {
    if (!isMissingPackagePriceColumnError(error)) {
      throw error;
    }

    await query(PACKAGE_PRICE_COLUMN_SQL);
    const result = await query<{
      id: string;
      slug: string;
      title: string;
      duration: PackageDuration;
      duration_months: number;
      price_label: string | null;
      is_active: boolean;
      created_at: string;
    }>(sql);

    return result.rows.map<PackageRecord>((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      duration: row.duration,
      durationMonths: row.duration_months,
      priceLabel: row.price_label ?? null,
      isActive: row.is_active,
      createdAt: row.created_at
    }));
  }
}

function buildSearchClause(search?: string) {
  return search ? `%${search.toLowerCase()}%` : null;
}

function buildGroupClause(group?: string) {
  return group ? group.toLowerCase() : null;
}

function normalizeGroupFilterValue(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const LIVE_COUNTRY_CODE_ALIASES = new Map<string, string>([
  ["TUR", "TR"],
  ["TRK", "TR"]
]);

function normalizeLiveCountryCode(value: string) {
  const sanitized = value.replace(/[^a-z]/gi, "").toUpperCase();
  if (sanitized.length < 2 || sanitized.length > 3) {
    return null;
  }
  return LIVE_COUNTRY_CODE_ALIASES.get(sanitized) ?? sanitized;
}

export function resolveLiveCountryFilter(group?: string | null) {
  const normalized = normalizeGroupFilterValue(group ?? "");
  if (!normalized) {
    return null;
  }

  if (normalized === "turkiye") {
    return "TR";
  }

  const prefixedFilters = ["country:", "ulke:"];
  for (const prefix of prefixedFilters) {
    if (!normalized.startsWith(prefix)) {
      continue;
    }

    const rawCode = normalized.slice(prefix.length).trim();
    return normalizeLiveCountryCode(rawCode);
  }

  return null;
}

export function isCountryWideLiveGroupFilter(group?: string | null) {
  return resolveLiveCountryFilter(group) !== null;
}

export function isTurkiyeLiveGroupFilter(group?: string | null) {
  return resolveLiveCountryFilter(group) === "TR";
}

function buildNormalizedLiveCountryCodeExpression(countryCodeExpression: string) {
  return `
    case
      when nullif(upper(${countryCodeExpression}), '') in ('TUR', 'TRK') then 'TR'
      else nullif(upper(${countryCodeExpression}), '')
    end
  `;
}

function buildPrefixedLiveCountryCodeExpression(groupTitleExpression: string) {
  const rawPrefixExpression = `(regexp_match(lower(coalesce(${groupTitleExpression}, '')), '^\\s*([a-z]{2,3})\\s*[:\\-]'))[1]`;
  return `
    case
      when ${rawPrefixExpression} is null then null
      when upper(${rawPrefixExpression}) in ('TUR', 'TRK') then 'TR'
      else upper(${rawPrefixExpression})
    end
  `;
}

function buildTurkiyeStrongTokenSignalClause(textExpression: string) {
  return `
    ${textExpression} ~ '(^|[^a-z0-9çğıöşü])(tr|turkiye|türkiye|turkey|turk|türk|turkce|türkçe)([^a-z0-9çğıöşü]|$)'
  `;
}

function buildTurkiyeStrongTitleSignalClause(textExpression: string) {
  return `
    (
      ${textExpression} ~ '(^|[^a-z0-9çğıöşü])(trt|atv|tv8|cnnturk|cnn\\s*turk|haberturk|aspor|a\\s*spor|ahaber|a\\s*haber|kanal\\s*d|kanal\\s*7|show\\s*tv|star\\s*tv|beyaz\\s*tv|ulke\\s*tv|ülke\\s*tv|tgrt|teve2|kanal\\s*24|ntv|tv100|halk\\s*tv|tele\\s*1|haber\\s*global|s\\s*sport|spor\\s*smart|bein\\s*sports?)([^a-z0-9çğıöşü]|$)'
      or (
        ${textExpression} ~ '(^|[^a-z0-9çğıöşü])tr([^a-z0-9çğıöşü]|$)'
        and ${textExpression} ~ '(^|[^a-z0-9çğıöşü])(spor|haber|kanal|tv|ulusal)([^a-z0-9çğıöşü]|$)'
      )
    )
  `;
}

function buildTurkiyeStrongTvgIdSignalClause(textExpression: string) {
  return `
    (
      ${textExpression} ~ '(trt1|trt2|trthaber|trtspor|trtcocuk|atv|tv8|kanald|showtv|startv|beyaztv|ulketv|cnnturk|haberturk|ahaber|aspor|tgrt|teve2|tv100|halktv|tele1|haberglobal|ssport|sporsmart|beinsports[0-9]*tr)'
      or ${textExpression} ~ '(^|[^a-z0-9])tr([^a-z0-9]|$).*(spor|haber|kanal|tv|ulusal)'
      or ${textExpression} ~ '(\\.|_|-)(tr)(\\.|_|-|$)'
    )
  `;
}

function buildTurkiyeMediumTokenSignalClause(textExpression: string) {
  return `
    ${textExpression} ~ '(^|[^a-z0-9çğıöşü])(turk|türk|turkce|türkçe|dublaj|ulusal|turkish)([^a-z0-9çğıöşü]|$)'
  `;
}

function buildTurkiyeHeuristicClause(
  groupTextExpression: string,
  titleTextExpression: string,
  tvgIdTextExpression: string
) {
  return `
    (
      ${buildTurkiyeStrongTokenSignalClause(groupTextExpression)}
      or ${buildTurkiyeStrongTitleSignalClause(titleTextExpression)}
      or ${buildTurkiyeStrongTvgIdSignalClause(tvgIdTextExpression)}
      or (
        ${buildTurkiyeMediumTokenSignalClause(groupTextExpression)}
        and (
          ${buildTurkiyeMediumTokenSignalClause(titleTextExpression)}
          or ${buildTurkiyeMediumTokenSignalClause(tvgIdTextExpression)}
        )
      )
    )
  `;
}

export function buildLiveCountryFilterWhereClause() {
  const groupTextExpression = "lower(coalesce(c.group_title, ''))";
  const titleTextExpression = "lower(coalesce(c.title, ''))";
  const tvgIdTextExpression = "lower(coalesce(c.tvg_id, ''))";
  const normalizedCountryCodeExpression = buildNormalizedLiveCountryCodeExpression("c.country_code");
  const prefixedCountryCodeExpression = buildPrefixedLiveCountryCodeExpression("c.group_title");
  return `
    (
      ${normalizedCountryCodeExpression} = $3
      or (
        ${normalizedCountryCodeExpression} is null
        and ${prefixedCountryCodeExpression} = $3
      )
      or (
        $3 = 'TR'
        and ${buildTurkiyeHeuristicClause(groupTextExpression, titleTextExpression, tvgIdTextExpression)}
      )
    )
  `;
}

function buildLive4kPriorityClause() {
  return `
    case
      when (
        c.title ~* '(^|[^a-z0-9])4k([^a-z0-9]|$)'
        or coalesce(c.group_title, '') ~* '(^|[^a-z0-9])4k([^a-z0-9]|$)'
      ) then 0
      else 1
    end asc
  `;
}

export function buildLiveCatalogOrderByClause(isTurkiyeGroup: boolean) {
  if (isTurkiyeGroup) {
    return `
      ${buildLive4kPriorityClause()},
      c.order_index asc,
      c.title asc
    `;
  }

  return `
    ${buildLive4kPriorityClause()},
    case coalesce(h.health_status, 'unknown')
      when 'healthy' then 0
      when 'unknown' then 1
      when 'degraded' then 2
      when 'broken' then 3
      else 4
    end asc,
    c.order_index asc,
    c.title asc
  `;
}

type PlaybackContext = {
  baseUrl: string | null;
  credentials: { username: string; password: string } | null;
  canPlay: boolean;
};

async function listCatalogGroupsForTable(
  tableName: "shared_live_channels" | "shared_movies",
  kind: CatalogGroup["kind"],
  snapshotVersion: number,
  search?: string
) {
  const searchValue = buildSearchClause(search);
  const result = await query<{ title: string; count: string }>(
    `
      select coalesce(nullif(group_title, ''), 'Diger') as title, count(*)::text as count
      from public.${tableName}
      where snapshot_version = $1
        and ($2::text is null or lower(title) like $2 or lower(coalesce(group_title, '')) like $2)
      group by 1
      order by count(*) desc, title asc
    `,
    [snapshotVersion, searchValue]
  );

  return result.rows.map<CatalogGroup>((row) => ({
    title: row.title,
    count: Number(row.count),
    kind
  }));
}

async function listLiveCountryGroups(snapshotVersion: number, search?: string) {
  const searchValue = buildSearchClause(search);
  const groupTextExpression = "normalized_group_title";
  const titleTextExpression = "normalized_title";
  const tvgIdTextExpression = "normalized_tvg_id";
  const normalizedCountryCodeExpression = buildNormalizedLiveCountryCodeExpression("country_code");
  const prefixedCountryCodeExpression = buildPrefixedLiveCountryCodeExpression("normalized_group_title");
  const result = await query<{ title: string; count: string }>(
    `
      with scoped_channels as (
        select
          c.country_code,
          lower(coalesce(c.title, '')) as normalized_title,
          lower(coalesce(c.group_title, '')) as normalized_group_title,
          lower(coalesce(c.tvg_id, '')) as normalized_tvg_id
        from public.shared_live_channels c
        left join public.shared_live_channel_health h on h.channel_id = c.id
        where c.snapshot_version = $1
          and coalesce(h.health_status, 'unknown') <> 'broken'
          and ($2::text is null or lower(c.title) like $2 or lower(coalesce(c.group_title, '')) like $2)
      ),
      normalized_country as (
        select
          case
            when ${buildTurkiyeHeuristicClause(groupTextExpression, titleTextExpression, tvgIdTextExpression)}
            then 'TR'
            else coalesce(
              ${normalizedCountryCodeExpression},
              ${prefixedCountryCodeExpression}
            )
          end as country_code
        from scoped_channels
      )
      select country_code as title, count(*)::text as count
      from normalized_country
      where country_code is not null
      group by country_code
      order by count(*) desc, country_code asc
    `,
    [snapshotVersion, searchValue]
  );

  return result.rows.map<CatalogGroup>((row) => ({
    title: row.title,
    count: Number(row.count),
    kind: "live"
  }));
}

async function listLiveCatalogGroups(snapshotVersion: number, search?: string) {
  const searchValue = buildSearchClause(search);
  const [countryGroups, result] = await Promise.all([
    listLiveCountryGroups(snapshotVersion, search),
    query<{ title: string; count: string }>(
      `
        select coalesce(nullif(c.group_title, ''), 'Diger') as title, count(*)::text as count
        from public.shared_live_channels c
        left join public.shared_live_channel_health h on h.channel_id = c.id
        where c.snapshot_version = $1
          and coalesce(h.health_status, 'unknown') <> 'broken'
          and ($2::text is null or lower(c.title) like $2 or lower(coalesce(c.group_title, '')) like $2)
        group by 1
        order by count(*) desc, title asc
      `,
      [snapshotVersion, searchValue]
    )
  ]);
  const countryCodeTitles = new Set(countryGroups.map((group) => group.title.toUpperCase()));
  const groupTitleGroups = result.rows.map<CatalogGroup>((row) => ({
    title: row.title,
    count: Number(row.count),
    kind: "live"
  }));

  return [
    ...countryGroups,
    ...groupTitleGroups.filter((group) => !countryCodeTitles.has(group.title.trim().toUpperCase()))
  ];
}

async function listSeriesGroups(snapshotVersion: number, search?: string) {
  const searchValue = buildSearchClause(search);
  const result = await query<{ title: string; count: string }>(
    `
      select coalesce(nullif(group_title, ''), 'Diger') as title, count(*)::text as count
      from public.shared_series
      where snapshot_version = $1
        and ($2::text is null or lower(title) like $2 or lower(coalesce(group_title, '')) like $2)
      group by 1
      order by count(*) desc, title asc
    `,
    [snapshotVersion, searchValue]
  );

  return result.rows.map<CatalogGroup>((row) => ({
    title: row.title,
    count: Number(row.count),
    kind: "series"
  }));
}

function buildMovieGroupsFromRows(rows: Array<{ group_title: string | null }>) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = row.group_title?.trim() || "Diger";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "tr"))
    .map<CatalogGroup>(([title, count]) => ({
      title,
      count,
      kind: "movie"
    }));
}

export async function listLiveCatalog(
  snapshotVersion: number,
  page: number,
  pageSize: number,
  search?: string,
  group?: string,
  playback?: PlaybackContext
) {
  const offset = (page - 1) * pageSize;
  const searchValue = buildSearchClause(search);
  const countryCodeFilter = resolveLiveCountryFilter(group);
  const [itemsResult, totalResult, groups] = countryCodeFilter
    ? await Promise.all([
        query<SharedLiveChannelRow>(
          `
            select
              c.id,
              c.title,
              c.group_title,
              c.logo_url,
              c.stream_path,
              c.transport,
              h.health_status,
              h.last_checked_at,
              h.failure_count,
              h.last_error
            from public.shared_live_channels c
            left join public.shared_live_channel_health h on h.channel_id = c.id
            where c.snapshot_version = $1
              and coalesce(h.health_status, 'unknown') <> 'broken'
              and ($2::text is null or lower(c.title) like $2 or lower(coalesce(c.group_title, '')) like $2)
              and ${buildLiveCountryFilterWhereClause()}
            order by ${buildLiveCatalogOrderByClause(true)}
            limit $4 offset $5
          `,
          [snapshotVersion, searchValue, countryCodeFilter, pageSize, offset]
        ),
        query<{ count: string }>(
          `
            select count(*)::text as count
            from public.shared_live_channels c
            left join public.shared_live_channel_health h on h.channel_id = c.id
            where c.snapshot_version = $1
              and coalesce(h.health_status, 'unknown') <> 'broken'
              and ($2::text is null or lower(c.title) like $2 or lower(coalesce(c.group_title, '')) like $2)
              and ${buildLiveCountryFilterWhereClause()}
          `,
          [snapshotVersion, searchValue, countryCodeFilter]
        ),
        listLiveCatalogGroups(snapshotVersion, search)
      ])
    : await Promise.all([
        query<SharedLiveChannelRow>(
          `
            select
              c.id,
              c.title,
              c.group_title,
              c.logo_url,
              c.stream_path,
              c.transport,
              h.health_status,
              h.last_checked_at,
              h.failure_count,
              h.last_error
            from public.shared_live_channels c
            left join public.shared_live_channel_health h on h.channel_id = c.id
            where c.snapshot_version = $1
              and coalesce(h.health_status, 'unknown') <> 'broken'
              and ($2::text is null or lower(c.title) like $2 or lower(coalesce(c.group_title, '')) like $2)
              and ($3::text is null or lower(coalesce(c.group_title, 'diger')) = $3)
            order by ${buildLiveCatalogOrderByClause(false)}
            limit $4 offset $5
          `,
          [snapshotVersion, searchValue, buildGroupClause(group), pageSize, offset]
        ),
        query<{ count: string }>(
          `
            select count(*)::text as count
            from public.shared_live_channels c
            left join public.shared_live_channel_health h on h.channel_id = c.id
            where c.snapshot_version = $1
              and coalesce(h.health_status, 'unknown') <> 'broken'
              and ($2::text is null or lower(c.title) like $2 or lower(coalesce(c.group_title, '')) like $2)
              and ($3::text is null or lower(coalesce(c.group_title, 'diger')) = $3)
          `,
          [snapshotVersion, searchValue, buildGroupClause(group)]
        ),
        listLiveCatalogGroups(snapshotVersion, search)
      ]);

  return {
    items: itemsResult.rows.map((row) => mapLiveChannel(row, playback)),
    page,
    pageSize,
    total: Number(totalResult.rows[0]?.count ?? 0),
    groups
  };
}

export async function getLiveChannelForPlayback(snapshotVersion: number, channelId: string) {
  const result = await query<SharedLiveChannelRow>(
    `
      select
        c.id,
        c.snapshot_version,
        c.title,
        c.group_title,
        c.logo_url,
        c.stream_path,
        c.transport,
        h.health_status,
        h.last_checked_at,
        h.failure_count,
        h.last_error
      from public.shared_live_channels c
      left join public.shared_live_channel_health h on h.channel_id = c.id
      where c.snapshot_version = $1
        and coalesce(h.health_status, 'unknown') <> 'broken'
        and c.id = $2
      limit 1
    `,
    [snapshotVersion, channelId]
  );

  return result.rows[0] ?? null;
}

export async function updateLiveChannelHealth(
  channelId: string,
  snapshotVersion: number,
  input: {
    status: LiveHealthStatus;
    errorMessage?: string | null;
    resetFailureCount?: boolean;
    markSuccess?: boolean;
    touchPlaybackRequest?: boolean;
    skipFailureCountIncrement?: boolean;
  }
) {
  await query(
    `
      insert into public.shared_live_channel_health (
        channel_id,
        snapshot_version,
        health_status,
        failure_count,
        last_checked_at,
        last_play_requested_at,
        last_success_at,
        last_error
      ) values (
        $1,
        $2,
        $3,
        case
          when $4::boolean then 0
          when $8::boolean then 0
          else case when $3 = 'healthy' then 0 else 1 end
        end,
        timezone('utc', now()),
        case when $5::boolean then timezone('utc', now()) else null end,
        case when $6::boolean then timezone('utc', now()) else null end,
        $7
      )
      on conflict (channel_id) do update
      set
        snapshot_version = excluded.snapshot_version,
        health_status = case
          when excluded.health_status = 'healthy' then 'healthy'
          when $8::boolean then public.shared_live_channel_health.health_status
          when public.shared_live_channel_health.failure_count + 1 >= 5 then 'broken'
          when public.shared_live_channel_health.failure_count + 1 >= 2 then 'degraded'
          else excluded.health_status
        end,
        failure_count = case
          when $4::boolean or excluded.health_status = 'healthy' then 0
          when $8::boolean then public.shared_live_channel_health.failure_count
          else public.shared_live_channel_health.failure_count + 1
        end,
        last_checked_at = timezone('utc', now()),
        last_play_requested_at = case
          when $5::boolean then timezone('utc', now())
          else public.shared_live_channel_health.last_play_requested_at
        end,
        last_success_at = case
          when $6::boolean then timezone('utc', now())
          else public.shared_live_channel_health.last_success_at
        end,
        last_error = excluded.last_error
    `,
    [
      channelId,
      snapshotVersion,
      input.status,
      input.resetFailureCount ?? false,
      input.touchPlaybackRequest ?? false,
      input.markSuccess ?? false,
      input.errorMessage ?? null,
      input.skipFailureCountIncrement ?? false
    ]
  );
}

export async function getLivePlaybackHealth(channelId: string) {
  const result = await query<{
    health_status: LiveHealthStatus;
    last_checked_at: string | null;
    failure_count: number;
    last_error: string | null;
  }>(
    `
      select health_status, last_checked_at, failure_count, last_error
      from public.shared_live_channel_health
      where channel_id = $1
      limit 1
    `,
    [channelId]
  );

  return result.rows[0] ?? null;
}

export async function reportLivePlaybackEvent(
  channelId: string,
  snapshotVersion: number,
  event: "playing" | "stalled" | "recovered" | "failed",
  input?: {
    diagnosticsSessionId?: string | null;
    deliveryMode?: string | null;
    sourceTransport?: string | null;
    playerEngine?: string | null;
    uptimeMs?: number | null;
    bufferedSeconds?: number | null;
    currentTime?: number | null;
    readyState?: number | null;
    networkState?: number | null;
    stallReason?: string | null;
    errorCode?: string | null;
    upstreamStatus?: number | null;
    detail?: Record<string, unknown> | null;
    errorMessage?: string | null;
  }
) {
  await query(
    `
      insert into public.live_playback_diagnostics (
        channel_id,
        snapshot_version,
        diagnostics_session_id,
        event,
        delivery_mode,
        source_transport,
        player_engine,
        uptime_ms,
        buffered_seconds,
        current_time_seconds,
        ready_state,
        network_state,
        stall_reason,
        error_code,
        upstream_status,
        error_message,
        detail
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17::jsonb
      )
    `,
    [
      channelId,
      snapshotVersion,
      input?.diagnosticsSessionId ?? null,
      event,
      input?.deliveryMode ?? null,
      input?.sourceTransport ?? null,
      input?.playerEngine ?? null,
      input?.uptimeMs ?? null,
      input?.bufferedSeconds ?? null,
      input?.currentTime ?? null,
      input?.readyState ?? null,
      input?.networkState ?? null,
      input?.stallReason ?? null,
      input?.errorCode ?? null,
      input?.upstreamStatus ?? null,
      input?.errorMessage ?? null,
      input?.detail ? JSON.stringify(input.detail) : null
    ]
  );
}

export async function reportVodPlaybackEvent(
  itemId: string,
  kind: VodPlaybackKind,
  event:
    | "session-created"
    | "audio-track-selected"
    | "audio-track-switch-failed"
    | "no-audio-detected"
    | "transcode-started"
    | "transcode-failed"
    | "playback-failed"
    | "recovered",
  input?: {
    diagnosticsSessionId?: string | null;
    deliveryMode?: string | null;
    sourceTransport?: string | null;
    playerEngine?: string | null;
    uptimeMs?: number | null;
    bufferedSeconds?: number | null;
    currentTime?: number | null;
    readyState?: number | null;
    networkState?: number | null;
    audioTrackId?: string | null;
    errorCode?: string | null;
    upstreamStatus?: number | null;
    detail?: Record<string, unknown> | null;
    errorMessage?: string | null;
  }
) {
  await query(
    `
      insert into public.vod_playback_diagnostics (
        item_id,
        kind,
        diagnostics_session_id,
        event,
        delivery_mode,
        source_transport,
        player_engine,
        uptime_ms,
        buffered_seconds,
        current_time_seconds,
        ready_state,
        network_state,
        audio_track_id,
        error_code,
        upstream_status,
        error_message,
        detail
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17::jsonb
      )
    `,
    [
      itemId,
      kind,
      input?.diagnosticsSessionId ?? null,
      event,
      input?.deliveryMode ?? null,
      input?.sourceTransport ?? null,
      input?.playerEngine ?? null,
      input?.uptimeMs ?? null,
      input?.bufferedSeconds ?? null,
      input?.currentTime ?? null,
      input?.readyState ?? null,
      input?.networkState ?? null,
      input?.audioTrackId ?? null,
      input?.errorCode ?? null,
      input?.upstreamStatus ?? null,
      input?.errorMessage ?? null,
      input?.detail ? JSON.stringify(input.detail) : null
    ]
  );
}

export async function insertLivePlaybackDiagnostic(
  channelId: string,
  snapshotVersion: number,
  input: {
    diagnosticsSessionId?: string | null;
    event: string;
    deliveryMode?: string | null;
    sourceTransport?: string | null;
    playerEngine?: string | null;
    stallReason?: string | null;
    errorCode?: string | null;
    upstreamStatus?: number | null;
    errorMessage?: string | null;
    detail?: Record<string, unknown> | null;
  }
) {
  await query(
    `
      insert into public.live_playback_diagnostics (
        channel_id,
        snapshot_version,
        diagnostics_session_id,
        event,
        delivery_mode,
        source_transport,
        player_engine,
        stall_reason,
        error_code,
        upstream_status,
        error_message,
        detail
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb
      )
    `,
    [
      channelId,
      snapshotVersion,
      input.diagnosticsSessionId ?? null,
      input.event,
      input.deliveryMode ?? null,
      input.sourceTransport ?? null,
      input.playerEngine ?? null,
      input.stallReason ?? null,
      input.errorCode ?? null,
      input.upstreamStatus ?? null,
      input.errorMessage ?? null,
      input.detail ? JSON.stringify(input.detail) : null
    ]
  );
}

export async function listMoviesCatalog(
  snapshotVersion: number,
  page: number,
  pageSize: number,
  search?: string,
  group?: string,
  playback?: PlaybackContext
) {
  const offset = (page - 1) * pageSize;
  const searchValue = buildSearchClause(search);
  const groupValue = buildGroupClause(group);
  const where = `
    where snapshot_version = $1
      and ($2::text is null or lower(title) like $2 or lower(coalesce(group_title, '')) like $2)
  `;
  const itemsResult = await query<{
    id: string;
    title: string;
    poster_url: string | null;
    group_title: string | null;
    stream_path: string;
    order_index: number;
  }>(
    `
      select id, title, poster_url, group_title, stream_path, order_index
      from public.shared_movies
      ${where}
      order by order_index asc, title asc
    `,
    [snapshotVersion, searchValue]
  );

  const dedupedRows = dedupeMovieCatalogEntries(itemsResult.rows, {
    getTitle: (row) => row.title,
    getGroupTitle: (row) => row.group_title,
    getArtworkUrl: (row) => row.poster_url
  });
  const groups = buildMovieGroupsFromRows(dedupedRows);
  const filteredRows = groupValue
    ? dedupedRows.filter((row) => (row.group_title?.trim() || "Diger").toLowerCase() === groupValue)
    : dedupedRows;
  const pagedRows = filteredRows.slice(offset, offset + pageSize);

  return {
    items: pagedRows.map<MovieRecord>((row) => ({
      id: row.id,
      title: row.title,
      posterUrl: row.poster_url,
      groupTitle: row.group_title,
      streamUrl: null,
      playbackAllowed: Boolean(playback?.canPlay)
    })),
    page,
    pageSize,
    total: filteredRows.length,
    groups
  };
}

export async function getMovieForPlayback(snapshotVersion: number, movieId: string) {
  const result = await query<{
    id: string;
    snapshot_version: number;
    title: string;
    poster_url: string | null;
    group_title: string | null;
    stream_path: string;
    order_index: number;
  }>(
    `
      select id, snapshot_version, title, poster_url, group_title, stream_path, order_index
      from public.shared_movies
      where snapshot_version = $1
        and id = $2
      limit 1
    `,
    [snapshotVersion, movieId]
  );

  return result.rows[0] ?? null;
}

export async function listSeriesCatalog(
  snapshotVersion: number,
  page: number,
  pageSize: number,
  search?: string,
  group?: string,
  playback?: PlaybackContext
) {
  const offset = (page - 1) * pageSize;
  const searchValue = buildSearchClause(search);
  const groupValue = buildGroupClause(group);
  const where = `
    where s.snapshot_version = $1
      and ($2::text is null or lower(s.title) like $2 or lower(coalesce(s.group_title, '')) like $2)
      and ($3::text is null or lower(coalesce(s.group_title, 'diger')) = $3)
  `;
  const [seriesResult, totalResult, groups] = await Promise.all([
    query<{
      id: string;
      title: string;
      poster_url: string | null;
      group_title: string | null;
    }>(
      `
        select s.id, s.title, s.poster_url, s.group_title
        from public.shared_series s
        ${where}
        order by s.order_index asc, s.title asc
        limit $4 offset $5
      `,
      [snapshotVersion, searchValue, groupValue, pageSize, offset]
    ),
    query<{ count: string }>(
      `select count(*)::text as count from public.shared_series s ${where}`,
      [snapshotVersion, searchValue, groupValue]
    ),
    listSeriesGroups(snapshotVersion, search)
  ]);

  const seriesIds = seriesResult.rows.map((row) => row.id);
  const episodesResult =
    seriesIds.length > 0
      ? await query<{
          id: string;
          series_id: string;
          title: string;
          season_number: number;
          episode_number: number;
          stream_path: string;
        }>(
          `
            select id, series_id, title, season_number, episode_number, stream_path
            from public.shared_episodes
            where series_id = any($1::uuid[])
            order by season_number asc, episode_number asc, order_index asc
          `,
          [seriesIds]
        )
      : { rows: [] };

  return {
    items: seriesResult.rows.map<SeriesRecord>((seriesRow) => ({
      id: seriesRow.id,
      title: seriesRow.title,
      posterUrl: seriesRow.poster_url,
      groupTitle: seriesRow.group_title,
      ...(() => {
        const seriesEpisodes = episodesResult.rows
          .filter((episode) => episode.series_id === seriesRow.id)
          .map((episode) => ({
            id: episode.id,
            title: episode.title,
            seasonNumber: episode.season_number,
            episodeNumber: episode.episode_number,
            streamUrl: null,
            playbackAllowed: Boolean(playback?.canPlay)
          }));

        const seasonsMap = new Map<number, SeriesSeasonRecord>();
        for (const episode of seriesEpisodes) {
          const existingSeason = seasonsMap.get(episode.seasonNumber);
          if (existingSeason) {
            existingSeason.episodes.push(episode);
            existingSeason.episodeCount += 1;
            continue;
          }

          seasonsMap.set(episode.seasonNumber, {
            seasonNumber: episode.seasonNumber,
            title: `${episode.seasonNumber}. Sezon`,
            episodeCount: 1,
            episodes: [episode]
          });
        }

        const seasons = Array.from(seasonsMap.values()).sort((left, right) => left.seasonNumber - right.seasonNumber);
        const firstPlayableEpisode =
          seasons.flatMap((season) => season.episodes).find((episode) => episode.playbackAllowed) ??
          seasons.flatMap((season) => season.episodes)[0] ??
          null;

        return {
          seasonCount: seasons.length,
          episodeCount: seriesEpisodes.length,
          featuredEpisode: firstPlayableEpisode,
          seasons
        };
      })()
    })),
    page,
    pageSize,
    total: Number(totalResult.rows[0]?.count ?? 0),
    groups
  };
}

export async function getEpisodeForPlayback(snapshotVersion: number, episodeId: string) {
  const result = await query<{
    id: string;
    series_id: string;
    title: string;
    season_number: number;
    episode_number: number;
    stream_path: string;
  }>(
    `
      select id, series_id, title, season_number, episode_number, stream_path
      from public.shared_episodes
      where id = $1
        and exists (
          select 1
          from public.shared_series s
          where s.id = public.shared_episodes.series_id
            and s.snapshot_version = $2
        )
      limit 1
    `,
    [episodeId, snapshotVersion]
  );

  return result.rows[0] ?? null;
}

export async function createPaymentRequest(userId: string, packageSlug: string) {
  const result = await query(
    `
      insert into public.payment_requests (user_id, package_id)
      select $1, id
      from public.packages
      where slug = $2
        and is_active = true
      limit 1
    `,
    [userId, packageSlug]
  );

  if (result.rowCount === 0) {
    throw new Error("Package not found");
  }
}

export async function createTrialRequest(userId: string, note?: string) {
  await query(
    "insert into public.trial_requests (user_id, note) values ($1, $2)",
    [userId, note ?? null]
  );
}

export async function listAdminUsers(
  page: number,
  pageSize: number,
  filters: AdminUserFilters = {}
) {
  const offset = (page - 1) * pageSize;
  const searchValue = buildSearchClause(filters.search);
  const statusValue = filters.status ?? null;
  const m3uValue = filters.m3u ?? null;
  const includeDeleted = filters.includeDeleted || filters.status === "deleted";
  const baseWhere = `
    where
      ($1::text is null or lower(u.id::text) like $1 or lower(coalesce(u.notes, '')) like $1 or lower(coalesce(u.code_suffix, '')) like $1 or lower(coalesce(u.kryptonite_code, '')) like $1)
      and (
        case
          when $2::text = 'deleted' then u.deleted_at is not null
          when $2::text is null then ($3::boolean = true or u.deleted_at is null)
          else u.deleted_at is null and u.status = $2::text
        end
      )
      and (
        $4::text is null
        or ($4::text = 'assigned' and cred.username is not null and cred.password is not null)
        or ($4::text = 'unassigned' and (cred.username is null or cred.password is null))
      )
  `;

  const [result, totalResult] = await Promise.all([
    query<UserContextRow>(
      `
        select
          u.id,
          u.status,
          u.created_at,
          u.last_login_at,
          u.kryptonite_code,
          u.code_suffix,
          u.notes,
          u.deleted_at,
          settings.shared_source_status as source_status,
          settings.shared_source_snapshot_version as current_snapshot_version,
          settings.shared_source_base_url as source_base_url,
          settings.shared_source_playlist_path as source_playlist_path,
          settings.shared_source_playlist_suffix as source_playlist_suffix,
          settings.shared_source_reference_username as source_reference_username,
          settings.shared_source_reference_password as source_reference_password,
          cred.username as iptv_username,
          cred.password as iptv_password,
          sub.package_id,
          sub.package_title,
          sub.package_duration,
          sub.ends_at
        from public.users u
        left join public.app_settings settings on settings.id = true
        left join public.user_iptv_credentials cred on cred.user_id = u.id
        left join lateral (
          select
            s.package_id,
            case
              when s.end_reason = 'trial-24h' then '24 Saat Test'
              else p.title
            end as package_title,
            p.duration as package_duration,
            s.ends_at
          from public.subscriptions s
          join public.packages p on p.id = s.package_id
          where s.user_id = u.id
            and s.status = 'active'
            and s.ends_at > timezone('utc', now())
          order by s.ends_at desc
          limit 1
        ) sub on true
        ${baseWhere}
        order by u.created_at desc
        limit $5 offset $6
      `,
      [searchValue, statusValue, includeDeleted, m3uValue, pageSize, offset]
    ),
    query<{ count: string }>(
      `select count(*)::text as count from public.users u left join public.user_iptv_credentials cred on cred.user_id = u.id ${baseWhere}`,
      [searchValue, statusValue, includeDeleted, m3uValue]
    )
  ]);

  return {
    items: result.rows.map((row) => mapAdminUserListItem(row)),
    page,
    pageSize,
    total: Number(totalResult.rows[0]?.count ?? 0)
  };
}

export async function listDeviceSessionsForUser(userId: string, currentSessionId: string | null = null) {
  const result = await query<DeviceSessionRow>(
    `
      select id, device_name, platform, expires_at, last_seen_at, revoked_at, created_at
      from public.device_sessions
      where user_id = $1
      order by last_seen_at desc, created_at desc
    `,
    [userId]
  );

  return result.rows.map((row) => mapDeviceSession(row, currentSessionId));
}

export async function revokeDeviceSessionForUser(userId: string, sessionId: string) {
  const result = await query(
    `
      update public.device_sessions
      set revoked_at = timezone('utc', now())
      where id = $1
        and user_id = $2
        and revoked_at is null
    `,
    [sessionId, userId]
  );

  if (result.rowCount === 0) {
    throw new Error("Session not found");
  }
}

export async function listAdminAuditLogsByEntity(entityId: string, limit = 20) {
  const result = await query<AuditLogRow>(
    `
      select id, admin_id, action, entity_type, entity_id, created_at
      from public.admin_audit_logs
      where entity_id = $1
      order by created_at desc
      limit $2
    `,
    [entityId, limit]
  );

  return result.rows.map(mapAuditLog);
}

export async function getAdminDashboard() {
  const result = await query<{
    users_total: string;
    users_blocked: string;
    users_waiting_for_link: string;
    active_subscriptions: string;
    pending_payment_requests: string;
    pending_trial_requests: string;
    queued_m3u_jobs: string;
    failed_m3u_jobs: string;
    live_healthy_channels: string;
    live_degraded_channels: string;
    live_broken_channels: string;
    live_last_error: string | null;
  }>(
    `
      select
        (select count(*)::text from public.users where deleted_at is null) as users_total,
        (select count(*)::text from public.users where status = 'blocked' and deleted_at is null) as users_blocked,
        (select count(*)::text from public.users u left join public.user_iptv_credentials cred on cred.user_id = u.id where u.deleted_at is null and cred.user_id is null) as users_waiting_for_link,
        (select count(*)::text from public.subscriptions s join public.users u on u.id = s.user_id where s.status = 'active' and s.ends_at > timezone('utc', now()) and u.deleted_at is null) as active_subscriptions,
        (select count(*)::text from public.payment_requests where status = 'pending-review') as pending_payment_requests,
        (select count(*)::text from public.trial_requests where status = 'pending') as pending_trial_requests,
        (select count(*)::text from public.shared_m3u_sync_jobs where status = 'queued') as queued_m3u_jobs,
        (select count(*)::text from public.shared_m3u_sync_jobs where status = 'failed') as failed_m3u_jobs,
        (
          select count(*)::text
          from public.shared_live_channel_health h
          join public.shared_live_channels c on c.id = h.channel_id
          where c.snapshot_version = (select shared_source_snapshot_version from public.app_settings where id = true)
            and h.health_status = 'healthy'
        ) as live_healthy_channels,
        (
          select count(*)::text
          from public.shared_live_channel_health h
          join public.shared_live_channels c on c.id = h.channel_id
          where c.snapshot_version = (select shared_source_snapshot_version from public.app_settings where id = true)
            and h.health_status = 'degraded'
        ) as live_degraded_channels,
        (
          select count(*)::text
          from public.shared_live_channel_health h
          join public.shared_live_channels c on c.id = h.channel_id
          where c.snapshot_version = (select shared_source_snapshot_version from public.app_settings where id = true)
            and h.health_status = 'broken'
        ) as live_broken_channels,
        (
          select h.last_error
          from public.shared_live_channel_health h
          join public.shared_live_channels c on c.id = h.channel_id
          where c.snapshot_version = (select shared_source_snapshot_version from public.app_settings where id = true)
            and h.last_error is not null
          order by h.last_checked_at desc nulls last
          limit 1
        ) as live_last_error
    `
  );

  const row = result.rows[0];
  return {
    usersTotal: Number(row?.users_total ?? 0),
    usersBlocked: Number(row?.users_blocked ?? 0),
    usersWaitingForLink: Number(row?.users_waiting_for_link ?? 0),
    activeSubscriptions: Number(row?.active_subscriptions ?? 0),
    pendingPaymentRequests: Number(row?.pending_payment_requests ?? 0),
    pendingTrialRequests: Number(row?.pending_trial_requests ?? 0),
    queuedM3UJobs: Number(row?.queued_m3u_jobs ?? 0),
    failedM3UJobs: Number(row?.failed_m3u_jobs ?? 0),
    liveHealthyChannels: Number(row?.live_healthy_channels ?? 0),
    liveDegradedChannels: Number(row?.live_degraded_channels ?? 0),
    liveBrokenChannels: Number(row?.live_broken_channels ?? 0),
    liveLastError: row?.live_last_error ?? null
  };
}

export async function getAdminUserDetail(userId: string) {
  const row = await getUserContextRow(userId, true);
  const [deviceSessions, paymentRequests, trialRequests, subscriptions, auditLogs] =
    await Promise.all([
      listDeviceSessionsForUser(userId),
      listPaymentRequests(userId),
      listTrialRequests(userId),
      listSubscriptions(userId),
      listAdminAuditLogsByEntity(userId)
    ]);

  return {
    summary: mapAdminUserListItem(row),
    currentSourceStatus: row.source_status,
    currentSourceUrl: getCurrentSourceUrl(row),
    iptvUsername: row.iptv_username ?? null,
    iptvPassword: row.iptv_password ?? null,
    snapshotVersion: row.current_snapshot_version ?? 0,
    deviceSessions,
    paymentRequests,
    trialRequests,
    subscriptions,
    auditLogs
  };
}

async function revokeUserSessions(client: PoolClient, userId: string) {
  await client.query(
    `
      update public.device_sessions
      set revoked_at = timezone('utc', now())
      where user_id = $1
        and revoked_at is null
    `,
    [userId]
  );
}

export async function updateAdminUser(
  userId: string,
  input: {
    status?: "new" | "active" | "blocked";
    notes?: string | null;
  },
  adminId: string
) {
  return withTransaction(async (client) => {
    const result = await client.query<{ status: "new" | "active" | "blocked" }>(
      `
        update public.users
        set status = coalesce($2, status),
            notes = case when $3::boolean then $4 else notes end
        where id = $1
        returning status
      `,
      [userId, input.status ?? null, input.notes !== undefined, input.notes ?? null]
    );

    if (result.rowCount === 0) {
      throw new Error("User not found");
    }

    const nextStatus = result.rows[0]?.status;
    if (nextStatus === "blocked") {
      await revokeUserSessions(client, userId);
    }

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, 'update-user', 'user', $2, jsonb_strip_nulls(jsonb_build_object('status', $3::text, 'notes', $4::text)))
      `,
      [adminId, userId, input.status ?? null, input.notes ?? null]
    );
  });
}

export async function updateUserStatus(
  userId: string,
  status: "new" | "active" | "blocked",
  adminId: string
) {
  return updateAdminUser(userId, { status }, adminId);
}

export async function softDeleteUser(userId: string, adminId: string) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `
        update public.users
        set status = 'blocked',
            deleted_at = timezone('utc', now())
        where id = $1
          and deleted_at is null
      `,
      [userId]
    );

    if (result.rowCount === 0) {
      throw new Error("User not found");
    }

    await revokeUserSessions(client, userId);
    await client.query(
      `
        update public.subscriptions
        set status = 'cancelled',
            end_reason = 'soft-deleted'
        where user_id = $1
          and status = 'active'
      `,
      [userId]
    );

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, 'soft-delete-user', 'user', $2, jsonb_build_object('deleted', true))
      `,
      [adminId, userId]
    );
  });
}

async function queueSharedSourceSync(client: PoolClient, adminId: string) {
  const existing = await client.query<{ id: string }>(
    `
      select id
      from public.shared_m3u_sync_jobs
      where status in ('queued', 'processing')
      order by created_at desc
      limit 1
    `
  );

  if (existing.rowCount && existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const inserted = await client.query<{ id: string }>(
    `
      insert into public.shared_m3u_sync_jobs (requested_by_admin_id, status)
      values ($1, 'queued')
      returning id
    `,
    [adminId]
  );

  return inserted.rows[0]?.id ?? null;
}

export async function assignM3USource(
  userId: string,
  input: {
    sourceUrl?: string;
    username?: string;
    password?: string;
  },
  adminId: string
) {
  return withTransaction(async (client) => {
    await client.query(
      "update public.users set status = 'active' where id = $1 and status <> 'blocked' and deleted_at is null",
      [userId]
    );

    const parsed = input.sourceUrl ? parsePlaylistUrl(input.sourceUrl) : null;
    const username = input.username?.trim() || parsed?.username;
    const password = input.password?.trim() || parsed?.password;

    if (!username || !password) {
      throw new Error("IPTV kullanici adi ve sifresi gerekli.");
    }

    if (parsed) {
      await client.query(
        `
          insert into public.app_settings (
            id,
            support_whatsapp_url,
            support_telegram_url,
            sales_portal_url,
            hero_title,
            hero_subtitle,
            shared_source_base_url,
            shared_source_playlist_path,
            shared_source_playlist_suffix,
            shared_source_reference_username,
            shared_source_reference_password,
            shared_source_status,
            shared_source_last_error
          ) values (
            true,
            coalesce((select support_whatsapp_url from public.app_settings where id = true), 'https://wa.me/900000000000'),
            coalesce((select support_telegram_url from public.app_settings where id = true), 'https://t.me/yourchannel'),
            (select sales_portal_url from public.app_settings where id = true),
            coalesce((select hero_title from public.app_settings where id = true), 'Canli TV, film ve diziler tek uygulamada'),
            coalesce((select hero_subtitle from public.app_settings where id = true), 'Kriptonit kod ile hizli giris, size ozel baglanti ve manuel onayli paket yonetimi.'),
            $1,
            $2,
            $3,
            $4,
            $5,
            'pending',
            null
          )
          on conflict (id) do update
          set
            shared_source_base_url = coalesce(public.app_settings.shared_source_base_url, excluded.shared_source_base_url),
            shared_source_playlist_path = coalesce(public.app_settings.shared_source_playlist_path, excluded.shared_source_playlist_path),
            shared_source_playlist_suffix = coalesce(public.app_settings.shared_source_playlist_suffix, excluded.shared_source_playlist_suffix),
            shared_source_reference_username = coalesce(public.app_settings.shared_source_reference_username, excluded.shared_source_reference_username),
            shared_source_reference_password = coalesce(public.app_settings.shared_source_reference_password, excluded.shared_source_reference_password),
            shared_source_status = case
              when public.app_settings.shared_source_base_url is null then 'pending'
              else public.app_settings.shared_source_status
            end,
            shared_source_last_error = null
        `,
        [
          parsed.baseUrl,
          parsed.playlistPath,
          parsed.playlistSuffix,
          parsed.username,
          parsed.password
        ]
      );

      const settingsCheck = await client.query<{
        shared_source_base_url: string | null;
        shared_source_playlist_path: string | null;
        shared_source_playlist_suffix: string | null;
      }>(
        `
          select
            shared_source_base_url,
            shared_source_playlist_path,
            shared_source_playlist_suffix
          from public.app_settings
          where id = true
          limit 1
        `
      );

      const settings = settingsCheck.rows[0];
      if (
        settings?.shared_source_base_url &&
        settings.shared_source_base_url !== parsed.baseUrl
      ) {
        throw new Error("Ortak kaynak zaten farkli bir base URL ile tanimli.");
      }
      if (
        settings?.shared_source_playlist_path &&
        settings.shared_source_playlist_path !== parsed.playlistPath
      ) {
        throw new Error("Ortak kaynak playlist yolu farkli.");
      }
      if (
        settings?.shared_source_playlist_suffix &&
        settings.shared_source_playlist_suffix !== parsed.playlistSuffix
      ) {
        throw new Error("Ortak kaynak playlist tipi farkli.");
      }
    }

    await client.query(
      `
        insert into public.user_iptv_credentials (user_id, username, password)
        values ($1, $2, $3)
        on conflict (user_id) do update
        set
          username = excluded.username,
          password = excluded.password
      `,
      [userId, username, password]
    );

    if (parsed) {
      await queueSharedSourceSync(client, adminId);
    }

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values (
          $1,
          'assign-iptv-credentials',
          'user',
          $2,
          jsonb_build_object(
            'username', $3::text,
            'hasSourceUrl', $4::boolean
          )
        )
      `,
      [adminId, userId, username, Boolean(input.sourceUrl)]
    );
  });
}

export async function activateSubscription(userId: string, packageSlug: string, adminId: string) {
  return withTransaction(async (client) => {
    await client.query(
      "update public.users set status = 'active' where id = $1 and status <> 'blocked' and deleted_at is null",
      [userId]
    );

    const packageResult = await client.query<{
      id: string;
      duration: PackageDuration;
    }>("select id, duration from public.packages where slug = $1 and is_active = true limit 1", [
      packageSlug
    ]);
    const pack = packageResult.rows[0];
    if (!pack) {
      throw new Error("Package not found");
    }

    const startsAt = new Date();
    const endsAt = addPackageDuration(startsAt, pack.duration);

    await client.query(
      `
        update public.subscriptions
        set status = 'cancelled',
            end_reason = 'replaced-by-admin'
        where user_id = $1
          and status = 'active'
      `,
      [userId]
    );

    await client.query(
      `
        insert into public.subscriptions (
          user_id,
          package_id,
          status,
          starts_at,
          ends_at,
          activated_by_admin_id
        ) values ($1, $2, 'active', $3, $4, $5)
      `,
      [userId, pack.id, startsAt.toISOString(), endsAt.toISOString(), adminId]
    );

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, 'activate-subscription', 'user', $2, jsonb_build_object('packageSlug', $3::text))
      `,
      [adminId, userId, packageSlug]
    );
  });
}

export async function activateTestSubscription24Hours(userId: string, adminId: string) {
  return withTransaction(async (client) => {
    await client.query(
      "update public.users set status = 'active' where id = $1 and status <> 'blocked' and deleted_at is null",
      [userId]
    );

    const packageResult = await client.query<{ id: string }>(
      `
        select id
        from public.packages
        where is_active = true
        order by
          case when slug = '1-ay' then 0 else 1 end,
          duration_months asc
        limit 1
      `
    );

    const pack = packageResult.rows[0];
    if (!pack) {
      throw new Error("Active package not found");
    }

    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);

    await client.query(
      `
        update public.subscriptions
        set status = 'cancelled',
            end_reason = 'replaced-by-admin'
        where user_id = $1
          and status = 'active'
      `,
      [userId]
    );

    await client.query(
      `
        insert into public.subscriptions (
          user_id,
          package_id,
          status,
          starts_at,
          ends_at,
          activated_by_admin_id,
          end_reason
        ) values ($1, $2, 'active', $3, $4, $5, 'trial-24h')
      `,
      [userId, pack.id, startsAt.toISOString(), endsAt.toISOString(), adminId]
    );

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values (
          $1,
          'activate-test-subscription-24h',
          'user',
          $2,
          jsonb_build_object('durationHours', 24)
        )
      `,
      [adminId, userId]
    );
  });
}

export async function listPaymentRequests(userId?: string) {
  const result = await query<{
    id: string;
    status: "pending-review" | "approved" | "rejected";
    title: string;
    created_at: string;
    user_id: string;
  }>(
    `
      select pr.id, pr.status, p.title, pr.created_at, pr.user_id
      from public.payment_requests pr
      join public.packages p on p.id = pr.package_id
      where ($1::uuid is null or pr.user_id = $1)
      order by pr.created_at desc
    `,
    [userId ?? null]
  );

  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    packageTitle: row.title,
    createdAt: row.created_at,
    userId: row.user_id
  }));
}

export async function listMyPaymentRequests(userId: string) {
  const result = await query<{
    id: string;
    status: "pending-review" | "approved" | "rejected";
    title: string;
    created_at: string;
  }>(
    `
      select pr.id, pr.status, p.title, pr.created_at
      from public.payment_requests pr
      join public.packages p on p.id = pr.package_id
      where pr.user_id = $1
      order by pr.created_at desc
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    packageTitle: row.title,
    createdAt: row.created_at
  }));
}

export async function approvePaymentRequest(paymentRequestId: string, adminId: string) {
  return withTransaction(async (client) => {
    const paymentRequest = await client.query<{
      user_id: string;
      slug: string;
      package_id: string;
      duration: PackageDuration;
    }>(
      `
        select pr.user_id, p.slug, p.id as package_id, p.duration
        from public.payment_requests pr
        join public.packages p on p.id = pr.package_id
        where pr.id = $1
          and pr.status = 'pending-review'
        limit 1
      `,
      [paymentRequestId]
    );
    const row = paymentRequest.rows[0];
    if (!row) {
      throw new Error("Payment request not found");
    }

    await client.query(
      `
        update public.subscriptions
        set status = 'cancelled',
            end_reason = 'replaced-by-payment-approval'
        where user_id = $1
          and status = 'active'
      `,
      [row.user_id]
    );

    const startsAt = new Date();
    const endsAt = addPackageDuration(startsAt, row.duration);

    await client.query(
      `
        insert into public.subscriptions (
          user_id,
          package_id,
          status,
          starts_at,
          ends_at,
          activated_by_admin_id
        ) values ($1, $2, 'active', $3, $4, $5)
      `,
      [row.user_id, row.package_id, startsAt.toISOString(), endsAt.toISOString(), adminId]
    );

    await client.query(
      `
        update public.payment_requests
        set status = 'approved',
            reviewed_by_admin_id = $2,
            reviewed_at = timezone('utc', now())
        where id = $1
      `,
      [paymentRequestId, adminId]
    );

    await client.query(
      "update public.users set status = 'active' where id = $1 and status <> 'blocked' and deleted_at is null",
      [row.user_id]
    );

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, 'approve-payment-request', 'payment_request', $2, jsonb_build_object('packageSlug', $3::text))
      `,
      [adminId, paymentRequestId, row.slug]
    );
  });
}

export async function rejectPaymentRequest(paymentRequestId: string, adminId: string, note?: string) {
  return withTransaction(async (client) => {
    await client.query(
      `
        update public.payment_requests
        set status = 'rejected',
            note = $3,
            reviewed_by_admin_id = $2,
            reviewed_at = timezone('utc', now())
        where id = $1
      `,
      [paymentRequestId, adminId, note ?? null]
    );

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, 'reject-payment-request', 'payment_request', $2, jsonb_build_object('note', $3::text))
      `,
      [adminId, paymentRequestId, note ?? null]
    );
  });
}

export async function listTrialRequests(userId?: string) {
  const result = await query<{
    id: string;
    status: "pending" | "approved" | "rejected";
    created_at: string;
    user_id: string;
    note: string | null;
  }>(
    `
      select id, status, created_at, user_id, note
      from public.trial_requests
      where ($1::uuid is null or user_id = $1)
      order by created_at desc
    `,
    [userId ?? null]
  );

  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    userId: row.user_id,
    note: row.note
  }));
}

export async function reviewTrialRequest(
  trialRequestId: string,
  nextStatus: "approved" | "rejected",
  adminId: string,
  note?: string
) {
  return withTransaction(async (client) => {
    await client.query(
      `
        update public.trial_requests
        set status = $2,
            note = coalesce($4, note),
            reviewed_by_admin_id = $3,
            reviewed_at = timezone('utc', now())
        where id = $1
      `,
      [trialRequestId, nextStatus, adminId, note ?? null]
    );

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, $2, 'trial_request', $3, jsonb_build_object('note', $4::text))
      `,
      [adminId, `${nextStatus}-trial-request`, trialRequestId, note ?? null]
    );
  });
}

export async function listM3USources(userId?: string) {
  const settings = await query<AppSettingsRow>(
    `
      select
        support_whatsapp_url,
        support_telegram_url,
        sales_portal_url,
        hero_title,
        hero_subtitle,
        bank_transfer_eft_enabled,
        bank_transfer_eft_details,
        crypto_enabled,
        crypto_details,
        bank_card_enabled,
        bank_card_details,
        shared_source_base_url,
        shared_source_playlist_path,
        shared_source_playlist_suffix,
        shared_source_reference_username,
        shared_source_reference_password,
        shared_source_status,
        shared_source_snapshot_version,
        shared_source_last_successful_sync_at,
        shared_source_last_error
      from public.app_settings
      where id = true
      limit 1
    `,
    []
  );

  const row = settings.rows[0];
  const sharedConfig = row ? getSharedPlaylistConfig(row) : null;
  const playlistUrl = sharedConfig ? buildPlaylistUrl(sharedConfig) : null;

  return row && sharedConfig
    ? [
        {
          id: "shared-source",
          user_id: userId ?? null,
          source_url: playlistUrl,
          status: row.shared_source_status,
          current_snapshot_version: row.shared_source_snapshot_version,
          last_successful_sync_at: row.shared_source_last_successful_sync_at,
          last_error: row.shared_source_last_error
        }
      ]
    : [];
}

export async function listM3USyncJobs() {
  const result = await query<{
    id: string;
    requested_by_admin_id: string;
    status: "queued" | "processing" | "succeeded" | "failed";
    snapshot_version: number | null;
    attempt_count: number;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>(
    `
      select
        id,
        requested_by_admin_id,
        status,
        snapshot_version,
        attempt_count,
        error_message,
        started_at,
        completed_at,
        created_at
      from public.shared_m3u_sync_jobs
      order by created_at desc
      limit 100
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: "00000000-0000-0000-0000-000000000000",
    userM3USourceId: "00000000-0000-0000-0000-000000000000",
    requestedByAdminId: row.requested_by_admin_id,
    status: row.status,
    snapshotVersion: row.snapshot_version,
    attemptCount: row.attempt_count,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  }));
}

export async function resyncM3USource(sourceId: string, adminId: string) {
  return withTransaction(async (client) => {
    const settings = await client.query<AppSettingsRow>(
      `
        select
          support_whatsapp_url,
          support_telegram_url,
          sales_portal_url,
          hero_title,
          hero_subtitle,
          shared_source_base_url,
          shared_source_playlist_path,
          shared_source_playlist_suffix,
          shared_source_reference_username,
          shared_source_reference_password,
          shared_source_status,
          shared_source_snapshot_version,
          shared_source_last_successful_sync_at,
          shared_source_last_error
        from public.app_settings
        where id = true
        limit 1
      `
    );
    const source = settings.rows[0];
    if (!source || !getSharedPlaylistConfig(source)) {
      throw new Error("Source not found");
    }

    await queueSharedSourceSync(client, adminId);

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, 'resync-m3u', 'm3u_source', $2, '{}'::jsonb)
      `,
      [adminId, sourceId]
    );
  });
}

export async function listSubscriptions(userId?: string) {
  const result = await query<{
    id: string;
    user_id: string;
    status: string;
    starts_at: string;
    ends_at: string;
    package_title: string;
  }>(
    `
      select
        s.id,
        s.user_id,
        s.status,
        s.starts_at,
        s.ends_at,
        case
          when s.end_reason = 'trial-24h' then '24 Saat Test'
          else p.title
        end as package_title
      from public.subscriptions s
      join public.packages p on p.id = s.package_id
      where ($1::uuid is null or s.user_id = $1)
      order by s.created_at desc
    `,
    [userId ?? null]
  );

  return result.rows.map<SubscriptionRecord>((row) => ({
    id: row.id,
    userId: row.user_id,
    status: row.status as SubscriptionRecord["status"],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    packageTitle: row.package_title
  }));
}

export async function getAppSettings() {
  const result = await query<AppSettingsRow>(
    `
      select
        support_whatsapp_url,
        support_telegram_url,
        sales_portal_url,
        hero_title,
        hero_subtitle,
        shared_source_base_url,
        shared_source_playlist_path,
        shared_source_playlist_suffix,
        shared_source_reference_username,
        shared_source_reference_password,
        shared_source_status,
        shared_source_snapshot_version,
        shared_source_last_successful_sync_at,
        shared_source_last_error
      from public.app_settings
      where id = true
      limit 1
    `
  );

  const row = result.rows[0];
  const sharedConfig = row ? getSharedPlaylistConfig(row) : null;
  return {
    supportWhatsappUrl: row?.support_whatsapp_url ?? "https://wa.me/900000000000",
    supportTelegramUrl: row?.support_telegram_url ?? "https://t.me/yourchannel",
    salesPortalUrl: row?.sales_portal_url ?? null,
    heroTitle: row?.hero_title ?? "Canli TV, film ve diziler tek uygulamada",
    heroSubtitle:
      row?.hero_subtitle ??
      "Kriptonit kod ile hizli giris, size ozel baglanti ve manuel onayli paket yonetimi.",
    sharedPlaylistUrl: sharedConfig ? buildPlaylistUrl(sharedConfig) : null,
    sharedSourceStatus: row?.shared_source_status ?? null,
    sharedSourceSnapshotVersion: row?.shared_source_snapshot_version ?? null,
    sharedSourceLastSuccessfulSyncAt: row?.shared_source_last_successful_sync_at ?? null,
    sharedSourceLastError: row?.shared_source_last_error ?? null
  };
}

export async function getPaymentMethodSettings() {
  try {
    const result = await query<AppSettingsRow>(
      `
        select
          bank_transfer_eft_enabled,
          bank_transfer_eft_details,
          bank_transfer_recipient_name,
          bank_transfer_iban,
          bank_transfer_bank_name,
          crypto_enabled,
          crypto_details,
          crypto_wallet_usdt_trc20,
          crypto_wallet_tron,
          crypto_wallet_sol,
          crypto_wallet_btc,
          crypto_wallet_usdc,
          bank_card_enabled,
          bank_card_details
        from public.app_settings
        where id = true
        limit 1
      `
    );

    return mapPaymentMethodSettings(result.rows[0]);
  } catch (error) {
    if (!isMissingPaymentMethodColumnsError(error)) {
      throw error;
    }

    await query(PAYMENT_METHOD_COLUMNS_SQL);

    const result = await query<AppSettingsRow>(
      `
        select
          bank_transfer_eft_enabled,
          bank_transfer_eft_details,
          bank_transfer_recipient_name,
          bank_transfer_iban,
          bank_transfer_bank_name,
          crypto_enabled,
          crypto_details,
          crypto_wallet_usdt_trc20,
          crypto_wallet_tron,
          crypto_wallet_sol,
          crypto_wallet_btc,
          crypto_wallet_usdc,
          bank_card_enabled,
          bank_card_details
        from public.app_settings
        where id = true
        limit 1
      `
    );

    return mapPaymentMethodSettings(result.rows[0]);
  }
}

export async function listPublicPaymentMethods() {
  const settings = await getPaymentMethodSettings();
  return mapPaymentMethodsForViewer(settings);
}

export async function updatePaymentMethodSettings(input: PaymentMethodSettings, adminId: string) {
  return withTransaction(async (client) => {
    await client.query(PAYMENT_METHOD_COLUMNS_SQL);

    await client.query(
      `
        insert into public.app_settings (
          id,
          support_whatsapp_url,
          support_telegram_url,
          sales_portal_url,
          hero_title,
          hero_subtitle,
          bank_transfer_eft_enabled,
          bank_transfer_eft_details,
          bank_transfer_recipient_name,
          bank_transfer_iban,
          bank_transfer_bank_name,
          crypto_enabled,
          crypto_details,
          crypto_wallet_usdt_trc20,
          crypto_wallet_tron,
          crypto_wallet_sol,
          crypto_wallet_btc,
          crypto_wallet_usdc,
          bank_card_enabled,
          bank_card_details
        ) values (
          true,
          coalesce((select support_whatsapp_url from public.app_settings where id = true), 'https://wa.me/900000000000'),
          coalesce((select support_telegram_url from public.app_settings where id = true), 'https://t.me/yourchannel'),
          (select sales_portal_url from public.app_settings where id = true),
          coalesce((select hero_title from public.app_settings where id = true), 'Canli TV, film ve diziler tek uygulamada'),
          coalesce((select hero_subtitle from public.app_settings where id = true), 'Kriptonit kod ile hizli giris, size ozel baglanti ve manuel onayli paket yonetimi.'),
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14
        )
        on conflict (id) do update
        set
          bank_transfer_eft_enabled = excluded.bank_transfer_eft_enabled,
          bank_transfer_eft_details = excluded.bank_transfer_eft_details,
          bank_transfer_recipient_name = excluded.bank_transfer_recipient_name,
          bank_transfer_iban = excluded.bank_transfer_iban,
          bank_transfer_bank_name = excluded.bank_transfer_bank_name,
          crypto_enabled = excluded.crypto_enabled,
          crypto_details = excluded.crypto_details,
          crypto_wallet_usdt_trc20 = excluded.crypto_wallet_usdt_trc20,
          crypto_wallet_tron = excluded.crypto_wallet_tron,
          crypto_wallet_sol = excluded.crypto_wallet_sol,
          crypto_wallet_btc = excluded.crypto_wallet_btc,
          crypto_wallet_usdc = excluded.crypto_wallet_usdc,
          bank_card_enabled = excluded.bank_card_enabled,
          bank_card_details = excluded.bank_card_details
      `,
      [
        input.bankTransferEftEnabled,
        input.bankTransferEftDetails,
        input.bankTransferRecipientName,
        input.bankTransferIban,
        input.bankTransferBankName,
        input.cryptoEnabled,
        input.cryptoDetails,
        input.cryptoWalletUsdtTrc20,
        input.cryptoWalletTron,
        input.cryptoWalletSol,
        input.cryptoWalletBtc,
        input.cryptoWalletUsdc,
        input.bankCardEnabled,
        input.bankCardDetails
      ]
    );

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values (
          $1,
          'update-payment-method-settings',
          'app_settings',
          'true',
          jsonb_build_object(
            'bankTransferEftEnabled', $2::boolean,
            'cryptoEnabled', $3::boolean,
            'bankCardEnabled', $4::boolean,
            'bankTransferHasIban', ($5::text is not null and length(trim($5::text)) > 0),
            'cryptoWalletCount', $6::int
          )
        )
      `,
      [
        adminId,
        input.bankTransferEftEnabled,
        input.cryptoEnabled,
        input.bankCardEnabled,
        input.bankTransferIban,
        [
          input.cryptoWalletUsdtTrc20,
          input.cryptoWalletTron,
          input.cryptoWalletSol,
          input.cryptoWalletBtc,
          input.cryptoWalletUsdc
        ].filter((value) => Boolean(value && value.trim().length > 0)).length
      ]
    );
  });
}

export async function updatePackageStatus(
  packageId: string,
  input: {
    isActive?: boolean;
    priceLabel?: string | null;
  },
  adminId: string
) {
  return withTransaction(async (client) => {
    await client.query(PACKAGE_PRICE_COLUMN_SQL);

    const hasIsActive = input.isActive !== undefined;
    const hasPriceLabel = input.priceLabel !== undefined;
    const result = await client.query(
      `
        update public.packages
        set
          is_active = case when $2::boolean then $3::boolean else is_active end,
          price_label = case when $4::boolean then $5::text else price_label end
        where id = $1
      `,
      [packageId, hasIsActive, input.isActive ?? false, hasPriceLabel, input.priceLabel ?? null]
    );

    if (result.rowCount === 0) {
      throw new Error("Package not found");
    }

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values (
          $1,
          'update-package-status',
          'package',
          $2,
          jsonb_strip_nulls(
            jsonb_build_object(
              'isActive', case when $3::boolean then $4::boolean else null end,
              'priceLabel', case when $5::boolean then $6::text else null end
            )
          )
        )
      `,
      [adminId, packageId, hasIsActive, input.isActive ?? false, hasPriceLabel, input.priceLabel ?? null]
    );
  });
}

export async function updateAppSettings(
  input: {
    supportWhatsappUrl: string;
    supportTelegramUrl: string;
    salesPortalUrl: string | null;
    heroTitle: string;
    heroSubtitle: string;
    sharedPlaylistUrl: string | null;
  },
  adminId: string
) {
  return withTransaction(async (client) => {
    const sharedConfig = input.sharedPlaylistUrl ? parsePlaylistUrl(input.sharedPlaylistUrl) : null;
    await client.query(
      `
        insert into public.app_settings (
          id,
          support_whatsapp_url,
          support_telegram_url,
          sales_portal_url,
          hero_title,
          hero_subtitle,
          shared_source_base_url,
          shared_source_playlist_path,
          shared_source_playlist_suffix,
          shared_source_reference_username,
          shared_source_reference_password,
          shared_source_status,
          shared_source_last_error
        ) values (
          true,
          $1,
          $2,
          $3,
          $4,
          $5,
          $6::text,
          $7::text,
          $8::text,
          $9::text,
          $10::text,
          case when $6::text is null then coalesce((select shared_source_status from public.app_settings where id = true), 'pending') else 'pending' end,
          null
        )
        on conflict (id) do update
        set
          support_whatsapp_url = excluded.support_whatsapp_url,
          support_telegram_url = excluded.support_telegram_url,
          sales_portal_url = excluded.sales_portal_url,
          hero_title = excluded.hero_title,
          hero_subtitle = excluded.hero_subtitle,
          shared_source_base_url = excluded.shared_source_base_url,
          shared_source_playlist_path = excluded.shared_source_playlist_path,
          shared_source_playlist_suffix = excluded.shared_source_playlist_suffix,
          shared_source_reference_username = excluded.shared_source_reference_username,
          shared_source_reference_password = excluded.shared_source_reference_password,
          shared_source_status = case
            when excluded.shared_source_base_url is null then public.app_settings.shared_source_status
            else 'pending'
          end,
          shared_source_last_error = null
      `,
      [
        input.supportWhatsappUrl,
        input.supportTelegramUrl,
        input.salesPortalUrl,
        input.heroTitle,
        input.heroSubtitle,
        sharedConfig?.baseUrl ?? null,
        sharedConfig?.playlistPath ?? null,
        sharedConfig?.playlistSuffix ?? null,
        sharedConfig?.username ?? null,
        sharedConfig?.password ?? null
      ]
    );

    if (sharedConfig) {
      await client.query(
        `
          insert into public.user_iptv_credentials (user_id, username, password)
          select
            u.id,
            $1::text,
            $2::text
          from public.users u
          where u.deleted_at is null
            and u.status <> 'blocked'
            and exists (
              select 1
              from public.subscriptions s
              where s.user_id = u.id
                and s.status = 'active'
                and s.ends_at > timezone('utc', now())
            )
          on conflict (user_id) do update
          set
            username = excluded.username,
            password = excluded.password,
            updated_at = timezone('utc', now())
        `,
        [sharedConfig.username, sharedConfig.password]
      );

      await queueSharedSourceSync(client, adminId);
    }

    await client.query(
      `
        insert into public.admin_audit_logs (admin_id, action, entity_type, entity_id, payload)
        values ($1, 'update-settings', 'app_settings', 'true', jsonb_build_object('heroTitle', $2::text, 'sharedPlaylistConfigured', $3::boolean))
      `,
      [adminId, input.heroTitle, Boolean(sharedConfig)]
    );
  });
}
