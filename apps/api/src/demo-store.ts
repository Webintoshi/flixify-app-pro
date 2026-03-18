import { randomBytes, randomUUID } from "node:crypto";
import type {
  AdminAuditLogRecord,
  CatalogGroup,
  DeviceSessionRecord,
  LiveChannel,
  MeResponse,
  M3USyncJobRecord,
  MovieRecord,
  PaymentMethodOption,
  PackageRecord,
  SeriesRecord,
  SubscriptionRecord,
  UserSummary,
  VodPlaybackKind,
  VodPlaybackRecord
} from "@flixify/contracts";
import { signAccessToken } from "./security.js";

type DemoSession = {
  sessionId: string;
  userId: string;
  refreshSecret: string;
  deviceName: string | null;
  platform: string | null;
  revokedAt: string | null;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
};

type DemoUser = {
  summary: UserSummary;
  kryptoniteCode: string;
  currentSourceStatus: string | null;
  currentSourceUrl: string | null;
  snapshotVersion: number;
  notes: string | null;
  deletedAt: string | null;
};

type DemoPaymentRequest = {
  id: string;
  status: "pending-review" | "approved" | "rejected";
  packageTitle: string;
  createdAt: string;
  userId: string;
};

type DemoTrialRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  userId: string;
  note: string | null;
};

type DemoSource = {
  id: string;
  userId: string;
  sourceUrl: string;
  status: "pending" | "syncing" | "ready" | "error";
  currentSnapshotVersion: number;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
};

