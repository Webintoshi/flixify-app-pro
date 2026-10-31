# Live provider labels, website only

This patch removes raw provider group labels from visible live-channel UI while preserving category/filter/source data. The exact three existing runtime files are `apps/ops-web/app/canli-tv/page.tsx`, `apps/ops-web/app/platform/catalog.tsx` and `apps/ops-web/app/platform/catalog-search.tsx`. No new runtime files, CSS, shared-contract data, API, worker, Android or public-asset changes are permitted.

Accepted source is Git `cbc90d6f846197122494afcb895fab55be522873`, web tag `flixify-ops-web:turkey-lineup-cbc90d6f8461-20261031`, immutable image `sha256:6fae8e37970359c91fbc3c9eb80739aa3c23212ad3e253676694565084b864c8`. Each existing source file must match baseline Git bytes in that image. Target tag is `flixify-ops-web:live-labels-REVISION_PREFIX-20261031`.

The entire public tree, file modes and links remain byte-identical. APK 1.4.4 remains 1,355,944 bytes with SHA256 `1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f`; the 1.4.3 APK and static update JSON are also unchanged. Candidate acceptance checks complete public/untouched manifests, exact runtime sources and configuration, immutable ancestry, plus the unchanged 1.4.4 download's local HTTP HEAD, MIME, Range, full digest/size and update JSON. No customer session or provider media is opened.

## Independent fingerprint and build

Measure a fresh independent source fingerprint against immutable `SOURCE_ID` using this adapter's `snapshot_script()` in a read-only inspection container. Exclude exactly these three runtime paths plus `apps/ops-web/.next`; public files, APKs, shared contracts, dependencies and all other source remain included. A fingerprint from an earlier release or another exclusion list is invalid.

```sh
python3 coolify/releases/2026-10-31-live-labels/build-web.py SOURCE_REPO --revision FULL_REVIEWED_COMMIT --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only preflight. Add `--build` only after reviewing the exact source and independent fingerprint; `--verify-existing` checks the immutable candidate without recompiling. The reused bounded compiler requires at least 8 GiB free disk, no network, 1280 MiB memory/1536 MiB total and 256 PIDs, verifies kernel limits, restores temporary compiler settings and removes only its owned build container/cache. API 249, worker D5, database 721 and `.env` bytes are checked before and after building.

## Release

```sh
python3 coolify/releases/2026-10-31-live-labels/release-web.py --revision FULL_REVIEWED_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only. `--apply` swaps only the website image record without restarting containers. `--recreate` recreates only `ops-web`, with no dependency build/pull. `--rollback` restores the accepted `6fae8e...` website. Candidate health failure uses that same website-only rollback. All protected service identities and configuration, `.env` bytes and the three existing literal-empty `REGISTRATION_GUARD_SECRET` overrides must remain unchanged. No broad cleanup or automatic scope expansion occurs.

Offline contracts: `python3 coolify/releases/2026-10-31-live-labels/test-web.py`. Tests use owned temporary Git fixtures and mocked Docker/Coolify boundaries; they do not build or deploy production services.
