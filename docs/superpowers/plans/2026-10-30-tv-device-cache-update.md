# Android TV Device Cache and Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make verified catalog/artwork survive app restarts and provide verified in-app APK updates without changing playback permissions or the existing TV design.

**Architecture:** Private, bounded, account/source-qualified disk caches supplement existing RAM caches. Optional refresh/image work observes a shared playback gate. A separate updater verifies a static HTTPS manifest and downloaded APK before using Android's normal installer.

**Tech Stack:** Existing Java17/Android API23+, Media3, Gradle8.13, native Android UI, private files/SQLite as appropriate, existing Next.js website distribution.

**Spec:** `docs/superpowers/specs/2026-10-30-tv-device-cache-update-design.md`

## Global Constraints

- Preserve access expiry, source/account isolation, fresh playback authorization and memory-only provider credentials.
- Keep current colors/remote/player behavior and signer. New version1.4.0/code8, minimum API23.
- Do not fetch customer media for feature verification or start downloads while a player is active.
- Static Android update manifest only; no desktop/backend/bot/edge changes. No broad Docker cleanup or shared-service restart.

## Review Focus

- A stale response after logout/source replacement cannot write or display old data.
- Expired cached access cannot open media; network failure cannot extend the last verified deadline.
- Low disk/corrupt/interrupted cache writes cannot crash startup or erase the last valid snapshot.
- Same/newer malformed or wrongly signed APKs cannot reach the installer; permission cancellation remains recoverable.
- Returning from player or rotating/resizing the account page preserves focus and releases Activity references.

### Task1: Scoped metadata persistence

**Files:** `data/NetworkTvRepository.java`, `TvRepository.java`, new private cache classes under `data/`, relevant unit and Android tests.

**Interfaces:** Keep existing repository APIs. Add nested `TvRepository.CatalogObserver { void onCatalog(Catalog catalog); }` and default `AutoCloseable observeCatalog(CatalogObserver observer)` (no-op default for existing fake repositories). Background work consumes `vip.flixify.tv.BackgroundWorkGate.isPlaybackActive()`.

- [x] Write and observe failing persistence/isolation/expiry/corruption tests.
- [x] Implement bounded atomic disk storage without credentials/playable URLs, verified-source reuse, optional refresh on a separate bounded lane, and observer publication on the main callback executor.
- [x] Ensure explicit force refresh stays fresh and optional work yields before/between provider I/O when playback is active. Token rotation remains serialized on the original lane.
- [x] Run unit/instrumentation regression tests; review storage bytes and stale callback behavior.

### Task2: Persistent artwork

**Files:** `ArtworkLoader.java`, new focused disk cache class/tests. Root integrates callers.

**Interfaces:** `ArtworkLoader(Context)`, `load(ImageView,String address,String scope)`, existing `unbind`/`close`, plus `clear()` for explicit logout. Consume the same playback gate. Disk budget64MiB, existing RAM budget8MiB, individual response2MiB, existing decode bounds retained; disk writes stop when free space would fall below32MiB. TTL7days; scoped hashed keys and LRU eviction.

- [x] Write and observe failing restart/corruption/budget/account-separation tests.
- [x] Implement lazy bounded disk reads/downloads and atomic writes, preserving recycling tickets and stale-close protection.
- [x] Suppress optional downloads during playback; do not introduce bulk prefetch.
- [x] Test actual image decoding in the owned emulator and unit storage cases.

### Task3: Verified app updater

**Files:** new `vip/flixify/tv/update/` classes/tests, AndroidManifest.xml, `res/xml/update_paths.xml`. Root owns MainActivity and version fields.

**Interfaces:** Public `TvUpdater(Context)` with async `check(Callback<UpdateInfo>)`, `download(UpdateInfo,DownloadCallback)` and `close()`; immutable `UpdateInfo` exposes versionName, versionCode, minSdk, apkUrl, sha256, sizeBytes, notes. Callback methods `onResult`/`onError(String)`; download callback `onProgress(int)`, `onReady(File)`, `onError(String)`. `canInstallPackages()` and `requestInstall(Activity,File)` handle permission/installer Intents without silent grant. Expose any additional small lifecycle API in the handoff before root integration.

Manifest schema: packageName, versionName, versionCode, minSdk, apkUrl, sha256, sizeBytes, notes. Require own package, higher installed version code, minimum device compatibility, HTTPS flixify.vip/downloads/ versioned APK without userinfo/query/fragment, exact bytes/hash, same installed signing certificate. Cap manifest64KiB/APK32MiB. Download only after explicit account action. FileProvider exposes only private `cache/apk-updates/`.

- [x] Write and observe failing policy/HTTP/file verification tests.
- [x] Implement bounded updater and normal permission/install flow; no raw URLs/credentials logged.
- [x] Verify malformed/oversize/hash/signer/package/downgrade and cancellation behavior; preserve installed app on all failures.

### Task4: Integrate lifecycle and remote UI

**Files:** `BackgroundWorkGate.java` and test, MainActivity.java, PlayerActivity.java, app/build.gradle, README, account/remote instrumentation.

- [x] Write failing gate ownership tests and new account/observer interaction tests.
- [x] Implement an identity-owned playback gate; enter at player onStart and leave after onStop release (idempotent destruction cleanup).
- [x] Cold startup requests nonforced cached catalog, explicit Yenile stays forced. Subscribe while MainActivity is started; preserve category/query/focus when a new scoped catalog arrives and defer disruptive rebuild while a dialog is open.
- [x] Integrate scoped artwork and clear it on explicit logout. Add account-screen update status/check/download/install actions using existing TV controls; no automatic APK download or player overlay.
- [x] Build unit/lint/debug/release, run remote/player/decoder and cache/updater instrumentation in the owned emulator.

### Task5: Signed APK and protected website publication

**Files:** immutable new public APK, `platform/tv-download.ts`, static update JSON, new exact-pinned build/release wrappers and contracts, verification record.

- [x] Verify signature/package/minSDK/version/absence of fixtures and compatible upgrade from1.3.2.
- [x] Pin source APK SHA/size and generate static manifest from the actual accepted artifact.
- [x] Add exact web-only publication guards based on observed current996d4e4 image; keep all existing public assets and protected services unchanged.
- [ ] Run guard contracts, bounded candidate build/preflight, scoped web rollout and public APK/JSON HEAD/range/hash/browser checks.
- [ ] Commit verification and report actual results and physical-TV limitations.
