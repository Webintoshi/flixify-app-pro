# Forced Analytics Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start the existing analytics runtime as accepted on web/PWA, Android TV, macOS and Windows, remove every in-app analytics permission surface, then publish only artifacts that pass their established release gates.

**Architecture:** Each client keeps its current analytics configuration checks, event allowlists and sensitive-data filters, but migrates any missing or rejected preference to accepted during runtime initialization. Consent presentation and mutation controls are removed at the UI boundary. Native publication remains platform-specific and cannot bypass operating-system signing, notarization or installer approval.

**Tech Stack:** Next.js/React/Vitest, Android Java/Gradle/JUnit/Firebase Analytics, Swift/SwiftUI/SwiftPM/Firebase Analytics, C++/Qt Quick/CMake/CTest, Coolify and existing guarded release scripts.

**Spec:** `docs/superpowers/specs/2026-11-03-forced-analytics-consent-design.md`

## Global Constraints

- Existing event allowlists, private-data filters, analytics configuration validation and playback access rules stay unchanged.
- No advertising identifier, advertising collection, camera, microphone, location or file permission is added.
- Android package installer, macOS Gatekeeper/notarization, Windows SmartScreen and destructive-action confirmations are not bypassed.
- `sources/` and synced project files remain read-only.
- No release is called live unless the established artifact proof and public endpoint checks pass.

## Review Focus

- A stored `rejected` value must migrate to accepted rather than re-disable collection after focus/storage synchronization.
- Missing or malformed analytics configuration must still prevent collection even though consent is accepted.
- StrictMode/remounts must not duplicate page or screen events.
- No analytics banner, dialog, footer button, account checkbox or settings toggle may remain reachable.
- A stale callback admitted before runtime migration or reinitialization must not duplicate or leak a private value.

---

### Task 1: Web/PWA Forced Acceptance and Consent UI Removal

**Files:**
- Modify: `apps/ops-web/app/platform/analytics-policy.test.ts`
- Modify: `apps/ops-web/app/platform/analytics-provider.test.tsx`
- Modify: `apps/ops-web/app/platform/analytics-policy.ts`
- Modify: `apps/ops-web/app/platform/analytics-provider.tsx`
- Modify: `apps/ops-web/app/platform/analytics.ts`
- Modify: `apps/ops-web/app/platform/landing.tsx`
- Modify: `apps/ops-web/app/components/home/HomeFooter.tsx`
- Modify: `apps/ops-web/app/site-shell.tsx`
- Modify: `apps/ops-web/app/ayarlar/page.tsx`

**Interfaces:**
- Consumes: existing `createAnalyticsRuntime(deps)` and `webAnalytics()` singleton.
- Produces: an always-accepted configured runtime with no public consent mutation or presentation surface.

- [ ] **Step 1: Write failing web tests**

