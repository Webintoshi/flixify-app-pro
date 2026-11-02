# TV 1.4.10 website publication profile

This profile prepares accepted APK 1.4.10/code18 over the actual analytics web image. Both entry points default to `ROOT_ACCEPTANCE_PENDING` before host reads. No populated acceptance pins or successful runtime receipt are included. The previous 1.4.9 profile was never deployed and must not be used for this publication.

## Fixed identities and scope

Native revision: `3d9b345d231f344cecb4e1c35449e3b54d1bedee`; Android tree: `943d1685ef04ceee561fa2c8b3d3868e4c78a114`.
Publication revision: `2345c1b59c930c5b249bde9035ef6869ba73d3f4`.
APK: 2,147,555 bytes, SHA256 `6c820efbe587a1486441e1991cf289c437e884657ee7d9edf81a3635d87057a9`.
The single original signer, v1/v2 signatures, package, minSdk23/targetSdk35 and non-debuggable release remain required.

The only runtime overlay is `apps/ops-web/app/platform/tv-download.ts`, `app/paketler/page.tsx`, `app/paketler/packages-model.ts`, `components/ui/pricing.tsx` (the latter three under `apps/ops-web`), the new 1.4.10 APK, and update manifest. These six blobs and modes must equal the publication revision. Every native path must equal the accepted native tree. The source-only 1.4.9 APK, old profile's seven named files, old plan/spec and two package tests are accepted only at their exact `ab8d3e8bbf8173733202f560547c5bea384c4dcc` modes/blobs; they are never copied to the live image. The performance plan/spec must equal the native freeze. Only the seven exact files in this new profile are additionally allowed. No directory-prefix support exception exists.

The current live image remains `sha256:dd2873797802a76c45052feb1a76a626adc2f04fa63a72f289350450169d4bfd`, based on `07fbf0bf4b29a1f07bb6b28d6dec740b80b9bda1`. A fresh measurement of that actual host image is mandatory. Every other public byte, mode and link is preserved, including 1.4.8 and all retained installers. API/worker/database images, environment, registration fence and analytics remain guarded at their pinned values. Both build/release require 8GiB free on `/var/lib/docker`; compiler limits remain network none, 1280MiB memory, 1536MiB memory+swap, one CPU, 256 pids.

## Root evidence review

Review actual evidence outside Git at `../artifacts/tv-speed-20261102/`. `artifact-proof.json` is supported in its exact existing schema, including immutable native/public identities, APK and source manifest hash, signer, release flags and `websitePublished: false`. Alternatively `verify-android.py` emits a separately verified local proof in its strict schema after APK/retained 1.4.8 SDK verification. It performs no device or host operations. Hash the actual chosen proof into `apkProofSha256`.

Create a separate root-reviewed runtime JSON outside Git; do not invent a receipt or infer pass results from file presence. Its exact keys are:

- `schema: 1`, `packageName: vip.flixify.tv`, `versionName: 1.4.10`, `versionCode: 18`, exact `nativeRevision`, `nativeTree`, `apkSha256`, and `verification: offline-instrumentation`.
- True booleans: `passed`, `catalogPerformancePassed`, `networkInstrumentationPassed`, `unitTestsPassed`, `focusedRemotePassed`, `lintReleasePassed`, `releaseBuildPassed`, `repeatedTrimPassed`, `boundedHeapPassed`.
- Exact integers: `unitTests: 172`, `networkInstrumentationTests: 51`, `catalogFixtureItems: 29000`.
- False booleans: `realAccountUsed`, `realCheckoutStarted`, `providerPlaybackOpened`.
- `artifacts`: 1–64 entries, each exactly `file`, `bytes`, `sha256`. Use unique plain basenames, 1–128MiB per file. Copy actual evidence beside the receipt without changing bytes; symlinks, directories and path traversal fail. Preserve all 26 final unit XMLs, final 51-test Network XML/log, before/after measurements, performance log and focused MainRemote evidence. Space-containing original XML names must be copied under plain distinct basenames.
- `evidenceFiles`: exactly `baselineMeasurements`, `afterMeasurements`, `finalBuildLog`, `finalNetworkXml`, `finalUnitXml`, `focusedRemoteXml`, `performanceLog`, each a nonempty list of unique artifact basenames already bound by `artifacts`.

Root must inspect the contents and limitations of those evidence files. The guards validate identity, required reviewed assertions, counts and evidence bytes; they do not rerun Android or infer truth from logs. The focused MainRemote evidence comes from the round-one targeted run; that XML also contains the subsequently fixed Network failure. Do not claim the original monolithic 153-test run or entire round-one XML passed. Final 172 units and all 51 Network instrumentation tests passed separately. Performance evidence is the offline debug emulator's 12k live + 12k movies + 5k series fixture, not a physical TV/provider guarantee.

Hash the reviewed runtime JSON into `runtimeProofSha256`. Only after review, fill local `release-pins.json` with exact native revision/tree, APK hash/size and both proof hashes; set `acceptance: root-accepted-offline-runtime-evidence`. Do not commit populated acceptance pins. Publication metadata must follow native freeze, and any later profile commit must preserve the pinned publication runtime/native/support blobs.

## Actual host sequence after review and access restoration

Use the reviewed profile from its exact committed revision; keep pins and evidence local. Obtain authorized host access first. Local browser access was disabled during preparation; no host action has been performed by preparing this profile.

1. Run `build-web.py --measure --apk-proof-file ACTUAL_PROOF --runtime-proof-file REVIEWED_RUNTIME` on the actual production host. Save its fresh untouched hash/file count and protected-state receipt. Historical values and local fixtures are invalid substitutes.
2. Run `build-web.py REPO --revision EXACT_PROFILE_COMMIT --apk-proof-file ACTUAL_PROOF --runtime-proof-file REVIEWED_RUNTIME --source-untouched-sha256 FRESH_HASH --source-untouched-files FRESH_COUNT` for read-only preflight. Add `--build`, or `--verify-existing` only for an existing candidate. Record the verified image ID. No action may begin with pending pins or missing evidence.
3. Run `release-web.py --revision EXACT_PROFILE_COMMIT --candidate-id VERIFIED_IMAGE_ID --apk-proof-file ACTUAL_PROOF --runtime-proof-file REVIEWED_RUNTIME` for transaction preflight. Repeat separately with `--apply`, then `--recreate`; preserve rollback records/images. Only ops-web may change; API/worker/DB/env/fence must remain identical.
4. Verify the real public website manifest, full APK hash/bytes, HEAD/range, retained installers, rendered download links and package query focus, without checkout or provider playback. Save actual receipts. GitHub raw APK availability alone does not publish `flixify.vip`.

Offline verification: `python3 coolify/releases/2026-11-02-tv-catalog-publication/test-release.py`. Temporary synthetic test receipts are never acceptance evidence. No host, network or publication operations run in this suite.
