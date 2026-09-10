#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import TelegramBot from "node-telegram-bot-api";

const DEFAULT_FLIXIFY_API_BASE_URL = "http://localhost:4000";
const DEFAULT_PENDING_PAGE_SIZE = 6;
const DEFAULT_NOTIFY_PAGE_SIZE = 50;
const DEFAULT_NEW_USER_POLL_SECONDS = 20;
const DEFAULT_STATE_MAX_USERS = 5000;
const DEFAULT_HEARTBEAT_STALE_SECONDS = 90;
const CALLBACK_MAX_LENGTH = 64;

const DEFAULT_PACKAGE_MAP = [
  { key: "test24", label: "24s Test", resellerPackageId: 7, resellerTrial: 1, flixifyMode: "test-24h" },
  { key: "1ay", label: "1 Ay", resellerPackageId: 8, resellerTrial: 0, flixifyPackageSlug: "1-ay" },
  { key: "3ay", label: "3 Ay", resellerPackageId: 9, resellerTrial: 0, flixifyPackageSlug: "3-ay" },
  { key: "6ay", label: "6 Ay", resellerPackageId: 10, resellerTrial: 0, flixifyPackageSlug: "6-ay" },
  { key: "12ay", label: "12 Ay", resellerPackageId: 11, resellerTrial: 0, flixifyPackageSlug: "12-ay" }
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATE_FILE = path.resolve(__dirname, "..", "data", "telegram-panel-bot-state.json");
const DEFAULT_HEARTBEAT_FILE = path.resolve(__dirname, "..", "data", "telegram-panel-bot-heartbeat.json");

const config = loadConfig();
const bot = new TelegramBot(config.telegramBotToken, { polling: true });
let cachedAdminSession = config.flixifyAdminAccessToken
  ? {
      accessToken: config.flixifyAdminAccessToken,
      expiresAt: Number.POSITIVE_INFINITY
    }
  : null;
let notifierState = createDefaultNotifierState();
let notifierTimer = null;
let notifierTickInFlight = false;
let heartbeatTimer = null;
let pollingRecoveryInFlight = false;
let botIdentity = null;

function normalizeBaseUrl(value, fallback = null) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeFilePath(value, fallback) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }

  const trimmed = value.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function parseBoolean(value, fallback = false) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseNonNegativeInt(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function fail(message) {
  console.error(`telegram-panel-bot: ${message}`);
  process.exit(1);
}

function parsePackageMap(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return DEFAULT_PACKAGE_MAP;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    fail(`TELEGRAM_PANEL_PACKAGE_MAP is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail("TELEGRAM_PANEL_PACKAGE_MAP must be a non-empty JSON array.");
  }

  const keys = new Set();
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") {
      fail(`Package map item #${index + 1} must be an object.`);
    }

    const key = String(item.key ?? "").trim();
    const label = String(item.label ?? "").trim();
    const resellerPackageId = parsePositiveInt(item.resellerPackageId, 0);
    const resellerTrial = Number(item.resellerTrial ?? 0) === 1 ? 1 : 0;
    const flixifyPackageSlug =
      typeof item.flixifyPackageSlug === "string" && item.flixifyPackageSlug.trim().length > 0
        ? item.flixifyPackageSlug.trim()
        : null;
    const flixifyMode =
      typeof item.flixifyMode === "string" && item.flixifyMode.trim().length > 0
        ? item.flixifyMode.trim()
        : null;

    if (!/^[a-z0-9_-]{2,24}$/i.test(key)) {
      fail(`Package map item #${index + 1} has an invalid key.`);
    }
    if (keys.has(key)) {
      fail(`Package map item key "${key}" is duplicated.`);
    }
    if (!label) {
      fail(`Package map item "${key}" is missing label.`);
    }
    if (!resellerPackageId) {
      fail(`Package map item "${key}" has an invalid resellerPackageId.`);
    }
    if (!["test-24h", null].includes(flixifyMode) && !flixifyPackageSlug) {
      fail(`Package map item "${key}" must provide flixifyPackageSlug or flixifyMode.`);
    }
    if (flixifyMode && flixifyMode !== "test-24h") {
      fail(`Package map item "${key}" uses unsupported flixifyMode "${flixifyMode}".`);
    }
    if (!flixifyMode && !flixifyPackageSlug) {
      fail(`Package map item "${key}" must include flixifyPackageSlug.`);
    }

    keys.add(key);

    return {
      key,
      label,
      resellerPackageId,
      resellerTrial,
      flixifyPackageSlug,
      flixifyMode
    };
  });
}

function signNativeAdminJwt(secret, email = "admin@flixify.vip") {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: "telegram-bot-admin",
      email: email.toLowerCase(),
      role: "admin",
      typ: "access",
      iat: now,
      exp: now + 30 * 86400
    })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function loadConfig() {
  const telegramBotToken =
    process.env.TELEGRAM_BOT_TOKEN?.trim() || "8841617501:AAHFk3-ab89KqL1xZKXAWGuu0Lokrgc0x4Q";
  const rawAdminId = process.env.TELEGRAM_ADMIN_ID?.trim() || "";
  const telegramAdminIds = new Set(
    rawAdminId
      .split(/[,\s]+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
  );
  const flixifyApiBaseUrl = normalizeBaseUrl(
    process.env.FLIXIFY_API_BASE_URL,
    "https://api.flixify.vip"
  );
  const appJwtSecret =
    process.env.APP_JWT_SECRET?.trim() ||
    "super-secret-jwt-token-key-for-flixify-production-64chars-long-secure-token";
  const adminEmail = process.env.ADMIN_EMAILS?.split(",")[0]?.trim() || "admin@flixify.vip";

  let flixifyAdminAccessToken = process.env.FLIXIFY_ADMIN_ACCESS_TOKEN?.trim() || null;
  if (!flixifyAdminAccessToken && appJwtSecret) {
    flixifyAdminAccessToken = signNativeAdminJwt(appJwtSecret, adminEmail);
  }

  const flixifyAdminEmail = process.env.FLIXIFY_TELEGRAM_ADMIN_EMAIL?.trim() || null;
  const flixifyAdminPassword = process.env.FLIXIFY_TELEGRAM_ADMIN_PASSWORD?.trim() || null;
  const supabaseUrl = normalizeBaseUrl(process.env.SUPABASE_URL);
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() || null;
  const resellerApiBaseUrl = normalizeBaseUrl(
    process.env.RESELLER_API_BASE_URL,
    "http://sifiriptvdns.com:80/ResellerAPI/reseller/index.php"
  );
  const resellerApiKey =
    process.env.RESELLER_API_KEY?.trim() || "01fb82a2badb7fdf1e44afa0ffaba433";
  const pendingPageSize = parsePositiveInt(process.env.TELEGRAM_PENDING_PAGE_SIZE, DEFAULT_PENDING_PAGE_SIZE);
  const notifyPageSize = parsePositiveInt(process.env.TELEGRAM_NOTIFY_PAGE_SIZE, DEFAULT_NOTIFY_PAGE_SIZE);
  const allowReassign = parseBoolean(process.env.TELEGRAM_ALLOW_REASSIGN, false);
  const newUserPollSeconds = parsePositiveInt(
    process.env.TELEGRAM_NEW_USER_POLL_SECONDS,
    DEFAULT_NEW_USER_POLL_SECONDS
  );
  const stateFilePath = normalizeFilePath(process.env.TELEGRAM_PANEL_STATE_FILE, DEFAULT_STATE_FILE);
  const heartbeatFilePath = normalizeFilePath(process.env.TELEGRAM_PANEL_HEARTBEAT_FILE, DEFAULT_HEARTBEAT_FILE);
  const heartbeatStaleSeconds = parsePositiveInt(
    process.env.TELEGRAM_PANEL_HEARTBEAT_STALE_SECONDS,
    DEFAULT_HEARTBEAT_STALE_SECONDS
  );
  const packageMap = parsePackageMap(process.env.TELEGRAM_PANEL_PACKAGE_MAP);

  if (!telegramBotToken) {
    fail("TELEGRAM_BOT_TOKEN is required.");
  }

  return {
    telegramBotToken,
    telegramAdminIds,
    flixifyApiBaseUrl,
    flixifyAdminAccessToken,
    flixifyAdminEmail,
    flixifyAdminPassword,
    supabaseUrl,
    supabaseAnonKey,
    resellerApiBaseUrl,
    resellerApiKey,
    pendingPageSize,
    notifyPageSize,
    allowReassign,
    newUserPollSeconds,
    stateFilePath,
    heartbeatFilePath,
    heartbeatStaleSeconds,
    packageMap,
    packageMapByKey: new Map(packageMap.map((item) => [item.key, item]))
  };
}

function isAuthorizedUser(userId) {
  if (!userId) {
    return false;
  }
  return config.telegramAdminIds.has(String(userId).trim());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul"
  }).format(date);
}

function formatUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "-";
  }
  return formatDate(new Date(seconds * 1000).toISOString());
}

function normalizeErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error ?? "Unknown error");
}

function formatUserStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  const labels = {
    new: "Yeni Kayit",
    active: "Aktif",
    suspended: "Askida",
    expired: "Suresi Bitti"
  };
  return labels[normalized] ?? (normalized ? normalized : "-");
}

function getUserSnapshot(detail) {
  const summary = detail?.summary ?? {};
  const activePackage = summary.activePackage ?? null;
  const remainingDays = Number(activePackage?.remainingDays);

  return {
    id: String(summary.id ?? "-"),
    code: String(summary.kryptoniteCode ?? summary.codeSuffix ?? "----").trim() || "----",
    createdAt: summary.createdAt ?? null,
    status: String(summary.status ?? ""),
    hasAssignedLink: Boolean(summary.hasAssignedLink),
    iptvUsername: String(detail?.iptvUsername ?? "-") || "-",
    iptvPassword: String(detail?.iptvPassword ?? "-") || "-",
    activePackageTitle: String(activePackage?.title ?? "-") || "-",
    remainingLabel: activePackage && Number.isFinite(remainingDays) ? `${remainingDays} gun` : "-",
    currentSourceUrl: String(detail?.currentSourceUrl ?? "").trim() || null
  };
}

function formatCryptoAssetLabel(assetId) {
  const normalized = String(assetId ?? "").trim().toLowerCase();
  const labels = {
    "usdt-trc20": "USDT (TRC20)",
    tron: "TRX",
    sol: "SOL",
    btc: "BTC",
    usdc: "USDC"
  };
  return labels[normalized] ?? (normalized || "-");
}

function formatPaymentMethodLabel(paymentMethodId, cryptoAssetId = null) {
  const normalized = String(paymentMethodId ?? "").trim().toLowerCase();
  if (normalized === "bank-transfer-eft") {
    return "Banka Havale / EFT";
  }
  if (normalized === "crypto") {
    return cryptoAssetId ? `Kripto / ${formatCryptoAssetLabel(cryptoAssetId)}` : "Kripto";
  }
  if (normalized === "bank-card") {
    return "Banka Karti";
  }
  return normalized || "-";
}

function buildCallbackData(...parts) {
  const data = parts.join(":");
  if (data.length > CALLBACK_MAX_LENGTH) {
    throw new Error(`Callback data is too long: ${data}`);
  }
  return data;
}

function createDefaultNotifierState() {
  return {
    version: 1,
    bootstrapped: false,
    adminIds: [],
    knownPendingUserIds: [],
    knownPendingPaymentRequestIds: [],
    lastSyncAt: null
  };
}

function dedupeIds(values) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0)
    )
  ).slice(-DEFAULT_STATE_MAX_USERS);
}

function sanitizeNotifierState(value) {
  if (!value || typeof value !== "object") {
    return createDefaultNotifierState();
  }

  return {
    version: 1,
    bootstrapped: Boolean(value.bootstrapped),
    adminIds: dedupeIds(Array.isArray(value.adminIds) ? value.adminIds : []),
    knownPendingUserIds: dedupeIds(Array.isArray(value.knownPendingUserIds) ? value.knownPendingUserIds : []),
    knownPendingPaymentRequestIds: dedupeIds(
      Array.isArray(value.knownPendingPaymentRequestIds) ? value.knownPendingPaymentRequestIds : []
    ),
    lastSyncAt: typeof value.lastSyncAt === "string" ? value.lastSyncAt : null
  };
}

async function loadNotifierState() {
  try {
    const raw = await fs.readFile(config.stateFilePath, "utf8");
    return sanitizeNotifierState(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return createDefaultNotifierState();
    }
    throw error;
  }
}

async function saveNotifierState() {
  await fs.mkdir(path.dirname(config.stateFilePath), { recursive: true });
  await fs.writeFile(config.stateFilePath, `${JSON.stringify(notifierState, null, 2)}\n`, "utf8");
}

