#!/usr/bin/env node
/**
 * Telegram VS Code Yönetim Botu
 * 
 * Özellikler:
 * - /status - Sistem durumu
 * - /code - VS Code linki gönder
 * - /exec <komut> - Terminal komutu çalıştır
 * - /logs <servis> - Logları göster
 * - /git <komut> - Git işlemleri
 * - /dev - Dev server kontrolü
 * - /restart - Servis yeniden başlat
 * 
 * Kurulum:
 * 1. npm install node-telegram-bot-api
 * 2. .env dosyasına TELEGRAM_BOT_TOKEN ve TELEGRAM_ADMIN_ID ekle
 * 3. npm install -g code-server (opsiyonel)
 * 4. node scripts/telegram-vscode.mjs
 */

import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execAsync = promisify(exec);

// Config
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;
const PROJECT_ROOT = join(__dirname, '..');
const CODESERVER_PORT = process.env.CODESERVER_PORT || '8080';
const CODESERVER_AUTH = process.env.CODESERVER_AUTH || 'password';

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN eksik! .env dosyasına ekleyin.');
  process.exit(1);
}

if (!ADMIN_ID) {
  console.error('❌ TELEGRAM_ADMIN_ID eksik! .env dosyasına ekleyin.');
  console.error('   Telegram ID\'nizi öğrenmek için @userinfobot\'a yazın.');
  process.exit(1);
}

// Bot oluştur
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Yetkilendirme kontrolü
const isAuthorized = (userId) => userId.toString() === ADMIN_ID.toString();

// Güvenli komut çalıştırma
async function safeExec(command, timeout = 30000) {
  try {
    const { stdout, stderr } = await execAsync(command, { 
      cwd: PROJECT_ROOT,
      timeout,
      maxBuffer: 1024 * 1024 // 1MB
    });
    return { success: true, output: stdout || stderr };
  } catch (error) {
    return { success: false, error: error.message, output: error.stdout || error.stderr };
  }
}

// Uzun komut çalıştırma (stream)
function execStream(command, chatId) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' }
    });
    
    let output = '';
    const maxLength = 4000;
    
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      if (output.length > maxLength) {
        output = output.slice(-maxLength);
      }
    });
    
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      if (output.length > maxLength) {
        output = output.slice(-maxLength);
      }
    });
    
    child.on('close', (code) => {
      resolve({ 
        success: code === 0, 
        output: output || 'Komut tamamlandı (çıktı yok)',
        code 
      });
    });
    
    // 2 dakika timeout
    setTimeout(() => {
      child.kill();
      resolve({ success: false, output: output + '\n\n⏱️ Timeout (120s)' });
    }, 120000);
  });
}

// ==================== KOMUTLAR ====================

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) {
    return bot.sendMessage(chatId, '⛔ Yetkisiz erişim!');
  }
  
  const welcome = `
🚀 *Flixify VS Code Yönetim Botu*

*🔧 Terminal & Sistem:*
📊 /status - Sistem durumu
⚡ /exec <komut> - Terminal komutu
📋 /logs <servis> - Logları göster
▶️ /dev - Dev server kontrolü
🔄 /restart <servis> - Yeniden başlat

*💻 VS Code & Eklentiler:*
🌐 /code - VS Code linki
🎯 /vscode <komut> - VS Code komutu
🤖 /ask <soru> - AI asistan (Codex/Copilot)
🤖 /codex <prompt> - OpenAI Codex CLI
🤖 /copilot <prompt> - GitHub Copilot Chat
📦 /extensions - Yüklü eklentiler
⬇️ /install <id> - Eklenti kur

*📁 Dosya & Git:*
📁 /read <dosya> - Dosya oku
✏️ /edit <dosya> <içerik> - Dosya düzenle
🔀 /git <komut> - Git işlemi

*❓ Yardım:*
❓ /help - Detaylı yardım

💡 *İpucu:* Dosya yolları "/apps/api/src/index.ts" formatında olmalı.
  `;
  
  bot.sendMessage(chatId, welcome, { parse_mode: 'Markdown' });
});

