# 2026 homepage website-only release

Source website: `flixify-ops-web:search-activation-50e3bd7af5a4-20261031`, immutable image `sha256:ddc80c1fac256161fbf6d61099021200e9271e1af37a6688fe614fd11f19150f`. Its Git baseline is `50e3bd7af5a476e5e6ac5dd013be148e942c5c0b`. Rollback restores this website, retaining search activation and APK1.4.3. Older websites are not acceptable rollback targets.

## Reviewed boundary

Existing runtime files, relative to `apps/ops-web/app/platform/`:

- `catalog.tsx`
- `types.ts`
- `personal-provider.ts`

New runtime files:

- `catalog-release-year.ts`
- `homepage-showcase.ts`
- `homepage-hero.tsx`
- `homepage.module.css`

Every existing overlay file and `next.config.ts` must match the exact source image and baseline Git bytes. New files must be regular Git blobs, absent from the baseline and source image, with no symbolic-link ancestors. The full website diff may contain only the runtime allowlist and regular `app/**/*.test.{ts,tsx,mts,...}` files. Tests are not copied into the image. The Android source tree must remain identical to the baseline.

The entire public tree stays unchanged, including all APKs, logos, update-manifest bytes, modes and symbolic links. Dependencies and all source outside the explicit runtime allowlist also stay unchanged. No installation or dependency update occurs.

## Independent source acceptance

Before building, independently run this adapter's `snapshot_script()` in the exact source image and retain its JSON result. `untouched(SOURCE_ID)` is a bounded, network-disabled reader for that purpose. The accepted result must have shape `{"sha256":"64 lowercase hex characters","files":positive_integer}`.

The exclusion list is exactly the seven runtime paths above and `apps/ops-web/.next`. It does **not** exclude public files, APKs, manifests, node_modules, API/worker sources or environment/configuration files. Do not reuse any previous release's fingerprint or file count. No accepted fingerprint has been invented or embedded in this adapter.

## Build and verify

All commands default to preflight. Supply the full reviewed publication commit and independently accepted fingerprint values:

```sh
python3 coolify/releases/2026-10-31-home-2026/build-web.py /tmp/flixify-playback-release --revision FULL_PUBLICATION_COMMIT --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Add `--build` only after preflight acceptance. Compilation uses the reviewed owned container: network disabled,1280MiB memory/1536MiB total,256PIDs and an8GiB free-space floor. Actual cgroup limits are checked before Next and its children start. Temporary Next settings are restored exactly; generated build cache and owned compiler/checker containers are removed. Existing candidate tags are not overwritten; use `--verify-existing` to verify one already built.

Candidate acceptance verifies immutable ancestry/labels, all reviewed source bytes, runtime configuration/environment equality, exact untouched fingerprint and complete unchanged public-tree manifest. An isolated network-disabled HTTP check verifies the existing1.4.3 APK's MIME, length, byte-range response and SHA-256, plus exact update JSON. No provider media or customer account is used.

## Website-only transaction

```sh
python3 coolify/releases/2026-10-31-home-2026/release-web.py --revision FULL_PUBLICATION_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

After the dry run passes, `--apply` synchronizes only the ops-web image in Coolify's model/file transaction without restarting containers. `--recreate` recreates only that website with `--no-deps --no-build --pull never`. API249, workerD5, database721, protected container identities/configuration and `.env` bytes remain unchanged.

Raw, rendered and generated Compose must already contain the three literal-empty `REGISTRATION_GUARD_SECRET` overrides on ops-web, worker and db. This adapter preserves them, cannot add/remove them, and uses only the reviewed image-change PHP transaction. Full current Compose hashes remain required. No historical hash compatibility exception is enabled.

An unhealthy candidate can trigger website-only rollback; explicit `--rollback` also restores only source website `ddc80c1…`. No API, worker or database rollback/restart is allowed. Independently verify public homepage/assets/downloads, protected-service snapshots, `.env` bytes and disk after release. Opening a channel is not required for this frontend change.

Offline contracts (no Docker, Coolify or provider contact):

```sh
python3 coolify/releases/2026-10-31-home-2026/test-web.py
```