type DemoPaymentMethodSettings = {
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

const now = () => new Date().toISOString();

function plusDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function plusHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function makeSummary(input: {
  id?: string;
  status?: UserSummary["status"];
  hasAssignedLink?: boolean;
  hasActiveSubscription?: boolean;
  activePackage?: UserSummary["activePackage"];
  kryptoniteCode?: string | null;
  codeSuffix?: string | null;
} = {}): UserSummary {
  return {
    id: input.id ?? randomUUID(),
    status: input.status ?? "new",
    createdAt: now(),
    lastLoginAt: now(),
    kryptoniteCode: input.kryptoniteCode ?? null,
    codeSuffix: input.codeSuffix ?? null,
    hasAssignedLink: input.hasAssignedLink ?? false,
    hasActiveSubscription: input.hasActiveSubscription ?? false,
    activePackage: input.activePackage ?? null,
    popup:
      input.hasAssignedLink === true
        ? null
        : {
            required: true,
            actions: ["free-trial", "contact", "buy-package"]
          }
  };
}

const packages: PackageRecord[] = [
  {
    id: randomUUID(),
    slug: "1-ay",
    title: "1 Ay",
    duration: "1m",
    durationMonths: 1,
    priceLabel: "199 TL",
    isActive: true,
    createdAt: now()
  },
  {
    id: randomUUID(),
    slug: "3-ay",
    title: "3 Ay",
    duration: "3m",
    durationMonths: 3,
    priceLabel: "499 TL",
    isActive: true,
    createdAt: now()
  },
  {
    id: randomUUID(),
    slug: "6-ay",
    title: "6 Ay",
    duration: "6m",
    durationMonths: 6,
    priceLabel: "899 TL",
    isActive: true,
    createdAt: now()
  },
  {
    id: randomUUID(),
    slug: "12-ay",
    title: "12 Ay",
    duration: "12m",
    durationMonths: 12,
    priceLabel: "1499 TL",
    isActive: true,
    createdAt: now()
  }
];

const settings = {
  supportWhatsappUrl: "https://wa.me/905555555555",
  supportTelegramUrl: "https://t.me/flixifydestek",
  salesPortalUrl: "https://flixify.pro/paketler",
  heroTitle: "Flixify IPTV Platformu",
  heroSubtitle: "Demo modunda calisiyor. Baglantilar hazir oldugunda ayni arayuz gercek veriyle devam edecek."
};

const paymentMethodSettings: DemoPaymentMethodSettings = {
  bankTransferEftEnabled: true,
  bankTransferEftDetails: "Havale/EFT detaylarini buraya girin.",
  bankTransferRecipientName: "Flixify Teknoloji",
  bankTransferIban: "TR000000000000000000000000",
  bankTransferBankName: "Ornek Bankasi",
  cryptoEnabled: true,
  cryptoDetails: "Kripto odeme agi ve cuzdan bilgisini buraya girin.",
  cryptoWalletUsdtTrc20: "TM2D3moAddressDemoUsdtTrc20",
  cryptoWalletTron: "TVfAddressDemoTron",
  cryptoWalletSol: "7D2kAddressDemoSolana",
  cryptoWalletBtc: "bc1qaddressdemobtc",
  cryptoWalletUsdc: "0xAddressDemoUsdcEth",
  bankCardEnabled: true,
  bankCardDetails: "Banka karti odeme linkini buraya girin."
};

const demoCatalog = {
  live: [
    {
      id: randomUUID(),
      title: "TR Spor HD",
      groupTitle: "Spor",
      logoUrl: "https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=400&q=80",
      streamUrl: "https://example.com/live/tr-spor.m3u8"
    },
    {
      id: randomUUID(),
      title: "World News 24",
      groupTitle: "Haber",
      logoUrl: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=400&q=80",
      streamUrl: "https://example.com/live/world-news.m3u8"
    },
    {
      id: randomUUID(),
      title: "Cinema Family",
      groupTitle: "Aile",
      logoUrl: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=400&q=80",
      streamUrl: "https://example.com/live/cinema-family.m3u8"
    }
  ] satisfies Array<Omit<LiveChannel, "playbackAllowed">>,
  movies: [
    {
      id: randomUUID(),
      title: "Midnight Route",
      posterUrl: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=400&q=80",
      groupTitle: "Aksiyon",
      streamUrl: "https://example.com/movie/midnight-route.m3u8"
    },
    {
      id: randomUUID(),
      title: "Coastal Heist",
      posterUrl: "https://images.unsplash.com/photo-1513106580091-1d82408b8cd6?auto=format&fit=crop&w=400&q=80",
      groupTitle: "Gerilim",
      streamUrl: "https://example.com/movie/coastal-heist.m3u8"
    }
  ] satisfies Array<Omit<MovieRecord, "playbackAllowed">>,
  series: [
    {
      id: randomUUID(),
      title: "North Line",
      posterUrl: "https://images.unsplash.com/photo-1518998053901-5348d3961a04?auto=format&fit=crop&w=400&q=80",
      groupTitle: "Drama",
      seasonCount: 2,
      episodeCount: 4,
      featuredEpisode: {
        id: randomUUID(),
        title: "Bolum 1",
        seasonNumber: 1,
        episodeNumber: 1,
        streamUrl: "https://example.com/series/north-line-s1e1.m3u8",
        playbackAllowed: true
      },
      seasons: [
        {
          seasonNumber: 1,
          title: "1. Sezon",
          episodeCount: 2,
          episodes: [
            {
              id: randomUUID(),
              title: "Bolum 1",
              seasonNumber: 1,
              episodeNumber: 1,
              streamUrl: "https://example.com/series/north-line-s1e1.m3u8",
              playbackAllowed: true
            },
            {
              id: randomUUID(),
              title: "Bolum 2",
              seasonNumber: 1,
              episodeNumber: 2,
              streamUrl: "https://example.com/series/north-line-s1e2.m3u8",
              playbackAllowed: true
            }
          ]
        },
        {
          seasonNumber: 2,
          title: "2. Sezon",
          episodeCount: 2,
          episodes: [
            {
              id: randomUUID(),
              title: "Bolum 1",
              seasonNumber: 2,
              episodeNumber: 1,
              streamUrl: "https://example.com/series/north-line-s2e1.m3u8",
              playbackAllowed: true
            },
            {
              id: randomUUID(),
              title: "Bolum 2",
              seasonNumber: 2,
              episodeNumber: 2,
              streamUrl: "https://example.com/series/north-line-s2e2.m3u8",
              playbackAllowed: true
            }
          ]
        }
      ]
    }
  ] satisfies SeriesRecord[]
};

const users = new Map<string, DemoUser>();
const sessions = new Map<string, DemoSession>();
const paymentRequests: DemoPaymentRequest[] = [];
const trialRequests: DemoTrialRequest[] = [];
const subscriptions: SubscriptionRecord[] = [];
const sources = new Map<string, DemoSource>();
const m3uJobs: M3USyncJobRecord[] = [];
const auditLogs: AdminAuditLogRecord[] = [];

type DemoAdminUserFilters = {
  search?: string;
  status?: "new" | "active" | "blocked" | "deleted";
  m3u?: "assigned" | "unassigned";
  includeDeleted?: boolean;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function addAuditLog(action: string, entityType: string, entityId: string) {
  auditLogs.unshift({
    id: randomUUID(),
    adminId: "demo-admin",
    action,
    entityType,
    entityId,
    createdAt: now()
  });
}

function mapDemoPaymentMethods(settingsValue: DemoPaymentMethodSettings): PaymentMethodOption[] {
  return [
    {
      id: "bank-transfer-eft",
      label: "Banka Havale / EFT",
      enabled: settingsValue.bankTransferEftEnabled,
      details: settingsValue.bankTransferEftDetails,
      bankTransfer: {
        recipientName: settingsValue.bankTransferRecipientName,
        iban: settingsValue.bankTransferIban,
        bankName: settingsValue.bankTransferBankName
      }
    },
    {
      id: "crypto",
      label: "Kripto",
      enabled: settingsValue.cryptoEnabled,
      details: settingsValue.cryptoDetails,
      cryptoAssets: [
        {
          id: "usdt-trc20",
          label: "Tether",
          symbol: "USDT",
          walletAddress: settingsValue.cryptoWalletUsdtTrc20
        },
        {
          id: "tron",
          label: "Tron",
          symbol: "TRX",
          walletAddress: settingsValue.cryptoWalletTron
        },
        {
          id: "sol",
          label: "Sol",
          symbol: "SOL",
          walletAddress: settingsValue.cryptoWalletSol
        },
        {
          id: "btc",
          label: "BTC",
          symbol: "BTC",
          walletAddress: settingsValue.cryptoWalletBtc
        },
        {
          id: "usdc",
          label: "USDC",
          symbol: "USDC",
          walletAddress: settingsValue.cryptoWalletUsdc
        }
      ]
    },
    {
      id: "bank-card",
      label: "Banka Karti",
      enabled: settingsValue.bankCardEnabled,
      details: settingsValue.bankCardDetails
    }
  ];
}

function collectGroups(
  items: Array<{ title?: string; groupTitle: string | null | undefined }>,
  kind: CatalogGroup["kind"],
  options?: {
    includeCountryBuckets?: boolean;
  }
) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.groupTitle?.trim() || "Diger";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const groups = Array.from(counts.entries())
    .map<CatalogGroup>(([title, count]) => ({ title, count, kind }))
    .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));

  if (!options?.includeCountryBuckets || kind !== "live") {
    return groups;
  }

  const countryCounts = new Map<string, number>();
  for (const item of items) {
    const code = parseCountryCodeFromLiveCatalogEntry(item.title, item.groupTitle);
    if (!code) {
      continue;
    }
    const normalizedCode = code.toUpperCase();
    countryCounts.set(normalizedCode, (countryCounts.get(normalizedCode) ?? 0) + 1);
  }

  const countryGroups = Array.from(countryCounts.entries())
    .map<CatalogGroup>(([title, count]) => ({ title, count, kind: "live" }))
    .sort((left, right) => right.count - left.count || left.title.localeCompare(right.title));

  const countryTitles = new Set(countryGroups.map((group) => group.title.toUpperCase()));
  return [
    ...countryGroups,
    ...groups.filter((group) => !countryTitles.has(group.title.trim().toUpperCase()))
  ];
}

