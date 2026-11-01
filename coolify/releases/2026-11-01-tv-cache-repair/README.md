# Android TV cache repair: 1.4.5/code 13 publication

These tools do not change the native implementation. They verify a reviewed native build and publish only its static APK, update manifest and existing website download descriptor. API, worker, database, provider data and every other frontend source remain protected. No Play Protect setting change, silent permission grant, signing-key change or third-party security submission is included.

Source/rollback website is `flixify-ops-web:movie-discovery-c2ece2f6a774-20261101`, image `sha256:6f0a8b8ae11383d25a76d5ed6c3add935ea5d803415e164875e10a5d69c3fe32`, runtime revision `c2ece2f6a774c586e32364a129b5bbcba15b39b7`. Git baseline `fdbfa41ae058ab671a228c762b38faf95634f0c2` adds only reviewed channel tooling/evidence; the builder proves its web, shared-package and native trees equal that runtime revision before accepting a later freeze. Existing current API `cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1`, worker `9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57` and database `721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` remain pinned. The permanent registration fence retains original API249 proof, not the current payment API ID.

## Native freeze and artifact

Keep package `vip.flixify.tv`, version `1.4.5`/code13, Android minimum23/target35, nondebuggable release and current signing identity. The existing build uses the private local Android keystore; do not generate a replacement. Existing certificate SHA256 is `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`; both v1/v2 signatures are required. Published1.4.4 must remain byte-identical: SHA256 `1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f`, 1,355,944 bytes.

Commit the reviewed native sources first and record their exact commit/tree. Run the JVM/lint/release build and focused owned-emulator cache, artwork, favorites, lifecycle and updater regressions. Build/sign from that frozen tree; do not infer provenance from AGP's unsupported VCS metadata. Then generate independent artifact proof:

```sh
python3 coolify/releases/2026-11-01-tv-cache-repair/verify-android.py SOURCE_REPO --native-revision FULL_NATIVE_COMMIT --apk BUILT_145_APK --previous-apk apps/ops-web/public/downloads/flixify-pro-1.4.4.apk --apksigner /Users/Celebix/Library/Android/sdk/build-tools/36.0.0/apksigner --aapt2 /Users/Celebix/Library/Android/sdk/build-tools/36.0.0/aapt2 --output NEW_ARTIFACT_PROOF.json
```

The verifier invokes real signing/metadata tools, pins both old/new signatures and old bytes, records the new exact APK hash/size and refuses to replace existing proof. It does not install the app or submit its bytes elsewhere.

## Same-signer upgrade and cold launch

`verify-upgrade.py` is read-only by default. Its default strict mode requires an explicitly selected already-rooted owned Android emulator, exact published1.4.4 installed bytes, the independent new artifact proof/hash, and a reviewed JSON list of existing private fixture paths. It never roots a device, changes Play Protect/settings, grants permissions, clears/uninstalls the app or creates synthetic session/cache data itself. Prepare isolated fixture data beforehand; never point this QA at a customer's device/account. A production emulator that refuses root must use the explicit package-only mode below; failure in strict mode never falls back automatically.

The path list must include `shared_prefs/tv_encrypted_session.xml`, at least one file under `files/catalog-cache-v1/`, and at least one under `cache/artwork-v1/`. Only regular files in these narrow roots are hashed; file contents/tokens are not printed. Example shape:

```json
["shared_prefs/tv_encrypted_session.xml", "files/catalog-cache-v1/REVIEWED_EXISTING_FILE.bin", "cache/artwork-v1/REVIEWED_EXISTING_FILE.art"]
```

```sh
python3 coolify/releases/2026-11-01-tv-cache-repair/verify-upgrade.py --adb /Users/Celebix/Library/Android/sdk/platform-tools/adb --serial emulator-OWNED_SERIAL --apk BUILT_145_APK --apk-proof-file NEW_ARTIFACT_PROOF.json --apk-proof-sha256 ACCEPTED_PROOF_SHA256 --preserved-paths-file REVIEWED_PATHS.json --output NEW_UPGRADE_PROOF.json
```

Add `--run` after reviewing preflight. That explicitly force-stops only Flixify, installs the exact new APK with `adb install -r`, verifies installed1.4.5 bytes/code/name and unchanged firstInstallTime and public package UID, then compares all reviewed private file digests **before launching**. It cold-launches MainActivity, requires the same process still alive after five seconds, checks app focus and rejects fatal app logs. The result distinguishes file preservation from a real decrypted-login test (`sessionDecryptionVerified:false`); use the separate Android repository/session tests to verify decryption and cache migration. It makes no physical-TV/long-duration-playback claim and opens no provider media itself. Runtime network behavior still depends on the prepared isolated fixture and must be controlled by its operator.

