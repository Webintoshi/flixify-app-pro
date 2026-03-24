# Flixify App Pro

Bu repo native-odakli yapida tutulur.

## Paketler

- `apps/viewer-native-qt`: Qt + libVLC native istemci
- `apps/api`: custom auth, katalog ve playback API
- `apps/worker`: arka plan senkron ve isleyici surecleri
- `packages/contracts`: ortak tipler ve API semalari
- `packages/sdk`: ortak istemci SDK'si
- `packages/viewer-core`: paylasilan viewer yardimcilari
- `supabase`: migration ve SQL dogrulama dosyalari

## Hizli Baslangic

1. `.env.example` dosyasini `.env` olarak kopyalayip ortami doldur.
2. `npm install`
3. Supabase migration'larini uygula.
4. `npm run check:env`
5. Backend icin `npm run dev`

Native istemciyi ayri hazirlamak icin:

- `npm run configure:native-qt`
- `npm run build:native-qt`

## Kalite Kapisi

- `npm run test`
- `npm run build`
- `npm run smoke:p0`
- `npm run quality:p0`

## Notlar

- Coolify uzerinden sadece `api` ve `worker` servisleri deploy edilir.
- Native app update kontrolu icin local fallback manifest dosyasi `data/app-update-manifest.json` altindadir.
- Windows production paketleri icin Qt 6, CMake, Ninja ve libVLC toolchain'i gerekir.