function normalizeGroupFilterValue(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeCountryFilterCode(value: string) {
  const sanitized = value.replace(/[^a-z]/gi, "").toLowerCase();
  if (sanitized.length < 2 || sanitized.length > 3) {
    return null;
  }
  if (sanitized === "tur" || sanitized === "trk") {
    return "tr";
  }
  return sanitized;
}

function parseCountryCodeFromGroupTitle(groupTitle: string | null | undefined) {
  const normalized = normalizeGroupFilterValue(groupTitle);
  const match = normalized.match(/^([a-z]{2,3})\s*[:\-]/);
  if (!match?.[1]) {
    return null;
  }
  return normalizeCountryFilterCode(match[1]);
}

const TURKIYE_STRONG_GROUP_SIGNAL_PATTERN =
  /(^|[^a-z0-9])(tr|turkiye|turkey|turk|turkce)([^a-z0-9]|$)/;
const TURKIYE_MEDIUM_SIGNAL_PATTERN = /(^|[^a-z0-9])(turk|turkce|dublaj|ulusal|turkish)([^a-z0-9]|$)/;
const TURKIYE_UNIQUE_TITLE_SIGNAL_PATTERN =
  /(^|[^a-z0-9])(trt|atv|tv8|cnnturk|cnn\s*turk|haberturk|aspor|a\s*spor|ahaber|a\s*haber|kanal\s*d|kanal\s*7|show\s*tv|star\s*tv|beyaz\s*tv|ulke\s*tv|tgrt|teve2|kanal\s*24|ntv|tv100|halk\s*tv|tele\s*1|haber\s*global)([^a-z0-9]|$)/;
const TURKIYE_CONTEXTUAL_BRAND_SIGNAL_PATTERN =
  /(^|[^a-z0-9])(s\s*sport|spor\s*smart|bein\s*sports?)([^a-z0-9]|$)/;
const TURKIYE_CONTEXT_TOKEN_SET = new Set(["tr", "turk", "turkce", "turkiye", "turkey", "turkish"]);
const FOREIGN_SIGNAL_TOKEN_SET = new Set([
  "us",
  "usa",
  "uk",
  "eng",
  "de",
  "ger",
  "germany",
  "deutsch",
  "fr",
  "fra",
  "france",
  "es",
  "esp",
  "spain",
  "it",
  "ita",
  "italy",
  "pt",
  "por",
  "portugal",
  "br",
  "bra",
  "brazil",
  "latin",
  "latam",
  "arab",
  "pl",
  "pol",
  "poland",
  "ru",
  "rus",
  "russia",
  "exyu",
  "balkan"
]);

function tokenizeNormalized(value: string) {
  return value.split(/[^a-z0-9]+/g).filter(Boolean);
}

function hasTokenMatch(tokens: string[], lookup: Set<string>) {
  return tokens.some((token) => lookup.has(token));
}

function hasTurkiyeUniqueTitleSignal(normalizedTitle: string) {
  if (TURKIYE_UNIQUE_TITLE_SIGNAL_PATTERN.test(normalizedTitle)) {
    return true;
  }

  return (
    /(^|[^a-z0-9])tr([^a-z0-9]|$)/.test(normalizedTitle) &&
    /(^|[^a-z0-9])(spor|haber|kanal|tv|ulusal)([^a-z0-9]|$)/.test(normalizedTitle)
  );
}

function hasTurkiyeCountryHeuristic(title: string | null | undefined, groupTitle: string | null | undefined) {
  const normalizedGroup = normalizeGroupFilterValue(groupTitle);
  const normalizedTitle = normalizeGroupFilterValue(title);
  const groupTokens = tokenizeNormalized(normalizedGroup);
  const titleTokens = tokenizeNormalized(normalizedTitle);
  const hasTrContext = hasTokenMatch(groupTokens, TURKIYE_CONTEXT_TOKEN_SET) || hasTokenMatch(titleTokens, TURKIYE_CONTEXT_TOKEN_SET);
  const hasForeignSignal = hasTokenMatch(groupTokens, FOREIGN_SIGNAL_TOKEN_SET) || hasTokenMatch(titleTokens, FOREIGN_SIGNAL_TOKEN_SET);
  const hasContextualBrandSignal =
    TURKIYE_CONTEXTUAL_BRAND_SIGNAL_PATTERN.test(normalizedGroup) ||
    TURKIYE_CONTEXTUAL_BRAND_SIGNAL_PATTERN.test(normalizedTitle);
  const hasUniqueStrongSignal =
    TURKIYE_STRONG_GROUP_SIGNAL_PATTERN.test(normalizedGroup) ||
    hasTurkiyeUniqueTitleSignal(normalizedTitle);

  if (hasUniqueStrongSignal) {
    return true;
  }

  if (hasContextualBrandSignal && hasTrContext && !hasForeignSignal) {
    return true;
  }

  return (
    !hasForeignSignal &&
    hasTrContext &&
    TURKIYE_MEDIUM_SIGNAL_PATTERN.test(normalizedGroup) &&
    TURKIYE_MEDIUM_SIGNAL_PATTERN.test(normalizedTitle)
  );
}

function parseCountryCodeFromLiveCatalogEntry(
  title: string | null | undefined,
  groupTitle: string | null | undefined
) {
  const prefixedCode = parseCountryCodeFromGroupTitle(groupTitle);
  if (prefixedCode && prefixedCode !== "tr" && hasTurkiyeCountryHeuristic(title, groupTitle)) {
    return "tr";
  }
  if (prefixedCode) {
    return prefixedCode;
  }

  if (hasTurkiyeCountryHeuristic(title, groupTitle)) {
    return "tr";
  }

  return null;
}

function resolveCountryFilterCode(group?: string) {
  const normalized = normalizeGroupFilterValue(group);
  if (!normalized) {
    return null;
  }

  if (normalized === "turkiye") {
    return "tr";
  }

  const prefixes = ["country:", "ulke:"];
  for (const prefix of prefixes) {
    if (!normalized.startsWith(prefix)) {
      continue;
    }
    return normalizeCountryFilterCode(normalized.slice(prefix.length).trim());
  }

  return null;
}

function normalizeCatalogGroupLabel(value: string | null | undefined) {
  return normalizeGroupFilterValue(value ?? "Diger").replace(/\s*:\s*/g, ":");
}

export function matchesCatalogGroupFilter(
  groupTitle: string | null | undefined,
  group?: string,
  title?: string | null
) {
  const normalizedGroup = normalizeGroupFilterValue(group);
  if (!normalizedGroup) {
    return true;
  }

  const groupLabel = normalizeCatalogGroupLabel(groupTitle ?? "Diger");
  const countryFilterCode = resolveCountryFilterCode(group);
  if (countryFilterCode) {
    if (parseCountryCodeFromGroupTitle(groupTitle) === countryFilterCode) {
      return true;
    }
    if (countryFilterCode === "tr") {
      return hasTurkiyeCountryHeuristic(title, groupTitle);
    }
    return false;
  }

  return groupLabel === normalizedGroup;
}

function paginate<T extends { title?: string; groupTitle?: string | null }>(
  items: T[],
  page: number,
  pageSize: number,
  search?: string,
  group?: string
) {
  const normalizedSearch = search?.toLowerCase();
  const filtered = items.filter((item) => {
    const matchesSearch = normalizedSearch
      ? (item.title ?? "").toLowerCase().includes(normalizedSearch)
      : true;
    const matchesGroup = matchesCatalogGroupFilter(item.groupTitle, group, item.title);
    return matchesSearch && matchesGroup;
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total: filtered.length
  };
}

function getPlaybackState(userId: string) {
  const user = users.get(userId);
  return {
    canViewCatalog: Boolean(user?.summary.hasAssignedLink),
    canPlay: Boolean(user?.summary.hasActiveSubscription)
  };
}

function withPlayback<T extends { streamUrl: string | null }>(items: T[], playbackAllowed: boolean) {
  return items.map((item) => ({
    ...item,
    playbackAllowed,
    streamUrl: playbackAllowed ? item.streamUrl : null
  }));
}

function withoutVodStream<T extends { streamUrl: string | null; playbackAllowed: boolean }>(items: T[]) {
  return items.map((item) => ({
    ...item,
    streamUrl: null
  }));
}

function seedDemoUsers() {
  const linkedPackage = packages[1];
  if (!linkedPackage) {
    return;
  }

  const waitingCode = randomCode();
  const waitingUser: DemoUser = {
    summary: makeSummary({
      status: "new",
      hasAssignedLink: false,
      hasActiveSubscription: false,
      kryptoniteCode: waitingCode,
      codeSuffix: waitingCode.slice(-4)
    }),
    kryptoniteCode: waitingCode,
    currentSourceStatus: null,
    currentSourceUrl: null,
    snapshotVersion: 0,
    notes: null,
    deletedAt: null
  };

  const activeCode = randomCode();
  const activeUser: DemoUser = {
    summary: makeSummary({
      status: "active",
      hasAssignedLink: true,
      hasActiveSubscription: true,
      kryptoniteCode: activeCode,
      codeSuffix: activeCode.slice(-4),
      activePackage: {
        id: linkedPackage.id,
        title: linkedPackage.title,
        duration: linkedPackage.duration,
        endsAt: plusDays(84),
        remainingDays: 84
      }
    }),
    kryptoniteCode: activeCode,
    currentSourceStatus: "ready",
    currentSourceUrl: "https://example.com/seed/source.m3u",
    snapshotVersion: 3,
    notes: "Telegram /setm3u komutu ile guncellendi",
    deletedAt: null
  };

  users.set(waitingUser.summary.id, waitingUser);
  users.set(activeUser.summary.id, activeUser);

  const sourceId = randomUUID();
  sources.set(activeUser.summary.id, {
    id: sourceId,
    userId: activeUser.summary.id,
    sourceUrl: activeUser.currentSourceUrl ?? "https://example.com/seed/source.m3u",
    status: "ready",
    currentSnapshotVersion: activeUser.snapshotVersion,
    lastSuccessfulSyncAt: now(),
    lastError: null
  });

  subscriptions.unshift({
    id: randomUUID(),
    userId: activeUser.summary.id,
    status: "active",
    startsAt: now(),
    endsAt: plusDays(84),
    packageTitle: linkedPackage.title
  });
}

seedDemoUsers();

async function createSession(
  userId: string,
  input?: { deviceName?: string; platform?: string }
) {
  const sessionId = randomUUID();
  const refreshSecret = randomBytes(24).toString("hex");
  const createdAt = now();
  sessions.set(sessionId, {
    sessionId,
    userId,
    refreshSecret,
    deviceName: input?.deviceName ?? null,
    platform: input?.platform ?? null,
    revokedAt: null,
    expiresAt: plusDays(30),
    createdAt,
    lastSeenAt: createdAt
  });

  const accessToken = await signAccessToken({ userId, sessionId });
  return {
    accessToken,
    refreshToken: `${sessionId}.${refreshSecret}`
  };
}

function getDemoUser(userId: string) {
  return users.get(userId) ?? null;
}

function listDemoDeviceSessionsInternal(userId: string, currentSessionId: string | null = null) {
  return Array.from(sessions.values())
    .filter((item) => item.userId === userId)
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .map<DeviceSessionRecord>((item) => ({
      id: item.sessionId,
      deviceName: item.deviceName,
      platform: item.platform,
      expiresAt: item.expiresAt,
      lastSeenAt: item.lastSeenAt,
      revokedAt: item.revokedAt,
      createdAt: item.createdAt,
      isCurrent: currentSessionId === item.sessionId
    }));
}

export async function registerDemoUser(input: { deviceName?: string; platform?: string }) {
  const code = randomCode();
  const userId = randomUUID();
  const user: DemoUser = {
    summary: makeSummary({
      id: userId,
      status: "new",
      hasAssignedLink: false,
      hasActiveSubscription: false,
      kryptoniteCode: code,
      codeSuffix: code.slice(-4)
    }),
    kryptoniteCode: code,
    currentSourceStatus: input.platform ? `waiting-${input.platform}` : "pending",
    currentSourceUrl: null,
    snapshotVersion: 0,
    notes: null,
    deletedAt: null
  };
  users.set(userId, user);

  const session = await createSession(userId, input);
  return {
    ...session,
    user: clone(user.summary),
    kryptoniteCode: code
  };
}

export async function loginDemoUser(code: string, input?: { deviceName?: string; platform?: string }) {
  const user = Array.from(users.values()).find((item) => item.kryptoniteCode === code);
  if (!user || user.summary.status === "blocked" || user.deletedAt) {
    return null;
  }

  user.summary.lastLoginAt = now();
  const session = await createSession(user.summary.id, input);
  return {
    ...session,
    user: clone(user.summary),
    kryptoniteCode: user.kryptoniteCode
  };
}

export async function refreshDemoSession(refreshToken: string) {
  const [sessionId, rawSecret] = refreshToken.split(".");
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session || session.revokedAt || session.refreshSecret !== rawSecret) {
    return null;
  }

  const user = users.get(session.userId);
  if (!user || user.summary.status === "blocked" || user.deletedAt) {
    return null;
  }

  session.revokedAt = now();
  const nextSession = await createSession(session.userId, {
    deviceName: session.deviceName ?? undefined,
    platform: session.platform ?? undefined
  });
  return {
    ...nextSession,
    user: clone(user.summary),
    kryptoniteCode: user.kryptoniteCode
  };
}

export function getDemoSession(sessionId: string, userId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.revokedAt || session.userId !== userId) {
    return null;
  }

  session.lastSeenAt = now();
  return session;
}

