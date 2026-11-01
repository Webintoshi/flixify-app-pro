# Welcome offer: narrow API, website and TV publication

This profile preserves the published one-time embedded checkout, movie discovery, live-channel policy and TV cache fixes. It does not install dependencies, change runtime environment values, restart the worker, alter existing financial records, clean Docker storage or weaken device security. Migration and reviewed Stripe coupon preparation are separate from these image tools.

## Immutable sources and scope

Git source baseline is `1e41bf2f092b2b87518af045aba9ce67dd16db05`. Actual production images are:

- Website `flixify-ops-web:tv-cache-repair-b9a7f606ba86-20261101`, `sha256:33e838ffbec2318214458b7a42868b58a974dac3cb48374cce3be63fc7064a63`.
- API `flixify-api:embedded-page-b0def990e266-20261101`, `sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1`.
- Protected worker `flixify-worker:packages-8fa66d103053-20261101`, `sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57`; database `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.

The permanent completed registration fence still pins original API249. Its proof must not be rewritten to the current payment API. Existing API proxy trust, two-account IP quota and guard reference, plus literal-empty overrides on other services, stay unchanged.

The API overlays six existing modules (`stripe-billing-routes`, `stripe-billing-store`, `stripe-billing-api`, `stripe-payment-api`, `stripe-payment`, `stripe-payment-store`) and adds `welcome-offer`, `welcome-offer-store`, `welcome-offer-routes`. Runtime destinations are exact `.ts` leaves under `apps/api/src/`; reviewed payloads live under this folder's `api-source/`. The actual production `server.ts` and `repository.ts` are never replaced with repository copies. Their separate patch descriptions require actual whole-file source digests and exactly two/one bounded, unique, nonoverlapping replacements. `api-source-manifest.json` pins all nine module digests/new flags and both patch-description digests. The compiler first reproduces the original actual API compiled output byte-for-byte, then overlays only these eleven runtime leaves. All other source, dependencies and configuration remain in the complete untouched fingerprint.

The website overlays exactly eleven regular leaves, listed by `build-web.py:PATHS`: three new welcome files under existing `app/platform/`, site shell, package page/model, pricing component/style, checkout activation callback, API helper and existing download descriptor. No directory subtree is excluded. Every other frontend file, including movie/catalog, channel controls and embedded-checkout stylesheet, remains covered by the untouched fingerprint. The only public changes are adding `downloads/flixify-pro-1.4.6.apk` and updating `downloads/flixify-tv-update.json`. Every previous APK and public mode/file/link stays byte-identical.

## Independent measurements before building

Freeze the API/web source allowlists before measuring. Never reuse a historical fingerprint. On the host, import this profile and save its `snapshot_script('api')` result against immutable API `cfc…` using a read-only, network-disabled 512/640MiB,128PID inspection container. The JSON must contain `sourceHashes` (null only for the three new files), `distEntries`, complete `dist` and complete `untouched` fingerprints. Save it outside the repository with private permissions. Import `build-web.py` and use `snapshot_script()` against immutable website `33e…`; exclusions are only the eleven exact leaves, new APK, updateJSON and `.next`.

Example Python measurement body, run separately for each image without other Docker activity:

```python
spec = importlib.util.spec_from_file_location('profile', PROFILE_FILE)
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)
script = profile.snapshot_script('api')  # use snapshot_script() for website
data = subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--memory', '512m', '--memory-swap', '640m', '--pids-limit', '128', '--entrypoint', 'node', IMMUTABLE_SOURCE_ID, '-e', script], timeout=180)
```

Full host/container/config/mount/network checks retain the previously documented exact external Keycloak crash-loop observation exception. Do not run concurrent Docker builders or inspection containers while a build is comparing host state. Both builders require at least8GiB free and retain the reviewed isolated1280/1536MiB,256PID compiler, original image configuration, environment bytes and owned-container cleanup.

## Tests, native freeze and builds

Run `python3 coolify/releases/2026-11-01-welcome-offer/test-release.py`. API candidate tests mount the combined welcome and historical billing suites read-only with fixture credentials and no network. Both release-source aliases resolve the actual verified candidate `apps/api/src`; tests do not execute a duplicate payload. Database-backed tests require their separate explicitly isolated fixture workflow and are not silently pointed at production.

```sh
python3 coolify/releases/2026-11-01-welcome-offer/build-backend.py SOURCE_REPO --service api --revision FULL_REVIEWED_REVISION --source-pin INDEPENDENT_CURRENT_API_PIN.json
```

Read-only preflight is the default; `--build` compiles and verifies a new immutable `flixify-api:welcome-offer-REVISION12-20261101` candidate. `--verify-existing` rechecks an existing candidate. There is no worker build mode.

Freeze native sources before publishing artifacts. Keep package `vip.flixify.tv`, release1.4.6/code14, minimumAndroid23/target35 and signer SHA256 `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594` with v1/v2 signatures. Published1.4.5 remains SHA256 `0557946f54082e60a171d5ada901b725e8308b7136d606efcb78233b5ff4d338`,1,367,652bytes. Build/sign from the accepted native commit, then run the new `verify-android.py` with the same arguments as the previous cache-repair verifier and `--previous-apk` pointing to1.4.5. It independently checks real signer/metadata tools and emits proof pinned to1.4.6/code14 and the actual native tree. It does not submit the APK to a third party.

The new `verify-upgrade.py` checks exact1.4.5/code13→1.4.6/code14 installation. Its default strict mode requires already-rooted owned-emulator private fixtures. Explicit `--package-only` mode supports an owned unrooted emulator, rejects unused private-path arguments, preserves public UID/firstInstallTime and verifies exact APK bytes plus cold launch/PID/focus/no fatal log. It reports private-file/session checks false. Neither mode roots a device, changes Play Protect, grants permissions or makes a physical-TV claim. Default is read-only; installation needs explicit `--run`.

Commit the download descriptor, signed APK and updateJSON after native freeze, preserving the exact native tree. Runtime-path JSON must list exactly `PATHS`; the manifest must use URL `https://flixify.vip/downloads/flixify-pro-1.4.6.apk`, coherent SHA/size and bounded notes.

