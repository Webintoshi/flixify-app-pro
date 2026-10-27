# Android TV APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Build and publish one remote-controlled Android TV test APK on existing Flixify homepage.
**Architecture:** Native Java Views, asynchronous scoped personal API repository, Media3 player, unchanged existing backend. Shared frozen TvModels/TvRepository interfaces allow disjoint data/UI/player work.
**Tech Stack:** Java17, AGP8.13.2, Gradle8.13, Media3 1.11.1, SDK36/min23/target35.
**Spec:** docs/superpowers/specs/2026-10-27-android-tv-design.md

## Global Constraints

- One common APK for ARM32/64/x86, no native ABI binaries. vip.flixify.tv,1.0.0-test.1/code1, Android6+.
- Existing16-character login, exact current movie allowlist, personal-only TV-origin metadata/media; no legacy relay/shared credentials.
- Encrypted tokens, secrets never logged/persisted in APK, provider credentials memory only; source/account cancellation and absolute cutoff, refresh60s and before playback.
- No actual production media test, provider/account changes, API/worker/bot/Edge/DNS deployment or suspended host actions. Fixture tests/local media only.
- Existing brand colors/signup preserved. Main homepage anonymous+signed-in link and /indir; new versioned download path only.
- Web base44bd380/ad05c921; protected worker539e01c/d5b9, API8cdbf9, actualDB721873. Resource/disk/candidate/cache guards preserved.

## Review Focus

- Every remote action reachable, Back exits logically and no focus traps in grid, category, IME or player track menus.
- Old account/source responses and token-refresh races never restore old access; cutoff cannot be extended by outage.
- Missing/unrecognized movie categories, malformed metadata/IDs and poster credential URLs fail closed.
- Activity stop/switch releases player and only one stream opens; controls hide after2s and reappear on D-pad.
- Test APK includes no test bypass/fixture secrets and published bytes/signature match the verified artifact.

### Task 1: Personal data repository

**Files:** Create under apps/tv-android/app/src/main/java/vip/flixify/tv/data/: NetworkTvRepository, TokenStore, ProviderParser and focused helpers. Tests in matching test paths. Consume root-owned TvModels/TvRepository; do not edit shared interfaces without parent.
**Interfaces:** Frozen root TvRepository.java and TvModels.java, callbacks main-thread, scope accountId:sourceVersion. Parent supplies build config/application factory.

- [ ] Write failing policy/parser and scope/cutoff tests; exact allowlist from existing web personal-provider.ts.
- [ ] Implement bounded async auth/refresh, encrypted session storage, provider metadata/categories/episodes/EPG, direct playback and library/resume. Serialize token refresh; generation guards and no secrets in errors.
- [ ] Verify unit tests/build with parent runner, report exact results/limits and commit owned files.

### Task 2: Complete TV remote UI

**Files:** MainActivity.java, TvUi.java, ArtworkLoader.java and UI-only resources/tests under apps/tv-android/app. Consume frozen repository/models; launch PlayerActivity with EXTRA_ITEM. No data/player/build/web edits.
**Interfaces:** TvApplication.repository(Context), TvRepository callbacks main thread; Item serializable scoped identifier, TvModels types. Tests may inject TvApplication.setRepositoryForTests only via instrumentation (no Intent/public bypass).

- [ ] Write focused instrumented D-pad cases for login/home/navigation/search/category/series/favorite/back and loading error recovery.
- [ ] Native TV margin/readability/grid, explicit focus and selection, initial focus/restore, complete login and account/logout. Keep colors from web; no signup/payments on TV.
- [ ] Verify offline fixture-only tests via parent emulator, report and commit owned files.

### Task 3: Native TV player

**Files:** PlayerActivity.java, player helpers/resources and focused tests. Consume frozen repository/models/application. No data/main UI/build/web edits.
**Interfaces:** EXTRA_ITEM serializable Item. repository.playback returns Playback(url,mime,expiresAtMs,resume,nextEpisode), refreshAccess returns Account; update cutoff without engine reset; currentScope must match item scope.

- [ ] Write cutoff/recovery/remote tests before behavior: VOD seek/pause, live zap, track selection, next episode,2s autohide, expiry/outage/source change/stop.
- [ ] Media3 hardware player and remote controls; bounded silent recovery, release old media before new, no production playback/diagnostic network tests.
- [ ] Verify offline media/fixture instrumentation via parent emulator, report and commit owned files.

### Task 4: Build, homepage and guarded publish

**Files:** Parent shared models/repository/factory, Gradle/manifest/resources/wrapper/build script and README; homepage landing.tsx/AppShell.tsx,/indir, styles or shared download metadata; versioned public APK; new build/release adapters and tests.

- [ ] Freeze contracts, set up reproducible verified Gradle/SDK build, launcher/banner/permission/network/backup metadata and stable test signing. Obtain official dependencies only.
- [ ] Integrate tasks, independent code review and fixture emulator tests; unit/lint/APK install/start and D-pad focus traversal. No fixture data/public bypass in shipped APK.
- [ ] Publish versioned APK artifact, verify manifest/signature/checksum and anonymous+signed-in homepage links and installation page. Run relevant web checks.
- [ ] New exact-source and APK-hash pinned web adapter, offline guard tests, bounded candidate build, protected rollout. Public HEAD/MIME/GET digest/range206 and real page links verified. Scoped own-cache cleanup only.
- [ ] Record results/physical-device limits, commit/push and provide direct APK download link.
