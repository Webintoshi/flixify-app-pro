# Flixify Native Qt

`viewer-native-qt` is the new native playback client for Windows, macOS, Android and Android TV.

Current scope in this repo:
- Qt 6 + QML application shell
- libVLC-backed playback controller
- direct-only playback via `/me/native/.../playback`
- sibling variant fallback using `variantGroupKey` and `qualityRank`
- native playback diagnostics posting back to the API

## Prerequisites

- CMake 3.28+
- Ninja
- Qt 6 with `Core`, `Gui`, `Quick`, `Qml`, `QuickControls2`, `Network`
- libVLC development bundle

Environment variables:
- `QT_ROOT`
- `LIBVLC_ROOT`
- `FLIXIFY_API_BASE_URL`
- `FLIXIFY_NATIVE_QT_PRESET` optional
- `FLIXIFY_NATIVE_QT_BUILD_DIR` optional

## Commands

```bash
npm run configure -w @flixify/viewer-native-qt
npm run build -w @flixify/viewer-native-qt
npm run run -w @flixify/viewer-native-qt
```

## Notes

- The app talks only to the Flixify API and uses the native playback endpoints.
- Browser playback dependencies are intentionally absent from this client.
- Windows and macOS can bind libVLC directly to the QML window handle today.
- Android and Android TV use the same codebase, but final surface binding still depends on the target Qt + libVLC package layout available in your toolchain.