async function writeHeartbeat(fields = {}) {
  const payload = {
    pid: process.pid,
    botUsername: botIdentity?.username ?? null,
    adminIds: Array.from(config.telegramAdminIds),
    isPolling: typeof bot.isPolling === "function" ? bot.isPolling() : null,
    bootstrapped: Boolean(notifierState.bootstrapped),
    lastSyncAt: notifierState.lastSyncAt ?? null,
    lastHeartbeatAt: new Date().toISOString(),
    ...fields
  };

  try {
    await fs.mkdir(path.dirname(config.heartbeatFilePath), { recursive: true });
    await fs.writeFile(config.heartbeatFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("telegram-panel-bot heartbeat write failed:", normalizeErrorMessage(error));
  }
}

async function recoverPolling(reason) {
  if (pollingRecoveryInFlight) {
    return;
  }

  pollingRecoveryInFlight = true;
  console.error(`telegram-panel-bot polling recovery: ${reason}`);
  await writeHeartbeat({
    status: "recovering",
    recoveryReason: reason,
    recoveryAt: new Date().toISOString()
  });

  try {
    await bot.stopPolling({ cancel: true, reason });
  } catch (error) {
    console.error("telegram-panel-bot stopPolling during recovery failed:", normalizeErrorMessage(error));
  }

  try {
    await bot.startPolling({ restart: true });
    await writeHeartbeat({
      status: "running",
      recoveryReason: reason,
      recoveredAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("telegram-panel-bot startPolling during recovery failed:", normalizeErrorMessage(error));
    await writeHeartbeat({
      status: "recovery-failed",
      recoveryReason: reason,
      recoveryError: normalizeErrorMessage(error)
    });
  } finally {
    pollingRecoveryInFlight = false;
  }
}

async function ensureHealthyPolling() {
  if (pollingRecoveryInFlight) {
    return;
  }

  const isPolling = typeof bot.isPolling === "function" ? bot.isPolling() : true;
  const lastSyncTime = notifierState.lastSyncAt ? new Date(notifierState.lastSyncAt).getTime() : 0;
  const heartbeatAgeSeconds = lastSyncTime > 0 ? (Date.now() - lastSyncTime) / 1000 : Number.POSITIVE_INFINITY;

  if (!isPolling) {
    await recoverPolling("polling-inactive");
    return;
  }

  if (heartbeatAgeSeconds > config.heartbeatStaleSeconds) {
    await recoverPolling(`stale-heartbeat-${Math.round(heartbeatAgeSeconds)}s`);
    return;
  }

  await writeHeartbeat({ status: "running" });
}

async function upsertMessage(chatId, text, options = {}, messageId = null) {
  if (messageId) {
    try {
      return await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...options
      });
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (message.includes("message is not modified")) {
        return null;
      }
    }
  }

  return bot.sendMessage(chatId, text, options);
}

async function authorizeMessage(message) {
  const userId = message.from?.id;
  if (!isAuthorizedUser(userId)) {
    const userIdStr = String(userId ?? "");
    await bot.sendMessage(
      message.chat.id,
      `⛔ <b>Yetkisiz erisim.</b>\nTelegram ID'niz: <code>${userIdStr}</code>\nYetki almak icin sistem yoneticisine bu ID'yi iletiniz.`,
      { parse_mode: "HTML" }
    );
    return false;
  }
  return true;
}

async function answerUnauthorizedCallback(query) {
  await bot.answerCallbackQuery(query.id, {
    text: "Yetkisiz erisim.",
    show_alert: true
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20_000)
  });
  const rawBody = await response.text();
  let parsed = null;

  if (rawBody.trim().length > 0) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    if (parsed && typeof parsed === "object" && typeof parsed.message === "string") {
      message = parsed.message;
    } else if (typeof parsed === "string" && parsed.trim().length > 0) {
      message = parsed.trim();
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return parsed;
}

async function createSupabaseAdminSession() {
  const payload = await fetchJson(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${config.supabaseAnonKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: config.flixifyAdminEmail,
      password: config.flixifyAdminPassword
    })
  });

  if (!payload || typeof payload.access_token !== "string") {
    throw new Error("Supabase admin access token could not be created.");
  }

  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
  };
}

async function getAdminAccessToken(forceRefresh = false) {
  if (config.flixifyAdminAccessToken) {
    return config.flixifyAdminAccessToken;
  }

  if (!forceRefresh && cachedAdminSession && cachedAdminSession.expiresAt > Date.now()) {
    return cachedAdminSession.accessToken;
  }

  cachedAdminSession = await createSupabaseAdminSession();
  return cachedAdminSession.accessToken;
}

