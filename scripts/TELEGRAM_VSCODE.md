# 🤖 VS Code Telegram Yönetim Botu

VS Code'u Telegram üzerinden tamamen uzaktan yönetin. Tarayıcı tabanlı VS Code (code-server) + Telegram bot entegrasyonu.

## 🚀 Özellikler

- **🌐 code-server**: Tarayıcıdan tam VS Code deneyimi
- **⚡ Telegram Komutları**: Hızlı terminal/git/dosya işlemleri
- **📊 Sistem Monitörü**: Disk, RAM, servis durumu
- **🔒 Güvenli**: Sadece yetkili kullanıcı erişimi
- **📱 Mobil Uyumlu**: Her yerden erişim

## 📋 Gereksinimler

```bash
# Node.js 22+
# Telegram Bot Token
# (Opsiyonel) code-server
# (Opsiyonel) Cloudflare Tunnel / ngrok
```

## 🔧 Kurulum

### 1. Telegram Bot Oluşturma

1. Telegram'da [@BotFather](https://t.me/botfather) açın
2. `/newbot` yazın
3. Bot adı ve kullanıcı adı belirleyin
4. **Token** kopyalayın (örn: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Chat ID Öğrenme

1. [@userinfobot](https://t.me/userinfobot) açın
2. `/start` yazın
3. **ID** numarasını kopyalayın (örn: `123456789`)

### 3. .env Ayarları

```bash
# .env dosyasına ekle:
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_ADMIN_ID=your_telegram_id_here

# (Opsiyonel) VS Code Server şifresi
CODESERVER_PASSWORD=guclu_bir_sifre_123
CODESERVER_PORT=8080
```

### 4. Bağımlılıkları Kur

```bash
# Root dizinde çalıştır
npm install node-telegram-bot-api
```

### 5. Botu Başlat

```bash
node scripts/telegram-vscode.mjs
```

## 🌐 code-server Kurulumu (Önerilir)

### macOS
```bash
brew install code-server

# Başlat
code-server --auth password --bind-addr 0.0.0.0:8080
```

### Linux
```bash
curl -fsSL https://code-server.dev/install.sh | sh

# Başlat
code-server --auth password --bind-addr 0.0.0.0:8080
```

### Cloudflare Tunnel (Public Erişim)

```bash
# Kurulum
brew install cloudflared  # macOS

# Tunnel oluştur
cloudflared tunnel create vscode

# DNS route
cloudflared tunnel route dns vscode vscode.sizindomain.com

# Başlat
cloudflared tunnel run vscode
```

## 💬 Telegram Komutları

| Komut | Açıklama | Örnek |
|-------|----------|-------|
| `/start` | Botu başlat | `/start` |
| `/help` | Yardım menüsü | `/help` |
| `/status` | Sistem durumu | `/status` |
| `/code` | VS Code linki | `/code` |
| `/exec` | Terminal komutu | `/exec npm test` |
| `/logs` | Logları göster | `/logs api` |
| `/git` | Git işlemi | `/git status` |
| `/dev` | Dev server kontrol | `/dev start` |
| `/restart` | Servis yeniden başlat | `/restart api` |
| `/read` | Dosya oku | `/read package.json` |
| `/edit` | Dosya düzenle | `/edit .env KEY=value` |

## 🔒 Güvenlik

- Sadece `TELEGRAM_ADMIN_ID` yetkili
- Tehlikeli komutlar engellenir (`rm -rf /` vb.)
- Git force push için onay gerekir
- Proje dışı dosya erişimi engellenir

## 🔄 Otomatik Başlatma (macOS/Linux)

### PM2 ile
```bash
# PM2 kur
npm install -g pm2

# Botu PM2 ile başlat
pm2 start scripts/telegram-vscode.mjs --name "telegram-vscode"

# Otomatik başlatma ayarla
pm2 startup
pm2 save
```

### systemd (Linux)
```ini
# /etc/systemd/system/telegram-vscode.service
[Unit]
Description=Telegram VS Code Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/flixify
ExecStart=/usr/bin/node scripts/telegram-vscode.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable telegram-vscode
sudo systemctl start telegram-vscode
```

## 📱 Kullanım Senaryoları

### 1. Acil Kod Düzeltmesi
```
Telegram: /code → VS Code linki al → Tarayıcıda düzenle
```

### 2. Log Kontrolü
```
Telegram: /logs api → API logları anlık gör
```

### 3. Hızlı Deploy
```
Telegram: 
/exec git pull origin main
/restart api
/status
```

### 4. Sistem Kontrolü
```
Telegram: /status → Disk/RAM/servis durumu
```

## 🐛 Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| "Yetkisiz erişim" | TELEGRAM_ADMIN_ID doğru mu kontrol et |
| Bot yanıt vermiyor | node-telegram-bot-api kurulu mu? |
| code-server açılmıyor | Port 8080 boş mu? (`lsof -i :8080`) |
| Loglar gözükmüyor | `logs/` klasörü var mı? |

## 📞 Destek

Sorun mu var? Telegram'da bota `/status` yazarak başlayın!
