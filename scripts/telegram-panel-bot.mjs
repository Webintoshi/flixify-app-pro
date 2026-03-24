#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import TelegramBot from "node-telegram-bot-api";

const DEFAULT_FLIXIFY_API_BASE_URL = "http://localhost:4000";
const DEFAULT_PENDING_PAGE_SIZE = 6;
const DEFAULT_NOTIFY_PAGE_SIZE = 50;
const DEFAULT_NEW_USER_POLL_SECONDS = 20;
const DEFAULT_STATE_MAX_USERS = 5000;
const CALLBACK_MAX_LENGTH = 64;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATE_FILE = path.resolve(__dirname, "..", "data", "telegram-panel-bot-state.json");

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
    fail("TELEGRAM_PANEL_PACKAGE_MAP is required.");
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

function loadConfig() {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const telegramAdminId = process.env.TELEGRAM_ADMIN_ID?.trim();
  const flixifyApiBaseUrl = normalizeBaseUrl(
    process.env.FLIXIFY_API_BASE_URL,
    DEFAULT_FLIXIFY_API_BASE_URL
  );
  const flixifyAdminAccessToken = process.env.FLIXIFY_ADMIN_ACCESS_TOKEN?.trim() || null;
  const flixifyAdminEmail = process.env.FLIXIFY_TELEGRAM_ADMIN_EMAIL?.trim() || null;
  const flixifyAdminPassword = process.env.FLIXIFY_TELEGRAM_ADMIN_PASSWORD?.trim() || null;
  const supabaseUrl = normalizeBaseUrl(process.env.SUPABASE_URL);
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() || null;
  const resellerApiBaseUrl = normalizeBaseUrl(process.env.RESELLER_API_BASE_URL);
  const resellerApiKey = process.env.RESELLER_API_KEY?.trim() || null;
  const pendingPageSize = parsePositiveInt(process.env.TELEGRAM_PENDING_PAGE_SIZE, DEFAULT_PENDING_PAGE_SIZE);
  const notifyPageSize = parsePositiveInt(process.env.TELEGRAM_NOTIFY_PAGE_SIZE, DEFAULT_NOTIFY_PAGE_SIZE);
  const allowReassign = parseBoolean(process.env.TELEGRAM_ALLOW_REASSIGN, false);
  const newUserPollSeconds = parsePositiveInt(
    process.env.TELEGRAM_NEW_USER_POLL_SECONDS,
    DEFAULT_NEW_USER_POLL_SECONDS
  );
  const stateFilePath = normalizeFilePath(process.env.TELEGRAM_PANEL_STATE_FILE, DEFAULT_STATE_FILE);
  const packageMap = parsePackageMap(process.env.TELEGRAM_PANEL_PACKAGE_MAP);

  if (!telegramBotToken) {
    fail("TELEGRAM_BOT_TOKEN is required.");
  }
  if (!telegramAdminId) {
    fail("TELEGRAM_ADMIN_ID is required.");
  }
  if (!resellerApiBaseUrl) {
    fail("RESELLER_API_BASE_URL is required.");
  }
  if (!resellerApiKey) {
    fail("RESELLER_API_KEY is required.");
  }
  if (!flixifyAdminAccessToken) {
    if (!supabaseUrl || !supabaseAnonKey) {
      fail("SUPABASE_URL and SUPABASE_ANON_KEY are required unless FLIXIFY_ADMIN_ACCESS_TOKEN is provided.");
    }
    if (!flixifyAdminEmail || !flixifyAdminPassword) {
      fail(
        "FLIXIFY_TELEGRAM_ADMIN_EMAIL and FLIXIFY_TELEGRAM_ADMIN_PASSWORD are required unless FLIXIFY_ADMIN_ACCESS_TOKEN is provided."
      );
    }
  }

  return {
    telegramBotToken,
    telegramAdminId,
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
    packageMap,
    packageMapByKey: new Map(packageMap.map((item) => [item.key, item]))
  };
}