export function getDemoMe(userId: string): MeResponse | null {
  const user = getDemoUser(userId);
  if (!user || user.deletedAt) {
    return null;
  }

  return {
    user: clone(user.summary),
    contact: {
      whatsapp: settings.supportWhatsappUrl,
      telegram: settings.supportTelegramUrl
    }
  };
}

export function listDemoPackages() {
  return packages.map((item) => ({ ...item }));
}

export function updateDemoPackageStatus(
  packageId: string,
  input: { isActive?: boolean; priceLabel?: string | null }
) {
  const item = packages.find((entry) => entry.id === packageId);
  if (!item) {
    throw new Error("Paket bulunamadi");
  }
  if (input.isActive !== undefined) {
    item.isActive = input.isActive;
  }
  if (input.priceLabel !== undefined) {
    item.priceLabel = input.priceLabel;
  }
  addAuditLog("update-package-status", "package", packageId);
}

export function listDemoLiveCatalog(
  userId: string,
  page: number,
  pageSize: number,
  search?: string,
  group?: string
) {
  const state = getPlaybackState(userId);
  return {
    ...paginate(withPlayback(demoCatalog.live, state.canPlay), page, pageSize, search, group),
    groups: collectGroups(demoCatalog.live, "live", { includeCountryBuckets: true })
  };
}

