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
- Mevcut bot ortamini Coolify service `.env` dosyasina guvenle tasimak icin `python3 coolify/prepare-auto-trial-env.py --service-dir <coolify-service-dir> --dry-run` ile on kontrol yap; dogruladiktan sonra `--dry-run` olmadan calistir. Yardimci dosya secret degerlerini ekrana basmaz ve backup olusturur.
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