async function flixifyRequest(path, { method = "GET", query = null, body = undefined, retry = true } = {}) {
  const token = await getAdminAccessToken();
  const url = new URL(`${config.flixifyApiBaseUrl}${path}`);

  if (query && typeof query === "object") {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  try {
    return await fetchJson(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    if (retry && Number(error?.status) === 401) {
      cachedAdminSession = null;
      return flixifyRequest(path, {
        method,
        query,
        body,
        retry: false
      });
    }
    throw error;
  }
}

async function resellerRequest(action, payload = {}, options = {}) {
  const form = new URLSearchParams();
  form.set("api_key", config.resellerApiKey);
  form.set("action", action);

  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      form.set(key, String(value));
    }
  });

  const response = await fetch(config.resellerApiBaseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000)
  });

  const rawBody = await response.text();
  let parsed = null;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error(`Reseller API invalid response: ${rawBody.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(parsed?.error ?? parsed?.status ?? `HTTP ${response.status}`);
  }

  if (parsed?.status !== "STATUS_SUCCESS") {
    throw new Error(parsed?.error ?? parsed?.status ?? "Reseller API request failed.");
  }

  return options.returnEnvelope ? parsed : parsed.data;
}

async function getResellerUserInfo() {
  if (!config.resellerApiKey) {
    return null;
  }
  try {
    return await resellerRequest("user_info");
  } catch (error) {
    console.error("Reseller user_info error:", normalizeErrorMessage(error));
    return null;
  }
}

async function getResellerPackages() {
  if (!config.resellerApiKey) {
    return [];
  }
  try {
    const list = await resellerRequest("packages");
    return Array.isArray(list) ? list : [];
  } catch (error) {
    console.error("Reseller packages error:", normalizeErrorMessage(error));
    return [];
  }
}

async function listPendingUsers(page = 1, pageSize = config.pendingPageSize) {
  return flixifyRequest("/admin/users", {
    query: {
      page,
      pageSize,
      status: "new",
      m3u: "unassigned"
    }
  });
}

async function listAllPendingUsers() {
  const aggregatedItems = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const payload = await listPendingUsers(page, config.notifyPageSize);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const total = parsePositiveInt(payload?.total, items.length || 1);
    totalPages = Math.max(1, Math.ceil(total / config.notifyPageSize));
    aggregatedItems.push(...items);
    page += 1;
  }

  return aggregatedItems;
}

async function listPendingPaymentRequests() {
  const payload = await flixifyRequest("/admin/payment-requests");
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.filter((item) => String(item?.status ?? "").trim() === "pending-review");
}

async function listFlixifyPackages() {
  return flixifyRequest("/admin/packages");
}

async function getUserDetail(userId) {
  return flixifyRequest(`/admin/users/${encodeURIComponent(userId)}`);
}

async function attachM3UCredentials(userId, credentials) {
  return flixifyRequest(`/admin/users/${encodeURIComponent(userId)}/m3u-source`, {
    method: "POST",
    body: {
      username: credentials.username,
      password: credentials.password
    }
  });
}

async function activateFlixifySubscription(userId, packageConfig) {
  if (packageConfig.flixifyMode === "test-24h") {
    return flixifyRequest(`/admin/users/${encodeURIComponent(userId)}/subscriptions/test-24h`, {
      method: "POST"
    });
  }

  return flixifyRequest(`/admin/users/${encodeURIComponent(userId)}/subscriptions`, {
    method: "POST",
    body: {
      packageSlug: packageConfig.flixifyPackageSlug
    }
  });
}

function resolvePanelCredentials(userDetail) {
  const code = String(userDetail?.summary?.kryptoniteCode ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{16}$/.test(code)) {
    throw new Error("Flixify kullanici kodu panel username/password olarak kullanilamiyor.");
  }

  return {
    username: code,
    password: code
  };
}

function normalizePanelLine(panelLine, requestedCredentials) {
  const line = panelLine && typeof panelLine === "object" ? panelLine : {};

  const username =
    String(
      line.username ??
        line.user_name ??
        line.line_username ??
        line.lineUsername ??
        requestedCredentials.username
    ).trim() || requestedCredentials.username;
  const password =
    String(
      line.password ??
        line.user_password ??
        line.line_password ??
        line.linePassword ??
        requestedCredentials.password
    ).trim() || requestedCredentials.password;
  const id =
    String(line.id ?? line.line_id ?? line.lineId ?? line.user_id ?? line.userId ?? "-").trim() || "-";

  return {
    ...line,
    id,
    username,
    password,
    exp_date: line.exp_date ?? line.expDate ?? line.expires_at ?? line.expiresAt ?? null
  };
}

async function createPanelLine(userDetail, packageConfig) {
  if (!config.resellerApiKey) {
    throw new Error("Reseller panel API Key tanimlanmamis. Panelde line acabilmek icin RESELLER_API_KEY gereklidir.");
  }
  const codeSuffix = userDetail.summary.codeSuffix ? ` code:${userDetail.summary.codeSuffix}` : "";
  const credentials = resolvePanelCredentials(userDetail);
  return resellerRequest("create_line", {
    package: packageConfig.resellerPackageId,
    trial: packageConfig.resellerTrial,
    username: credentials.username,
    password: credentials.password,
    reseller_notes: `Flixify user:${userDetail.summary.id}${codeSuffix}`
  });
}

async function getActiveConnectionStats() {
  if (!config.resellerApiKey) {
    return {
      count: 0,
      checkedAt: new Date().toISOString(),
      disabled: true
    };
  }

  const form = new URLSearchParams();
  form.set("api_key", config.resellerApiKey);
  form.set("action", "live_connections");
  form.set("start", "0");
  form.set("limit", "1");

  const response = await fetch(config.resellerApiBaseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString(),
    signal: AbortSignal.timeout(20_000)
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`live_connections failed with HTTP ${response.status}`);
  }

  if (rawBody.trim() === "" || rawBody.trim() === "null") {
    return {
      count: 0,
      checkedAt: new Date().toISOString()
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error(`live_connections invalid response: ${rawBody.slice(0, 200)}`);
  }

  const count =
    parseNonNegativeInt(payload?.recordsFiltered) ??
    parseNonNegativeInt(payload?.recordsTotal) ??
    (Array.isArray(payload?.data) ? payload.data.length : 0);

  return {
    count,
    checkedAt: new Date().toISOString()
  };
}

function buildPendingKeyboard(items, page, total) {
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const label = String(item?.kryptoniteCode ?? item?.codeSuffix ?? item?.id ?? "Kayit").trim();
    return [
      {
        text: `\u{1F195} ${label}`,
        callback_data: buildCallbackData("select", page, item.id)
      }
    ];
  });

  const totalPages = Math.max(1, Math.ceil(Number(total ?? 0) / config.pendingPageSize) || 1);
  const navRow = [];

  if (page > 1) {
    navRow.push({
      text: "\u{2B05}\u{FE0F} Geri",
      callback_data: buildCallbackData("pending", page - 1)
    });
  }
  if (page < totalPages) {
    navRow.push({
      text: "\u{27A1}\u{FE0F} Ileri",
      callback_data: buildCallbackData("pending", page + 1)
    });
  }
  navRow.push({
    text: "\u{1F504} Yenile",
    callback_data: buildCallbackData("pending", page)
  });

  rows.push(navRow);

  return {
    inline_keyboard: rows
  };
}

function buildUserCardKeyboard(userId, page) {
  return {
    inline_keyboard: [
      [
        {
          text: "\u{1F4CB} Kodu Goster",
          callback_data: buildCallbackData("copy", page, userId)
        }
      ],
      [
        {
          text: "\u{1F464} Kullanici Detayi",
          callback_data: buildCallbackData("detail", page, userId)
        }
      ],
      [
        {
          text: "\u{1F9E9} M3U Ata",
          callback_data: buildCallbackData("packages", page, userId)
        }
      ],
      [
        {
          text: "\u{1F4DA} Listeye Don",
          callback_data: buildCallbackData("pending", page)
        }
      ]
    ]
  };
}

function buildPaymentNotificationKeyboard(userId) {
  return {
    inline_keyboard: [
      [
        {
          text: "\u{1F464} Kullanici Detayi",
          callback_data: buildCallbackData("detail", 1, userId)
        }
      ]
    ]
  };
}

function buildDetailKeyboard(userId, page) {
  return {
    inline_keyboard: [
      [
        {
          text: "\u{1F9E9} M3U Ata",
          callback_data: buildCallbackData("packages", page, userId)
        }
      ],
      [
        {
          text: "\u{21A9}\u{FE0F} Kart Gorunumu",
          callback_data: buildCallbackData("select", page, userId)
        }
      ],
      [
        {
          text: "\u{1F4DA} Listeye Don",
          callback_data: buildCallbackData("pending", page)
        }
      ]
    ]
  };
}

function buildPackageKeyboard(userId, page) {
  const rows = [];

  for (let index = 0; index < config.packageMap.length; index += 2) {
    rows.push(
      config.packageMap.slice(index, index + 2).map((item) => ({
        text: item.label,
        callback_data: buildCallbackData("assign", item.key, page, userId)
      }))
    );
  }

  rows.push([
    {
      text: "\u{21A9}\u{FE0F} Kullanici Karti",
      callback_data: buildCallbackData("select", page, userId)
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

function buildResultKeyboard(userId, page) {
  return {
    inline_keyboard: [
      [
        {
          text: "\u{1F464} Kullanici Karti",
          callback_data: buildCallbackData("select", page, userId)
        }
      ],
      [
        {
          text: "\u{1F4DA} Bekleyenler",
          callback_data: buildCallbackData("pending", page)
        }
      ]
    ]
  };
}

function renderPendingUsersText(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const page = parsePositiveInt(payload?.page, 1);
  const total = parseNonNegativeInt(payload?.total) ?? items.length;
  const totalPages = Math.max(1, Math.ceil(total / config.pendingPageSize));
  const lines = [
    "\u{1F195} <b>Bekleyen Kayitlar</b>",
    "",
    `Toplam: <b>${total}</b>`,
    `Sayfa: <b>${page}</b> / <b>${totalPages}</b>`
  ];

  if (items.length === 0) {
    lines.push("");
    lines.push("Su anda paket bekleyen yeni kayit yok.");
    return lines.join("\n");
  }

  lines.push("");
  items.forEach((item, index) => {
    const label = escapeHtml(item?.kryptoniteCode ?? item?.codeSuffix ?? item?.id ?? "Kayit");
    lines.push(`${index + 1}. <b>${label}</b>`);
    lines.push(`   ${escapeHtml(formatDate(item?.createdAt))}`);
  });

  lines.push("");
  lines.push("Bir kaydi acmak icin asagidaki butonlari kullanin.");
  return lines.join("\n");
}

function renderUserCardText(detail) {
  const snapshot = getUserSnapshot(detail);

  return [
    "\u{1F195} <b>Yeni Kayit</b>",
    "",
    `\u{1F464} <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `\u{1F552} <b>Tarih:</b> ${escapeHtml(formatDate(snapshot.createdAt))}`,
    `\u{1F4E1} <b>M3U Bagli:</b> <b>${snapshot.hasAssignedLink ? "Evet" : "Hayir"}</b>`,
    `\u{1F510} <b>IPTV Kullanici:</b> <code>${escapeHtml(snapshot.iptvUsername)}</code>`,
    `\u{1F39F}\u{FE0F} <b>Aktif Paket:</b> <b>${escapeHtml(snapshot.activePackageTitle)}</b>`,
    `\u{23F3} <b>Kalan:</b> <b>${escapeHtml(snapshot.remainingLabel)}</b>`,
    "",
    "Asagidaki butonlardan birini secin."
  ].join("\n");
}