Add tests named `migrates missing and rejected storage to accepted without a prompt` and `renders no analytics permission controls on public and account surfaces`. Assert literal accepted storage, configured collection behavior, no permission text/buttons, and no duplicate page event under StrictMode.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run apps/ops-web/app/platform/analytics-policy.test.ts apps/ops-web/app/platform/analytics-provider.test.tsx`

Expected: FAIL because the runtime restores unknown/rejected consent and the current UI renders permission controls.

- [ ] **Step 3: Implement minimal web behavior**

Initialize and persist `accepted` in `createAnalyticsRuntime`; make storage synchronization preserve forced acceptance. Reduce `AnalyticsBoundary` to lifecycle/page tracking and remove consent UI exports/usages. Keep config validation and event/privacy filtering intact.

- [ ] **Step 4: Verify GREEN and build**

Run: `npx vitest run apps/ops-web/app/platform/analytics-policy.test.ts apps/ops-web/app/platform/analytics-provider.test.tsx`

Run: `npm run build:ops`

Expected: all selected tests pass and the Next.js production build exits 0.

### Task 2: Android TV Forced Acceptance and Dialog Removal

**Files:**
- Modify: `apps/tv-android/app/src/test/java/vip/flixify/tv/AnalyticsPolicyTest.java`
- Modify: `apps/tv-android/app/src/main/java/vip/flixify/tv/AnalyticsPolicy.java`
- Modify: `apps/tv-android/app/src/main/java/vip/flixify/tv/TvAnalytics.java`
- Modify: `apps/tv-android/app/src/main/java/vip/flixify/tv/MainActivity.java`
- Modify: `apps/tv-android/app/build.gradle`

**Interfaces:**
- Consumes: `AnalyticsPolicy(boolean configured, Sink sink)` and `TvAnalytics.get(Context)`.
- Produces: configured analytics enabled at initialization, persisted accepted version, no dialog/account preference action, APK version `1.4.12` code `20`.

- [ ] **Step 1: Write failing Android tests**

Add `configuredPolicyStartsAcceptedWithoutAChoice` and update stale-epoch coverage to prove generation invalidation still works. Extend the existing authenticated Activity instrumentation flow to assert that no focusable control or visible text exposes the analytics permission action.

- [ ] **Step 2: Verify RED**

Run from `apps/tv-android`: `./gradlew testDebugUnitTest --tests vip.flixify.tv.AnalyticsPolicyTest`

Expected: FAIL because configured policy currently starts disabled and consent UI still exists.

- [ ] **Step 3: Implement minimal Android behavior**

Start configured policy accepted, persist version/accepted on `TvAnalytics` construction, initialize Firebase only when valid release config exists, remove `dialog`, `offerAnalytics`, status/preference controls and their focus links, then bump the immutable APK version.

- [ ] **Step 4: Verify GREEN and release APK**

Run from `apps/tv-android`: `./gradlew clean testReleaseUnitTest assembleRelease`

Expected: unit tests pass and `app/build/outputs/apk/release/app-release.apk` exists with version `1.4.12` code `20`.

### Task 3: macOS Forced Acceptance and Consent UI Removal

**Files:**
- Modify: `apps/macos-native/Tests/FlixifyCoreTests/AnalyticsPolicyTests.swift`
- Modify: `apps/macos-native/Sources/FlixifyCore/Models.swift`
- Modify: `apps/macos-native/Sources/FlixifyMac/Support/FlixifyAnalytics.swift`
- Modify: `apps/macos-native/Sources/FlixifyMac/Views/RootView.swift`

**Interfaces:**
- Consumes: `AnalyticsPolicy(configured:sink:)` and `FlixifyAnalytics.shared`.
- Produces: accepted configured analytics at app initialization and no consent overlay/settings toggle.

- [ ] **Step 1: Write failing macOS tests**

Add `testConfiguredPolicyStartsAcceptedWithoutChoice` and retain withdrawal-generation assertions as an internal safety contract. Assert an event is admitted immediately only when configured.

- [ ] **Step 2: Verify RED**

Run from `apps/macos-native`: `swift test --filter AnalyticsPolicyTests`

Expected: FAIL because policy currently requires `choice(accepted:version:)`.

- [ ] **Step 3: Implement minimal macOS behavior**

Initialize configured policy accepted, migrate UserDefaults to accepted in `FlixifyAnalytics.init`, apply the valid Firebase configuration, and remove the RootView consent overlay and Settings toggle/status while preserving all filters.

- [ ] **Step 4: Verify GREEN and package gates**

Run from `apps/macos-native`: `swift test`

Run: `python3 -m unittest discover -s scripts/tests -v`

Run: `python3 scripts/build-app.py --configuration release`

Expected: tests pass and the universal release app proof is created. Public packaging proceeds only if the approved organization identity and notary profile are present.

### Task 4: Windows Forced Acceptance and Consent UI Removal

**Files:**
- Modify: `apps/windows-native/tests/analytics_test.cpp`
- Modify: `apps/windows-native/tests/repository_test.cpp`
- Modify: `apps/windows-native/tests/ui_smoke.cpp`
- Modify: `apps/windows-native/src/analytics.cpp`
- Modify: `apps/windows-native/qml/Root.qml`
- Modify: `apps/windows-native/qml/AccountPage.qml`

**Interfaces:**
- Consumes: `DesktopAnalytics`, `DesktopRepository::analyticsChoice()` and existing measurement bridge.
- Produces: stored/default choice `accepted`, no QML consent dialog or account checkbox, unchanged event and privacy boundaries.

- [ ] **Step 1: Write failing Windows tests**

Add `defaultsAndMigratesAnalyticsConsentToAccepted` and update repository/UI smoke expectations to require no prompt and no consent control while preserving authenticated playback and event delivery.

- [ ] **Step 2: Verify RED**

Run on the available local Qt preset: `cmake --build --preset local-qa && ctest --preset local-qa --output-on-failure`

Expected: FAIL because an empty/rejected preference currently exposes the prompt and disables collection.

- [ ] **Step 3: Implement minimal Windows behavior**

Normalize the loaded analytics choice to `accepted` and persist it, remove the Root QML dialog and Account checkbox/copy, and keep generation/configuration/authentication gates unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `cmake --build --preset local-qa && ctest --preset local-qa --output-on-failure`

Expected: all locally supported Windows source tests pass. The Windows 2022 workflow remains the authority for package verification.

### Task 5: Cross-Platform Review and Documentation Consistency

**Files:**
- Modify: `apps/tv-android/README.md`
- Modify: `apps/macos-native/README.md`
- Modify: `docs/superpowers/specs/2026-11-03-forced-analytics-consent-design.md` only if implementation facts differ.

**Interfaces:**
- Consumes: Tasks 1-4 behavior.
- Produces: accurate temporary behavior documentation without claiming OS permission bypass or unsupported live status.

- [ ] **Step 1: Update stale consent documentation**

Replace claims of explicit optional choice with the temporary forced-acceptance behavior and preserve the exact privacy/filter/configuration boundaries.

- [ ] **Step 2: Run full available suites**

Run root `npm test`, web targeted tests/build, Android release tests/build, macOS tests/build, and local Qt CTest. Record every unavailable or failing command by name.

- [ ] **Step 3: Inspect the final diff and UI strings**

Run `rg -n 'İzin ver|İzin verme|İstatistik tercihleri|Kullanım analizi tercihi|analyticsConsentDialog|analyticsConsentSetting' apps/ops-web apps/tv-android apps/macos-native apps/windows-native`.

Expected: no analytics permission surface remains outside tests/history/docs that intentionally describe migration.

### Task 6: Guarded Live Publication

**Files:**
- Create/modify release metadata under a new `coolify/releases/2026-11-03-forced-analytics-consent/` directory only by adapting the current guarded web/APK publication pattern.
- Modify download descriptors only after artifact hash, package identity and version checks pass.

**Interfaces:**
- Consumes: verified Task 1 build and verified native artifacts from Tasks 2-4.
- Produces: live web deployment and only those native downloads whose established public gates pass.

- [ ] **Step 1: Commit reviewed source and push the configured release branch**

Commit the spec, plan, tests, implementation and accurate docs. Push only after every locally available verification command is green. The push triggers the existing Windows native workflow for changed Windows sources.

- [ ] **Step 2: Publish web through the existing protected Coolify web flow**

Build a new overlay from the verified live base, run the release script in read-only mode, then apply it. Verify the deployed HTML/JS has no consent copy or controls and the authenticated analytics config remains valid.

- [ ] **Step 3: Publish Android TV 1.4.12 only after package proof**

Verify APK signer continuity, application ID, version/code, min SDK, SHA256, size and optimized non-debuggable manifest. Publish an immutable filename and matching update/download descriptors, then verify public HEAD/range/GET bytes and hashes.

- [ ] **Step 4: Publish macOS only if trust gates are available**

Run `package-release.py` with the approved organization identity, identity policy and notary profile. Publish only if app and DMG notarization, stapling and Gatekeeper verification succeed. Otherwise report macOS public release as blocked without weakening security.

- [ ] **Step 5: Accept Windows package only after GitHub workflow proof**

Wait for `Windows native TEST package`; verify all build, CTest, UI smoke, privacy, dependency, installer and hash gates. Publish/update website bytes only if the workflow produces the verified artifact; otherwise report the exact failed gate.

- [ ] **Step 6: Verify live endpoints and behavior**

Check public website routes, download descriptors and artifact bytes. Confirm no analytics permission surface appears after a clean session or login, collection remains disabled when configuration is absent, and no console/runtime error is present.