function isAuthorizedUser(userId) {
  return String(userId ?? "") === config.telegramAdminId;
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
    knownPendingUserIds: [],
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
    knownPendingUserIds: dedupeIds(Array.isArray(value.knownPendingUserIds) ? value.knownPendingUserIds : []),
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
    await bot.sendMessage(message.chat.id, "Yetkisiz erisim.");
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

async function createPanelLine(userDetail, packageConfig) {
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
  const payload = await resellerRequest(
    "live_connections",
    {
      start: 0,
      limit: 1
    },
    {
      returnEnvelope: true
    }
  );

  const count =
    parseNonNegativeInt(payload.recordsFiltered) ??
    parseNonNegativeInt(payload.recordsTotal) ??
    (Array.isArray(payload.data) ? payload.data.length : 0);

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
        text: `🆕 ${label}`,
        callback_data: buildCallbackData("select", page, item.id)
      }
    ];
  });

  const totalPages = Math.max(1, Math.ceil(Number(total ?? 0) / config.pendingPageSize) || 1);
  const navRow = [];

  if (page > 1) {
    navRow.push({
      text: "⬅️ Geri",
      callback_data: buildCallbackData("pending", page - 1)
    });
  }
  if (page < totalPages) {
    navRow.push({
      text: "➡️ Ileri",
      callback_data: buildCallbackData("pending", page + 1)
    });
  }
  navRow.push({
    text: "🔄 Yenile",
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
          text: "📋 Kodu Goster",
          callback_data: buildCallbackData("copy", page, userId)
        }
      ],
      [
        {
          text: "👤 Kullanici Detayi",
          callback_data: buildCallbackData("detail", page, userId)
        }
      ],
      [
        {
          text: "🧩 M3U Ata",
          callback_data: buildCallbackData("packages", page, userId)
        }
      ],
      [
        {
          text: "📚 Listeye Don",
          callback_data: buildCallbackData("pending", page)
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
          text: "🧩 M3U Ata",
          callback_data: buildCallbackData("packages", page, userId)
        }
      ],
      [
        {
          text: "↩️ Kart Gorunumu",
          callback_data: buildCallbackData("select", page, userId)
        }
      ],
      [
        {
          text: "📚 Listeye Don",
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
      text: "↩️ Kullanici Karti",
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
          text: "👤 Kullanici Karti",
          callback_data: buildCallbackData("select", page, userId)
        }
      ],
      [
        {
          text: "📚 Bekleyenler",
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
    "🆕 <b>Bekleyen Kayitlar</b>",
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
    "🆕 <b>Yeni Kayit</b>",
    "",
    `👤 <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `🕒 <b>Tarih:</b> ${escapeHtml(formatDate(snapshot.createdAt))}`,
    `📡 <b>M3U Bagli:</b> <b>${snapshot.hasAssignedLink ? "Evet" : "Hayir"}</b>`,
    `🔐 <b>IPTV Kullanici:</b> <code>${escapeHtml(snapshot.iptvUsername)}</code>`,
    `🎟️ <b>Aktif Paket:</b> <b>${escapeHtml(snapshot.activePackageTitle)}</b>`,
    `⏳ <b>Kalan:</b> <b>${escapeHtml(snapshot.remainingLabel)}</b>`,
    "",
    "Asagidaki butonlardan birini secin."
  ].join("\n");
}

function renderUserDetailText(detail) {
  const snapshot = getUserSnapshot(detail);

  return [
    "👤 <b>Kullanici Detayi</b>",
    "",
    `🆔 <b>User ID:</b> <code>${escapeHtml(snapshot.id)}</code>`,
    `👤 <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `🏷️ <b>Durum:</b> <b>${escapeHtml(formatUserStatus(snapshot.status))}</b>`,
    `🕒 <b>Kayit Tarihi:</b> ${escapeHtml(formatDate(snapshot.createdAt))}`,
    `📡 <b>M3U Bagli:</b> <b>${snapshot.hasAssignedLink ? "Evet" : "Hayir"}</b>`,
    `🔐 <b>IPTV Kullanici:</b> <code>${escapeHtml(snapshot.iptvUsername)}</code>`,
    `🔑 <b>IPTV Sifre:</b> <code>${escapeHtml(snapshot.iptvPassword)}</code>`,
    `🎟️ <b>Aktif Paket:</b> <b>${escapeHtml(snapshot.activePackageTitle)}</b>`,
    `⏳ <b>Kalan Sure:</b> <b>${escapeHtml(snapshot.remainingLabel)}</b>`,
    `🔗 <b>Kaynak URL:</b> <code>${escapeHtml(snapshot.currentSourceUrl ?? "-")}</code>`
  ].join("\n");
}

