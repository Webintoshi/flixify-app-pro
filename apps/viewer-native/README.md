# viewer-native

Bu paket `react-native-tvos` tabanli native istemciyi icerir.

## Desteklenen Platformlar

- Android
- Android TV
- Apple TV (kod tabani)
- iOS (kod tabani)

## APK Build

Android SDK/JDK kuruluysa asagidaki komutlarla APK uretebilirsin:

1. `npm ci`
2. `npm run apk:debug -w @flixify/viewer-native`
3. `npm run apk:release -w @flixify/viewer-native`

Uretilen dosyalar:

- Debug APK: `apps/viewer-native/android/app/build/outputs/apk/debug/app-debug.apk`
- Release APK: `apps/viewer-native/android/app/build/outputs/apk/release/app-release.apk`

## Notlar

- Manifest hem `LAUNCHER` hem `LEANBACK_LAUNCHER` icerir, ayni APK Android telefon/tablet ve Android TV'de calisir.
- Monorepo icin Metro ve Gradle yollari root `node_modules` konumuna gore ayarlanmistir.
