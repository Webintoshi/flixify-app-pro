# Flixify App Pro

Supabase veri katmani ve Coolify deployment hedefiyle tasarlanmis coklu platform IPTV platformu.

## Paketler

- `apps/api`: custom auth, katalog, paket, admin API
- `apps/worker`: M3U senkron ve paket surec worker'i
- `apps/ops-web`: admin ve satis paneli
- `apps/viewer-native-qt`: Windows odakli native playback istemcisi
- `apps/viewer-webos`: LG webOS istemcisi
- `packages/contracts`: ortak tipler ve API semalari
- `packages/sdk`: istemciler icin ortak API SDK'si
- `supabase`: SQL migration'lari ve seed mantigi

## Hizli Baslangic

1. `.env.example` dosyasini `.env` olarak kopyalayip ortami doldur.
   `apps/ops-web/.env.local` icin public Supabase ve API degiskenlerini ayarla.
   `ADMIN_EMAILS` ile admin API erisimi verilecek adresleri belirle.
2. `npm install`
3. Supabase migration'larini uygula.
4. `npm run check:env`
5. `npm run dev`

Alternatif olarak servisleri ayri ayri da calistirabilirsin:

- `npm run dev:api`
- `npm run dev:worker`
- `npm run dev:ops`
- `npm run dev:ops:turbo`
- `npm run dev:webos`

Kalite kapisi komutlari:

- `npm run test` (contracts + api + worker)
- `npm run build`
- `npm run smoke:p0` (API auth flow + ops redirect + webos runtime config smoke)
- `npm run quality:p0` (test + build + smoke)

Supabase SQL uygulama ve guvenlik ayrintilari icin `supabase/README.md`,
`supabase/sql/verify_schema.sql` ve `supabase/sql/verify_security.sql` dosyalarini kullan.

Coolify canli kurulum adimlari ve zorunlu production env listesi icin `coolify/README.md`
ve `coolify/.env.production.example` dosyalarini kullan.

## Notlar

- Aktif istemci shell'leri `viewer-native-qt` ve `viewer-webos` ile sinirlidir.
- LG webOS ve Windows derlemeleri ilgili vendor SDK'larina baglidir.
- `viewer-webos` runtime API adresi `public/app-config.json` dosyasindan okunur (`apiBaseUrl`).
- Windows production paketlerinde `FLIXIFY_API_BASE_URL` ve `FLIXIFY_WEB_APP_URL` zorunludur.
