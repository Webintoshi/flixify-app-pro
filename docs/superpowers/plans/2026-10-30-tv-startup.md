# Branded Android TV Startup Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or superpowers:subagent-driven-development; root implements native and delegates isolated release guards/review.

**Goal:** Show the existing logo, Yükleniyor… and spinner until the first usable screen is drawn.
**Architecture:** MainActivity-only starting theme, then a lifecycle-safe overlay wrapping the existing target screen; validated ready surfaces dismiss at pre-draw.
**Tech Stack:** Existing Java17, AndroidAPI23+, native views and Gradle.
**Spec:** docs/superpowers/specs/2026-10-30-tv-startup-design.md

## Global Constraints

Keep existing palette/logo/player/authorization/remote behavior. No arbitrary delay, new network/preload request or dependency. Release1.4.1/code9, existing signer/min23. Preserve oldAPK/public files; only newAPK and updatedstaticmanifest/descriptor. Protect API/worker/DB,8GiBfloor,1280/1536MiB offline compiler.

## Review Focus

- Delayed, empty and error catalog must leave a usable terminal surface.
- Stale/stopped/recreated callbacks cannot dismiss the current pending overlay.
- Overlay covers resized viewport and blocks hidden navigation, preserving Back/focus.
- Cached/login/account restoration and later navigation do not incur fixed delay or repeated splash.
- Starting theme covers pre-view work on23–30/31+, while player theme remains original.

### Task1: Native startup

Files: MainActivity.java, new StartupScreen.java, launching drawable/styles/API31 styles, MainActivity manifest theme, StartupScreenTest.java; existing FakeTvRepository utility only as required.

- [x] Add and observe RED for delayed success/empty/network/auth/account/recreation/resize/navigation and branded launch resources.
- [x] Implement StartupScreen.show(View), ready(), cancelPendingFrame(), close(), isShowing()/isComplete() and integrate only valid terminal surfaces. Preserve hidden focus, allowBackexit, remove deferred frame listeners on lifecycle change.
- [x] Run focused tests, then existing native unit/instrumentation/lint/release regression and independent review. Capture actual offline loading screenshot.

### Task2: Compatible publication

Files: version/README, new build/release/test-tv-startup-web.py, immutableAPK, sharedstaticmanifest and TVdescriptor, verificationrecord.

- [x] Guard tests RED/GREEN for exact current runtime/native source freeze/APK A+JSON M/previouspublic preservation.
- [x] Freeze1.4.1/code9 native tree; signed build, exact identity/digest/no fixtures, compatible upgrade.
- [ ] Pin accepted source/artifact; protected bounded web build and web-only rollout.
- [ ] PublicHTTP/manifest/browser/unchanged service checks, commit verification and clean owned test/access resources.
