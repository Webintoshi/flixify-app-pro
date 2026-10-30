# Flixify Pro for Android TV

Native TV/box client, one architecture-independent APK. Android6/API23 or newer. Package `vip.flixify.tv`; version `1.4.0`, code8, launcher name `Flixify Pro`. Uses Android platform decoders through Media3; no ARM/x86 native extension is bundled. Real TV codec support still depends on its firmware/hardware.

## Build

Requirements: OpenJDK17, Android SDK36/build-tools36.0.0 and accepted SDK licenses. Set `ANDROID_HOME` or a private `local.properties` with `sdk.dir=...`. Gradle8.13 distribution is checksum pinned; AGP8.13.2 and Media31.11.1 come from official Google/Maven repositories.

```
./scripts/build-test-apk.sh
```

Output: `app/build/outputs/apk/release/app-release.apk`. The build script retains its historical filename. Release is optimized and not debuggable. It is signed with the existing local keystore; keep that private key safe for compatible updates. No keystore, token or provider credential is committed. Distribution uses the existing website download, without a Play Store submission. Update versionName/versionCode and use a new immutable filename for subsequent releases.

## Offline tests

```
./gradlew --no-daemon :app:testDebugUnitTest :app:lintDebug
./gradlew --no-daemon :app:connectedDebugAndroidTest
```

The connected tests require an Android TV emulator. Repository fixtures use no real accounts, providers or streams. The separate real Media3 smoke test decodes an official local MP4 fixture packaged only in the test APK. Trusted debug-only Java injection hooks are not exposed through Intents/URLs and are removed from the optimized release.

## Remote

- Direction keys move visible focus; OK selects. Back closes input/dialogs, hides active playback controls before leaving the player, restores catalog focus, then returns to navigation and exits at the root.
- Search uses a focused panel with live local result counts and sample titles; edits stay as drafts until Ara. Categories use a virtualized side panel, local finder, per-category counts and a selected mark independent of focus. Search and category remain intersected, Turkish-aware, and scoped to the current account/catalog. Native keyboard resize preserves the editor; Back/cancel restores the opener. Short screens simplify optional context so the action stays visible.
- Native TV keyboard enters the existing16-character account code and search. No signup or purchase is performed on TV.
- Live TV, movies, series/seasons/episodes, favorites, account and search use native controls.
- Cinematic artwork-led home and virtualized cards adapt to measured usable width and height; live logos use landscape FIT_CENTER cards, including mixed Favorites, and film/series posters retain their existing treatment. Focus is restored after resize.
- Card OK opens playback directly. A series starts its latest available saved episode, otherwise the first unwatched episode, otherwise its first episode for replay. The player retains a remote season/episode panel for manual selection. Favorites are added/removed with the player heart; episodes favorite the parent series. Returning to Favorites refreshes the list and restores nearby focus.
- Player: approved bottom title/tools, compact utility icons, thin remote seek timeline, translucent track panel with active selection, media keys, live channel switching and next episode. Movies/episodes omit the redundant on-screen play/pause, rewind, forward and Back row; the remote keeps these actions. OK on the VOD timeline or player background toggles playback, including replay at actual end; OK on a utility opens that utility. Hidden-player OK toggles playback; up/down reveals controls. Controls hide after2seconds while playing and remain during pause, track selection or continuation. Live controls are unchanged; live sources never seek.
- Each poster focus transition plays the user-supplied short opening cue (298ms), preloaded through SoundPool. Rapid moves retrigger a single stream; restored same-poster focus stays silent. Feedback stops on pause and releases on destroy, without requesting audio focus. Normal control/player sounds are unchanged.
- An episode's actual end starts a cancellable5second next-episode countdown, including the next available season. Back, replay/seek and leaving the foreground cancel it for that selected episode. The final episode does not start another stream.
- Stopping/leaving playback releases its decoder/connection; resume is local to the current account/source.

## Existing services

API origin is `https://api.flixify.vip`. App uses login/refresh, `/me`, `/me/provider-session` and `/me/personal-library`. Personal provider metadata/media are fetched from the TV's IP using the verified HTTPS origin. It never switches to shared credentials, legacy native relay endpoints or cancelled proxies. Tokens are encrypted through AndroidKeyStore; provider credentials are memory-only. Account/source changes discard stale work and caches. Absolute access expiry is checked before playback and on resume; metadata is refreshed every60seconds and before opening media. Provider extension changes the cutoff without restarting a running engine.

LIVE playback revalidates access before using its already verified scoped catalog, avoiding a full channel-list download for each selection. Optional EPG provider I/O has its own bounded worker after serialized context preparation; token rotation remains on the original serialized lane. Actual first-frame rendering distinguishes the30second initial preparation budget from a12second established playback stall. These changes remove avoidable client work; provider/network/physical-TV startup time still needs real-device feedback.

Web delivery is a new versioned public APK under `/downloads/`, linked from anonymous and signed-in homepages and `/indir`. Existing Qt desktop and old download files remain separate. APK signature, SHA256, launcher/banner/minSdk, published MIME/HEAD/range/GET bytes and protected web-only deployment are release gates. Physical TV/box testing is performed by the user; automated emulator results do not claim every firmware/media codec works.

## Device cache and updates

Catalog and series metadata are kept in a bounded64MiB private cache, partitioned by verified account/source and access expiry. Fresh snapshots are reused for6hours; older snapshots may be displayed for up to7days within the verified access period while optional background work refreshes them. Logout, source replacement or revoked access discards that scope. No bootstrap credentials or playable media URLs are stored in these snapshots. Playback still performs its existing access checks.

Artwork uses8MiB RAM and64MiB private evictable disk storage, with7day expiry and2MiB response limits. Both caches stop writing below32MiB available storage and tolerate eviction or corrupt files. Images are downloaded only as needed; no whole catalog image prefetch or video download is performed. Optional background metadata/artwork/update network work yields while the player is active. Remote focus and open search drafts survive catalog refreshes.

Hesabım → Güncellemeleri kontrol et reads the separate Android manifest at `https://flixify.vip/downloads/flixify-tv-update.json`. The user explicitly chooses download and installation. The client checks the fixed HTTPS download host/path, package, newer version, supported Android version, exact size/SHA256 and the installed app's signing identity before opening the standard Android permission/installer flow. Android still asks for installation approval. Existing1.3.2 users install1.4.0 once from the website to gain this in-app update feature. APK files are immutable per version; the static manifest advances only with a verified published APK.
