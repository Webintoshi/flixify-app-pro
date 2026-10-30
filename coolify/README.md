# Coolify Live Deployment Guide

Bu klasor native-only repo yapisi icin sadece `api + worker` deploy etmek uzere tutulur.

## Topoloji

- `api.<domain>` -> `api`
- `worker` public degil

## 1) Coolify Kaynak Kurulumu

1. Coolify'da yeni proje olustur.
2. Kaynak olarak Git repo bagla.
3. Docker Compose kaynagi olarak `coolify/docker-compose.yml` sec.

## 2) Env Degiskenleri

- Tum gerekli anahtarlar icin `coolify/.env.production.example` dosyasini baz al.
- Production kurali: `localhost` degeri kullanma.
- Zorunlu API URL:
  - `PUBLIC_API_BASE_URL=https://api.<domain>`
- VOD transcode icin `FFMPEG_BINARY=ffmpeg` tanimla.
- `APP_UPDATE_MANIFEST_URL` bos birakilabilir; bu durumda API local fallback olarak `data/app-update-manifest.json` kullanir.
- Otomatik 3 saatlik IPTV denemesi icin worker'a gercek `RESELLER_API_BASE_URL` ve `RESELLER_API_KEY` degerlerini Coolify secret ortam degiskenleriyle ver. Demo disinda bu degerler yoksa worker baslamaz.
- Mevcut bot ortamini Coolify service `.env` dosyasina guvenle tasimak icin `python3 coolify/prepare-auto-trial-env.py --service-dir <coolify-service-dir> --dry-run` ile on kontrol yap; dogruladiktan sonra `--dry-run` olmadan calistir. Yardimci dosya secret degerlerini ekrana basmaz, yeni ayarlari uygulamadan once dogrular ve yedek olusturmaz.
- API, IP kotasini `APP_JWT_SECRET` ile HMAC'ler; anahtar degisirse mevcut 24 saatlik kota hash'leri eslesmez.

## 3) Deploy Sirasi

1. `supabase/migrations/202610130001_auto_trial_provision_jobs.sql` dahil tum migration'lari uygula. Bu migration eski kullanicilara otomatik hat acmaz.
2. Provider panelinde package ID `4` icin 3 saatlik test ve `get_lines` erisimini dogrula; worker'a reseller URL/anahtarini secret olarak tanimla.
3. Once `worker` surumunu calistir ve hata vermeden is kuyrugunu okuyabildigini dogrula.
4. Ardindan `api` ve web surumlerini deploy et. Yeni kayitlar ancak bu asamadan sonra otomatik deneme kuyruguna girer.

## 4) Canli Dogrulama

1. `https://api.<domain>/health` -> `200` ve `ok:true`.
2. Native istemci login ve katalog akisi API uzerinden calisiyor olmali.
3. Yeni bir test kaydinda Hesabim once "3 saatlik denemeniz hazirlaniyor", hat dogrulaninca "3 Saat Deneme" ve kalan sureyi gostermeli. Saglayicida hat ve abonelik bitisi en gec 3 saat olmali.
4. Ayni hesaba tekrar hat acilmamali; kuyrukta `review` kayitlari olursa provider kimligini ve hata nedenini incele. Kimligi belirsiz bir `create_line` sonucunda otomatik ikinci hat acilmaz.

## Android TV 1.4.0 indirme ve guncelleme yayini

`releases/2026-10-26-edge-recovery/build-tv-device-cache-web.py` ve
`release-tv-device-cache-web.py`, dogrulanmis `996d4e434e47` web imaji uzerine
yalniz Android TV indirme tanimini ve iki yeni genel dosyayi ekler. API, worker,
veritabani, oynatici ve onceki APK adresleri korunur. Masaustu guncelleme API'si
bu yayinin parcasi degildir.

Once kabul edilen native kaynak commit'i dondurulur; release APK yerelde
`apksigner` ve Android paket araclariyla kontrol edilir. Paket `vip.flixify.tv`,
surum `1.4.0`/kod `8`, minimum API `23`, uygulama adi `Flixify Pro` ve imza
kurulu kararlı APK ile ayni olmalidir. Bu yerel kontrolun SHA256 ve byte sayisi
build aracina bagimsiz pin olarak verilir; sunucu Android imza kontrolunu yeniden
yaptigini iddia etmez.

Kabul edilen tam native commit, yeni build aracindaki
`ACCEPTED_NATIVE_REVISION` alanina yazilana kadar araclar kapali kalir. Bu alani
bir dal adi veya `HEAD` ile doldurma. Native agac yayin commit'inde ayni kalmali;
web uygulamasinda yalniz `app/platform/tv-download.ts` surum degisikligi olmali.
Yeni genel dosyalar:

- `public/downloads/flixify-pro-1.4.0.apk`
- `public/downloads/flixify-tv-update.json`

Statik JSON; `packageName`, `versionName`, `versionCode`, `minSdk`, `apkUrl`,
`sha256`, `sizeBytes`, `notes` alanlarini tasir. APK adresi tam olarak
`https://flixify.vip/downloads/flixify-pro-1.4.0.apk` olmalidir. Ozet ve boyut
kabul edilen APK'dan uretilir; onceki genel dosyalar degistirilmez.

Varsayilan build ve release islemleri salt okunur on kontroldur. Build icin tam
yayin commit'i ile `--apk-sha256` ve `--apk-bytes` gerekir. On kontrol kabulunden
sonra `--container-build`, mevcut adayi dogrulamak icin `--verify-existing`
kullanilir. Derleyici ag kapali, 1280 MiB RAM/1536 MiB toplam siniri ve en az
8 GiB bos disk denetimiyle calisir. Adayda eski genel dosyalarin tam agaci ve
yeni APK'nin HEAD/MIME/Range/tam GET ozeti ile statik JSON uyumu dogrulanir.

Release araci mevcut korunan worker tag/ID pinlerini ve dogrulanmis aday imaj
ID'sini ister. `--apply` yalniz web imajini Coolify kaydinda esler;
`--recreate` yalniz web konteynerini yeniden olusturur. Bu araclarla toplu
temizlik, bagimli hizmet yeniden baslatma veya saglayici yayini testi yapilmaz.