// /help
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const help = `
*🔧 Terminal & Sistem Komutları:*

📊 */status* - Disk, RAM, Node.js versiyonu, aktif servisler

⚡ */exec <komut>* - Terminal komutu çalıştır
   \`/exec npm run test\`
   \`/exec ls -la apps/\`

📋 */logs <servis>* - Logları göster
   Servisler: api, worker, all
   \`/logs api\`

▶️ */dev [start|stop|status]* - Dev server kontrolü

🔄 */restart <servis>* - Servis yeniden başlat
   Servisler: api, worker

*🤖 AI Asistan & VS Code Eklentileri:*

🤖 */ask <soru>* - AI asistan ile sohbet (Codex/Copilot)
   \`/ask Create a login API endpoint\`
   \`/ask Refactor this to use TypeScript\`

🤖 */codex <prompt>* - OpenAI Codex CLI
   \`/codex apps/api/src/auth.ts Add JWT middleware\`
   \`/codex Create React component for user profile\`

🤖 */copilot <prompt>* - GitHub Copilot Chat
   \`/copilot Explain this code\`
   \`/copilot Optimize this function\`

🎯 */vscode <komut>* - VS Code komutu çalıştır
   \`/vscode workbench.action.files.newUntitledFile\`
   \`/vscode workbench.action.terminal.toggleTerminal\`
   \`/vscode git.sync\`
   \`/vscode editor.action.formatDocument\`

📦 */extensions* - Yüklü eklentileri listele
⬇️ */install <id>* - Eklenti kur
   \`/install github.copilot-chat\`
   \`/install ms-vscode.vscode-typescript-next\`

*📁 Dosya & Git:*

📁 */read <dosya>* - Dosya içeriğini oku
   \`/read package.json\`

✏️ */edit <dosya> <içerik>* - Dosya düzenle
   \`/edit .env KEY=value\`

🔀 */git <komut>* - Git işlemleri
   \`/git status\`
   \`/git pull origin main\`
  `;
  
  bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
});

// /status
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const statusMsg = await bot.sendMessage(chatId, '⏳ Durum kontrol ediliyor...');
  
  try {
    // Sistem bilgisi
    const { output: diskOutput } = await safeExec('df -h .');
    const diskLine = diskOutput.split('\n')[1];
    const diskUsage = diskLine ? diskLine.split(/\s+/)[4] : 'N/A';
    
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
    const usedMem = (totalMem - freeMem).toFixed(2);
    
    const { output: nodeVersion } = await safeExec('node --version');
    
    // Aktif servisler
    const { output: psOutput } = await safeExec('ps aux | grep -E "(npm|node)" | grep -v grep | head -10');
    const services = psOutput.split('\n').filter(Boolean).map(line => {
      const parts = line.split(/\s+/);
      return parts.slice(10).join(' ').substring(0, 40);
    }).filter(Boolean);
    
    // code-server durumu
    const { output: csOutput } = await safeExec('pgrep -f "code-server" || echo "Kapalı"');
    const codeServerStatus = csOutput.includes('Kapalı') ? '🔴 Kapalı' : '🟢 Çalışıyor';
    
    const message = `
📊 *Sistem Durumu*

💾 *Disk:* ${diskUsage} kullanımda
🧠 *RAM:* ${usedMem}GB / ${totalMem}GB
⚙️ *Node.js:* ${nodeVersion.trim()}
💻 *VS Code Server:* ${codeServerStatus}

🔄 *Aktif Servisler:*
${services.length > 0 ? services.map(s => `  • ${s}`).join('\n') : '  • Aktif servis yok'}
    `;
    
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    bot.editMessageText(`❌ Hata: ${error.message}`, {
      chat_id: chatId,
      message_id: statusMsg.message_id
    });
  }
});

