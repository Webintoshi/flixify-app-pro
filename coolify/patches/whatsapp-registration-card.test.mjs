import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { AUDITED_BOT_SOURCE_SHA256, applyWhatsAppRegistrationCardPatch, registrationCardSource, transformWhatsAppRegistrationCardSource } from "./whatsapp-registration-card.mjs";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const formatDate = value => `formatted:${value}`;
const render = vm.runInNewContext(`(${registrationCardSource})`, { getUserSnapshot: detail => detail.snapshot, escapeHtml, formatDate });
const snapshot = { code: "AB12CD34EF56GH78", createdAt: "2026-11-07T12:00:00.000Z", hasAssignedLink: true, iptvUsername: "fixture-provider-user", activePackageTitle: "1 aylık", remainingLabel: "31 gün" };
const sha = value => createHash("sha256").update(value).digest("hex");
const source = (await readFile(new URL("../../scripts/telegram-panel-bot.mjs", import.meta.url), "utf8")).replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
const startAnchor = "function renderUserCardText(detail) {", endAnchor = "\nfunction renderPaymentRequestText(";

test("WhatsApp signup is labelled from its original metadata, not the presence of an internal account code", () => {
  const result = render({ snapshot, registration: { method: "phone_otp", platform: "android_phone", createdAt: snapshot.createdAt } });
  assert.match(result, /Kayıt yöntemi:<\/b> WhatsApp doğrulaması/);
  assert.match(result, /Hesap kodu \(sistem\):<\/b> <code>AB12CD34EF56GH78<\/code>/);
  assert.match(result, /Kayıt platformu:<\/b> Android telefon/);
  assert.match(result, /Kayıt tarihi:<\/b> formatted:2026-11-07T12:00:00.000Z/);
});

test("known legacy code registrations retain an explicit legacy label", () => {
  const result = render({ snapshot, registration: { method: "account_code", platform: "web", createdAt: snapshot.createdAt } });
  assert.match(result, /Kayıt yöntemi:<\/b> Kullanıcı kodu \(eski kayıt\)/);
  assert.match(result, /Kayıt platformu:<\/b> Web \/ PWA/);
});

test("missing provenance stays unknown even after subsequent WhatsApp or Windows logins", () => {
  const result = render({ snapshot, sessions: [{ authMethod: "phone_otp", platform: "windows", createdAt: "2027-01-01T12:00:00.000Z" }] });
  assert.match(result, /Kayıt yöntemi:<\/b> Bilinmiyor \(eski kayıt\)/);
  assert.match(result, /Kayıt platformu:<\/b> Bilinmiyor \(eski kayıt\)/);
  assert.match(result, /formatted:2026-11-07T12:00:00.000Z/);
  assert.doesNotMatch(result, /2027|WhatsApp doğrulaması|Windows/);
});

test("later account-code sessions cannot relabel an original WhatsApp signup or its date", () => {
  const result = render({ snapshot, registration: { method: "phone_otp", platform: "android_tv", createdAt: "2026-11-06T10:30:00.000Z" }, sessions: [{ authMethod: "account_code", platform: "windows", createdAt: "2027-01-01T12:00:00.000Z" }] });
  assert.match(result, /WhatsApp doğrulaması/); assert.match(result, /Android TV/); assert.match(result, /formatted:2026-11-06T10:30:00.000Z/);
  assert.doesNotMatch(result, /Windows|2027|Kullanıcı kodu \(eski kayıt\)/);
});

test("all user-controlled displayed values are HTML-escaped, while unknown metadata cannot inject HTML", () => {
  const injected = Object.fromEntries(["code", "iptvUsername", "activePackageTitle", "remainingLabel"].map(key => [key, '<b>unsafe & "value"</b>']));
  const result = render({ snapshot: { ...snapshot, ...injected }, registration: { method: "<script>phone_otp</script>", platform: "__proto__", createdAt: "<script>date</script>" }, phone: "+905551234567", ip: "192.0.2.15", id: "private-id" });
  assert.doesNotMatch(result, /<b>unsafe|<script>|905551234567|192\.0\.2\.15|private-id/);
  assert.equal((result.match(/&lt;b&gt;unsafe &amp; &quot;value&quot;&lt;\/b&gt;/g) ?? []).length, 4);
  assert.match(result, /Kayıt tarihi:<\/b> Bilinmiyor/); assert.match(result, /Bilinmiyor \(eski kayıt\)/);
});