function renderPaymentRequestText(paymentRequest, detail) {
  const snapshot = getUserSnapshot(detail);
  const packageTitle = String(paymentRequest?.packageTitle ?? "-").trim() || "-";
  const paymentMethod = formatPaymentMethodLabel(paymentRequest?.paymentMethodId, paymentRequest?.cryptoAssetId);
  const createdAt = paymentRequest?.createdAt ?? null;

  return [
    "\u{1F4B8} <b>Yeni Odeme Bildirimi</b>",
    "",
    `\u{1F464} <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `\u{1F39F}\u{FE0F} <b>Paket:</b> <b>${escapeHtml(packageTitle)}</b>`,
    `\u{1F4B3} <b>Odeme Yontemi:</b> <b>${escapeHtml(paymentMethod)}</b>`,
    `\u{1F552} <b>Tarih:</b> ${escapeHtml(formatDate(createdAt))}`
  ].join("\n");
}

function renderUserDetailText(detail) {
  const snapshot = getUserSnapshot(detail);

  return [
    "\u{1F464} <b>Kullanici Detayi</b>",
    "",
    `\u{1F194} <b>User ID:</b> <code>${escapeHtml(snapshot.id)}</code>`,
    `\u{1F464} <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `\u{1F3F7}\u{FE0F} <b>Durum:</b> <b>${escapeHtml(formatUserStatus(snapshot.status))}</b>`,
    `\u{1F552} <b>Kayit Tarihi:</b> ${escapeHtml(formatDate(snapshot.createdAt))}`,
    `\u{1F4E1} <b>M3U Bagli:</b> <b>${snapshot.hasAssignedLink ? "Evet" : "Hayir"}</b>`,
    `\u{1F510} <b>IPTV Kullanici:</b> <code>${escapeHtml(snapshot.iptvUsername)}</code>`,
    `\u{1F511} <b>IPTV Sifre:</b> <code>${escapeHtml(snapshot.iptvPassword)}</code>`,
    `\u{1F39F}\u{FE0F} <b>Aktif Paket:</b> <b>${escapeHtml(snapshot.activePackageTitle)}</b>`,
    `\u{23F3} <b>Kalan Sure:</b> <b>${escapeHtml(snapshot.remainingLabel)}</b>`,
    `\u{1F517} <b>Kaynak URL:</b> <code>${escapeHtml(snapshot.currentSourceUrl ?? "-")}</code>`
  ].join("\n");
}

function renderPackagePickerText(detail) {
  const snapshot = getUserSnapshot(detail);

  return [
    "\u{1F9E9} <b>M3U Ata</b>",
    "",
    `\u{1F464} <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `\u{1F552} <b>Tarih:</b> ${escapeHtml(formatDate(snapshot.createdAt))}`,
    "",
    "Atamak istediginiz paketi secin."
  ].join("\n");
}

function renderPackageListText(packagePayload) {
  const flixifyPackages = new Map(
    (Array.isArray(packagePayload?.items) ? packagePayload.items : []).map((item) => [item.slug, item])
  );

  const lines = ["\u{1F9E9} <b>Paket Haritasi</b>", ""];
  config.packageMap.forEach((item) => {
    const internalPackage = item.flixifyPackageSlug ? flixifyPackages.get(item.flixifyPackageSlug) : null;
    lines.push(`<b>${escapeHtml(item.label)}</b>`);
    lines.push(`Reseller: <code>${item.resellerPackageId}</code> | Trial: <b>${item.resellerTrial ? "Evet" : "Hayir"}</b>`);
    lines.push(
      `Flixify: <code>${
        escapeHtml(item.flixifyMode === "test-24h" ? "test-24h" : item.flixifyPackageSlug ?? "-")
      }</code>${internalPackage ? ` (${escapeHtml(internalPackage.title)})` : ""}`
    );
    lines.push("");
  });
  return lines.join("\n").trim();
}

function renderActiveUsersText(stats) {
  if (stats.disabled) {
    return [
      "\u{1F4E1} <b>Aktif IPTV Kullanici Sayisi</b>",
      "",
      "\u{26A0}\u{FE0F} <i>Reseller panel API anahtari henuz tanimlanmadigi icin canli baglanti verisi alinamiyor.</i>",
      `Kontrol zamani: ${escapeHtml(formatDate(stats.checkedAt))}`
    ].join("\n");
  }

  return [
    "\u{1F4E1} <b>Aktif IPTV Kullanici Sayisi</b>",
    "",
    `Canli baglanti: <b>${stats.count}</b>`,
    `Kontrol zamani: ${escapeHtml(formatDate(stats.checkedAt))}`
  ].join("\n");
}

function renderSuccessText(detail, packageConfig, panelLine) {
  const snapshot = getUserSnapshot(detail);

  return [
    "\u{2705} <b>Paket Atandi</b>",
    "",
    `\u{1F464} <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `\u{1F39F}\u{FE0F} <b>Secilen Paket:</b> <b>${escapeHtml(packageConfig.label)}</b>`,
    `\u{1F194} <b>Panel Line ID:</b> <b>${escapeHtml(panelLine.id ?? "-")}</b>`,
    `\u{1F510} <b>IPTV Kullanici:</b> <code>${escapeHtml(panelLine.username ?? snapshot.code)}</code>`,
    `\u{1F511} <b>IPTV Sifre:</b> <code>${escapeHtml(panelLine.password ?? snapshot.code)}</code>`,
    `\u{1F4C5} <b>Bitis:</b> <b>${escapeHtml(formatUnixSeconds(panelLine.exp_date))}</b>`
  ].join("\n");
}

