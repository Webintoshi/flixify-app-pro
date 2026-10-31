# Homepage artwork quality patch

These minimal adapters reuse the [reviewed homepage build and release](../2026-10-31-home-2026/README.md), including its bounded compiler, public-download verification, protected-service snapshots, existing registration isolation, image-only transaction and website-only rollback.

Exact current source and rollback target:

- Git `cca30ce96a9137b85c40e32aed9cbce7d12c3e72`
- Image `sha256:4f0fb47292ddac6232bb302d7b82f1b26820d02c62e84ddc0fea152b7fe4e7bb`
- Tag `flixify-ops-web:home-2026-cca30ce96a91-20261031`

The complete runtime overlay is three **existing** files under `apps/ops-web/app/platform/`: `catalog.tsx`, `homepage-showcase.ts`, `homepage-hero.tsx`. No new runtime files are allowed. Regular app test changes may accompany the patch without being copied into the candidate. Public files, APK1.4.3, update JSON, native source, dependencies, configuration and all other runtime files remain unchanged.

The target is `flixify-ops-web:home-artwork-REVISION_PREFIX-20261031`. Do not use the earlier search website as this patch's source or rollback target.

## Independent acceptance and build

Obtain a **fresh independent** source fingerprint by running this adapter's `snapshot_script()` against the exact current source image. Its exclusions are only the three runtime paths and `apps/ops-web/.next`. Public files, APKs, manifests, dependencies and all other sources are included. The previous seven-path homepage fingerprint is invalid for this patch. No accepted fingerprint or file count is embedded in these adapters.

```sh
python3 coolify/releases/2026-10-31-home-artwork/build-web.py /tmp/flixify-playback-release --revision FULL_PATCH_COMMIT --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is preflight. Add `--build` after acceptance, or `--verify-existing` for an immutable candidate already built. The unchanged limits are an8GiB disk floor,1280MiB memory/1536MiB total,256PIDs and no compiler network. Source-image/Git parity, complete unchanged public tree, candidate ancestry/configuration, untouched fingerprint and APK HTTP contracts remain mandatory.

## Website-only release

```sh
python3 coolify/releases/2026-10-31-home-artwork/release-web.py --revision FULL_PATCH_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only. `--apply` synchronizes only the website image; `--recreate` recreates only ops-web with no dependency rebuild or pull. `--rollback` restores only current source homepage image4f0. API249, workerD5, database721, `.env` bytes, full Compose hashes and the three literal-empty registration-guard overrides remain protected exactly as in the reviewed release. No channel playback is needed for this frontend patch.

Offline verification, with no production connections or builds:

```sh
python3 coolify/releases/2026-10-31-home-artwork/test-web.py
```