export function listDemoMovieCatalog(
  userId: string,
  page: number,
  pageSize: number,
  search?: string,
  group?: string
) {
  const state = getPlaybackState(userId);
  return {
    ...paginate(withoutVodStream(withPlayback(demoCatalog.movies, state.canPlay)), page, pageSize, search, group),
    groups: collectGroups(demoCatalog.movies, "movie")
  };
}

export function listDemoSeriesCatalog(
  userId: string,
  page: number,
  pageSize: number,
  search?: string,
  group?: string
) {
  const state = getPlaybackState(userId);
  return {
    ...paginate(
      demoCatalog.series.map((item) => ({
        ...item,
        featuredEpisode: item.featuredEpisode
          ? {
              ...item.featuredEpisode,
              playbackAllowed: state.canPlay,
              streamUrl: null
            }
          : null,
        seasons: item.seasons.map((season) => ({
          ...season,
          episodes: withoutVodStream(withPlayback(season.episodes, state.canPlay))
        }))
      })),
      page,
      pageSize,
      search,
      group
    ),
    groups: collectGroups(demoCatalog.series, "series")
  };
}

export function resolveDemoVodPlayback(
  userId: string,
  kind: VodPlaybackKind,
  itemId: string,
  _baseOrigin: string
): VodPlaybackRecord {
  const state = getPlaybackState(userId);
  if (!state.canPlay) {
    return {
      itemId,
      kind,
      url: null,
      transport: "hls",
      deliveryMode: "hls_proxy",
      audioTracks: [],
      defaultAudioTrackId: null,
      selectedAudioTrackId: null,
      expiresAt: null,
      canPlay: false,
      isVerified: false,
      errorMessage: "Bu icerigi oynatmak icin aktif paket gerekir."
    };
  }

  if (kind === "movie") {
    const movie = demoCatalog.movies.find((item) => item.id === itemId);
    return {
      itemId,
      kind,
      url: movie?.streamUrl ?? null,
      transport: "hls",
      deliveryMode: "hls_proxy",
      audioTracks: [],
      defaultAudioTrackId: null,
      selectedAudioTrackId: null,
      expiresAt: movie ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
      canPlay: Boolean(movie),
      isVerified: Boolean(movie),
      errorMessage: movie ? null : "Film bulunamadi."
    };
  }

  const episode = demoCatalog.series
    .flatMap((series) => series.seasons.flatMap((season) => season.episodes))
    .find((item) => item.id === itemId);

  return {
    itemId,
    kind,
    url: episode?.streamUrl ?? null,
    transport: "hls",
    deliveryMode: "hls_proxy",
    audioTracks: [],
    defaultAudioTrackId: null,
    selectedAudioTrackId: null,
    expiresAt: episode ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
    canPlay: Boolean(episode),
    isVerified: Boolean(episode),
    errorMessage: episode ? null : "Bolum bulunamadi."
  };
}