// /code - VS Code linki
bot.onText(/\/code/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const msg_wait = await bot.sendMessage(chatId, '🔍 code-server kontrol ediliyor...');
  
  // code-server kurulu mu?
  const { output: whichOutput } = await safeExec('which code-server');
  
  if (!whichOutput.includes('code-server')) {
    const installMsg = `
❌ *code-server kurulu değil*

Kurulum için:
\`\`\`bash
# macOS
brew install code-server

# Linux
curl -fsSL https://code-server.dev/install.sh | sh
\`\`\`

Kurulumdan sonra:
\`\`\`bash
# Şifre ile başlat
code-server --auth password --bind-addr 0.0.0.0:${CODESERVER_PORT}

# .env dosyasına şifre ekle:
# CODESERVER_PASSWORD=guclu_sifre
\`\`\`
    `;
    return bot.editMessageText(installMsg, {
      chat_id: chatId,
      message_id: msg_wait.message_id,
      parse_mode: 'Markdown'
    });
  }
  
  // code-server çalışıyor mu?
  const { output: pgrepOutput } = await safeExec('pgrep -f "code-server" || echo ""');
  
  if (!pgrepOutput.trim()) {
    // Başlat
    await safeExec(`code-server --auth ${CODESERVER_AUTH} --bind-addr 0.0.0.0:${CODESERVER_PORT} &`);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Cloudflare Tunnel veya ngrok var mı?
  const { output: tunnelOutput } = await safeExec('pgrep -f "(cloudflared|ngrok)" || echo ""');
  
  let linkMessage;
  if (tunnelOutput.trim()) {
    // Public link var
    linkMessage = `
🌐 *VS Code Server*

✅ code-server çalışıyor!

🔗 *Yerel:* http://localhost:${CODESERVER_PORT}
🔓 *Şifre:* ${process.env.CODESERVER_PASSWORD || 'Yok (güvensiz)'}

💡 Cloudflare Tunnel/ngrok aktif. Public link için:
   cloudflared tunnel list
    `;
  } else {
    // Yerel link
    const { output: ipOutput } = await safeExec('hostname -I || echo "127.0.0.1"');
    const localIp = ipOutput.trim().split(' ')[0];
    
    linkMessage = `
🌐 *VS Code Server*

✅ code-server çalışıyor!

🔗 *Yerel:* http://${localIp}:${CODESERVER_PORT}
🔗 *Localhost:* http://localhost:${CODESERVER_PORT}
🔓 *Şifre:* ${process.env.CODESERVER_PASSWORD || 'Yok (güvensiz)'}

💡 Public erişim için Cloudflare Tunnel:
\`\`\`bash
# Kurulum
brew install cloudflared  # macOS
# veya
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared

# Tunnel oluştur
cloudflared tunnel create vscode

# Config
cloudflared tunnel route dns vscode vscode.sizinalaniniz.com

# Başlat
cloudflared tunnel run vscode
\`\`\`
    `;
  }
  
  bot.editMessageText(linkMessage, {
    chat_id: chatId,
    message_id: msg_wait.message_id,
    parse_mode: 'Markdown'
  });
});

// /exec <komut>
bot.onText(/\/exec (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const command = match[1];
  
  // Güvenlik kontrolü
  const dangerousCommands = ['rm -rf /', 'mkfs', 'dd if=/dev/zero', '>:dev>null'];
  if (dangerousCommands.some(cmd => command.includes(cmd))) {
    return bot.sendMessage(chatId, '⛔ Tehlikeli komut engellendi!');
  }
  
  const execMsg = await bot.sendMessage(chatId, `⏳ Çalıştırılıyor: ${command}`);
  
  const result = await execStream(command, chatId);
  
  const output = result.output.substring(0, 4000);
  const status = result.success ? '✅' : '❌';
  
  bot.editMessageText(`${status} *Komut:* \`${command}\`\n\n\`\`\`\n${output}\n\`\`\``, {
    chat_id: chatId,
    message_id: execMsg.message_id,
    parse_mode: 'Markdown'
  });
});

// /logs <servis>
bot.onText(/\/logs(?:\s+(\w+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const service = match[1] || 'all';
  const validServices = ['api', 'worker', 'all'];
  
  if (!validServices.includes(service)) {
    return bot.sendMessage(chatId, `❌ Geçersiz servis: ${service}\nKullanılabilir: ${validServices.join(', ')}`);
  }
  
  const logMsg = await bot.sendMessage(chatId, `📋 ${service} logları alınıyor...`);
  
  let command;
  switch (service) {
    case 'api':
      command = 'tail -50 logs/api.log 2>/dev/null || pm2 logs api --lines 50 --nostream || echo "Log bulunamadı"';
      break;
    case 'worker':
      command = 'tail -50 logs/worker.log 2>/dev/null || pm2 logs worker --lines 50 --nostream || echo "Log bulunamadı"';
      break;
    case 'all':
      command = 'ps aux | grep -E "(npm|node)" | grep -v grep | head -20';
      break;
  }
  
  const result = await safeExec(command);
  const output = (result.output || result.error || 'Log bulunamadı').substring(0, 4000);
  
  bot.editMessageText(`📋 *${service.toUpperCase()} Logs*\n\n\`\`\`\n${output}\n\`\`\``, {
    chat_id: chatId,
    message_id: logMsg.message_id,
    parse_mode: 'Markdown'
  });
});

// /git <komut>
bot.onText(/\/git (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const gitCommand = match[1];
  
  // Güvenlik kontrolü
  if (gitCommand.includes('push --force') || gitCommand.includes('reset --hard')) {
    const warningMsg = await bot.sendMessage(chatId, '⚠️ *Tehlikeli Git Komutu!*\n\nBu komut veri kaybına neden olabilir. Onaylıyor musunuz?', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Evet', callback_data: `git_confirm:${gitCommand}` },
          { text: '❌ Hayır', callback_data: 'git_cancel' }
        ]]
      }
    });
    return;
  }
  
  const gitMsg = await bot.sendMessage(chatId, `🔀 git ${gitCommand} çalıştırılıyor...`);
  
  const result = await safeExec(`git ${gitCommand}`);
  const output = (result.output || result.error).substring(0, 4000);
  const status = result.success ? '✅' : '❌';
  
  bot.editMessageText(`${status} *git ${gitCommand}*\n\n\`\`\`\n${output}\n\`\`\``, {
    chat_id: chatId,
    message_id: gitMsg.message_id,
    parse_mode: 'Markdown'
  });
});