For an owned emulator running an unrooted production image, select `--package-only` and omit `--preserved-paths-file`:

```sh
python3 coolify/releases/2026-11-01-tv-cache-repair/verify-upgrade.py --adb /Users/Celebix/Library/Android/sdk/platform-tools/adb --serial emulator-OWNED_SERIAL --apk BUILT_145_APK --apk-proof-file NEW_ARTIFACT_PROOF.json --apk-proof-sha256 ACCEPTED_PROOF_SHA256 --package-only --output NEW_PACKAGE_UPGRADE_PROOF.json
```

This explicit mode performs the same exact old/new APK, accepted signer proof, version, install-r, firstInstallTime, public UID and cold-launch checks without issuing a root command or reading private files. Add `--run` only after reviewing its preflight. Passing a private path list in package-only mode is rejected. Evidence records `verificationMode:"package-only"`, `privateFilesVerified:false`, `privateFilesPreservedBeforeLaunch:false` and `sessionDecryptionVerified:false`; it proves package upgrade and launch only, with no real-login or private-cache preservation claim.

## Narrow static publication

Only these changes may enter the website image:

- Modify `apps/ops-web/app/platform/tv-download.ts` with the exact1.4.4→1.4.5 string replacement.
- Add immutable `apps/ops-web/public/downloads/flixify-pro-1.4.5.apk` with accepted signed bytes.
- Modify `apps/ops-web/public/downloads/flixify-tv-update.json` with coherent package/name/code/minSdk/URL/hash/size/notes.

Copy these only after the native freeze, then commit publication without changing the native tree. New manifest uses the existing flat eight-field schema; URL is exactly `https://flixify.vip/downloads/flixify-pro-1.4.5.apk`, versionCode13, minSdk23. Notes follow the installed client's UTF16/control limits. Old1.4.4/all other APKs and every other public file/mode/link remain protected.

The runtime path JSON contains exactly:

```json
["apps/ops-web/app/platform/tv-download.ts"]
```

Independently measure the immutable current website with this profile's `snapshot_script()`; the only exclusions are descriptor, new APK, update JSON and `.next`. Do not reuse an earlier catalog-source fingerprint. Keep the accepted SHA/file count and APK/proof pins outside the checkout. Check actual server free space before compiling; the existing8GiB gate remains. No disk cleanup belongs to these tools.

```sh
python3 coolify/releases/2026-11-01-tv-cache-repair/test-release.py
python3 coolify/releases/2026-11-01-tv-cache-repair/build-web.py SOURCE_REPO --revision FULL_PUBLICATION_COMMIT --native-revision FULL_NATIVE_COMMIT --native-tree ACCEPTED_NATIVE_TREE --runtime-paths-file RUNTIME_PATHS.json --apk-sha256 ACCEPTED_APK_SHA256 --apk-bytes ACCEPTED_APK_SIZE --apk-proof-file NEW_ARTIFACT_PROOF.json --apk-proof-sha256 ACCEPTED_PROOF_SHA256 --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILES --protected-api-tag flixify-api:embedded-page-b0def990e266-20261101 --protected-api-id sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1
```

Default build is read-only. `--build` runs the reviewed network-isolated1280/1536MiB,256PID compiler with actual cgroup enforcement, exact Next config restoration and owned-container cleanup. `--verify-existing` checks an already-built candidate. Both retain full source/dependency/public/config/env/ancestry and host checks. Candidate HTTP verifies APK HEAD/MIME/range/full-body hash+size and exact update JSON. Unrelated services—including the narrowly pinned pre-existing external Keycloak crash loop—retain their established static identity checks. Candidate tag is `flixify-ops-web:tv-cache-repair-REVISION12-20261101`.

```sh
python3 coolify/releases/2026-11-01-tv-cache-repair/release-web.py --revision FULL_PUBLICATION_COMMIT --candidate-id VERIFIED_CANDIDATE_ID --protected-api-tag flixify-api:embedded-page-b0def990e266-20261101 --protected-api-id sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1
```

Release is read-only by default. After preflight, `--apply` synchronizes only the web image; `--recreate` replaces only ops-web. The inherited exclusive lock, completed registration fence, raw environment bytes, original registration profile and exact protected services remain enforced. `--rollback` restores only the current movie-discovery website, including its old update descriptor/manifest. No frontend downgrade, billing/data migration, API/worker restart, provider write or broad prune is authorized by this release.