export function createDemoPaymentRequest(userId: string, packageSlug: string) {
  const pack = packages.find((item) => item.slug === packageSlug && item.isActive);
  if (!pack) {
    throw new Error("Paket bulunamadi");
  }

  paymentRequests.unshift({
    id: randomUUID(),
    status: "pending-review",
    packageTitle: pack.title,
    createdAt: now(),
    userId
  });
}

export function listDemoMyPaymentRequests(userId: string) {
  return paymentRequests.filter((item) => item.userId === userId);
}

export function createDemoTrialRequest(userId: string, note?: string) {
  trialRequests.unshift({
    id: randomUUID(),
    status: "pending",
    createdAt: now(),
    userId,
    note: note ?? null
  });
}

export function listDemoAdminUsers(
  page: number,
  pageSize: number,
  filters: DemoAdminUserFilters = {}
) {
  const searchValue = filters.search?.toLowerCase().trim();
  const items = Array.from(users.values())
    .filter((item) => {
      if (filters.status === "deleted") {
        return Boolean(item.deletedAt);
      }

      if (!filters.includeDeleted && !filters.status && item.deletedAt) {
        return false;
      }

      if (filters.status && filters.status !== "deleted" && item.summary.status !== filters.status) {
        return false;
      }

      if (filters.m3u === "assigned" && !item.summary.hasAssignedLink) {
        return false;
      }

      if (filters.m3u === "unassigned" && item.summary.hasAssignedLink) {
        return false;
      }

      if (!searchValue) {
        return true;
      }

      return [item.summary.id, item.notes ?? "", item.summary.kryptoniteCode ?? "", item.summary.codeSuffix ?? ""]
        .some((value) => value.toLowerCase().includes(searchValue));
    })
    .map((item) => ({
      ...clone(item.summary),
      notes: item.notes,
      deletedAt: item.deletedAt,
      subscriptionEndsAt: item.summary.activePackage?.endsAt ?? null,
      remainingDays: item.summary.activePackage?.remainingDays ?? null,
      packageStatus: item.summary.activePackage ? "active" : "none",
      m3uAssigned: item.summary.hasAssignedLink,
      currentSourceStatus: item.currentSourceStatus
    }));

  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total: items.length
  };
}

