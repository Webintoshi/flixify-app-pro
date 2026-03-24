#!/usr/bin/env node
import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";

const DEFAULT_FLIXIFY_API_BASE_URL = "http://localhost:4000";
const DEFAULT_PENDING_PAGE_SIZE = 6;
const CALLBACK_MAX_LENGTH = 64;

const config = loadConfig();
const bot = new TelegramBot(config.telegramBotToken, { polling: true });
let cachedAdminSession = config.flixifyAdminAccessToken
  ? {
      accessToken: config.flixifyAdminAccessToken,
      expiresAt: Number.POSITIVE_INFINITY
    }
  : null;

function normalizeBaseUrl(value, fallback = null) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : fallback;
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
  const allowReassign = parseBoolean(process.env.TELEGRAM_ALLOW_REASSIGN, false);
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
    allowReassign,
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

function buildCallbackData(...parts) {
  const data = parts.join(":");
  if (data.length > CALLBACK_MAX_LENGTH) {
    throw new Error(`Callback data is too long: ${data}`);
  }
  return data;
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

async function resellerRequest(action, payload = {}) {
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

  return parsed.data;
}

async function listPendingUsers(page = 1) {
  return flixifyRequest("/admin/users", {
    query: {
      page,
      pageSize: config.pendingPageSize,
      status: "new",
      m3u: "unassigned"
    }
  });
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

async function createPanelLine(userDetail, packageConfig) {
  const codeSuffix = userDetail.summary.codeSuffix ? ` code:${userDetail.summary.codeSuffix}` : "";
  return resellerRequest("create_line", {
    package: packageConfig.resellerPackageId,
    trial: packageConfig.resellerTrial,
    reseller_notes: `Flixify user:${userDetail.summary.id}${codeSuffix}`
  });
}

function buildPendingKeyboard(items, page, total) {
  const rows = items.map((item) => [
    {
      text: `${item.codeSuffix ?? "----"} | ${item.status}`,
      callback_data: buildCallbackData("select", page, item.id)
    }
  ]);

  const totalPages = Math.max(1, Math.ceil(total / config.pendingPageSize));
  const navRow = [];

  if (page > 1) {
    navRow.push({
      text: "Geri",
      callback_data: buildCallbackData("pending", page - 1)
    });
  }
  if (page < totalPages) {
    navRow.push({
      text: "Ileri",
      callback_data: buildCallbackData("pending", page + 1)
    });
  }
  navRow.push({
    text: "Yenile",
    callback_data: buildCallbackData("pending", page)
  });

  if (navRow.length > 0) {
    rows.push(navRow);
  }

  return {
    inline_keyboard: rows
  };
}

function buildActionKeyboard(userId, page) {
  const rows = [];
  for (let index = 0; index < config.packageMap.length; index += 2) {
    const slice = config.packageMap.slice(index, index + 2).map((item) => ({
      text: item.label,
      callback_data: buildCallbackData("assign", item.key, page, userId)
    }));
    rows.push(slice);
  }

  rows.push([
    {
      text: "Listeye don",
      callback_data: buildCallbackData("pending", page)
    }
  ]);

  return {
    inline_keyboard: rows
  };
}

function renderPendingUsersText(payload) {
  const lines = [
    "<b>Bekleyen kullanicilar</b>",
    `Toplam: <b>${payload.total}</b>`,
    `Sayfa: <b>${payload.page}</b>`,
    ""
  ];

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    lines.push("Bekleyen kayit yok.");
    return lines.join("\n");
  }

  payload.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. <b>${escapeHtml(item.codeSuffix ?? "----")}</b> | ${escapeHtml(item.status)} | ${formatDate(item.createdAt)}`
    );
  });

  lines.push("");
  lines.push("Bir kullanici secmek icin asagidaki butonlari kullanin.");
  return lines.join("\n");
}

function renderUserDetailText(detail) {
  const packageTitle = detail.summary.activePackage?.title ?? "-";
  const remainingDays =
    detail.summary.activePackage && Number.isFinite(detail.summary.activePackage.remainingDays)
      ? `${detail.summary.activePackage.remainingDays} gun`
      : "-";

  return [
    "<b>Kullanici secildi</b>",
    `Kod: <b>${escapeHtml(detail.summary.kryptoniteCode ?? detail.summary.codeSuffix ?? "----")}</b>`,
    `User ID: <code>${escapeHtml(detail.summary.id)}</code>`,
    `Durum: <b>${escapeHtml(detail.summary.status)}</b>`,
    `Kayit: ${formatDate(detail.summary.createdAt)}`,
    `M3U bagli: <b>${detail.summary.hasAssignedLink ? "evet" : "hayir"}</b>`,
    `IPTV kullanici: <b>${escapeHtml(detail.iptvUsername ?? "-")}</b>`,
    `Aktif paket: <b>${escapeHtml(packageTitle)}</b>`,
    `Kalan: <b>${escapeHtml(remainingDays)}</b>`,
    "",
    "Asagidaki butonlardan birini secin."
  ].join("\n");
}

function renderPackageListText(packagePayload) {
  const flixifyPackages = new Map(
    (Array.isArray(packagePayload?.items) ? packagePayload.items : []).map((item) => [item.slug, item])
  );

  const lines = ["<b>Bot paket haritasi</b>", ""];
  config.packageMap.forEach((item) => {
    const internalPackage = item.flixifyPackageSlug ? flixifyPackages.get(item.flixifyPackageSlug) : null;
    lines.push(`<b>${escapeHtml(item.label)}</b>`);
    lines.push(`- Reseller package: ${item.resellerPackageId} | trial=${item.resellerTrial}`);
    lines.push(
      `- Flixify: ${
        item.flixifyMode === "test-24h"
          ? "test-24h route"
          : escapeHtml(item.flixifyPackageSlug ?? "-")
      }${internalPackage ? ` (${escapeHtml(internalPackage.title)})` : ""}`
    );
    lines.push("");
  });
  return lines.join("\n").trim();
}

function renderSuccessText(detail, packageConfig, panelLine) {
  return [
    "<b>Atama tamamlandi</b>",
    `Kullanici: <code>${escapeHtml(detail.summary.id)}</code>`,
    `Kod: <b>${escapeHtml(detail.summary.codeSuffix ?? "----")}</b>`,
    `Secim: <b>${escapeHtml(packageConfig.label)}</b>`,
    `Panel line ID: <b>${escapeHtml(panelLine.id ?? "-")}</b>`,
    `IPTV user: <code>${escapeHtml(panelLine.username ?? "-")}</code>`,
    `IPTV pass: <code>${escapeHtml(panelLine.password ?? "-")}</code>`,
    `Bitis: <b>${escapeHtml(formatUnixSeconds(panelLine.exp_date))}</b>`
  ].join("\n");
}

function renderPartialFailureText(detail, packageConfig, panelLine, error) {
  return [
    "<b>Kismi hata</b>",
    "Panelde line acildi ama Flixify akisi tamamlanamadi.",
    `Kullanici: <code>${escapeHtml(detail.summary.id)}</code>`,
    `Secim: <b>${escapeHtml(packageConfig.label)}</b>`,
    `Panel line ID: <b>${escapeHtml(panelLine.id ?? "-")}</b>`,
    `IPTV user: <code>${escapeHtml(panelLine.username ?? "-")}</code>`,
    `IPTV pass: <code>${escapeHtml(panelLine.password ?? "-")}</code>`,
    `Hata: <b>${escapeHtml(normalizeErrorMessage(error))}</b>`,
    "",
    "Manuel kontrol gerekebilir."
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
      reply_markup: buildPendingKeyboard(payload.items, payload.page, payload.total)
    },
    messageId
  );
}

async function showUserActions(chatId, userId, page, messageId = null) {
  const detail = await getUserDetail(userId);
  const text = renderUserDetailText(detail);

  return upsertMessage(
    chatId,
    text,
    {
      parse_mode: "HTML",
      reply_markup: buildActionKeyboard(userId, page)
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
    `<b>Islem basladi</b>\nKullanici: <code>${escapeHtml(userId)}</code>\nSecim: <b>${escapeHtml(packageConfig.label)}</b>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Listeye don", callback_data: buildCallbackData("pending", page) }]]
      }
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
        reply_markup: {
          inline_keyboard: [
            [{ text: "Listeye don", callback_data: buildCallbackData("pending", page) }],
            [{ text: "Ayni kullanici", callback_data: buildCallbackData("select", page, userId) }]
          ]
        }
      },
      messageId
    );
  } catch (error) {
    return upsertMessage(
      chatId,
      renderPartialFailureText(detail, packageConfig, panelLine, error),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Listeye don", callback_data: buildCallbackData("pending", page) }],
            [{ text: "Ayni kullanici", callback_data: buildCallbackData("select", page, userId) }]
          ]
        }
      },
      messageId
    );
  }
}

