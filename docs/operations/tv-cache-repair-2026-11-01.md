# Android TV 1.4.5 cache repair publication

Published 2026-11-01. Owner reported sluggish catalog/favorites after the prior update and exits to the TV launcher. Code inspection found blocking library refresh/projection, duplicate catalogue allocations and retired artwork work; no physical-device crash trace was available.

## Delivered behavior

- Persist source/account/expiry-scoped favorite metadata and library references. After current access verification, restore valid local catalog/favorites while optional refresh proceeds independently.
- Prepare missing/stale catalogue metadata after the first usable screen and during future update downloads. Images remain a bounded on-demand cache; no media files or full poster pack are downloaded.
- Stream provider rows and disk payloads instead of retaining duplicate whole JSON trees. Bound unknown tokens and nesting, preserve existing admission/filter semantics and cancellation checks.
- Move projection and artwork disk work off the UI thread, retire old-screen image work and release inactive catalogue/view memory. Pause optional work during memory pressure and preserve pending live callbacks until consumed.
- Retain the same package, signing identity, colors, remote/player behavior and verified access checks. No Redis/Dragonfly deployment was needed for these client-side stalls.

## Exact release

- Native freeze: `33b562aacb117763092294a6c1c8a864bf933463`; tree `c3a5347afacccce8a7ed1a1d75a906ca0817b719`.
- Publication commit: `b9a7f606ba868ce2722e216b58656aef1348e554`. Website delta is only the download descriptor, immutable new APK and update JSON.
- APK: `vip.flixify.tv`, 1.4.5/code13, minSdk23/target35, 1,367,652 bytes, nondebuggable v1/v2 signed release.
- APK SHA256: `0557946f54082e60a171d5ada901b725e8308b7136d606efcb78233b5ff4d338`.
- Signing certificate SHA256: `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`.
- Live web image: `sha256:33e838ffbec2318214458b7a42868b58a974dac3cb48374cce3be63fc7064a63`, tag `flixify-ops-web:tv-cache-repair-b9a7f606ba86-20261101`.

## Verification

- JVM: 107/107. Full connected Android suite: 203/203. After memory-pressure follow-up, repository49/49 and startup/lifecycle14/14 also passed on the owned Android TV emulator. Lint: zero errors, 42 warnings.
- Optimized release compilation and real apksigner/aapt2 verification passed. Actual published1.4.4 to new1.4.5 `install -r` preserved package UID/first-install time and passed cold launch/focus/five-second same-process/no-fatal-log checks.
- Upgrade QA explicitly used package-only mode on an unrooted production emulator. It did not verify private-file hashes, decrypted customer login, a physical TV or prolonged playback. The emulator and isolated AVD were removed afterward.
- Publication guard17/17 and supervisor9/9 offline contracts passed. Guarded live build completed with isolated compiler cgroup enforcement. All18,261 protected source files retained fingerprint `11f2eb2d47b26197f82df8675c138c58e157e47da88784c685f0db8b253ebbaf`.
- Production proof confirms API/worker/database and raw environment/registration fence unchanged. Prior movie-discovery web image `6f0a8b8a…fe32` remains the rollback target; original registration API249 fence is retained.
- Independent public HTTP checks passed: update manifest1.4.5/code13, APK HEAD200 and correct MIME, byte range206, full download bytes/SHA, and old1.4.4 unchanged. `/indir` visually shows1.4.5 and links to the new immutable APK.

Local evidence is under `work/artifacts/tv-cache-repair-20261101/`: artifact/upgrade/verification/live-HTTP/production proofs, actual emulator logs and release/download screenshots. Full remote production proof is `/tmp/flixify-tv-cache-publication-h71fnvqt/run/production-proof.json`, SHA256 `699c5edf756d455c38adeb689ecd62475464627aa85140edd0824bb50b1d84c1`.

## Remaining limits

The repaired paths reduce demonstrated allocation/UI pressure; the user's exact physical-TV exit cause remains unverified without its crash trace. New-hash Play Protect classification was not asserted or changed. Real provider playback was not opened during this task.

Provider-wide panel inspection covered16,070 streams and found no extra Turkish source for TLC, Teve2, tv100 or Flash Haber beyond the already tested MP2/timeout alternatives. No replacement was invented, and no support ticket or paid/new line was created. These four still need compatible provider audio or a separately designed conversion path.