export function listDemoDeviceSessions(userId: string, currentSessionId: string | null = null) {
  return listDemoDeviceSessionsInternal(userId, currentSessionId);
}

export function revokeDemoDeviceSession(userId: string, sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    throw new Error("Session bulunamadi");
  }
  session.revokedAt = now();
}

export function getDemoAdminDashboard() {
  const userValues = Array.from(users.values()).filter((item) => !item.deletedAt);
  return {
    usersTotal: userValues.length,
    usersBlocked: userValues.filter((item) => item.summary.status === "blocked").length,
    usersWaitingForLink: userValues.filter((item) => !item.summary.hasAssignedLink).length,
    activeSubscriptions: userValues.filter((item) => item.summary.hasActiveSubscription).length,
    pendingPaymentRequests: paymentRequests.filter((item) => item.status === "pending-review").length,
    pendingTrialRequests: trialRequests.filter((item) => item.status === "pending").length,
    queuedM3UJobs: m3uJobs.filter((item) => item.status === "queued").length,
    failedM3UJobs: m3uJobs.filter((item) => item.status === "failed").length
  };
}

export function getDemoAdminUserDetail(userId: string) {
  const user = getDemoUser(userId);
  if (!user) {
    return null;
  }

  return {
    summary: {
      ...clone(user.summary),
      notes: user.notes,
      deletedAt: user.deletedAt,
      subscriptionEndsAt: user.summary.activePackage?.endsAt ?? null,
      remainingDays: user.summary.activePackage?.remainingDays ?? null,
      packageStatus: user.summary.activePackage ? "active" : "none",
      m3uAssigned: user.summary.hasAssignedLink,
      currentSourceStatus: user.currentSourceStatus
    },
    currentSourceStatus: user.currentSourceStatus,
    currentSourceUrl: user.currentSourceUrl,
    snapshotVersion: user.snapshotVersion,
    deviceSessions: listDemoDeviceSessionsInternal(userId),
    paymentRequests: paymentRequests.filter((item) => item.userId === userId),
    trialRequests: trialRequests.filter((item) => item.userId === userId),
    subscriptions: subscriptions.filter((item) => item.userId === userId),
    auditLogs: auditLogs.filter((item) => item.entityId === userId)
  };
}

export function updateDemoUserStatus(userId: string, status: UserSummary["status"]) {
  const user = getDemoUser(userId);
  if (!user) {
    throw new Error("Kullanici bulunamadi");
  }

  user.summary.status = status;
  if (status === "blocked") {
    user.summary.hasActiveSubscription = false;
    user.summary.popup = null;
    for (const session of sessions.values()) {
      if (session.userId === userId) {
        session.revokedAt = now();
      }
    }
  }
  addAuditLog("update-user-status", "user", userId);
}

export function updateDemoUser(
  userId: string,
  input: {
    status?: UserSummary["status"];
    notes?: string | null;
  }
) {
  const user = getDemoUser(userId);
  if (!user) {
    throw new Error("Kullanici bulunamadi");
  }

  if (input.status) {
    user.summary.status = input.status;
  }

  if (input.notes !== undefined) {
    user.notes = input.notes;
  }

  if (user.summary.status === "blocked") {
    user.summary.hasActiveSubscription = false;
    user.summary.popup = null;
    for (const session of sessions.values()) {
      if (session.userId === userId) {
        session.revokedAt = now();
      }
    }
  }

  addAuditLog("update-user", "user", userId);
}

export function softDeleteDemoUser(userId: string) {
  const user = getDemoUser(userId);
  if (!user || user.deletedAt) {
    throw new Error("Kullanici bulunamadi");
  }

  user.summary.status = "blocked";
  user.summary.hasActiveSubscription = false;
  user.summary.popup = null;
  user.deletedAt = now();
  for (const session of sessions.values()) {
    if (session.userId === userId) {
      session.revokedAt = now();
    }
  }

  addAuditLog("soft-delete-user", "user", userId);
}

export function assignDemoM3USource(userId: string, sourceUrl: string) {
  const user = getDemoUser(userId);
  if (!user || user.deletedAt) {
    throw new Error("Kullanici bulunamadi");
  }

  user.summary.hasAssignedLink = true;
  user.summary.status = "active";
  user.summary.popup = null;
  user.currentSourceStatus = sourceUrl.startsWith("http") ? "ready" : "pending";
  user.currentSourceUrl = sourceUrl;
  user.snapshotVersion += 1;

  const sourceId = sources.get(userId)?.id ?? randomUUID();
  sources.set(userId, {
    id: sourceId,
    userId,
    sourceUrl,
    status: "ready",
    currentSnapshotVersion: user.snapshotVersion,
    lastSuccessfulSyncAt: now(),
    lastError: null
  });

  m3uJobs.unshift({
    id: randomUUID(),
    userId,
    userM3USourceId: sourceId,
    requestedByAdminId: "demo-admin",
    status: "succeeded",
    snapshotVersion: user.snapshotVersion,
    attemptCount: 1,
    errorMessage: null,
    startedAt: now(),
    completedAt: now(),
    createdAt: now()
  });

  addAuditLog("assign-m3u", "user", userId);
}

