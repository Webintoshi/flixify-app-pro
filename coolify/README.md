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

## 3) Deploy Sirasi

1. `api` deploy et.
2. `worker` deploy et.

## 4) Canli Dogrulama

1. `https://api.<domain>/health` -> `200` ve `ok:true`.
2. Native istemci login ve katalog akisi API uzerinden calisiyor olmali.
