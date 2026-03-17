# viewer-windows

Bu paket `apps/viewer-webos` istemcisini masaustu kabugunda (Electron) paketler.

## Komutlar

- `npm run dist:win:portable -w @flixify/viewer-windows`
  Tek dosya portable `.exe` uretir.
- `npm run dist:win:installer -w @flixify/viewer-windows`
  NSIS installer `.exe` uretir.
- `npm run dist:win -w @flixify/viewer-windows`
  Her ikisini birden uretir.
- `npm run dist:mac:dmg -w @flixify/viewer-windows`
  macOS icin `.dmg` (ve zip) uretir.

Mimariye ozel:

- `npm run dist:win:installer:x64 -w @flixify/viewer-windows`
- `npm run dist:win:installer:arm64 -w @flixify/viewer-windows`
- `npm run dist:win:portable:x64 -w @flixify/viewer-windows`
- `npm run dist:win:portable:arm64 -w @flixify/viewer-windows`
- `npm run dist:mac:dmg:x64 -w @flixify/viewer-windows`
- `npm run dist:mac:dmg:arm64 -w @flixify/viewer-windows`

## Cikti

Uretilen dosyalar:

- `apps/viewer-windows/dist-electron/*.exe`
- `apps/viewer-windows/dist-electron/*.dmg`

Not: build once `apps/viewer-webos` derlenir ve `dist` icerigi otomatik olarak bu pakete kopyalanir.

## Runtime API Ayari

- Paketleme sirasinda `web-dist/app-config.json` otomatik olusturulur.
- Production paket icin public API adresi zorunludur (`FLIXIFY_API_BASE_URL` veya `PUBLIC_API_BASE_URL`).
- Production build `localhost` API ile bilerek hata verir; yanlis EXE dagitimi engellenir.
- Ornek:
  - `FLIXIFY_API_BASE_URL=https://api.example.com npm run dist:win:installer:x64 -w @flixify/viewer-windows`

Son kullanici tarafinda ekstra ayar gerekmez. API adresi EXE icine gomulu gelir.

Sadece destek/operasyon icin, kurulu uygulamada API adresi yeniden paketlemeden degistirilebilir:

1. Config dosyasini olusturun/guncelleyin:
   - Windows: `%APPDATA%\\Flixify Pro\\app-config.json`
   - macOS: `~/Library/Application Support/Flixify Pro/app-config.json`
2. Icerik:
   - `{ "apiBaseUrl": "https://api.example.com" }`
3. Uygulamayi tamamen kapatip tekrar acin.

Oncelik sirasi:
1. `FLIXIFY_API_BASE_URL` (process env)
2. `%APPDATA%\\Flixify Pro\\app-config.json`
3. Paket icindeki `web-dist/app-config.json`

Video decode sorunu yasarsan opsiyonel olarak donanim hizlandirma kapatilabilir:
- `FLIXIFY_DISABLE_HARDWARE_ACCELERATION=1`

## Desktop Stabilite Notlari

- Uygulama tek instance calisir; ikinci acilis denemesi mevcut pencereyi one getirir.
- Main-frame yukleme hatalarinda (gecici ag kesintisi gibi) otomatik yeniden deneme yapilir.
- Renderer kilitlenmesi/cokmesi durumunda uygulama otomatik yenilenir.
- Cache temizligi her acilista degil, versiyon degisiminde bir kez yapilir.

## Uygulama Guncelleme Davranisi

- Masaustu uygulama menude `Guncelle` aksiyonu sunar (`CmdOrCtrl+Shift+R`).
- `Guncelle`, Electron cache'ini temizler ve uygulamayi yeniden yukler.

Canli commitleri yeniden kurulum olmadan almak icin:

1. Paketleme sirasinda `FLIXIFY_WEB_APP_URL=https://app.flixify.pro` verin.
2. veya kurulu istemcide `app-config.json` icine `webAppUrl` ekleyin:
   - `{ "apiBaseUrl": "https://api.flixify.pro", "webAppUrl": "https://app.flixify.pro" }`

Bu ayarda desktop shell uzaktaki web uygulamasini acar ve `app.flixify.pro` deploylari guncellemeleri aninda yansitir.
Not: Electron shell kodu degisirse yine yeni `.exe/.dmg` paket yayinlamak gerekir.