```sh
python3 coolify/releases/2026-11-01-welcome-offer/build-web.py SOURCE_REPO --revision FULL_PUBLICATION_REVISION --native-revision FULL_NATIVE_REVISION --native-tree ACCEPTED_NATIVE_TREE --runtime-paths-file EXACT_RUNTIME_PATHS.json --apk-sha256 ACCEPTED_APK_SHA256 --apk-bytes ACCEPTED_APK_SIZE --apk-proof-file INDEPENDENT_APK_PROOF.json --apk-proof-sha256 ACCEPTED_PROOF_SHA256 --source-untouched-sha256 FRESH_WEB_UNTOUCHED_SHA256 --source-untouched-files FRESH_WEB_FILE_COUNT --protected-api-tag ACCEPTED_API_TAG --protected-api-id ACCEPTED_API_ID
```

The builder accepts the exact current API or a verified welcome API descendant of current`cfc…`, allowing both candidates to be built before cutover. Add `--build` or `--verify-existing` as appropriate. Candidate tag is `flixify-ops-web:welcome-offer-REVISION12-20261101`. Candidate checks cover complete untouched source/dependencies, public tree, exact APK HEAD/MIME/Range/full-body hash/size and exact updateJSON bytes.

## Staged publication and rollback

Apply additive migration `202611010003_welcome_monthly_offer.sql` separately with bounded transaction/lock checks and private-table RLS/revocations. Existing users are not backfilled; the new-account repository grant is part of that account's transaction. Preserve original package prices, existing pending full-price checkouts/catalog version, channel exclusions and provider configuration. Prepare/verify any approved50%coupon separately without creating charges.

Release API first while retaining the current website:

```sh
python3 coolify/releases/2026-11-01-welcome-offer/release-backend.py --service api --revision FULL_API_REVISION --candidate-id VERIFIED_API_ID --protected-web-tag flixify-ops-web:tv-cache-repair-b9a7f606ba86-20261101 --protected-web-id sha256:33e838ffbec2318214458b7a42868b58a974dac3cb48374cce3be63fc7064a63
```

Then release the website/APK while retaining that verified welcome API:

```sh
python3 coolify/releases/2026-11-01-welcome-offer/release-web.py --revision FULL_PUBLICATION_REVISION --candidate-id VERIFIED_WEB_ID --protected-api-tag VERIFIED_WELCOME_API_TAG --protected-api-id VERIFIED_WELCOME_API_ID
```

Both default to read-only preflight. Run `--apply`, then `--recreate` serially for each selected service. The inherited exclusive lock, raw `.env`, permanent registration fence, completed profile, database identity, other projects and worker remain protected. Web publication refuses the old API. No pull, rebuild or dependency restart occurs during recreation.

Automatic health failure restores only the current source of the selected service (`cfc…` API or`33e…` website). Additive schema is retained. Do not roll financial records back. After users have created discounted sessions, assess payment compatibility before a later manual API rollback; the old API does not understand discounted fulfillment. Preserve reservations for uncertain Stripe creation instead of issuing a second charge. API rollout must not consume a user's short offer window through an endpoint old clients already poll.
