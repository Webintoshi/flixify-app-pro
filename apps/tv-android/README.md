# Flixify Android TV

Native TV/box client, one architecture-independent APK. Android6/API23 or newer. Package `vip.flixify.tv`; test version `1.0.0-test.1`, code1. Uses Android platform decoders through Media3; no ARM/x86 native extension is bundled. Real TV codec support still depends on its firmware/hardware.

## Build

Requirements: OpenJDK17, Android SDK36/build-tools36.0.0 and accepted SDK licenses. Set `ANDROID_HOME` or a private `local.properties` with `sdk.dir=...`. Gradle8.13 distribution is checksum pinned; AGP8.13.2 and Media31.11.1 come from official Google/Maven repositories.

```
./scripts/build-test-apk.sh
```

Output: `app/build/outputs/apk/release/app-release.apk`. Release is optimized and not debuggable. It is signed with the existing local Android test keystore; keep that private key safe for compatible updates. No keystore, token or provider credential is committed. This is a sideload test release, not a Play Store submission. Update versionName/versionCode and use a new immutable filename for subsequent releases.

## Offline tests

```
./gradlew --no-daemon :app:testDebugUnitTest :app:lintDebug
./gradlew --no-daemon :app:connectedDebugAndroidTest
```

The connected tests require an Android TV emulator. Repository fixtures use no real accounts, providers or streams. The separate real Media3 smoke test decodes an official local MP4 fixture packaged only in the test APK. Trusted debug-only Java injection hooks are not exposed through Intents/URLs and are removed from the optimized release.

## Remote

- Direction keys move visible focus; OK selects. Back closes input/dialog/detail, returns focus to the navigation and exits at the root.
- Native TV keyboard enters the existing16-character account code and search. No signup or purchase is performed on TV.
- Live TV, movies, series/seasons/episodes, favorites, account and search use native controls.
- Player: media play/pause keys or focused controls; VOD seek; live channel switching; audio/subtitles and next episode. Controls hide after2seconds while playing and return on remote input.
- Stopping/leaving playback releases its decoder/connection; resume is local to the current account/source.

## Existing services

API origin is `https://api.flixify.vip`. App uses login/refresh, `/me`, `/me/provider-session` and `/me/personal-library`. Personal provider metadata/media are fetched from the TV's IP using the verified HTTPS origin. It never switches to shared credentials, legacy native relay endpoints or cancelled proxies. Tokens are encrypted through AndroidKeyStore; provider credentials are memory-only. Account/source changes discard stale work and caches. Absolute access expiry is checked before playback and on resume; metadata is refreshed every60seconds and before opening media. Provider extension changes the cutoff without restarting a running engine.

Web delivery is a new versioned public APK under `/downloads/`, linked from anonymous and signed-in homepages and `/indir`. Existing Qt desktop and old download files remain separate. APK signature, SHA256, launcher/banner/minSdk, published MIME/HEAD/range/GET bytes and protected web-only deployment are release gates. Physical TV/box testing is performed by the user; automated emulator results do not claim every firmware/media codec works.