// Callback queries (buton tıklamaları)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const data = query.data;
  
  if (data.startsWith('git_confirm:')) {
    const gitCommand = data.replace('git_confirm:', '');
    bot.editMessageText(`🔀 git ${gitCommand} çalıştırılıyor...`, {
      chat_id: chatId,
      message_id: query.message.message_id
    });
    
    const result = await safeExec(`git ${gitCommand}`);
    const output = (result.output || result.error).substring(0, 4000);
    const status = result.success ? '✅' : '❌';
    
    bot.editMessageText(`${status} *git ${gitCommand}*\n\n\`\`\`\n${output}\n\`\`\``, {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });
  } else if (data === 'git_cancel') {
    bot.editMessageText('❌ Git komutu iptal edildi.', {
      chat_id: chatId,
      message_id: query.message.message_id
    });
  }
  
  bot.answerCallbackQuery(query.id);
});

// /dev - Dev server kontrolü
bot.onText(/\/dev(?:\s+(\w+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const action = match[1] || 'status';
  
  if (action === 'status') {
    const statusMsg = await bot.sendMessage(chatId, '⏳ Dev server durumu kontrol ediliyor...');
    
    const { output } = await safeExec('ps aux | grep -E "npm run dev|node scripts/dev" | grep -v grep');
    const isRunning = output.includes('dev');
    
    const message = isRunning 
      ? '🟢 *Dev server çalışıyor*\n\n```\n' + output.substring(0, 500) + '\n```'
      : '🔴 *Dev server kapalı*\n\nBaşlatmak için: /dev start';
    
    bot.editMessageText(message, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  } else if (action === 'start') {
    const startMsg = await bot.sendMessage(chatId, '🚀 Dev server başlatılıyor... (Arka planda çalışacak)');
    
    // Arka planda başlat
    const child = spawn('npm', ['run', 'dev'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    
    await new Promise(r => setTimeout(r, 3000));
    
    bot.editMessageText('✅ *Dev server başlatıldı!*\n\nLogları görmek için: /logs all', {
      chat_id: chatId,
      message_id: startMsg.message_id,
      parse_mode: 'Markdown'
    });
  } else if (action === 'stop') {
    const stopMsg = await bot.sendMessage(chatId, '🛑 Dev server durduruluyor...');
    
    await safeExec('pkill -f "npm run dev" || true');
    await safeExec('pkill -f "node scripts/dev" || true');
    
    bot.editMessageText('🛑 *Dev server durduruldu!*', {
      chat_id: chatId,
      message_id: stopMsg.message_id,
      parse_mode: 'Markdown'
    });
  }
});

// /restart <servis>
bot.onText(/\/restart(?:\s+(\w+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const service = match[1];
  const validServices = ['api', 'worker'];
  
  if (!service) {
    return bot.sendMessage(chatId, `Kullanım: /restart <servis>\nServisler: ${validServices.join(', ')}`);
  }
  
  if (!validServices.includes(service)) {
    return bot.sendMessage(chatId, `❌ Geçersiz servis: ${service}`);
  }
  
  const restartMsg = await bot.sendMessage(chatId, `🔄 ${service} yeniden başlatılıyor...`);
  
  // PM2 ile çalışıyorsa
  const { output: pm2Output } = await safeExec(`pm2 restart ${service} 2>&1 || echo "PM2 yok"`);
  
  if (pm2Output.includes('PM2 yok')) {
    // Manuel yeniden başlat
    await safeExec(`pkill -f "${service}" || true`);
    await new Promise(r => setTimeout(r, 1000));
    
    const scriptMap = {
      api: 'dev:api',
      worker: 'dev:worker'
    };
    
    const child = spawn('npm', ['run', scriptMap[service]], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
  }
  
  bot.editMessageText(`✅ *${service}* yeniden başlatıldı!`, {
    chat_id: chatId,
    message_id: restartMsg.message_id,
    parse_mode: 'Markdown'
  });
});

// /read <dosya>
bot.onText(/\/read (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const filePath = match[1];
  const fullPath = join(PROJECT_ROOT, filePath);
  
  // Güvenlik: Proje dışına çıkma
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return bot.sendMessage(chatId, '⛔ Proje dışı erişim engellendi!');
  }
  
  try {
    const content = await readFile(fullPath, 'utf-8');
    const truncated = content.substring(0, 4000);
    const suffix = content.length > 4000 ? '\n\n... (devamı var)' : '';
    
    bot.sendMessage(chatId, `📁 *${filePath}*\n\n\`\`\`${filePath.split('.').pop()}\n${truncated}${suffix}\n\`\`\``, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Dosya okunamadı: ${error.message}`);
  }
});

// ==================== VS CODE EKLENTİ KOMUTLARI ====================

// VS Code CLI aracılığıyla komut çalıştırma
async function runVSCodeCommand(command, args = []) {
  try {
    const { output: codePath } = await safeExec('which code || echo ""');
    if (!codePath.trim()) {
      return { success: false, error: 'VS Code CLI (code) bulunamadı. "Shell Command: Install code command in PATH" çalıştırın.' };
    }
    const cmd = `code ${command} ${args.join(' ')}`;
    return await safeExec(cmd);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Extension kontrolü
async function isExtensionInstalled(extensionId) {
  const result = await safeExec(`code --list-extensions | grep -i "${extensionId}" || echo ""`);
  return result.output.trim().length > 0;
}

// /copilot <prompt> - GitHub Copilot Chat
bot.onText(/\/copilot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const prompt = match[1];
  const msg_wait = await bot.sendMessage(chatId, '🤖 Copilot\'a gönderiliyor...');
  
  // Copilot Chat extension ID'si
  const copilotInstalled = await isExtensionInstalled('github.copilot-chat');
  if (!copilotInstalled) {
    return bot.editMessageText('❌ *GitHub Copilot Chat* kurulu değil!\n\nKurulum:\n1. VS Code açın\n2. Extensions (Ctrl+Shift+X)\n3. "GitHub Copilot Chat" arayın\n4. Install', {
      chat_id: chatId,
      message_id: msg_wait.message_id,
      parse_mode: 'Markdown'
    });
  }
  
  // Prompt'u geçici dosyaya yaz
  const promptFile = join(PROJECT_ROOT, '.copilot-prompt.tmp');
  await writeFile(promptFile, prompt, 'utf-8');
  
  // VS Code komutunu çalıştır - Copilot chat'i aç
  const result = await runVSCodeCommand('--command', ['workbench.action.openChat']);
  
  // Alternatif: VS Code'un CLI'siyle extension komutu çalıştırma
  const message = `
✅ *Copilot Prompt Gönderildi!*

📝 *Sorunuz:*\n\`\`\`
${prompt.substring(0, 500)}
\`\`\`

💡 VS Code'da Copilot Chat açıldı. Yanıtı oradan takip edebilirsiniz.

🔗 Hemen aç: http://localhost:${CODESERVER_PORT}
  `;
  
  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: msg_wait.message_id,
    parse_mode: 'Markdown'
  });
  
  // Geçici dosyayı sil
  await safeExec(`rm -f ${promptFile}`);
});

// /codex <prompt> - OpenAI Codex CLI
bot.onText(/\/codex(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const prompt = match[1];
  
  if (!prompt) {
    return bot.sendMessage(chatId, `
🤖 *OpenAI Codex Kullanımı*

Komut: \`/codex <açıklama>\`

Örnekler:
\`/codex Create a React component for user profile\`
\`/codex Refactor this function to use async/await\`
\`/codex apps/api/src/auth.ts Add JWT validation\`

📋 Codex CLI kurulumu:\n\`\`\`bash
npm install -g @openai/codex
export OPENAI_API_KEY=sk-xxxx
\`\`\`
    `, { parse_mode: 'Markdown' });
  }
  
  const msg_wait = await bot.sendMessage(chatId, '🤖 Codex çalıştırılıyor...');
  
  // Codex CLI kurulu mu?
  const { output: codexCheck } = await safeExec('which codex || echo ""');
  if (!codexCheck.trim()) {
    return bot.editMessageText('❌ *Codex CLI* kurulu değil!\n\nKurulum:\n\`\`\`bash\nnpm install -g @openai/codex\nexport OPENAI_API_KEY=sk-xxxx\n\`\`\`', {
      chat_id: chatId,
      message_id: msg_wait.message_id,
      parse_mode: 'Markdown'
    });
  }
  
  // Codex komutunu çalıştır
  const result = await execStream(`codex "${prompt.replace(/"/g, '\\"')}"`, chatId);
  
  const output = result.output.substring(0, 3500);
  const status = result.success ? '✅' : '⚠️';
  
  bot.editMessageText(`${status} *Codex Yanıtı*\n\n📝 *İstek:* \`${prompt}\`\n\n\`\`\`\n${output}\n\`\`\``, {
    chat_id: chatId,
    message_id: msg_wait.message_id,
    parse_mode: 'Markdown'
  });
});

// /vscode <komut> - VS Code komutu çalıştır
bot.onText(/\/vscode(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const command = match[1];
  
  if (!command) {
    return bot.sendMessage(chatId, `
🎯 *VS Code Komutları*

Komut: \`/vscode <komut>\`

Popüler komutlar:
• \`/vscode workbench.action.files.newUntitledFile\` - Yeni dosya
• \`/vscode workbench.action.quickOpen\` - Dosya aç
• \`/vscode workbench.action.showCommands\` - Komut paleti
• \`/vscode workbench.action.terminal.toggleTerminal\` - Terminal
• \`/vscode workbench.action.files.saveAll\` - Tümünü kaydet
• \`/vscode git.sync\` - Git sync
• \`/vscode editor.action.formatDocument\` - Formatla

🔗 Tam liste: https://code.visualstudio.com/api/references/commands
    `, { parse_mode: 'Markdown' });
  }
  
  const msg_wait = await bot.sendMessage(chatId, `🎯 VS Code komutu çalıştırılıyor: ${command}`);
  
  const result = await runVSCodeCommand('--command', [command]);
  
  const status = result.success ? '✅' : '❌';
  const output = (result.output || result.error || 'Komut çalıştırıldı').substring(0, 1000);
  
  bot.editMessageText(`${status} *VS Code Komutu:* \`${command}\`\n\n\`\`\`\n${output}\n\`\`\``, {
    chat_id: chatId,
    message_id: msg_wait.message_id,
    parse_mode: 'Markdown'
  });
});

// /ask <soru> - Cursor/Copilot/Codex entegrasyonu
bot.onText(/\/ask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const question = match[1];
  const msg_wait = await bot.sendMessage(chatId, '🤖 AI asistan kontrol ediliyor...');
  
  // Önce Codex dene
  const { output: codexCheck } = await safeExec('which codex || echo ""');
  if (codexCheck.trim()) {
    bot.editMessageText('🤖 *Codex* ile yanıtlanıyor...', {
      chat_id: chatId,
      message_id: msg_wait.message_id
    });
    
    const result = await execStream(`codex "${question.replace(/"/g, '\\"')}"`, chatId);
    const output = result.output.substring(0, 3500);
    
    return bot.editMessageText(`🤖 *Codex Yanıtı:*\n\n\`\`\`\n${output}\n\`\`\``, {
      chat_id: chatId,
      message_id: msg_wait.message_id,
      parse_mode: 'Markdown'
    });
  }
  
  // Cursor CLI varsa
  const { output: cursorCheck } = await safeExec('which cursor || echo ""');
  if (cursorCheck.trim()) {
    // Cursor komutları
    await runVSCodeCommand('--command', ['cursor.generate']);
    
    return bot.editMessageText(`🎯 *Cursor\'a gönderildi!*\n\n📝 *Soru:* ${question}\n\n💡 Cursor\'da yanıtı kontrol edin.`, {
      chat_id: chatId,
      message_id: msg_wait.message_id,
      parse_mode: 'Markdown'
    });
  }
  
  // Hiçbiri yoksa
  bot.editMessageText(`❌ *AI asistan bulunamadı!*\n\nKurulum seçenekleri:\n\n1️⃣ *Codex CLI:*\n\`\`\`bash\nnpm install -g @openai/codex\nexport OPENAI_API_KEY=sk-xxxx\n\`\`\`\n\n2️⃣ *GitHub Copilot:*\nVS Code Extensions → GitHub Copilot Chat\n\n3️⃣ *Cursor:*\nhttps://cursor.sh/ kurun`, {
    chat_id: chatId,
    message_id: msg_wait.message_id,
    parse_mode: 'Markdown'
  });
});

// /extensions - Yüklü eklentileri listele
bot.onText(/\/extensions/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const msg_wait = await bot.sendMessage(chatId, '📦 Eklentiler listeleniyor...');
  
  const result = await safeExec('code --list-extensions 2>/dev/null || echo "VS Code CLI yok"');
  
  const extensions = result.output.split('\n').filter(Boolean);
  const aiExtensions = extensions.filter(e => 
    e.includes('copilot') || 
    e.includes('cursor') || 
    e.includes('codex') ||
    e.includes('chat') ||
    e.includes('ai')
  );
  
  const message = `
📦 *Yüklü Eklentiler:* ${extensions.length} adet

🤖 *AI Asistanlar:*
${aiExtensions.length > 0 ? aiExtensions.map(e => `  • ${e}`).join('\n') : '  • AI eklentisi yok'}

🔧 *Tüm Eklentiler:*
${extensions.slice(0, 20).map(e => `  • ${e}`).join('\n')}
${extensions.length > 20 ? `\n... ve ${extensions.length - 20} eklenti daha` : ''}

➕ Eklenti kurmak için:\n\`/vscode workbench.extensions.action.showInstalledExtensions\`
  `;
  
  bot.editMessageText(message, {
    chat_id: chatId,
    message_id: msg_wait.message_id,
    parse_mode: 'Markdown'
  });
});

// /install <extension> - Eklenti kur
bot.onText(/\/install (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const extensionId = match[1];
  const msg_wait = await bot.sendMessage(chatId, `⬇️ ${extensionId} kuruluyor...`);
  
  const result = await runVSCodeCommand('--install-extension', [extensionId]);
  
  const status = result.success ? '✅' : '❌';
  const output = (result.output || result.error || 'Tamamlandı').substring(0, 1000);
  
  bot.editMessageText(`${status} *Eklenti Kurulumu:* \`${extensionId}\`\n\n\`\`\`\n${output}\n\`\`\``, {
    chat_id: chatId,
    message_id: msg_wait.message_id,
    parse_mode: 'Markdown'
  });
});

// /edit <dosya> <içerik>
bot.onText(/\/edit (.+) ([\s\S]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAuthorized(chatId)) return;
  
  const filePath = match[1];
  const content = match[2];
  const fullPath = join(PROJECT_ROOT, filePath);
  
  // Güvenlik: Proje dışına çıkma
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return bot.sendMessage(chatId, '⛔ Proje dışı erişim engellendi!');
  }
  
  // Önemli dosyaları koru
  const protectedFiles = ['.env', 'package.json', 'package-lock.json'];
  if (protectedFiles.includes(filePath) && !content.includes('FORCE')) {
    return bot.sendMessage(chatId, '⚠️ Bu dosya korumalı. Değiştirmek için içeriğin sonuna FORCE ekle.');
  }
  
  try {
    await writeFile(fullPath, content.replace(' FORCE', ''), 'utf-8');
    bot.sendMessage(chatId, `✅ *${filePath}* güncellendi!`, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Dosya yazılamadı: ${error.message}`);
  }
});

// Hata yönetimi
bot.on('polling_error', (error) => {
  console.error('Telegram polling hatası:', error.message);
});

// Kapatma sinyalleri
process.on('SIGINT', () => {
  console.log('\n👋 Bot kapatılıyor...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Bot kapatılıyor...');
  bot.stopPolling();
  process.exit(0);
});

console.log('🤖 Telegram VS Code Botu başlatıldı!');
console.log(`   Admin ID: ${ADMIN_ID}`);
console.log('   Komutlar için Telegram\'da /start yazın.');
