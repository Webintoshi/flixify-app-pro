# macOS test-download website publication

This profile adds an explicitly unnotarized Mac test DMG to the existing website. The new user instruction authorizes a public **test download**, with a visible Apple-verification warning; it does not authorize personal signing, notarization claims, a trusted Mac update descriptor or security-policy bypasses. The Mac public-signing gate is unchanged.

## Exact scope

- Source website: `flixify-ops-web:tv-front-parity-7ceb5becb006-20261101`, `sha256:9bd0bd2ad50aef4faec981fbffb4ba6e4d121004d3f6a9dab71b740eee904db4`.
- Website Git baseline: `7ceb5becb0060e5d768c24ae2aeb99f9cb9fb981`.
- Frozen native Mac source: `0e00365010566c5291153dcff7cdc451dc7adbd5`, tree `5f3078b1c58a64e01d2596ff462cc43d83345fdd`.
- Protected API: `flixify-api:welcome-offer-a052006305ed-20261101`, `sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496`.
- Protected worker: `flixify-worker:packages-8fa66d103053-20261101`, `sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57`.
- Protected database: `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
- Source overlay: the eight exact `PATHS` in `build-web.py`; only `app/platform/mac-download.ts` is new.
- Public addition: only `downloads/flixify-pro-macos-1.0.0-build2-test.dmg`, 44,517,156 bytes, SHA256 `ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d`.

Every existing public file, mode and symlink remains in the public-manifest comparison, including all APK versions and the exact 462-byte TV update manifest (SHA256 `f439fd197839cbc3773dacc226801718c8688a3c438467f74ac87d619a838680`). The complete untouched `/app` fingerprint excludes only the exact source overlays, new DMG and `.next`; dependencies, checkout, registration, catalogue/player source and other public files remain protected. Mac, Android, API and shared-package source freezes are checked independently.

## Offline contracts

```sh
python3 coolify/releases/2026-11-01-macos-download/test-release.py
```

These tests use synthetic Git repositories and mocked Docker commands. They do not read account credentials or contact production. The DMG gets its own exact-byte bound; the existing 32 MiB APK reader policy is not relaxed.

## Fresh source measurement

On the production host, from the accepted repository checkout, first collect the new independent source fingerprint. Do not reuse the old TV publication fingerprint: the exclusion set is different.

```sh
python3 coolify/releases/2026-11-01-macos-download/build-web.py --measure
```

This read-only operation verifies the actual current website/protected services and host/environment/fence, then reports `sha256` and `files` for the exact new exclusion set. Keep the full JSON privately. No other concurrent Docker activity should occur while snapshots are compared.

## Bounded candidate build

Commit the reviewed UI, descriptor, immutable DMG and this profile. Use a full exact publication revision and the fresh measurement values:

```sh
python3 coolify/releases/2026-11-01-macos-download/build-web.py SOURCE_REPO --revision FULL_PUBLICATION_REVISION --source-untouched-sha256 FRESH_SHA256 --source-untouched-files FRESH_FILE_COUNT
```

Default is preflight only. Add `--build` once; `--verify-existing` verifies a previously created candidate without rebuilding. The compiler retains the 8 GiB free-space floor, network-disabled 1280/1536 MiB limits and 256 PID cap. It removes only its own temporary container, retains the source image configuration/environment and restores Next configuration after the bounded compile.

Candidate verification checks the complete untouched tree and exact public addition, then serves the candidate in a separate bounded network-disabled container. It requires `/`, `/indir` and `/paketler` to return 200; the DMG's HEAD length/type, Range response, full size/SHA256 and UDIF trailer; and unchanged TV manifest bytes. Only a verified `web_candidate_verified:sha256:...` result supplies the cutover candidate ID.

## Website-only cutover

```sh
python3 coolify/releases/2026-11-01-macos-download/release-web.py --revision FULL_PUBLICATION_REVISION --candidate-id VERIFIED_IMAGE_ID --protected-api-tag flixify-api:welcome-offer-a052006305ed-20261101 --protected-api-id sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496
```

Run default preflight, then the same command with `--apply` and `--recreate` serially. The inherited exclusive release lock, registration fence, literal-empty web guard, raw environment and protected API/worker/database/other-project snapshots are retained. `--rollback` restores the current TV-front-parity source image. No migrations, provider traffic, bot changes, Docker pruning or unrelated service restart are performed.

Finally verify public HEAD/Range/full DMG checksum, retained TV manifest/APK bytes and API health. Inspect hydrated home and `/indir#macos` in the real browser for a working macOS link, test label, visible Apple-verification warning and responsive layout. Do not claim Gatekeeper acceptance or notarization for this ad hoc local-test artifact.
