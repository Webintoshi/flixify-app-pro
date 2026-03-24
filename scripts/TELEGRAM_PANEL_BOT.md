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
