# Live channel curation and Android TV 1.4.4

These adapters reuse the reviewed search publication's bounded compiler and current website-only release transaction. They do not deploy API, worker or database services. Default execution is preflight. No production commands run from the offline tests.

The immutable source and rollback target are Git `d127d5955a26bb3ed345ac2d75b3870e6858f619`, tag `flixify-ops-web:home-artwork-d127d5955a26-20261031`, image `sha256:943cae7289b064d791b782c0d884f31b3e36c61febc7ca1097cde04efbf777d6`. Protected API remains `flixify-api:live-registration-8645860e0552-20261031` / `sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6`; worker D5 and database 721 remain pinned by the inherited transaction. Full environment bytes, Compose hashes, service identities and the three existing literal-empty registration overrides are protected.

## Accepted inputs

No candidate APK hash, native revision, native tree, source fingerprint or final runtime list is guessed or defaulted. The operator supplies the reviewed immutable values after native validation and source review.

- `--revision`: full publication commit, descending from the current source and native freeze.
- `--native-revision`, `--native-tree`: accepted native commit and exact `apps/tv-android` tree hash. Publication must preserve that tree.
- `--runtime-paths-file`: JSON array containing exactly the changed runtime source paths. The list must be unique, include the download descriptor, and stay within the narrow `RUNTIME_ALLOWLIST`. API/worker sources, dependencies, build configuration and playback policy are not allowed. Shared source changes are restricted to the contracts index and new curation module. Approved web source changes include the catalog, personal catalog/session, live presentation/favorites, legacy catalog, live directory/recent/personal helpers and download descriptor. The exact Git diff must equal the supplied paths plus the new APK and update JSON; regular test and documentation changes can accompany it.
- `--apk-sha256`, `--apk-bytes`: independently accepted 1.4.4 artifact fingerprint.
- `--apk-proof-file`, `--apk-proof-sha256`: independently reviewed local Android proof and its accepted digest. Proof pins the artifact, native freeze/tree, package `vip.flixify.tv`, version 1.4.4/code12, min23/target35, nondebuggable release, both v1/v2 signatures and existing signer `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`.
- `--source-untouched-sha256`, `--source-untouched-files`: fresh independently measured source-image fingerprint using this exact runtime list. Do not reuse an earlier homepage/search fingerprint.

The old 1.4.3 APK remains byte-identical: 1,347,386 bytes, SHA256 `6b60219f5cc91d1d229998e3e42a1a8d5f77c0416768baef22018995ffedf5bb`. Only `flixify-pro-1.4.4.apk` is added; the existing static update JSON and descriptor receive coherent version metadata. The full public tree check preserves old APKs, assets, modes and links.

## Generate independent Android proof locally

Build the release from the accepted native freeze using the existing signing process, then run:

```sh
python3 coolify/releases/2026-10-31-live-curation/verify-android.py SOURCE_REPO --native-revision FULL_NATIVE_COMMIT --apk EXACT_SIGNED_APK --previous-apk EXACT_PUBLISHED_143_APK --apksigner ABSOLUTE_APKSIGNER_PATH --aapt2 ABSOLUTE_AAPT2_PATH --output NEW_PROOF_JSON
```

This invokes actual Android tools with argument arrays, verifies both APKs against the existing certificate, checks release package/version/API metadata, records exact bytes and refuses to overwrite existing evidence. Source provenance still requires the build to have run from the accepted freeze; it is not invented from unavailable AGP VCS metadata. Compatible upgrade and emulator/TV checks are separate release acceptance requirements.

## Measure source fingerprint

On the target Docker host, import `build-web.py`, call `configure_paths(parse_runtime_paths(REVIEWED_PATH_FILE_BYTES))`, then run its `snapshot_script()` against immutable `SOURCE_ID` using an isolated read-only inspection container. The exclusions are precisely the accepted runtime paths, new APK, update JSON and `apps/ops-web/.next`. The old 1.4.3 APK, remaining public tree, dependencies and configuration are included. Review and record the returned SHA256/file count independently before passing them to the build.

## Preflight and candidate build

```sh
python3 coolify/releases/2026-10-31-live-curation/build-web.py SOURCE_REPO --revision FULL_PUBLICATION_COMMIT --native-revision FULL_NATIVE_COMMIT --native-tree ACCEPTED_NATIVE_TREE --runtime-paths-file REVIEWED_PATHS_JSON --apk-sha256 ACCEPTED_APK_SHA256 --apk-bytes ACCEPTED_APK_SIZE --apk-proof-file ACCEPTED_PROOF_JSON --apk-proof-sha256 ACCEPTED_PROOF_SHA256 --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default preflight validates all pins before compilation. Add `--build` only after acceptance, or `--verify-existing` for the exact already-built candidate tag. The builder requires 8 GiB free disk space, uses 1280 MiB memory/1536 MiB total, 256 PIDs and no compiler network, and removes only its own temporary container. New source leaves must be absent from the source image and have no symlink ancestor. Existing overlaid source files must match baseline Git bytes in the source image. Candidate verification retains source ancestry, configuration, dependencies, environment and the complete public tree, then verifies the APK's local HTTP HEAD, MIME, full SHA/size, Range and exact update JSON bytes without opening provider media.

Candidate tag: `flixify-ops-web:live-curation-REVISION_PREFIX-20261031`.

## Website-only publication

```sh
python3 coolify/releases/2026-10-31-live-curation/release-web.py --revision FULL_PUBLICATION_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only. `--apply` changes only the website image record. `--recreate` restarts only ops-web with no dependency rebuild/pull; failed candidate health restores the current artwork website. `--rollback` restores only source image 943cae. No broad Docker cleanup or service restart is performed.

Offline contracts:

```sh
python3 coolify/releases/2026-10-31-live-curation/test-web.py
```
