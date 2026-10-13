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

## Canlı bot düğme düzeltmesi — 13 Ekim 2026

`/start` ve yazılı komutlar çalışırken satır içi düğmelerin tamamı yanıtsızdı. Telegram'da bot için kayıtlı `allowed_updates` listesinde `callback_query` yoktu. Bot polling'i başlatırken bu listeyi belirtmediği için Telegram eski filtreyi koruyor ve düğme tıklamalarını bota iletmiyordu.

`coolify/patches/apply-live-telegram-callback-polling.mjs` yalnızca bot kurucusunu değiştirir: polling başlamadan `message`, `edited_message`, `channel_post`, `edited_channel_post` ve `callback_query` türlerini açıkça ister. Kaynak SHA kontrolü vardır; depodaki eski bot dosyasını canlıdaki daha yeni sürümün üzerine yazmaz.

- Düzeltme öncesi canlı dosya SHA256: `7953c56ddf31556db90b0029db0c03ce388f7449eb19c0e52d7842382595d705`
- Düzeltme sonrası canlı dosya SHA256: `6f2432082b7dc03c1491c02ca604096886bc0ffe265704ce3e924ef69b4a5fe9`
- Canlı geri alma yedeği: `/data/flixify/telegram-bot-backups/telegram-panel-bot-1791871273985625616.mjs`
- Dağıtım: `coolify/deploy-telegram-bot.py` ile kuru kontrol ve ardından aynı konteynerin kontrollü yeniden başlatılması. Yönetici durumu ve diğer servisler korundu.

Yeniden başlatmadan sonra Telegram güncelleme listesinde `callback_query` görüldü. Gerçek yönetici sohbetinde yeni menüden kullanıcı listesi, kullanıcı detayı, numara arama, bekleyen kayıt ve detay, M3U paket seçim ekranı, analiz, bakiye, sistem durumu ve geri/iptal düğmeleri açıldı. Gerçek kullanıcıya paket ataması yapılmadı; bu işlem kredi ve kullanıcı kaydı değiştirdiğinden ayrıca bir test hesabıyla doğrulanmalı.

## Canlı bot atama güvenliği — 13 Ekim 2026

Sağlayıcının `get_lines?search=` yanıtı kısmi eşleşme ve başka alan eşleşmeleri içeriyor. Eski bot tam kullanıcı adı bulunmadığında ilk sonucu seçip başka bir hattı uzatabiliyordu. Mevcut hat bulunamadığında da gerçek hat bilgisi olmadan başarılıymış gibi aboneliğe devam edebiliyordu. `coolify/patches/apply-live-telegram-assignment-safety.mjs` bu iki yolu kapatır: yalnız tam kullanıcı adı, geçerli hat kimliği ve beklenen şifreyle eşleşen hat kabul edilir; yeni hat yanıtı eksikse sağlayıcıdan tam eşleşme teyidi istenir. Teyit yoksa kullanıcı aboneliğine devam edilmez ve yöneticiye açık hata gösterilir.

- Önceki canlı dosya SHA256: `6f2432082b7dc03c1491c02ca604096886bc0ffe265704ce3e924ef69b4a5fe9`
- Güncel canlı dosya SHA256: `8fcb20731153a246ff13d7aaf0d2de9842ec8f74e9c7faf880e00a1e3e2e6110`
- Geri alma yedeği: `/data/flixify/telegram-bot-backups/telegram-panel-bot-1791873396607126604.mjs`
- Değişiklikten önce kaynak SHA, yama SHA, sözdizimi ve dağıtımın kuru kontrolü doğrulandı. Yeniden başlatmadan sonra host ve konteyner SHA değerleri, heartbeat, `callback_query` ve bot logları sağlıklıydı. Gerçek kullanıcıya yeni paket ataması yapılmadı.

Atama akışı sağlayıcı, M3U ve abonelik işlemlerini ardışık yapıyor; bu işlemler için kalıcı idempotency veya otomatik geri alma yok. Bu nedenle aynı paket düğmesine üst üste basarak deneme yapılmamalı; kısmi hata ekranı görülürse önce hattın ve aboneliğin durumu incelenmeli.

## Kullanıcı listesi süre etiketi — 13 Ekim 2026

M3U bağlı olup aktif paketi olmayan kullanıcılarda API `remainingDays: null` döndürür. Canlı botta `Number(null)` sıfır sayıldığı için listede `null gün` yazıyordu. `coolify/patches/apply-live-telegram-days-label.mjs` sayı kontrolünden önce null/undefined değerini ayırır; bu kayıtlar artık `M3U Bağlı (Aktif)` gösterilir. Sıfır ve pozitif gün değerleri aynı kalır.

- Önceki canlı dosya SHA256: `8fcb20731153a246ff13d7aaf0d2de9842ec8f74e9c7faf880e00a1e3e2e6110`
- Güncel canlı dosya SHA256: `aabba2e98c0cc46e4323a38674dfd94d73003e2b3cc12afba5a371ea74cf229a`
- Geri alma yedeği: `/data/flixify/telegram-bot-backups/telegram-panel-bot-1791878946166871348.mjs`
- Canlı Telegram sohbetinde liste yeniden açılıp `M3U Bağlı (Aktif)` metni görüldü. Bot heartbeat, polling, callback güncellemeleri ve logları sağlıklıydı.
