# Turkey channel lineup, website only

This adapter publishes only the website's channel ordering and Turkey classification correction. It does not rebuild Android or change the provider catalog, access rules, API, worker or database.

Accepted source:

- Git: `dd8d7a16c2002c47dc80537cf777155ec7fc622c`
- Web tag: `flixify-ops-web:live-curation-dd8d7a16c200-20261031`
- Web image: `sha256:73a348089680a50ec4b341a6ea1586c2399565fe18ad659e158d3519e436ff9c`
- Target tag: `flixify-ops-web:turkey-lineup-REVISION_PREFIX-20261031`

The exact four runtime files are `apps/ops-web/app/canli-tv/live-channel-catalog.ts`, `apps/ops-web/app/canli-tv/page.tsx`, `apps/ops-web/app/platform/catalog.tsx` and the new `apps/ops-web/app/platform/live-channel-lineup.ts`. The shared catalog surface is included so the homepage live-channel rail and other web catalog surfaces use the same ordering before pagination. The new leaf and its ancestors must be absent/non-symlink in the accepted source image. All three existing source files, including `platform/catalog.tsx`, must match baseline Git bytes in the source image. Other runtime, shared-contract, dependency, public-file and native changes are rejected. Regular web test files, this release folder and Markdown documentation may accompany the patch.

The complete public tree, modes and links remain unchanged. APK 1.4.4 remains 1,355,944 bytes with SHA256 `1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f`; the older 1.4.3 APK and static update JSON are also immutable. Candidate verification checks source ancestry, exact source/configuration/environment, all untouched files and the full public manifest. An isolated local HTTP check verifies the unchanged 1.4.4 APK HEAD/MIME, byte range, complete size/digest and exact update JSON. No customer session or provider media is opened.

## Independent fingerprint

Before preflight, independently import `build-web.py` on the Docker host and run its `snapshot_script()` against immutable `SOURCE_ID` in a read-only inspection container. Its exclusions are precisely the four runtime paths plus `apps/ops-web/.next`. All public assets/APKs, dependencies, shared contracts and configuration remain included. Record and review the resulting SHA256 and file count separately; no historical fingerprint is embedded or substituted.

## Preflight and build

```sh
python3 coolify/releases/2026-10-31-turkey-lineup/build-web.py SOURCE_REPO --revision FULL_REVIEWED_COMMIT --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only. Add `--build` only after reviewing the exact source and independent fingerprint. `--verify-existing` checks an already built candidate without recompiling. The build requires at least 8 GiB free space, compiles without network using 1280 MiB memory/1536 MiB total and 256 PIDs, verifies the kernel limits, restores the temporary compiler configuration and removes only its owned compiler container/cache. Protected container identities/configuration and `.env` bytes must remain unchanged before and after compilation.

## Website-only release

```sh
python3 coolify/releases/2026-10-31-turkey-lineup/release-web.py --revision FULL_REVIEWED_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only. `--apply` synchronizes only the web image record without restarting anything. `--recreate` recreates only `ops-web` with no dependency rebuild/pull. `--rollback` restores the accepted `73a348...` web image. A failed candidate health check uses the same website-only rollback. API 249, worker D5, database 721, all environment bytes and the three existing literal-empty `REGISTRATION_GUARD_SECRET` overrides remain protected. There is no broad Docker cleanup or automatic scope expansion.

## Offline contracts

```sh
python3 coolify/releases/2026-10-31-turkey-lineup/test-web.py
```

These contracts use temporary Git fixtures and mocked Docker/Coolify boundaries. They do not build a production image, deploy services or access provider media. Production acceptance still requires fresh source evidence, a verified immutable candidate and post-release browser checks.