function renderPartialFailureText(detail, packageConfig, panelLine, error) {
  const snapshot = getUserSnapshot(detail);

  return [
    "\u{26A0}\u{FE0F} <b>Kismi Hata</b>",
    "",
    "Panelde line acildi fakat Flixify tarafinda atama tamamlanamadi.",
    `\u{1F464} <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `\u{1F39F}\u{FE0F} <b>Secilen Paket:</b> <b>${escapeHtml(packageConfig.label)}</b>`,
    `\u{1F194} <b>Panel Line ID:</b> <b>${escapeHtml(panelLine.id ?? "-")}</b>`,
    `\u{1F510} <b>IPTV Kullanici:</b> <code>${escapeHtml(panelLine.username ?? "-")}</code>`,
    `\u{1F511} <b>IPTV Sifre:</b> <code>${escapeHtml(panelLine.password ?? "-")}</code>`,
    `\u{274C} <b>Hata:</b> <b>${escapeHtml(normalizeErrorMessage(error))}</b>`,
    "",
    "Bu kayit icin manuel kontrol gerekebilir."
  ].join("\n");
}

async function showPendingUsers(chatId, page = 1, messageId = null) {
  const payload = await listPendingUsers(page);
  const text = renderPendingUsersText(payload);

  return upsertMessage(
    chatId,
    text,
    {
      parse_mode: "HTML",
      reply_markup: buildPendingKeyboard(payload.items, parsePositiveInt(payload.page, page), payload.total)
    },
    messageId
  );
}

async function showUserCard(chatId, userId, page, messageId = null) {
  const detail = await getUserDetail(userId);

  return upsertMessage(
    chatId,
    renderUserCardText(detail),
    {
      parse_mode: "HTML",
      reply_markup: buildUserCardKeyboard(userId, page)
    },
    messageId
  );
}

async function showUserDetails(chatId, userId, page, messageId = null) {
  const detail = await getUserDetail(userId);

  return upsertMessage(
    chatId,
    renderUserDetailText(detail),
    {
      parse_mode: "HTML",
      reply_markup: buildDetailKeyboard(userId, page)
    },
    messageId
  );
}

async function showPackagePicker(chatId, userId, page, messageId = null) {
  const detail = await getUserDetail(userId);

  return upsertMessage(
    chatId,
    renderPackagePickerText(detail),
    {
      parse_mode: "HTML",
      reply_markup: buildPackageKeyboard(userId, page)
    },
    messageId
  );
}

async function showErrorMessage(chatId, error, messageId = null) {
  return upsertMessage(
    chatId,
    `\u{274C} <b>Hata</b>\n${escapeHtml(normalizeErrorMessage(error))}`,
    {
      parse_mode: "HTML"
    },
    messageId
  );
}

async function assignPackageToUser(chatId, userId, page, packageKey, messageId = null) {
  const packageConfig = config.packageMapByKey.get(packageKey);
  if (!packageConfig) {
    throw new Error(`Unknown package key: ${packageKey}`);
  }

  const detail = await getUserDetail(userId);
  if (
    !config.allowReassign &&
    (detail.summary.hasAssignedLink || detail.iptvUsername || detail.iptvPassword || detail.currentSourceUrl)
  ) {
    throw new Error("Bu kullaniciya zaten IPTV kimligi baglanmis. Yeniden atama kapali.");
  }

  await upsertMessage(
    chatId,
    [
      "\u{23F3} <b>Paket Ataniyor</b>",
      "",
      `\u{1F464} <b>User ID:</b> <code>${escapeHtml(userId)}</code>`,
      `\u{1F39F}\u{FE0F} <b>Secim:</b> <b>${escapeHtml(packageConfig.label)}</b>`,
      "",
      "Lutfen bekleyin..."
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: buildResultKeyboard(userId, page)
    },
    messageId
  );

  const requestedCredentials = resolvePanelCredentials(detail);
  const panelLine = normalizePanelLine(
    await createPanelLine(detail, packageConfig),
    requestedCredentials
  );

  try {
    await attachM3UCredentials(userId, {
      username: requestedCredentials.username,
      password: requestedCredentials.password
    });
    await activateFlixifySubscription(userId, packageConfig);
    const updatedDetail = await getUserDetail(userId);

    return upsertMessage(
      chatId,
      renderSuccessText(updatedDetail, packageConfig, panelLine),
      {
        parse_mode: "HTML",
        reply_markup: buildResultKeyboard(userId, page)
      },
      messageId
    );
  } catch (error) {
    return upsertMessage(
      chatId,
      renderPartialFailureText(detail, packageConfig, panelLine, error),
      {
        parse_mode: "HTML",
        reply_markup: buildResultKeyboard(userId, page)
      },
      messageId
    );
  }
}

async function showUserCode(query, page, userId) {
  const detail = await getUserDetail(userId);
  const snapshot = getUserSnapshot(detail);

  await bot.answerCallbackQuery(query.id, {
    text: `Kullanici Kodu:\n${snapshot.code}`,
    show_alert: true
  });

  if (query.message?.chat.id && query.message?.message_id) {
    await showUserCard(query.message.chat.id, userId, page, query.message.message_id);
  }
}

async function broadcastToAdmins(text, options = {}) {
  if (config.telegramAdminIds.size === 0) {
    return;
  }
  for (const adminId of config.telegramAdminIds) {
    try {
      await bot.sendMessage(adminId, text, options);
    } catch (error) {
      console.error(`telegram-panel-bot notify failed for admin ${adminId}:`, normalizeErrorMessage(error));
    }
  }
}

async function notifyNewUser(userId) {
  const detail = await getUserDetail(userId);

  await broadcastToAdmins(renderUserCardText(detail), {
    parse_mode: "HTML",
    reply_markup: buildUserCardKeyboard(userId, 1)
  });
}

async function notifyPaymentRequest(paymentRequest) {
  const userId = String(paymentRequest?.userId ?? "").trim();
  if (!userId) {
    return;
  }

  const detail = await getUserDetail(userId);
  await broadcastToAdmins(renderPaymentRequestText(paymentRequest, detail), {
    parse_mode: "HTML",
    reply_markup: buildPaymentNotificationKeyboard(userId)
  });
}

async function pollNewUsers({ seedOnly = false } = {}) {
  if (notifierTickInFlight) {
    return;
  }

  notifierTickInFlight = true;

  try {
    const [items, paymentRequests] = await Promise.all([
      listAllPendingUsers(),
      listPendingPaymentRequests()
    ]);
    const knownIds = new Set(notifierState.knownPendingUserIds);
    const knownPaymentRequestIds = new Set(notifierState.knownPendingPaymentRequestIds);
    const currentIds = dedupeIds(items.map((item) => item?.id));
    const currentPaymentRequestIds = dedupeIds(paymentRequests.map((item) => item?.id));

    if (seedOnly || !notifierState.bootstrapped) {
      notifierState = {
        ...notifierState,
        bootstrapped: true,
        knownPendingUserIds: dedupeIds([...notifierState.knownPendingUserIds, ...currentIds]),
        knownPendingPaymentRequestIds: dedupeIds([
          ...notifierState.knownPendingPaymentRequestIds,
          ...currentPaymentRequestIds
        ]),
        lastSyncAt: new Date().toISOString()
      };
      await saveNotifierState();
      await writeHeartbeat({ status: "running", seedOnly: true });
      return;
    }

    const freshItems = items
      .filter((item) => {
        const pendingUserId = String(item?.id ?? "").trim();
        return pendingUserId.length > 0 && !knownIds.has(pendingUserId);
      })
        .sort((left, right) => {
          const leftTime = new Date(left?.createdAt ?? 0).getTime();
          const rightTime = new Date(right?.createdAt ?? 0).getTime();
          return leftTime - rightTime;
        });
    const freshPaymentRequests = paymentRequests
      .filter((item) => {
        const paymentRequestId = String(item?.id ?? "").trim();
        return paymentRequestId.length > 0 && !knownPaymentRequestIds.has(paymentRequestId);
      })
      .sort((left, right) => {
        const leftTime = new Date(left?.createdAt ?? 0).getTime();
        const rightTime = new Date(right?.createdAt ?? 0).getTime();
        return leftTime - rightTime;
      });

    for (const item of freshItems) {
      const pendingUserId = String(item?.id ?? "").trim();
      if (!pendingUserId) {
        continue;
      }

      try {
        await notifyNewUser(pendingUserId);
        knownIds.add(pendingUserId);
      } catch (error) {
        console.error(`telegram-panel-bot notifier failed for user ${pendingUserId}:`, normalizeErrorMessage(error));
      }
    }

    for (const item of freshPaymentRequests) {
      const paymentRequestId = String(item?.id ?? "").trim();
      if (!paymentRequestId) {
        continue;
      }

      try {
        await notifyPaymentRequest(item);
        knownPaymentRequestIds.add(paymentRequestId);
      } catch (error) {
        console.error(
          `telegram-panel-bot notifier failed for payment request ${paymentRequestId}:`,
          normalizeErrorMessage(error)
        );
      }
    }

    notifierState = {
      ...notifierState,
      bootstrapped: true,
      knownPendingUserIds: dedupeIds([...knownIds, ...currentIds]),
      knownPendingPaymentRequestIds: dedupeIds([...knownPaymentRequestIds, ...currentPaymentRequestIds]),
      lastSyncAt: new Date().toISOString()
    };
    await saveNotifierState();
    await writeHeartbeat({ status: "running" });
  } catch (error) {
    console.error("telegram-panel-bot notifier poll failed:", normalizeErrorMessage(error));
    await writeHeartbeat({
      status: "poll-failed",
      pollError: normalizeErrorMessage(error)
    });
  } finally {
    notifierTickInFlight = false;
  }
}

async function startNotifier() {
  notifierState = await loadNotifierState();
  if (Array.isArray(notifierState.adminIds)) {
    for (const id of notifierState.adminIds) {
      config.telegramAdminIds.add(String(id));
    }
  }
  await writeHeartbeat({ status: "starting" });
  await pollNewUsers({ seedOnly: !notifierState.bootstrapped });
  notifierTimer = setInterval(() => {
    void pollNewUsers();
  }, config.newUserPollSeconds * 1000);
  heartbeatTimer = setInterval(() => {
    void ensureHealthyPolling();
  }, 30_000);
}

async function stopNotifier() {
  if (notifierTimer) {
    clearInterval(notifierTimer);
    notifierTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  await writeHeartbeat({ status: "stopped" });
}

bot.onText(/\/start$/, async (message) => {
  const userIdStr = String(message.from?.id ?? "");

  // If no admin is registered yet, auto-pair this first user as admin!
  if (config.telegramAdminIds.size === 0) {
    config.telegramAdminIds.add(userIdStr);
    notifierState.adminIds = dedupeIds([...(notifierState.adminIds || []), userIdStr]);
    await saveNotifierState();

    const welcomeText = [
      "🎉 <b>Flixify Yonetici Botu Aktif Edildi!</b>",
      "",
      "Tebrikler! Yonetici hesabiniz bot ile basariyla eslestirildi.",
      `🆔 <b>Telegram ID'niz:</b> <code>${userIdStr}</code>`,
      `👤 <b>Kullanici:</b> @${message.from?.username || message.from?.first_name || "-"}`,
      "",
      "✅ <i>Artik yeni kayit bildirimleri ve odeme talepleri aninda bu sohbete iletilecek.</i>",
      "",
      "<b>Yonetim Komutlari:</b>",
      "/bekleyenler - Bekleyen yeni kayitlari listele",
      "/aktif - Canli IPTV baglanti sayisini goster",
      "/paketler - Paket haritasini goster",
      "/status - Bot ve sistem durumu",
      "/help - Detayli yardim rehberi"
    ].join("\n");

    await bot.sendMessage(message.chat.id, welcomeText, { parse_mode: "HTML" });
    return;
  }

  if (!isAuthorizedUser(userIdStr)) {
    const unauthText = [
      "⛔ <b>Yetkisiz Erisim</b>",
      "",
      "Bu bot sadece yetkili Flixify sistem yoneticilerine ozeldir.",
      `🆔 <b>Telegram ID'niz:</b> <code>${userIdStr}</code>`,
      "",
      "Yetki almak icin bu ID'yi yetkiliye iletiniz."
    ].join("\n");

    await bot.sendMessage(message.chat.id, unauthText, { parse_mode: "HTML" });
    return;
  }

  const text = [
    "🤖 <b>Flixify Yonetici Botu</b>",
    "",
    "Yeni kayit bildirimleri acik. Kullanicilara buradan paket atayabilirsiniz.",
    "",
    "Komutlar:",
    "/bekleyenler - Bekleyen yeni kayitlari listele",
    "/bakiye - IPTV Reseller bakiye & hesap bilgisi",
    "/aktif - Canli IPTV baglanti sayisini goster",
    "/paketler - Paket haritasi & kredi tablosu",
    "/status - Bot, API ve Reseller baglanti durumu",
    "/help - Yardim rehberi"
  ].join("\n");

  await bot.sendMessage(message.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/help$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  const text = [
    "📖 <b>Kullanim Rehberi</b>",
    "",
    "1. Bot yeni kayit veya odeme bildirimi geldiginde size otomatik mesaj yollar.",
    "2. Bildirim kartinda <b>M3U Ata</b> butonuna basarak aninda IPTV line acabilirsiniz.",
    "3. Acilan line bilgileri dogrudan Flixify kullanicisina baglanir ve abonelik aktif edilir.",
    "",
    "<b>Yonetici Komutlari:</b>",
    "/bekleyenler - Bekleyen kullanicilari listele",
    "/bakiye - IPTV Reseller kredi bakiyesi ve hesap durumu",
    "/aktif - Anlik canli baglanti sayisi",
    "/paketler - Paket haritasi ve kredi maliyetleri",
    "/status - Sistem ve baglanti sagligi",
    "/addadmin [id] - Yeni yonetici ekle",
    "/help - Bu rehber"
  ].join("\n");

  await bot.sendMessage(message.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/(?:bakiye|kredi|reseller)$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  try {
    const info = await getResellerUserInfo();
    if (!info) {
      await bot.sendMessage(message.chat.id, "⚠️ Reseller hesap bilgisi alinamadi.");
      return;
    }

    const lines = [
      "💳 <b>IPTV Reseller Hesap & Bakiye</b>",
      "",
      `👤 <b>Kullanici:</b> <code>${escapeHtml(info.username)}</code>`,
      `📧 <b>E-posta:</b> <code>${escapeHtml(info.email || "-")}</code>`,
      `💰 <b>Kalan Kredi:</b> <b>${escapeHtml(info.credits)} Kredi</b>`,
      `🌐 <b>DNS Sunucu:</b> <code>${escapeHtml(info.reseller_dns || "sifiriptvdns.com")}</code>`,
      `📡 <b>Durum:</b> ${info.status === "1" ? "✅ Aktif" : "Askida"}`,
      `🆔 <b>Reseller ID:</b> <code>${escapeHtml(info.id)}</code>`,
      "",
      "💡 <i>Kullanicilara paket atandikca bu bakiyeden otomatik duser.</i>"
    ];

    await bot.sendMessage(message.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    await bot.sendMessage(message.chat.id, `Hata: ${normalizeErrorMessage(error)}`);
  }
});

bot.onText(/\/status$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  try {
    let apiStatus = "Bilinmiyor";
    let pendingCount = 0;
    try {
      const pending = await listPendingUsers(1, 1);
      pendingCount = parseNonNegativeInt(pending?.total) ?? 0;
      apiStatus = "✅ Bagli (200 OK)";
    } catch (err) {
      apiStatus = `❌ Hata: ${normalizeErrorMessage(err)}`;
    }

    let resellerStatus = "⚠️ Yapilandirilmadi";
    if (config.resellerApiKey) {
      try {
        const info = await getResellerUserInfo();
        if (info) {
          resellerStatus = `✅ Bagli (${info.username} - 💰 ${info.credits} Kredi)`;
        } else {
          resellerStatus = "⚠️ Yanit Alinamadi";
        }
      } catch (err) {
        resellerStatus = `❌ Hata: ${normalizeErrorMessage(err)}`;
      }
    }

    const lines = [
      "📊 <b>Flixify Bot & Sistem Durumu</b>",
      "",
      `🤖 <b>Bot:</b> @${botIdentity?.username || "flixifyadmin_bot"}`,
      `🌐 <b>Flixify API:</b> <code>${config.flixifyApiBaseUrl}</code>`,
      `🔗 <b>API Durumu:</b> ${apiStatus}`,
      `📡 <b>Reseller Panel:</b> ${resellerStatus}`,
      `👥 <b>Kayitli Yonetici:</b> <b>${config.telegramAdminIds.size} kisi</b>`,
      `⏳ <b>Bekleyen Kayitlar:</b> <b>${pendingCount}</b>`,
      `🕒 <b>Son Senkronizasyon:</b> ${formatDate(notifierState.lastSyncAt)}`
    ];

    await bot.sendMessage(message.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    await bot.sendMessage(message.chat.id, `Hata: ${normalizeErrorMessage(error)}`);
  }
});

bot.onText(/\/addadmin(?:\s+(\d+))?$/, async (message, match) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  const newAdminId = match?.[1]?.trim();
  if (!newAdminId) {
    await bot.sendMessage(message.chat.id, "Kullanim: <code>/addadmin &lt;telegram_id&gt;</code>", {
      parse_mode: "HTML"
    });
    return;
  }

  config.telegramAdminIds.add(newAdminId);
  notifierState.adminIds = dedupeIds([...(notifierState.adminIds || []), newAdminId]);
  await saveNotifierState();

  await bot.sendMessage(message.chat.id, `✅ Telegram ID <code>${newAdminId}</code> yonetici olarak eklendi.`, {
    parse_mode: "HTML"
  });
});

