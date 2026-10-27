# Android TV cinematic update implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Deliver a cinematic responsive native TV update with automatic next episode and less avoidable live startup work.
**Architecture:** Keep Java Views/Media3 and repository contracts. Three independent file owners implement data, catalog UI and player; root exclusively operates SDK/emulator/build/release and integrates/tests.
**Tech Stack:** Java17, Android API23+, SDK36/target35, existing Media3 1.11.1/RecyclerView.
**Spec:** docs/superpowers/specs/2026-10-28-tv-cinematic-design.md

## Global Constraints

- Preserve existing colors, login, subscription rules, personal direct provider origin and scope guards.
- Auth/refresh/bootstrap stay serialized; optional EPG must not block playback.
- One decoder/stream at a time; no real provider stream or customer mutation in tests.
- Keep Android6+, one universal APK, stable package/signature and higher versionCode.
- No production services except the versioned APK web download overlay may change.

## Review Focus

- Long labels/font scale/short screens must retain reachable remote controls.
- Backgrounding, recreation and duplicate ENDED must never open duplicate or cancelled next episodes.
- Delayed EPG and changing credentials must not block playback or publish old-source data.
- Denial/expiry checks remain authoritative with warmed metadata.
- Startup patience must remain bounded and recovery after established playback still works.

### Task 1: Live data path

**Files:** NetworkTvRepository.java and NetworkTvRepositoryTest.java under apps/tv-android/app/src.
**Interfaces:** Keep TvRepository public API unchanged; Playback still carries canonical item/scope/expiry.
- [x] Write regressions for warm/cold LIVE metadata, forged item canonicalization, denied/changed-source bootstrap and EPG concurrency using in-memory connections.
- [x] Root runs targeted instrumentation and records expected RED.
- [x] Reuse validated LIVE cache after forced bootstrap. Separate EPG provider network lane from serialized context preparation; bounded queues, no token refresh on optional lane. Keep stale/cutoff invalidation.
- [x] Root verifies GREEN, existing repository suite and independent review.

### Task 2: Cinematic responsive catalog

**Files:** MainActivity.java, TvUi.java, new TvLayout.java/resources as needed; MainRemoteTest.java and a responsive UI instrumentation test.
**Interfaces:** Preserve TvModels/TvRepository, navigation order and current artwork loader. Do not edit PlayerActivity/player files.
- [x] Add failing bounds/reachability regressions for narrow/short bounds and long content.
- [x] Root records RED before implementation.
- [x] Implement measured adaptive layout, cinematic home/details, rail and artwork cards; login/account/dialog/focus paths still work.
- [x] Root verifies GREEN, original remote suite and screenshots at representative logical sizes; independent review.

### Task 3: Player and automatic next

**Files:** PlayerActivity.java, player/*, tv_player resources, PlayerRemoteTest.java, RealEngineSmokeTest.java and focused next-episode policy tests.
**Interfaces:** Keep TvRepository/Playback. Add compatible default engine listener first-frame method if needed; do not edit shared TvUi or MainActivity.
- [x] Add failing regressions for one-shot five-second auto-next, cancel/background/recreate/expiry, final episode, release-before-switch and bounded startup vs rebuffer watchdog.
- [x] Root records RED before implementation.
- [x] Implement responsive two-level controls/real timeline, current-item persistence, automatic countdown policy and actual first-frame signal.
- [x] Root verifies GREEN plus local Media3 first-frame, existing player remote/policy suite and screenshots; independent review.

### Task 4: Integrate, verify and publish update

**Files:** Gradle version, Android README, existing web tv-download descriptor and versioned public APK; web-only release tooling/record as needed.
- [x] Run complete Android unit/instrumentation/release lint once all edits settle; address actual failures and review findings.
- [x] Inspect actual screenshots for login/home/catalog/details/series/player/live across responsive bounds and D-pad reachability.
- [x] Set version 1.1.0-test.1/code2, assemble signed release, verify same certificate/universal content and release install.
- [x] Publish new immutable APK file and existing download links with guarded web-only source-pinned deployment; verify public signature/hash/HEAD/MIME/range/full GET, protected service identities and homepage/indir anchors.
- [x] Record evidence, commit/push authorized branch and report new install link plus measured verification limits.