function renderPackagePickerText(detail) {
  const snapshot = getUserSnapshot(detail);

  return [
    "🧩 <b>M3U Ata</b>",
    "",
    `👤 <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `🕒 <b>Tarih:</b> ${escapeHtml(formatDate(snapshot.createdAt))}`,
    "",
    "Atamak istediginiz paketi secin."
  ].join("\n");
}

function renderPackageListText(packagePayload) {
  const flixifyPackages = new Map(
    (Array.isArray(packagePayload?.items) ? packagePayload.items : []).map((item) => [item.slug, item])
  );

  const lines = ["🧩 <b>Paket Haritasi</b>", ""];
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
  return [
    "📡 <b>Aktif IPTV Kullanici Sayisi</b>",
    "",
    `Canli baglanti: <b>${stats.count}</b>`,
    `Kontrol zamani: ${escapeHtml(formatDate(stats.checkedAt))}`
  ].join("\n");
}

function renderSuccessText(detail, packageConfig, panelLine) {
  const snapshot = getUserSnapshot(detail);

  return [
    "✅ <b>Paket Atandi</b>",
    "",
    `👤 <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `🎟️ <b>Secilen Paket:</b> <b>${escapeHtml(packageConfig.label)}</b>`,
    `🆔 <b>Panel Line ID:</b> <b>${escapeHtml(panelLine.id ?? "-")}</b>`,
    `🔐 <b>IPTV Kullanici:</b> <code>${escapeHtml(panelLine.username ?? snapshot.code)}</code>`,
    `🔑 <b>IPTV Sifre:</b> <code>${escapeHtml(panelLine.password ?? snapshot.code)}</code>`,
    `📅 <b>Bitis:</b> <b>${escapeHtml(formatUnixSeconds(panelLine.exp_date))}</b>`
  ].join("\n");
}