test("all five known platforms are labelled without changing the existing account and package fields", () => {
  for (const [platform, label] of Object.entries({ web: "Web / PWA", android_tv: "Android TV", android_phone: "Android telefon", macos: "macOS", windows: "Windows" })) {
    const result = render({ snapshot, registration: { method: "phone_otp", platform, createdAt: snapshot.createdAt } });
    assert.ok(result.includes(`<b>Kayıt platformu:</b> ${label}`));
    for (const retained of ["M3U Bagli:</b> <b>Evet</b>", "fixture-provider-user", "1 aylık", "31 gün", "Asagidaki butonlardan birini secin."]) assert.ok(result.includes(retained));
  }
});

test("the exact audited raw formatter is replaced while every callback, snapshot helper and surrounding byte stays unchanged", () => {
  const start = source.indexOf(startAnchor), end = source.indexOf(endAnchor, start), original = source.slice(start, end);
  assert.equal(sha(original), "7f75c4e62a10b28decc16a9eba5a98154549bfb2485d2a1ff4e39c267ba1c2b3");
  const candidate = transformWhatsAppRegistrationCardSource(source, sha(source));
  const newEnd = candidate.indexOf(endAnchor, start);
  assert.equal(candidate.slice(0, start), source.slice(0, start));
  assert.equal(candidate.slice(newEnd), source.slice(end));
  assert.equal(candidate.slice(start, newEnd).slice(registrationCardSource.replaceAll("\n", "\r\n").length), original.slice(original.trimEnd().length));
  assert.doesNotMatch(candidate, /(?<!\r)\n/);
  assert.match(candidate, /getUserSnapshot\(detail\)/);
  const syntax = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: candidate, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("normalized or wrong whole-source hashes, changed formatter bodies, duplicate anchors and repeated patching fail closed", () => {
  assert.throws(() => transformWhatsAppRegistrationCardSource(source, sha(source.replaceAll("\r\n", "\n"))), /source_hash_mismatch/);
  assert.throws(() => transformWhatsAppRegistrationCardSource(source, "bad-hash"), /patch_input_invalid/);
  const changed = source.replace('"Asagidaki butonlardan birini secin."', '"foreign formatter"');
  assert.throws(() => transformWhatsAppRegistrationCardSource(changed, sha(changed)), /formatter_changed/);
  const duplicated = source + `\r\n${startAnchor}\r\n}\r\n`;
  assert.throws(() => transformWhatsAppRegistrationCardSource(duplicated, sha(duplicated)), /anchor_invalid/);
  const patched = transformWhatsAppRegistrationCardSource(source, sha(source));
  assert.throws(() => transformWhatsAppRegistrationCardSource(patched, sha(patched)), /formatter_changed/);
});

test("filesystem application requires the pinned actual raw source and cannot overwrite the source or an existing output", async () => {
  assert.equal(AUDITED_BOT_SOURCE_SHA256, "8146bbfe48be7ac4c053d348d9963181a8715dd2164afb8caaf8e78f0a704a4d");
  const folder = await mkdtemp(path.join(os.tmpdir(), "flixify-registration-card-"));
  const sourcePath = path.join(folder, "source.mjs"), outputPath = path.join(folder, "candidate.mjs");
  try {
    await writeFile(sourcePath, source); await writeFile(outputPath, "preserve existing output");
    await assert.rejects(applyWhatsAppRegistrationCardPatch({ sourcePath, outputPath, expectedSha256: sha(source) }), /audited_source_required/);
    await assert.rejects(applyWhatsAppRegistrationCardPatch({ sourcePath, outputPath: sourcePath, expectedSha256: AUDITED_BOT_SOURCE_SHA256 }), /source_output_must_differ/);
    await assert.rejects(applyWhatsAppRegistrationCardPatch({ sourcePath, outputPath, expectedSha256: AUDITED_BOT_SOURCE_SHA256 }), /source_hash_mismatch/);
    assert.equal(await readFile(sourcePath, "utf8"), source); assert.equal(await readFile(outputPath, "utf8"), "preserve existing output");
  } finally { await rm(folder, { recursive: true, force: true }); }
});
