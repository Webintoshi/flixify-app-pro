# 🎬 FLIXIFY PRO - Logo Assets

Bu dizin Flixify Pro uygulaması için tüm logo ve ikon dosyalarını içerir.

## 📁 Dosya Listesi

### Ana Logo Dosyaları

| Dosya | Açıklama | Kullanım Alanı |
|-------|----------|----------------|
| `flixify-icon.svg` | Ana uygulama ikonu (1024x1024) | macOS, iOS, Android, Windows |
| `flixify-icon-only.svg` | Sade ikon (512x512) | Sistem tepsisi, favicon, küçük boyutlar |
| `flixify-logo-full.svg` | Tam logo (simge + yazı) | Web sitesi, pazarlama materyalleri |
| `flixify-icon-light.svg` | Açık arka plan versiyonu | Beyaz/light temalı yerler |

## 🖥️ Platform Bazlı Export Talimatları

### macOS (.icns)
```bash
# svgexport kullanarak (npm install -g svgexport)
svgexport flixify-icon.svg icon_16x16.png 16:16
svgexport flixify-icon.svg icon_16x16@2x.png 32:32
svgexport flixify-icon.svg icon_32x32.png 32:32
svgexport flixify-icon.svg icon_32x32@2x.png 64:64
svgexport flixify-icon.svg icon_128x128.png 128:128
svgexport flixify-icon.svg icon_128x128@2x.png 256:256
svgexport flixify-icon.svg icon_256x256.png 256:256
svgexport flixify-icon.svg icon_256x256@2x.png 512:512
svgexport flixify-icon.svg icon_512x512.png 512:512
svgexport flixify-icon.svg icon_512x512@2x.png 1024:1024

# iconutil ile .icns oluştur
iconutil -c icns icon.iconset
```

### Windows (.ico)
```bash
# ImageMagick kullanarak
convert flixify-icon.svg -define icon:auto-resize=256,128,64,48,32,16 favicon.ico
```

### Linux (.png seti)
```bash
# 16x16'dan 512x512'ye kadar
for size in 16 22 24 32 48 64 128 256 512; do
  svgexport flixify-icon.svg flixify-${size}x${size}.png ${size}:${size}
done
```

### iOS & Android
```bash
# iOS App Store
svgexport flixify-icon.svg ios-app-store.png 1024:1024

# iOS App Icon sizes
for size in 20 29 40 60; do
  for scale in 2 3; do
    total=$((size * scale))
    svgexport flixify-icon.svg ios-icon-${size}@${scale}x.png ${total}:${total}
  done
done

# Android
svgexport flixify-icon.svg android-mdpi.png 48:48
svgexport flixify-icon.svg android-hdpi.png 72:72
svgexport flixify-icon.svg android-xhdpi.png 96:96
svgexport flixify-icon.svg android-xxhdpi.png 144:144
svgexport flixify-icon.svg android-xxxhdpi.png 192:192
svgexport flixify-icon.svg android-playstore.png 512:512
```

### Web Favicon
```bash
# Favicon seti
svgexport flixify-icon-only.svg favicon-16x16.png 16:16
svgexport flixify-icon-only.svg favicon-32x32.png 32:32
svgexport flixify-icon-only.svg favicon-96x96.png 96:96
svgexport flixify-icon-only.svg favicon-180x180.png 180:180
svgexport flixify-icon-only.svg favicon-192x192.png 192:192
svgexport flixify-icon-only.svg favicon-512x512.png 512:512

# Apple Touch Icon
svgexport flixify-icon.svg apple-touch-icon.png 180:180

# Safari Pinned Tab (siyah-beyaz)
# Inkscape veya Illustrator ile monochrome versiyon oluşturulmalı
```

## 🎨 Renk Paleti

| Renk | Hex | Kullanım |
|------|-----|----------|
| Ana Kırmızı | `#f40612` | Ana marka rengi |
| Koyu Kırmızı | `#c0040e` | Gradient sonu |
| Açık Kırmızı | `#ff1a26` | Gradient başlangıcı |
| Arka Plan Koyu | `#060606` | Dark tema |
| Arka Plan Açık | `#ffffff` | Light tema |
| Metin | `#f5f5f1` | Ana metin |

## 📱 Uygulama İkonu Kullanımı

### React/Next.js
```tsx
// Favicon olarak
<link rel="icon" type="image/svg+xml" href="/logo/flixify-icon-only.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/logo/apple-touch-icon.png" />

// Component içinde
import Logo from '../public/logo/flixify-logo-full.svg';

<img src="/logo/flixify-icon.svg" alt="Flixify Pro" width="120" />
```

### Electron (Windows/Mac/Linux)
```javascript
// main.js
const { app, BrowserWindow } = require('electron');

const win = new BrowserWindow({
  icon: path.join(__dirname, 'assets/logo/flixify-icon.png'), // 512x512 PNG
  // ...
});
```

### Tauri
```json
// tauri.conf.json
{
  "tauri": {
    "bundle": {
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ]
    }
  }
}
```

## ⚠️ Önemli Notlar

1. **SVG Öncelikli**: Mümkün olan her yerde SVG kullanın. Sadece sistem gereksinimleri için PNG/ICO dönüştürün.

2. **Boyutlar**: 
   - Minimum kullanım: 16x16 piksel
   - Önerilen minimum: 32x32 piksel
   - Maksimum kalite: 512x512+ piksel

3. **Arka Plan Uyumu**:
   - Koyu arka plan: `flixify-icon.svg` veya `flixify-icon-only.svg`
   - Açık arka plan: `flixify-icon-light.svg`

4. **Güvenlik Boşluğu**: İkonun etrafında en az %10 güvenlik boşluğu bırakın. Önemli elementlerin logonun kenarlarına değmemesine dikkat edin.

## 🔄 Güncelleme Geçmişi

- v1.0.0 - İlk logo seti oluşturuldu
  - Ana ikon (1024x1024)
  - Sade ikon (512x512)
  - Tam logo (800x200)
  - Açık arka plan versiyonu

## 📞 İletişim

Logo kullanımı ve lisanslama hakkında sorular için: [iletisim@flixify.pro](mailto:iletisim@flixify.pro)