function renderPartialFailureText(detail, packageConfig, panelLine, error) {
  const snapshot = getUserSnapshot(detail);

  return [
    "⚠️ <b>Kismi Hata</b>",
    "",
    "Panelde line acildi fakat Flixify tarafinda atama tamamlanamadi.",
    `👤 <b>Kullanici Kodu:</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `🎟️ <b>Secilen Paket:</b> <b>${escapeHtml(packageConfig.label)}</b>`,
    `🆔 <b>Panel Line ID:</b> <b>${escapeHtml(panelLine.id ?? "-")}</b>`,
    `🔐 <b>IPTV Kullanici:</b> <code>${escapeHtml(panelLine.username ?? "-")}</code>`,
    `🔑 <b>IPTV Sifre:</b> <code>${escapeHtml(panelLine.password ?? "-")}</code>`,
    `❌ <b>Hata:</b> <b>${escapeHtml(normalizeErrorMessage(error))}</b>`,
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
    `❌ <b>Hata</b>\n${escapeHtml(normalizeErrorMessage(error))}`,
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
      "⏳ <b>Paket Ataniyor</b>",
      "",
      `👤 <b>User ID:</b> <code>${escapeHtml(userId)}</code>`,
      `🎟️ <b>Secim:</b> <b>${escapeHtml(packageConfig.label)}</b>`,
      "",
      "Lutfen bekleyin..."
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: buildResultKeyboard(userId, page)
    },
    messageId
  );

  const panelLine = await createPanelLine(detail, packageConfig);

  try {
    await attachM3UCredentials(userId, {
      username: panelLine.username,
      password: panelLine.password
    });
    await activateFlixifySubscription(userId, packageConfig);

    return upsertMessage(
      chatId,
      renderSuccessText(detail, packageConfig, panelLine),
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

async function notifyNewUser(userId) {
  const detail = await getUserDetail(userId);

  await bot.sendMessage(config.telegramAdminId, renderUserCardText(detail), {
    parse_mode: "HTML",
    reply_markup: buildUserCardKeyboard(userId, 1)
  });
}

async function pollNewUsers({ seedOnly = false } = {}) {
  if (notifierTickInFlight) {
    return;
  }

  notifierTickInFlight = true;

  try {
    const items = await listAllPendingUsers();
    const knownIds = new Set(notifierState.knownPendingUserIds);
    const currentIds = dedupeIds(items.map((item) => item?.id));

    if (seedOnly || !notifierState.bootstrapped) {
      notifierState = {
        ...notifierState,
        bootstrapped: true,
        knownPendingUserIds: dedupeIds([...notifierState.knownPendingUserIds, ...currentIds]),
        lastSyncAt: new Date().toISOString()
      };
      await saveNotifierState();
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

    notifierState = {
      ...notifierState,
      bootstrapped: true,
      knownPendingUserIds: dedupeIds([...knownIds, ...currentIds]),
      lastSyncAt: new Date().toISOString()
    };
    await saveNotifierState();
  } catch (error) {
    console.error("telegram-panel-bot notifier poll failed:", normalizeErrorMessage(error));
  } finally {
    notifierTickInFlight = false;
  }
}

async function startNotifier() {
  notifierState = await loadNotifierState();
  await pollNewUsers({ seedOnly: !notifierState.bootstrapped });
  notifierTimer = setInterval(() => {
    void pollNewUsers();
  }, config.newUserPollSeconds * 1000);
}

async function stopNotifier() {
  if (notifierTimer) {
    clearInterval(notifierTimer);
    notifierTimer = null;
  }
}

bot.onText(/\/start$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  const text = [
    "🤖 <b>Flixify Yonetici Botu</b>",
    "",
    "Yeni kayit bildirimleri acik. Kullanicilara buradan paket atayabilirsiniz.",
    "",
    "Komutlar:",
    "/bekleyenler - bekleyen yeni kayitlari listele",
    "/aktif - canli IPTV baglanti sayisini goster",
    "/paketler - bot paket haritasini goster",
    "/help - yardim menusu"
  ].join("\n");

  await bot.sendMessage(message.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/help$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  const text = [
    "📘 <b>Kullanim Akisi</b>",
    "",
    "1. Bot yeni kayit geldiginde size otomatik bildirim yollar.",
    "2. Bildirim kartinda <b>M3U Ata</b> butonuna basin.",
    "3. 24s Test, 1 Ay, 3 Ay, 6 Ay veya 12 Ay secin.",
    "4. Bot reseller panelde line acar ve Flixify kullanicisina baglar.",
    "",
    "Komutlar:",
    "/bekleyenler",
    "/aktif",
    "/aktifler",
    "/paketler",
    "/help"
  ].join("\n");

  await bot.sendMessage(message.chat.id, text, { parse_mode: "HTML" });
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
    const packages = await listFlixifyPackages();
    await bot.sendMessage(message.chat.id, renderPackageListText(packages), {
      parse_mode: "HTML"
    });
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

startNotifier()
  .then(() => {
    console.log("telegram-panel-bot started");
  })
  .catch(async (error) => {
    console.error("telegram-panel-bot failed to start:", normalizeErrorMessage(error));
    await stopNotifier();
    await bot.stopPolling();
    process.exit(1);
  });