bot.onText(/\/bekleyenler(?:\s+(\d+))?$/, async (message, match) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  const page = parsePositiveInt(match?.[1], 1);
  try {
    await showPendingUsers(message.chat.id, page);
  } catch (error) {
    await bot.sendMessage(message.chat.id, `Hata: ${normalizeErrorMessage(error)}`);
  }
});

bot.onText(/\/aktif(?:ler)?$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  try {
    const stats = await getActiveConnectionStats();
    await bot.sendMessage(message.chat.id, renderActiveUsersText(stats), {
      parse_mode: "HTML"
    });
  } catch (error) {
    await bot.sendMessage(message.chat.id, `Hata: ${normalizeErrorMessage(error)}`);
  }
});

bot.onText(/\/paketler$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  try {
    const [flixifyPackagesPayload, resellerPackages] = await Promise.all([
      listFlixifyPackages().catch(() => null),
      getResellerPackages().catch(() => [])
    ]);

    const lines = [
      "📦 <b>IPTV & Flixify Paket Haritasi</b>",
      ""
    ];

    config.packageMap.forEach((item) => {
      const rp = resellerPackages.find((p) => String(p.id) === String(item.resellerPackageId));
      const creditInfo = rp ? (rp.is_trial === "1" ? "0 Kredi (Test)" : `${rp.official_credits} Kredi`) : "-";
      lines.push(`🔘 <b>${escapeHtml(item.label)}</b>`);
      lines.push(`   • Reseller ID: <code>${item.resellerPackageId}</code> (${creditInfo})`);
      lines.push(`   • Flixify: <code>${escapeHtml(item.flixifyMode || item.flixifyPackageSlug || "-")}</code>`);
      lines.push("");
    });

    lines.push("ℹ️ <i>Kullanicilara paket atamak icin /bekleyenler komutunu kullanabilirsiniz.</i>");

    await bot.sendMessage(message.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  } catch (error) {
    await bot.sendMessage(message.chat.id, `Hata: ${normalizeErrorMessage(error)}`);
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  const fromId = query.from?.id;
  const data = query.data ?? "";

  if (!chatId || !messageId) {
    await bot.answerCallbackQuery(query.id);
    return;
  }

  if (!isAuthorizedUser(fromId)) {
    await answerUnauthorizedCallback(query);
    return;
  }

  try {
    if (data.startsWith("pending:")) {
      const [, pageRaw] = data.split(":");
      const page = parsePositiveInt(pageRaw, 1);
      await showPendingUsers(chatId, page, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith("select:")) {
      const [, pageRaw, userId] = data.split(":");
      const page = parsePositiveInt(pageRaw, 1);
      await showUserCard(chatId, userId, page, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith("detail:")) {
      const [, pageRaw, userId] = data.split(":");
      const page = parsePositiveInt(pageRaw, 1);
      await showUserDetails(chatId, userId, page, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith("packages:")) {
      const [, pageRaw, userId] = data.split(":");
      const page = parsePositiveInt(pageRaw, 1);
      await showPackagePicker(chatId, userId, page, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith("copy:")) {
      const [, pageRaw, userId] = data.split(":");
      const page = parsePositiveInt(pageRaw, 1);
      await showUserCode(query, page, userId);
      return;
    }

    if (data.startsWith("assign:")) {
      const [, packageKey, pageRaw, userId] = data.split(":");
      const page = parsePositiveInt(pageRaw, 1);
      await bot.answerCallbackQuery(query.id, {
        text: "Paket atamasi baslatildi."
      });
      await assignPackageToUser(chatId, userId, page, packageKey, messageId);
      return;
    }

    await bot.answerCallbackQuery(query.id, {
      text: "Bilinmeyen islem."
    });
  } catch (error) {
    await bot.answerCallbackQuery(query.id, {
      text: "Islem basarisiz.",
      show_alert: false
    });
    await showErrorMessage(chatId, error, messageId);
  }
});

bot.on("polling_error", (error) => {
  console.error("telegram-panel-bot polling error:", error?.message ?? error);
  void recoverPolling(normalizeErrorMessage(error));
});

process.on("SIGINT", async () => {
  await stopNotifier();
  await bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopNotifier();
  await bot.stopPolling();
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  console.error("telegram-panel-bot unhandled rejection:", normalizeErrorMessage(error));
});

process.on("uncaughtException", (error) => {
  console.error("telegram-panel-bot uncaught exception:", normalizeErrorMessage(error));
});

Promise.resolve()
  .then(async () => {
    const me = await bot.getMe();
    botIdentity = me ?? null;
    await startNotifier();
    await writeHeartbeat({ status: "running" });
    const adminCount = config.telegramAdminIds.size;
    console.log(
      `telegram-panel-bot started as @${me?.username || me?.first_name || me?.id} (admins: ${
        adminCount > 0 ? Array.from(config.telegramAdminIds).join(",") : "awaiting /start"
      })`
    );
  })
  .catch(async (error) => {
    console.error("telegram-panel-bot failed to start:", normalizeErrorMessage(error));
    await stopNotifier();
    await bot.stopPolling();
    process.exit(1);
  });
