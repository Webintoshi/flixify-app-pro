# TV+ channel ordering, website only

This metadata-only correction updates web channel ordering to the accepted TV+ reference while retaining available channels and placing unmatched entries near their groups. The sole permitted runtime file is the existing `apps/ops-web/app/platform/live-channel-lineup.ts`. No new runtime leaf, provider catalog/source data, shared-contract, CSS, API, worker, Android or public-file changes are permitted.

Accepted source is Git `6e4b326de33191147572feb587c22718b1185ad1`, web tag `flixify-ops-web:live-labels-6e4b326de331-20261031`, immutable image `sha256:9d032c04e6c6bf63dadeb689898ca55483c63d1232018e11d3355e3cb694f910`. The existing helper must match baseline Git bytes in that image. Target tag is `flixify-ops-web:tvplus-lineup-REVISION_PREFIX-20261031`.

All public files, modes and links stay identical, including static update JSON and APKs 1.4.4 and 1.4.3. APK 1.4.4 remains 1,355,944 bytes with SHA256 `1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f`. Candidate checks include immutable ancestry, exact source/config/environment, the untouched/full public manifests and the unchanged APK's local HTTP HEAD, MIME, Range, digest, size and update JSON. No customer session or provider media is opened.

## Fresh source evidence and build

Independently measure a fresh fingerprint against immutable `SOURCE_ID` using this adapter's `snapshot_script()` in a read-only inspection container. Exclude only the single runtime helper plus `apps/ops-web/.next`. All other source, shared contracts, dependencies, public assets and APKs remain included. Historical fingerprints or fingerprints from the previous three-file exclusion list are invalid.

```sh
python3 coolify/releases/2026-10-31-tvplus-lineup/build-web.py SOURCE_REPO --revision FULL_REVIEWED_COMMIT --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only preflight. Add `--build` after exact source/fingerprint acceptance; `--verify-existing` checks a verified candidate without recompiling. Compilation requires at least 8 GiB free disk, no network, 1280 MiB memory/1536 MiB total and 256 PIDs, verifies kernel limits and restores temporary compiler settings. Only the owned compiler container/cache is removed. A disk-floor failure stops the operation; this adapter never prunes images or other Docker data. Protected containers and `.env` bytes must remain unchanged before and after compilation.

## Website-only release

```sh
python3 coolify/releases/2026-10-31-tvplus-lineup/release-web.py --revision FULL_REVIEWED_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only. `--apply` synchronizes only the website image without restarting containers. `--recreate` recreates only `ops-web` without dependency build/pull. `--rollback` restores the accepted `9d032c...` website. Candidate health failure uses this same website-only rollback. API 249, worker D5, database 721, `.env` bytes and the three existing literal-empty `REGISTRATION_GUARD_SECRET` overrides stay protected. No broad cleanup or automatic scope expansion occurs.

Offline contracts: `python3 coolify/releases/2026-10-31-tvplus-lineup/test-web.py`. They use owned temporary Git fixtures and mocked Docker/Coolify boundaries, with no production builds, deployments or provider streams.
