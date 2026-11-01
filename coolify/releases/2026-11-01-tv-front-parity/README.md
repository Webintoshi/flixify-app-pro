# Android TV 1.4.7 publication over the current website

This profile publishes a signed native update without replaying the welcome-offer website changes. It overlays exactly one existing website source leaf, the download descriptor, then adds one immutable APK and replaces the update JSON. It does not build/restart the API or worker, run migrations, install dependencies, prune Docker storage, open provider media or change device security.

## Exact baseline and scope

- Git baseline: `3010833e1c4b1a7ebe059580d820f6c6a02d03e7`.
- Live website: `flixify-ops-web:welcome-offer-3010833e1c4b-20261101`, `sha256:65a3d81e5337f292d180ffe98dee4e5661b29bf783fee0a33d16c9bfe86c59d2`.
- Protected API: `flixify-api:welcome-offer-a052006305ed-20261101`, `sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496`. No older API or unreviewed descendant is accepted.
- Protected worker: `flixify-worker:packages-8fa66d103053-20261101`, `sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57`; database `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
- Raw environment SHA256: `c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42`; completed registration-fence SHA256: `5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b`. The permanent fence still refers to original registration API249 and must not be rewritten to API241.

`runtime-paths.json` must contain only `apps/ops-web/app/platform/tv-download.ts`. Its entire delta must be the exact `1.4.6` to `1.4.7` replacement. Public changes are only the new `apps/ops-web/public/downloads/flixify-pro-1.4.7.apk` and existing `downloads/flixify-tv-update.json`. All welcome, checkout, pricing, movie, channel and other source/dependency files remain inside the complete untouched fingerprint. All other public files, modes and links are preserved.

Published baseline APK 1.4.6/code 14 is 1,374,125 bytes, SHA256 `911bbfc9d6513676d6c6605af1e07a4d9e81f9997bb44c32c17688ae9b34a4b6`. Existing update JSON is exactly 483 bytes, SHA256 `4d48c55550a17bd55ba8c5247da22ccae966ebe11fad4c2ab11f92bfcbd5a838`. Neither the previous welcome profile's eleven-leaf scope nor its old source fingerprint is suitable for this release.

## Freeze, signing and offline contracts

Freeze native sources first, then build/sign 1.4.7/code 15 with package `vip.flixify.tv`, minSdk 23, targetSdk 35, nondebuggable v1/v2 signatures and unchanged certificate SHA256 `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`. The verifier checks the actual APK and previous published APK with explicit Android tools; it never submits them to an external scanner.

```sh
python3 coolify/releases/2026-11-01-tv-front-parity/test-release.py
python3 coolify/releases/2026-11-01-tv-front-parity/verify-android.py SOURCE_REPO --native-revision FULL_NATIVE_REVISION --apk SIGNED_147_APK --previous-apk EXACT_PUBLISHED_146_APK --apksigner APKSIGNER_PATH --aapt2 AAPT2_PATH --output NEW_PRIVATE_PROOF.json
```

Record the verifier's native tree, APK SHA/size and proof SHA separately. The publication commit must descend from the native freeze and retain that exact native tree. Commit the descriptor, immutable APK and coherent update JSON only after the freeze. The JSON schema is unchanged: package, version, code, minSdk, HTTPS APK URL, digest, byte size and bounded release notes. No account credentials belong in these artifacts.

Upgrade QA explicitly requires the exact published 1.4.6/code 14 already installed on an owned emulator. `verify-upgrade.py` defaults to read-only preflight. An actual upgrade requires `--run`; it uses only `install -r`, preserves public UID/first-install time and checks installed bytes, cold launch/focus, five-second process survival and fatal logs.

```sh
python3 coolify/releases/2026-11-01-tv-front-parity/verify-upgrade.py --adb ADB_PATH --serial emulator-OWNED_SERIAL --apk SIGNED_147_APK --apk-proof-file NEW_PRIVATE_PROOF.json --apk-proof-sha256 ACCEPTED_PROOF_SHA256 --output NEW_UPGRADE_PROOF.json --package-only
```

On an unrooted owned emulator, keep explicit `--package-only`; the proof reports private-file/session verification false. The default strict mode requires an already-rooted owned fixture emulator and reviewed private fixture paths. There is no silent fallback, rooting, permission grant or security-setting change. Neither mode proves physical-TV behavior or decrypted customer login.

## Fresh measurement and bounded build

Independently measure the actual immutable `65a3…` image after the source allowlist is fixed. Exclude only the descriptor, new 1.4.7 APK, update JSON and `.next`. Save the full result privately, outside Git. Do not reuse or infer the previous fingerprint/file count.

```python
spec = importlib.util.spec_from_file_location('parity_profile', PROFILE_FILE)
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)
raw = subprocess.check_output([
    'docker', 'run', '--rm', '--network', 'none', '--read-only',
    '--memory', '512m', '--memory-swap', '640m', '--pids-limit', '128',
    '--entrypoint', 'node', profile.SOURCE_ID, '-e', profile.snapshot_script(),
], timeout=180)
```

The result supplies `sha256` and `files`. Before building, verify the live source/tag, exact API/worker/database and environment/fence. The inherited compiler requires 8 GiB free, runs network-disabled with 1280/1536 MiB and 256 PIDs, preserves source image configuration/environment, and removes only its owned temporary containers. Do not run concurrent Docker activity while host snapshots are compared. Existing exact external Keycloak crash-loop tolerance is retained; static configuration changes still fail.

```sh
python3 coolify/releases/2026-11-01-tv-front-parity/build-web.py SOURCE_REPO --revision FULL_PUBLICATION_REVISION --native-revision FULL_NATIVE_REVISION --native-tree ACCEPTED_NATIVE_TREE --runtime-paths-file coolify/releases/2026-11-01-tv-front-parity/runtime-paths.json --apk-sha256 ACCEPTED_APK_SHA256 --apk-bytes ACCEPTED_APK_BYTES --apk-proof-file NEW_PRIVATE_PROOF.json --apk-proof-sha256 ACCEPTED_PROOF_SHA256 --source-untouched-sha256 FRESH_SOURCE_SHA256 --source-untouched-files FRESH_SOURCE_FILE_COUNT --protected-api-tag flixify-api:welcome-offer-a052006305ed-20261101 --protected-api-id sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496
```

Default is preflight with no mutation. Add `--build` once; use `--verify-existing` for an existing candidate. Parse the verified candidate ID only after success. The candidate tag is `flixify-ops-web:tv-front-parity-REVISION12-20261101`. Verification checks the complete untouched tree, exact public delta and candidate-served APK HEAD/MIME/Range/full digest plus exact update JSON bytes. Next output is expected to change; no deterministic baseline `.next` reproduction is claimed.

## Website-only cutover

```sh
python3 coolify/releases/2026-11-01-tv-front-parity/release-web.py --revision FULL_PUBLICATION_REVISION --candidate-id VERIFIED_CANDIDATE_ID --protected-api-tag flixify-api:welcome-offer-a052006305ed-20261101 --protected-api-id sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496
```

Run the default read-only preflight, then `--apply` and `--recreate` serially under the inherited exclusive lock. Only `ops-web` changes. The exact current welcome API, worker, database, other projects, raw environment, registration fence and literal-empty web guard stay protected. Health failure restores only the website source `65a3…`; `--rollback` uses that same current frontend, not an older cache-repair image.

After cutover, verify the rendered download version/link, public update JSON, APK HEAD/Range/full hash/size, unchanged old 1.4.6 bytes, API health and protected production state. Preserve proof/log files privately. Record actual native tests and upgrade scope; do not infer a full-suite, physical-TV, real-card/provider-playback or new-hash Play Protect result.
