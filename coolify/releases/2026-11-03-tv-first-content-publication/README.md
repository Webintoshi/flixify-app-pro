# TV 1.4.11/code19 guarded publication

Preparation only. Both host entry points stop at `ROOT_ACCEPTANCE_PENDING` before host reads. Native revision/tree, later publication revision, APK bytes/hash, signing-proof hash, runtime-proof hash and exact reviewed test counts remain unfilled. Offline fixture success is not source acceptance or permission to publish.

The actual live baseline is `e7e62e43dd6b2caa691f10081af206d71d2b2f11`, tag `flixify-ops-web:tv-catalog-publication-e7e62e43dd6b-20261102`, image `sha256:718025341d2282758af5a086d6d2bcec8c81666de3de34022d14b7fa3afe4cf8`. API analytics image/tag, worker, database, `.env` digest and registration fence retain the exact 1.4.10 profile pins. A new actual-host measurement is required after evidence review; historical fingerprints and local fixtures cannot replace it.

Only three runtime leaves change: `apps/ops-web/app/platform/tv-download.ts`, `apps/ops-web/public/downloads/flixify-pro-1.4.11.apk`, and `apps/ops-web/public/downloads/flixify-tv-update.json`. The descriptor permits exactly the 1.4.10 → 1.4.11 substitution. Package handoff is already live and has no overlay. The full public manifest preserves every other byte, mode and link, including 1.4.10 and the seven older retained installers. Source-only 1.4.9 is already in the Git baseline, must remain absent from the image, and is never copied.

Git scope is BASE → exact profile revision. Native regular files must equal the complete accepted Android tree; the two exact first-content plan/spec files must equal the native freeze. The three runtime leaves must equal the separate later publication revision. Only the seven explicitly named files in this profile may additionally change. No support-directory or documentation-prefix exception exists. Ancestry is BASE ≤ native < publication ≤ profile, and the Android tree must match at all three release revisions. Deleted native files, symlinks, runtime mode drift and unrelated changes fail.

## Review and local acceptance pins

Root first completes the actual native suite, inspects all evidence and freezes native before publication metadata/APK. Preserve the original single certificate `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`, v1/v2 signatures, `vip.flixify.tv`, minSdk23, targetSdk35 and non-debuggable release. `verify-android.py` can independently verify the actual APK and retained 1.4.10 APK using root-selected local SDK tools; it performs no device/host operations. Its strict proof contains schema/nativeRevision/nativeTree/packageName/versionName/versionCode/minSdk/targetSdk/sha256/sizeBytes/certificateSha256/baselineApkSha256/baselineApkSizeBytes/signatureSchemes/releaseDebuggable. Hash the untouched proof into `apkProofSha256`.

Create the reviewed runtime JSON outside Git, beside its actual artifacts. Exact keys:

- `schema: 1`, package/version/code/minSdk/targetSdk as above; exact `nativeRevision`, `nativeTree`, `publicationRevision`, `apkSha256`; `verification: offline-instrumentation`.
- True booleans: `passed`, `unitTestsPassed`, `fullInstrumentationPassed`, `lintReleasePassed`, `releaseBuildPassed`.
- `unitTests` and `instrumentationTests`: exact actual reviewed totals, equal acceptance pins, at least 172 and 153 respectively. `catalogFixtureItems: 29000`.
- False booleans: `realAccountUsed`, `realCheckoutStarted`, `providerPlaybackOpened`.
- `instrumentationCommand`: the actual complete unfiltered command. It must include `connectedDebugAndroidTest`, reject class/method filtering, and appear verbatim with `BUILD SUCCESSFUL` in the bound final instrumentation log. Preserve the full actual Gradle log and full XML evidence.
- `artifacts`: 1–64 entries, each exactly `file`, `bytes`, `sha256`. Names must be unique plain basenames; each file is a regular 1–128MiB file, all artifacts total at most 256MiB. Symlinks, traversal, altered bytes, duplicate keys and unsupported fields fail.
- `evidenceFiles`: exactly `finalUnitXml`, `finalInstrumentationXml`, `finalInstrumentationLog`, `finalBuildLog`, `performanceLog`, `firstContentJson`. Each is a nonempty list of unique names bound by `artifacts`. XML testcase counts must equal the exact reviewed pins; failures, errors, skipped tests and duplicated testcase coverage fail.

Each bound first-content JSON has exactly `schema: 1`, `catalogFixtureItems: 29000`, true `callbackGatesPassed`, `diskGatesPassed`, `artworkGatesPassed`, `accountGatesPassed`, and nonempty `callbacks`, `diskReads`, `uiMeasurements` arrays. Each row is exactly `{name, elapsedMs, thresholdMs}` with a unique observed name within its array, finite nonnegative elapsed time, a positive threshold and elapsed ≤ threshold. Callback budgets cannot exceed 500ms. Root derives actual rows from actual logs/XML; these guards validate shape, reviewed assertions and bytes, and do not manufacture measurements or infer truth from evidence presence. Document emulator/controlled-transport limitations separately; this evidence does not establish physical-TV or provider latency.

After review only, populate a local `release-pins.json`, including separate publication revision, exact actual counts and both proof hashes, and set `acceptance: root-accepted-offline-runtime-evidence`. Keep populated pins/evidence outside committed source. The committed default remains pending. Final actual-source validation is blocked until those refs/evidence exist.

## Actual-host sequence after root acceptance

Use the exact reviewed committed profile plus its frozen historical helper chain and local pins/evidence. Root chooses staging. A child commit can be fetched into an existing 1.4.10 staging repository without changing that checkout, then only this new profile materialized; no staging command was executed during preparation.

1. `build-web.py --measure --apk-proof-file ACTUAL_PROOF --runtime-proof-file REVIEWED_RUNTIME` reads the actual host and produces its fresh untouched fingerprint/count. Preserve that receipt and protected-state evidence.
2. `build-web.py REPO --revision EXACT_PROFILE_COMMIT --apk-proof-file ACTUAL_PROOF --runtime-proof-file REVIEWED_RUNTIME --source-untouched-sha256 FRESH_HASH --source-untouched-files FRESH_COUNT` performs read-only preflight. Add `--build` to compile or `--verify-existing` to verify an existing exact candidate. Record its verified image ID.
3. `release-web.py --revision EXACT_PROFILE_COMMIT --candidate-id VERIFIED_IMAGE_ID --apk-proof-file ACTUAL_PROOF --runtime-proof-file REVIEWED_RUNTIME` performs transaction preflight. Root separately invokes `--apply` then `--recreate`; preserve rollback records/images. Only ops-web changes.
4. Root verifies the actual canonical website manifest/APK hash/size, HEAD/range, retained installers and rendered download/update links. GitHub raw availability alone is not website publication. No checkout or provider playback is required.

Build and release preserve the 8GiB free-space floor on `/var/lib/docker`. Root's latest observed 8.02GiB is only slightly above it; do not loosen the floor or treat that reading as a future guarantee. Compilation remains network none, 1280MiB memory, 1536MiB memory+swap, one CPU and 256 pids, with cgroup verification. The existing web-only lock/transaction, protected images, environment/fence checks and rollback guards remain in use.

Offline verification: `PYTHONDONTWRITEBYTECODE=1 python3 coolify/releases/2026-11-03-tv-first-content-publication/test-release.py`. All synthetic repositories/evidence stay in temporary directories. No Docker, host, network, SDK, account or publication operations run in this suite.
