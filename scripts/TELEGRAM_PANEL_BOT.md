# Telegram Panel Bot

Flixify'ya kayit olan kullanicilara Telegram uzerinden reseller panel line atamak icin minimal admin bot.

## Bot ne yapiyor

- `/bekleyenler` ile `new + unassigned` kullanicilari listeler
- Yeni kayit olan kullanicilari arka planda izler ve size otomatik bildirim yollar
- Secilen kullanici icin reseller panelde `create_line` cagirir
- Donen `username/password` bilgisini Flixify kullanicisina baglar
- Flixify icinde test veya paket aboneligini aktive eder
- `/aktif` ile reseller paneldeki canli baglanti sayisini gosterir

## Gerekli env'ler

Root `.env` icine veya calisma ortaminda su degiskenleri ekleyin:

```bash
TELEGRAM_BOT_TOKEN=123456:telegram-token
TELEGRAM_ADMIN_ID=123456789

FLIXIFY_API_BASE_URL=http://localhost:4000

# Opsiyonel: dogrudan JWT verirseniz alttaki admin login bilgilerine gerek kalmaz
FLIXIFY_ADMIN_ACCESS_TOKEN=

FLIXIFY_TELEGRAM_ADMIN_EMAIL=admin@example.com
FLIXIFY_TELEGRAM_ADMIN_PASSWORD=strong-password

RESELLER_API_BASE_URL=http://sifiriptvdns.com:80/ResellerAPI/reseller/index.php
RESELLER_API_KEY=your-reseller-api-key

TELEGRAM_PENDING_PAGE_SIZE=6
TELEGRAM_NOTIFY_PAGE_SIZE=50
TELEGRAM_NEW_USER_POLL_SECONDS=20
TELEGRAM_PANEL_STATE_FILE=./data/telegram-panel-bot-state.json
TELEGRAM_ALLOW_REASSIGN=false

TELEGRAM_PANEL_PACKAGE_MAP=[
  {
    "key":"test24",
    "label":"24s Test",
    "resellerPackageId":7,
    "resellerTrial":1,
    "flixifyMode":"test-24h"
  },
  {
    "key":"1ay",
    "label":"1 Ay",
    "resellerPackageId":8,
    "resellerTrial":0,
    "flixifyPackageSlug":"1-ay"
  },
  {
    "key":"3ay",
    "label":"3 Ay",
    "resellerPackageId":9,
    "resellerTrial":0,
    "flixifyPackageSlug":"3-ay"
  },
  {
    "key":"6ay",
    "label":"6 Ay",
    "resellerPackageId":10,
    "resellerTrial":0,
    "flixifyPackageSlug":"6-ay"
  },
  {
    "key":"12ay",
    "label":"12 Ay",
    "resellerPackageId":11,
    "resellerTrial":0,
    "flixifyPackageSlug":"12-ay"
  }
]
```

## Notlar

- `SUPABASE_URL` ve `SUPABASE_ANON_KEY` zaten mevcut root `.env` icinde olmali.
- `FLIXIFY_TELEGRAM_ADMIN_EMAIL` adresi `ADMIN_EMAILS` listesinde yer almali.
- `TELEGRAM_PANEL_PACKAGE_MAP` icindeki Flixify paket suresi ile reseller panel paket suresi ayni olmali.
- `test-24h` sadece Flixify'deki ozel 24 saatlik route'u kullanir.
- Bot line acarken reseller panel `username` ve `password` alanina dogrudan Flixify kullanici kodunu yazar.
- `TELEGRAM_PANEL_STATE_FILE` botun hangi yeni kayitlari daha once bildirdigini tutar.

## Calistirma

```bash
npm run telegram:panel
```

## Komutlar

- `/start`
- `/help`
- `/bekleyenler`
- `/aktif`
- `/paketler`

## Canlı bot bakım notu — 26 Eylül 2026

Canlı `flixify-telegram-bot` bağımsız konteynerdir. `/data/flixify/app/scripts/telegram-panel-bot.mjs` dosyası `/app/scripts/telegram-panel-bot.mjs` olarak bind edilir; data ve logs dizinleri de kalıcı bind mount kullanır. Canlı dosya depodaki bot dosyasından daha yeni menüler içerir. Canlı düzeltmeler, doğrulanan dosyanın kopyasına küçük bir patch uygulanarak hazırlanır.

Arama düğmesi, yönetim menüsündeki geniş `normalized.includes("kullanıcı")` koşuluna takılıyordu. `coolify/patches/apply-live-telegram-menu.mjs` bunu tam eşleşen yönetim kısayollarıyla değiştirir. Diğer canlı işlevleri korur ve kaynak SHA kontrolü olmadan çalışmaz.

- Düzeltme öncesi SHA256: `c525a518c4c1a6590e84097addd0a03850c659bc051e1295fca2587489a655e5`
- Düzeltme sonrası SHA256: `7953c56ddf31556db90b0029db0c03ce388f7449eb19c0e52d7842382595d705`
- Güvenli güncelleme: `coolify/deploy-telegram-bot.py NEW_SCRIPT EXPECTED_CURRENT_SHA EXPECTED_NEW_SHA --dry-run`; kontrol geçince aynı komut flagsiz çalıştırılır. Aynı konteyner yeniden başlatılır; heartbeat, sync, admin kayıtları ve diğer servislerin değişmediği doğrulanır.
- Özel rollback yedekleri `/data/flixify/telegram-bot-backups/` altında tutulur. Bu güncellemenin yedeği `telegram-panel-bot-1790409456480065175.mjs` dosyasıdır.

`scripts/telegram-panel-bot-probe.mjs SOURCE_MJS` botu polling başlatmadan izole olarak çalıştırır. Gerçek API'de yalnızca admin login ve okuma isteklerine izin verir; kullanıcı kodlarını ve kimliklerini çıktıya yazmaz. Menü yönlendirmesi, arama, liste sayfalama, detay callback'i, paket görünümü, analiz, sistem, bakiye, ödeme/deneme ve M3U metadata bağlantıları kontrol edilir.

İsteğe bağlı `scripts/telegram-panel-bot-delivery-probe.mjs SOURCE_MJS --deliver-to-configured-admin` mevcut özel yönetici sohbetine tek sessiz test mesajı gönderir ve düzenler. Liste kodları ve kullanıcı düğmeleri sentetik değerlerle değiştirilir. Bu test, incelenen liste şablonunun HTML yapısını ve statik arama ekranını Telegram'a doğrulatır; listeye yeni kişisel alan eklenirse redaksiyon da güncellenmelidir.

Bu incelemede 26 kayıtlı kullanıcı vardı; tamamı aktif olduğundan bekleyen/atanmamış ve engelli filtreleri boştu. 28 kontrol geçti; 32 API/sağlayıcı isteği HTTP 200 döndü. Liste ve arama HTML ekranları gerçek Telegram teslimat testini geçti. Yönetici menüsü `/start` ile yenilenebilir.
