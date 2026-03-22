# Coolify Live Deployment Guide

Bu klasor, sistemi Coolify'da `api + worker + ops-web + viewer-webos` olarak canliya almak icin hazirlandi.

## Topoloji

- `api.<domain>` -> `api`
- `panel.<domain>` -> `ops-web`
- `app.<domain>` -> `viewer-webos`
- `worker` public degil (internal)

## 1) Coolify Kaynak Kurulumu

1. Coolify'da yeni proje olustur (`flixify-prod`).
2. Kaynak olarak Git repo bagla (branch `main`).
3. Docker Compose kaynagi olarak `coolify/docker-compose.yml` sec.

## 2) Env Degiskenleri

- Tum gerekli anahtarlar icin `coolify/.env.production.example` dosyasini baz al.
- Production kurali: `localhost` degeri kullanma.
- Zorunlu API URL:
  - `PUBLIC_API_BASE_URL=https://api.<domain>`
  - `NEXT_PUBLIC_API_BASE_URL=https://api.<domain>`
  - `VITE_API_BASE_URL=https://api.<domain>`
- Soft-update manifest:
  - `APP_UPDATE_MANIFEST_URL=https://app.<domain>/app-update-manifest.json`
- VOD transcode icin `FFMPEG_BINARY=ffmpeg` tanimla.

## 3) Deploy Sirasi

1. `api` deploy et.
2. `worker` deploy et.
3. `ops-web` deploy et.
4. `viewer-webos` deploy et.

Not:
- `viewer-webos` servisi baslarken `dist/app-config.json` dosyasini `PUBLIC_API_BASE_URL` ile runtime'da yazar.
- `ops-web` production build'i API env olmadan fail-fast olur.

## 4) Canli Dogrulama

1. `https://api.<domain>/health` -> `200` ve `ok:true`.
2. `https://app.<domain>/kayit-ol` aciliyor.
3. `https://app.<domain>/giris-yap` login akisi basarili.
4. `https://panel.<domain>` admin girisi aciliyor.
5. Browser ag kayitlarinda `localhost:*` istegi yok.

## 5) Windows EXE Paketleme

- Canli API ile paketle:
  - `FLIXIFY_API_BASE_URL=https://api.<domain> FLIXIFY_WEB_APP_URL=https://app.<domain> npm run dist:win:installer:x64 -w @flixify/viewer-windows`
- Surum: `1.35.0`
- Dagitim dosyasi:
  - `apps/viewer-windows/dist-electron/Flixify-Pro-Setup-1.35.0-x64.exe`
- Web indirme dosyasi ve update manifest otomatik guncellenir:
  - `apps/viewer-webos/public/downloads/flixify-windows.exe`
  - `apps/viewer-webos/public/app-update-manifest.json`
