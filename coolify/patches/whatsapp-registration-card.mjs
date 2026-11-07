const registrationCard = function renderUserCardText(detail) {
  const snapshot = getUserSnapshot(detail);
  const registration = detail?.registration;
  const method = registration?.method === "phone_otp" ? "WhatsApp doğrulaması"
    : registration?.method === "account_code" ? "Kullanıcı kodu (eski kayıt)" : "Bilinmiyor (eski kayıt)";
  const platforms = { web: "Web / PWA", android_tv: "Android TV", android_phone: "Android telefon", macos: "macOS", windows: "Windows" };
  const platform = typeof registration?.platform === "string" && Object.prototype.hasOwnProperty.call(platforms, registration.platform)
    ? platforms[registration.platform] : "Bilinmiyor (eski kayıt)";
  const recordedDate = registration?.createdAt ?? snapshot.createdAt;
  const createdAt = typeof recordedDate === "string" && recordedDate.length <= 40 && Number.isFinite(Date.parse(recordedDate))
    ? new Date(recordedDate).toISOString() : null;

  return [
    "\u{1F195} <b>Yeni Kayit</b>",
    "",
    `\u{1F464} <b>Hesap kodu (sistem):</b> <code>${escapeHtml(snapshot.code)}</code>`,
    `<b>Kayıt yöntemi:</b> ${escapeHtml(method)}`,
    `\u{1F552} <b>Kayıt tarihi:</b> ${escapeHtml(createdAt ? formatDate(createdAt) : "Bilinmiyor")}`,
    `<b>Kayıt platformu:</b> ${escapeHtml(platform)}`,
    `\u{1F4E1} <b>M3U Bagli:</b> <b>${snapshot.hasAssignedLink ? "Evet" : "Hayir"}</b>`,
    `\u{1F510} <b>IPTV Kullanici:</b> <code>${escapeHtml(snapshot.iptvUsername)}</code>`,
    `\u{1F39F}\u{FE0F} <b>Aktif Paket:</b> <b>${escapeHtml(snapshot.activePackageTitle)}</b>`,
    `\u{23F3} <b>Kalan:</b> <b>${escapeHtml(snapshot.remainingLabel)}</b>`,
    "",
    "Asagidaki butonlardan birini secin."
  ].join("\n");
};

export const registrationCardSource = registrationCard.toString();
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AUDITED_BOT_SOURCE_SHA256 = "8146bbfe48be7ac4c053d348d9963181a8715dd2164afb8caaf8e78f0a704a4d";
const AUDITED_FORMATTER_SHA256 = "21d1fda7b73de83598936374b750b884b9a5c90ff4119d4a7f472a611a27ba92";
const sha = value => createHash("sha256").update(value).digest("hex");


export function transformWhatsAppRegistrationCardSource(source, expectedSha256) {
  if (typeof source !== "string" || typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("registration_card_patch_input_invalid");
  if (sha(source) !== expectedSha256) throw new Error("registration_card_source_hash_mismatch");
  const startAnchor = "function renderUserCardText(detail) {", endAnchor = "\nfunction renderPaymentRequestText(";
  if (source.split(startAnchor).length !== 2 || source.split(endAnchor).length !== 2) throw new Error("registration_card_anchor_invalid");
  const start = source.indexOf(startAnchor), end = source.indexOf(endAnchor, start);
  if (end <= start) throw new Error("registration_card_anchor_invalid");
  const original = source.slice(start, end), body = original.trimEnd();
  if (sha(body.replaceAll("\r\n", "\n")) !== AUDITED_FORMATTER_SHA256) throw new Error("registration_card_formatter_changed");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  return source.slice(0, start) + registrationCardSource.replaceAll("\n", eol) + original.slice(body.length) + source.slice(end);
}

export async function applyWhatsAppRegistrationCardPatch({ sourcePath, outputPath, expectedSha256 }) {
  if (expectedSha256 !== AUDITED_BOT_SOURCE_SHA256) throw new Error("registration_card_audited_source_required");
  if (path.resolve(sourcePath) === path.resolve(outputPath)) throw new Error("registration_card_source_output_must_differ");
  const source = await readFile(sourcePath, "utf8"), output = transformWhatsAppRegistrationCardSource(source, expectedSha256);
  await writeFile(outputPath, output, { flag: "wx", mode: 0o600 });
  return { sourceSha256: expectedSha256, outputSha256: sha(output) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [sourcePath, outputPath, expectedSha256, ...extra] = process.argv.slice(2);
  if (!sourcePath || !outputPath || !expectedSha256 || extra.length) {
    console.error("Usage: whatsapp-registration-card.mjs SOURCE_MJS OUTPUT_MJS EXPECTED_RAW_SHA256"); process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await applyWhatsAppRegistrationCardPatch({ sourcePath, outputPath, expectedSha256 }))); }
    catch (error) { console.error(error?.code === "EEXIST" ? "registration_card_output_exists" : /^registration_card_[a-z_]+$/.test(error?.message || "") ? error.message : "registration_card_patch_failed"); process.exitCode = 1; }
  }
}
