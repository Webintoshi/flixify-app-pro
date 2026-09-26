import { readFile } from 'node:fs/promises';
import { runProbeSource } from './telegram-panel-bot-probe.mjs';

// This optional delivery test uses only the existing configured private admin chat.
// User codes and detail buttons are replaced with synthetic values before sending.
if (process.argv.length !== 4 || process.argv[3] !== '--deliver-to-configured-admin') {
  console.error('Usage: node telegram-panel-bot-delivery-probe.mjs SOURCE_MJS --deliver-to-configured-admin');
  process.exit(2);
}
const sourcePath = process.argv[2];
const captures = new Map();
let mainKeyboard;
const result = await runProbeSource(await readFile(sourcePath, 'utf8'), sourcePath, {
  emit: () => {},
  onCapture: ({ probe, text, options }) => {
    if (probe === 'user-list:all' || probe === 'search-prompt') captures.set(probe, { text, options });
    if (options?.reply_markup?.keyboard) mainKeyboard ??= options.reply_markup;
  }
});
if (result.failureCount || !captures.has('user-list:all') || !captures.has('search-prompt')) {
  console.log(JSON.stringify({ delivery: 'not-started', probeFailures: result.failureCount }));
  process.exit(1);
}
const token = process.env.TELEGRAM_BOT_TOKEN;
const admin = String(process.env.TELEGRAM_ADMIN_ID || '').split(/[ ,;]+/)[0];
if (!token || !/^-?\d+$/.test(admin)) throw new Error('Configured bot token/admin missing');
async function call(method, payload) {
  const start = Date.now();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
  });
  const body = await response.json();
  console.log(JSON.stringify({ method, http: response.status, ok: body.ok, ms: Date.now() - start,
    ...(body.ok ? {} : { errorCode: body.error_code, entityParseError: String(body.description).includes('parse entities') }) }));
  if (!body.ok) throw new Error('Telegram delivery rejected');
  return body.result;
}
let message;
try {
  const identity = await call('getMe', {});
  if (identity.username !== 'flixifyadmin_bot') throw new Error('Unexpected bot identity');
  const chat = await call('getChat', { chat_id: admin });
  if (String(chat.id) !== admin || chat.type !== 'private') throw new Error('Unexpected configured admin chat');
  message = await call('sendMessage', { chat_id: admin, text: 'Flixify bot bağlantı testi yapılıyor.',
    disable_notification: true, ...(mainKeyboard ? { reply_markup: mainKeyboard } : {}) });
  for (const label of ['user-list:all', 'search-prompt']) {
    const capture = captures.get(label);
    const text = capture.text.replace(/<code>[\s\S]*?<\/code>/g, '<code>TEST0000</code>')
      .replace(/\[<b>[^<]*<\/b>\]/g, '[<b>TEST</b>]');
    const rows = capture.options?.reply_markup?.inline_keyboard;
    const keyboard = rows?.map((row, rowIndex) => row.map((button, columnIndex) => ({
      text: button.callback_data?.startsWith('uview:') ? `Test kullanıcı ${rowIndex + 1}.${columnIndex + 1}` : button.text,
      callback_data: `probe:noop:${rowIndex}:${columnIndex}`
    })));
    await call('editMessageText', { chat_id: admin, message_id: message.message_id, text,
      parse_mode: 'HTML', ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) });
    console.log(JSON.stringify({ deliveryPanel: label, accepted: true }));
  }
  await call('editMessageText', { chat_id: admin, message_id: message.message_id,
    text: '<b>Flixify bot bağlantı testi tamamlandı.</b>\nKullanıcı listesi ve arama ekranı Telegram tarafından kabul edildi.\nMenüyü yenilemek için /start kullanabilirsin.',
    parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
} catch {
  if (message) await call('editMessageText', { chat_id: admin, message_id: message.message_id,
    text: 'Flixify bağlantı testinde bir ekran hatası bulundu. Düzeltme sürüyor.',
    reply_markup: { inline_keyboard: [] } }).catch(() => {});
  console.log(JSON.stringify({ delivery: 'failed' }));
  process.exitCode = 1;
}