bot.onText(/\/start$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  const text = [
    "<b>Flixify Panel Bot</b>",
    "",
    "/bekleyenler - yeni ve M3U atanmamis kullanicilari listele",
    "/paketler - botun paket haritasini goster",
    "/help - yardim"
  ].join("\n");

  await bot.sendMessage(message.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/help$/, async (message) => {
  if (!(await authorizeMessage(message))) {
    return;
  }

  const text = [
    "<b>Komutlar</b>",
    "",
    "/bekleyenler",
    "/paketler",
    "/help",
    "",
    "Akis:",
    "1. /bekleyenler",
    "2. kullaniciyi sec",
    "3. test veya paket dugmesine bas"
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
      await showUserActions(chatId, userId, page, messageId);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith("assign:")) {
      const [, packageKey, pageRaw, userId] = data.split(":");
      const page = parsePositiveInt(pageRaw, 1);
      await bot.answerCallbackQuery(query.id, {
        text: "Atama baslatildi."
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
    await upsertMessage(
      chatId,
      `<b>Hata</b>\n${escapeHtml(normalizeErrorMessage(error))}`,
      {
        parse_mode: "HTML"
      },
      messageId
    );
  }
});

bot.on("polling_error", (error) => {
  console.error("telegram-panel-bot polling error:", error?.message ?? error);
});

process.on("SIGINT", async () => {
  await bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await bot.stopPolling();
  process.exit(0);
});

console.log("telegram-panel-bot started");
