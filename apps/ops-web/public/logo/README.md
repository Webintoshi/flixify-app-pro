# Flixify Pro Logo System

Bu dizin Flixify Pro icin tek kaynak marka sistemini barindirir.
Final kilitlenen yon:

- koyu premium tile
- ustte merkezli kirmizi TV frame
- beyaz `F` monogram + kirmizi play vurgusu
- altta ortali `FLIXIFY`
- onun altinda `PRO` badge

Kimlik dili `TV ikon + guclu FLIXIFY wordmark + PRO badge` uzerine kuruludur.

## Asset Seti

| Dosya | Rol | Kullanim |
|-------|-----|----------|
| `flixify-logo-full.svg` | Ana yatay logo | Header, landing, marketing |
| `flixify-icon.svg` | Final master app icon | Desktop bundle, installer source, store export, high-res source |
| `flixify-icon-only.svg` | Kucuk boyut ikon | Favicon, constrained surfaces, tiny UI |
| `flixify-icon-light.svg` | Acik zemin varyanti | Light background, belge ve baski |
| `icon-192.png` | PWA icon | Android/PWA manifest |
| `icon-512.png` | PWA/store icon | PWA manifest, social/share fallback |

## Marka Kurallari

- Primary palette:
- `#F40612` marka kirmizisi
- `#C8040E` derin kirmizi
- `#FF3042` highlight
- `#F5F7FF` metin beyazi
- `#0B0C10` koyu destek tonu
- Clear space: ikon veya lockup etrafinda en az TV govdesi yuksekliginin `%25`i kadar bosluk birakin.
- Minimum boyut:
- `icon-only`: 16px altina inmeyin
- `icon.svg`: 96px altinda okunurluk dusuyorsa `icon-only` tercih edin
- `full logo`: 140px altinda `PRO` badge sikisiyorsa sadece wordmark veya icon-only kullanin
- Karmasik fotoğraf/video zeminlerinde tercihen koyu overlay veya tek renk panel uzerinde kullanin.

## Canli Dosya Baglantilari

- Web:
- `/favicon.svg`
- `/favicon.ico`
- `/apple-touch-icon.png`
- `/logo/site.webmanifest`
- Desktop:
- `apps/viewer-windows/resources/icon.png`
- `apps/viewer-windows/resources/icon.ico`
- `apps/viewer-windows/resources/icon.icns`
- WebOS viewer:
- `apps/viewer-webos/public/favicon.svg`
- `apps/viewer-webos/public/favicon.ico`
- `apps/viewer-webos/public/live-brand-poster.svg`

## Guncelleme Akisi

1. Once `flixify-icon.svg`, `flixify-icon-only.svg`, `flixify-logo-full.svg`, `flixify-icon-light.svg` dosyalarini guncelle.
2. Sonra turev varliklari yeniden uret:

```bash
sips -s format png --resampleHeightWidth 180 180 flixify-icon.svg --out ../apple-touch-icon.png
sips -s format png --resampleHeightWidth 192 192 flixify-icon-only.svg --out icon-192.png
sips -s format png --resampleHeightWidth 512 512 flixify-icon-only.svg --out icon-512.png
```

3. Desktop ikonlarini yeniden paketle:

```bash
npm run dist:win:installer:x64 -w @flixify/viewer-windows
npm run dist:mac:dmg:arm64 -w @flixify/viewer-windows
```

## Kullanım Karari

- Desktop ve installer tarafinda ana kaynak `flixify-icon.svg`
- Favicon ve cok kucuk yuzeylerde `flixify-icon-only.svg`
- Acik zemin gereksinimlerinde `flixify-icon-light.svg`

## Ornek Kullanim

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/logo/site.webmanifest" />
```
