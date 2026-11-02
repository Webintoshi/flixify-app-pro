# TV renewal recovery release profile

This profile overlays APK 1.4.9/code17 and four explicitly named web runtime files onto the immutable current analytics web image. The default pins deliberately stop both build and release entry points with `ROOT_ACCEPTANCE_PENDING`, before Docker or production state reads.

Root must independently review the exact native source commit/tree, artifact and real fixture UI evidence before filling local acceptance pins. Do not commit populated acceptance pins or invent a successful runtime receipt. The offline contract suite creates synthetic receipts exclusively inside temporary directories; these are not acceptance evidence.

## Required evidence

Run `verify-android.py --help` for local APK verification arguments. Supply the actual new APK, retained published 1.4.8 APK, Android SDK `apksigner` and `aapt2`, exact native revision and an absent output path. The verifier requires the existing single signer, both v1/v2 signatures, package `vip.flixify.tv`, version 1.4.9/code17, minSdk23/targetSdk35, non-debuggable release and exact retained APK hash/bytes. Hash the emitted proof into `apkProofSha256`.

The separate root-reviewed runtime JSON must have exactly these keys: `schema` (1), `packageName`, `versionName`, `versionCode`, `nativeRevision`, `nativeTree`, `apkSha256`, `verification` (`offline-instrumentation`), `passed`, `expiryRouting`, `remotePackageSelection`, `browserHandoff`, `activationReturn`, `staleAccountBlocked`, `activeAccountUnchanged` (all true), `realAccountUsed`, `realCheckoutStarted`, `providerPlaybackOpened` (all false), and `artifacts`.

Each artifact entry has exactly `file` (a unique plain basename), `bytes` and `sha256`. Store the actual logs/screenshots beside the runtime JSON. Symlinks, traversal, nested paths, changed bytes, missing checks or mismatched native/APK identities fail. Hash this JSON separately into `runtimeProofSha256`; its artifact hashes must describe actual fixture evidence, never a reconstructed receipt.

Acceptance pins require the exact native revision/tree, APK SHA256/bytes, both proof hashes and `acceptance: root-accepted-offline-runtime-evidence`. Root fills these only after review. Native source must remain identical through the later publication commit; protected applications/packages and historical release helpers must remain identical to baseline.

## Root sequence after acceptance

1. Retain the old APK; add only the accepted immutable new APK, update JSON and exact descriptor version replacement. Commit reviewed source and publication changes. Runtime overlay is exactly `tv-download.ts`, package `page.tsx`, `packages-model.ts`, `pricing.tsx`, APK and manifest. The two named package tests are source-only support.
2. On the actual production host, use `build-web.py --measure --apk-proof-file PROOF --runtime-proof-file RUNTIME`. Record the fresh untouched hash and file count from current image `sha256:dd2873797802a76c45052feb1a76a626adc2f04fa63a72f289350450169d4bfd`. No historical or offline substitute is valid.
3. Run `build-web.py REPO --revision EXACT_COMMIT --apk-proof-file PROOF --runtime-proof-file RUNTIME --source-untouched-sha256 ACTUAL_HASH --source-untouched-files ACTUAL_COUNT` for read-only preflight. Repeat with `--build`, or `--verify-existing` for an already built candidate. Both proof files remain required. Record the verified candidate image ID.
4. Run `release-web.py --revision EXACT_COMMIT --candidate-id EXACT_IMAGE_ID --apk-proof-file PROOF --runtime-proof-file RUNTIME` for transaction preflight, then the same command with `--apply` and `--recreate`. Root must use the exact candidate verified in step 3. The transaction changes only ops-web and protects API, worker, database, environment and registration fence. Retain rollback images and records.
5. Verify public full APK bytes/hash/HEAD/range, retained installers and manifest, rendered links and package query focus without checkout. Preserve actual receipts.

Both build and transaction require at least 8GiB free on `/var/lib/docker`. Compiler has network disabled, 1280MiB memory, 1536MiB combined memory/swap, one CPU and 256 pids; it checks CPU/pid bounds inside the container. Every other old public file/directory/link mode and byte must survive exactly. Historical helper bytes are pinned in `helper-pins.json` and never edited.

Offline check: `python3 coolify/releases/2026-11-02-tv-renewal-recovery/test-release.py`. This does not perform host operations, publish, prove real UI behavior or grant acceptance.