export function activateDemoSubscription(userId: string, packageSlug: string) {
  const user = getDemoUser(userId);
  const pack = packages.find((item) => item.slug === packageSlug);
  if (!user || !pack || user.deletedAt) {
    throw new Error("Aktivasyon yapilamadi");
  }

  const durationMap = {
    "1-ay": 30,
    "3-ay": 90,
    "6-ay": 180,
    "12-ay": 365
  } as const;
  const remainingDays = durationMap[packageSlug as keyof typeof durationMap] ?? 30;

  user.summary.hasActiveSubscription = true;
  user.summary.activePackage = {
    id: pack.id,
    title: pack.title,
    duration: pack.duration,
    endsAt: plusDays(remainingDays),
    remainingDays
  };
  user.summary.popup = null;
  user.summary.status = "active";

  subscriptions.unshift({
    id: randomUUID(),
    userId,
    status: "active",
    startsAt: now(),
    endsAt: plusDays(remainingDays),
    packageTitle: pack.title
  });

  addAuditLog("activate-subscription", "user", userId);
}

export function activateDemoTestSubscription24Hours(userId: string) {
  const user = getDemoUser(userId);
  const pack = packages.find((item) => item.slug === "1-ay") ?? packages[0];
  if (!user || !pack || user.deletedAt) {
    throw new Error("24 saat test aktivasyonu yapilamadi");
  }

  const startsAt = now();
  const endsAt = plusHours(24);

  user.summary.hasActiveSubscription = true;
  user.summary.activePackage = {
    id: pack.id,
    title: "24 Saat Test",
    duration: pack.duration,
    endsAt,
    remainingDays: 1
  };
  user.summary.popup = null;
  user.summary.status = "active";

  subscriptions.unshift({
    id: randomUUID(),
    userId,
    status: "active",
    startsAt,
    endsAt,
    packageTitle: "24 Saat Test"
  });

  addAuditLog("activate-test-subscription-24h", "user", userId);
}

export function listDemoPaymentRequests() {
  return clone(paymentRequests);
}

export function listDemoTrialRequests() {
  return clone(trialRequests);
}

export function listDemoM3USources() {
  return Array.from(sources.values()).map((item) => ({
    id: item.id,
    user_id: item.userId,
    source_url: item.sourceUrl,
    status: item.status,
    current_snapshot_version: item.currentSnapshotVersion,
    last_successful_sync_at: item.lastSuccessfulSyncAt,
    last_error: item.lastError
  }));
}

export function listDemoSubscriptions() {
  return clone(subscriptions);
}

export function listDemoM3USyncJobs() {
  return clone(m3uJobs);
}

export function resyncDemoM3USource(sourceId: string) {
  const source = Array.from(sources.values()).find((item) => item.id === sourceId);
  if (!source) {
    throw new Error("M3U source bulunamadi");
  }

  const job: M3USyncJobRecord = {
    id: randomUUID(),
    userId: source.userId,
    userM3USourceId: source.id,
    requestedByAdminId: "demo-admin",
    status: "queued",
    snapshotVersion: source.currentSnapshotVersion,
    attemptCount: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: now()
  };
  m3uJobs.unshift(job);
  addAuditLog("resync-m3u", "m3u_source", sourceId);
}

export function getDemoSettings() {
  return { ...settings };
}

export function updateDemoSettings(input: typeof settings) {
  settings.supportWhatsappUrl = input.supportWhatsappUrl;
  settings.supportTelegramUrl = input.supportTelegramUrl;
  settings.salesPortalUrl = input.salesPortalUrl;
  settings.heroTitle = input.heroTitle;
  settings.heroSubtitle = input.heroSubtitle;
  addAuditLog("update-settings", "app_settings", "true");
}

export function listDemoPublicPaymentMethods() {
  return mapDemoPaymentMethods(paymentMethodSettings);
}

export function getDemoPaymentMethodSettings() {
  return clone(paymentMethodSettings);
}

export function updateDemoPaymentMethodSettings(input: DemoPaymentMethodSettings) {
  paymentMethodSettings.bankTransferEftEnabled = input.bankTransferEftEnabled;
  paymentMethodSettings.bankTransferEftDetails = input.bankTransferEftDetails;
  paymentMethodSettings.bankTransferRecipientName = input.bankTransferRecipientName;
  paymentMethodSettings.bankTransferIban = input.bankTransferIban;
  paymentMethodSettings.bankTransferBankName = input.bankTransferBankName;
  paymentMethodSettings.cryptoEnabled = input.cryptoEnabled;
  paymentMethodSettings.cryptoDetails = input.cryptoDetails;
  paymentMethodSettings.cryptoWalletUsdtTrc20 = input.cryptoWalletUsdtTrc20;
  paymentMethodSettings.cryptoWalletTron = input.cryptoWalletTron;
  paymentMethodSettings.cryptoWalletSol = input.cryptoWalletSol;
  paymentMethodSettings.cryptoWalletBtc = input.cryptoWalletBtc;
  paymentMethodSettings.cryptoWalletUsdc = input.cryptoWalletUsdc;
  paymentMethodSettings.bankCardEnabled = input.bankCardEnabled;
  paymentMethodSettings.bankCardDetails = input.bankCardDetails;
  addAuditLog("update-payment-method-settings", "app_settings", "true");
}
