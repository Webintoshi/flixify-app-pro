const DEFAULT_TELEGRAM_BOT_TOKEN = "8841617501:AAHFk3-ab89KqL1xZKXAWGuu0Lokrgc0x4Q";
const DEFAULT_TELEGRAM_ADMIN_ID = "8217846714";

export interface TrialRequestNotificationPayload {
  userCode: string | null;
  userId: string;
  note?: string | null;
  createdAt?: string | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul"
  }).format(date);
}

export async function sendTelegramTrialRequestNotification(payload: TrialRequestNotificationPayload): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || DEFAULT_TELEGRAM_BOT_TOKEN;
  const rawAdminId = process.env.TELEGRAM_ADMIN_ID?.trim() || DEFAULT_TELEGRAM_ADMIN_ID;

  if (!botToken || !rawAdminId) {
    console.warn("[telegram-notifier] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_ID not configured.");
    return false;
  }

  const adminIds = rawAdminId
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (adminIds.length === 0) {
    return false;
  }

  const displayCode = payload.userCode ? payload.userCode.trim() : "Bilinmiyor";
  const displayNote = payload.note?.trim() || "Not eklenmedi";
  const displayDate = formatDate(payload.createdAt);

  const messageText = [
    "⚡ <b>YENİ DENEME (TEST) TALEBİ!</b>",
    "",
    `👤 <b>Kullanıcı Kodu:</b> <code>${escapeHtml(displayCode)}</code>`,
    `🆔 <b>User ID:</b> <code>${escapeHtml(payload.userId)}</code>`,
    `📝 <b>Not:</b> <i>${escapeHtml(displayNote)}</i>`,
    `📅 <b>Tarih:</b> ${escapeHtml(displayDate)}`,
    "",
    "🔗 <b>Yönetim Paneli:</b> https://flixify.vip/admin/dashboard"
  ].join("\n");

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "🌐 Yönetim Panelinde Aç",
          url: "https://flixify.vip/admin/dashboard"
        }
      ]
    ]
  };

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  let anySuccess = false;

  for (const adminId of adminIds) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: adminId,
          text: messageText,
          parse_mode: "HTML",
          reply_markup: replyMarkup
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[telegram-notifier] Failed to send trial alert to admin ${adminId}: HTTP ${response.status} - ${errorText}`);
      } else {
        anySuccess = true;
        console.log(`[telegram-notifier] Successfully sent trial request alert to admin ${adminId} for user ${displayCode}`);
      }
    } catch (error) {
      console.error(`[telegram-notifier] Network error sending trial alert to admin ${adminId}:`, error);
    }
  }

  return anySuccess;
}
