# Single and dual package selector — website publication

This adapter overlays exactly ten reviewed website leaves: the package page, package copy, admin package copy, package selection model, embedded-payment model, payment-result page and the four new pricing/embedded-checkout component and stylesheet files in `components/ui`. No dependency installation, global styling, shared contract, API source, worker source, native or public asset is copied into the website image.

The immutable source is `flixify-ops-web:tvplus-lineup-2f39237f8200-20261031`, `sha256:94078bed2ba04e00ddef43a358b4c1526f4e5c58c636d0954f86f2e833de979a`, Git baseline `2f39237f8200d8258c9d662b2a45c0ff5a1e3a58`. The target tag is `flixify-ops-web:packages-REVISION_PREFIX-20261101`. Rollback restores that exact TV+ source website.

Git scope checks apply to the entire `apps/ops-web` tree, allowing only the ten runtime leaves and regular test files. The Android tree must equal the baseline. Separate catalog or API changes in the same Git commit are not website overlays; they require their own review and deployment. The image fingerprint still covers all unchanged source, dependencies and public assets in the actual production image.

The new `apps/ops-web/components` root must be absent in both baseline Git and the pinned source image. It is excluded as one new directory from the untouched fingerprint, then checked separately: the candidate must contain exactly the root and `ui` directories with mode `0755`, and the four reviewed regular files with mode `0644`, exact byte lengths and SHA256 digests. Symlinks, extra files, extra directories or modified modes fail acceptance. No existing ancestor is created or replaced by the overlay.

## Verify and build

Run `python3 coolify/releases/2026-11-01-packages/test-web.py` before host work. Contracts use owned temporary Git fixtures and mocked Docker/Coolify boundaries. They do not open provider streams or modify production.

Independently measure a fresh `snapshot_script()` fingerprint against immutable `SOURCE_ID` in a bounded, read-only inspection container. Its exclusions are exactly the six app leaves, the new components root and `apps/ops-web/.next`. Do not reuse a historical fingerprint, including the earlier six-file recurring-checkout draft proof.

```sh
python3 coolify/releases/2026-11-01-packages/build-web.py SOURCE_REPO --revision FULL_REVIEWED_COMMIT --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only preflight. Add `--build` after source/fingerprint acceptance; `--verify-existing` verifies a previously built candidate. Compilation requires 8 GiB free disk and runs offline with 1280 MiB memory, 1536 MiB total memory and 256 PIDs. Temporary compiler settings are restored. Only the owned compiler/check containers are removed; no Docker pruning occurs. Candidate checks retain all existing source/config/environment checks, the full public manifest, APK 1.4.4 and update JSON coherence, HTTP HEAD, Range, size and full APK digest.

## Publish the website

```sh
python3 coolify/releases/2026-11-01-packages/release-web.py --revision FULL_REVIEWED_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Default is read-only. `--apply` synchronizes only the website image metadata without restarting containers. `--recreate` recreates only `ops-web`, without dependencies, pull or build. `--rollback` restores the source website, including automatic rollback on candidate health failure.

API image `249006…`, worker `d5b9ab…`, database `721873…`, all existing environment bytes and the three literal-empty registration-guard overrides remain protected. These tools do not migrate package data, alter Stripe prices, activate subscriptions, open payments or change provider line limits. If the API is deliberately changed by a separate deployment, these exact protected pins must be reviewed and updated before using this adapter; arbitrary caller-selected API pins are rejected.

## Backend candidates and staged publication

`build-backend.py` builds one service per invocation. Its API baseline is the actual immutable `249006…` production image, retaining its production-only Stripe, referral, registration and playback code and dependencies. The worker baseline is immutable `d5b9ab…`. Both compile the original actual image source first and require a byte-identical complete compiled output tree before overlaying reviewed edits. Compilation and candidate regressions run without network, under the same 1280/1536 MiB and 256-PID limits, with an 8 GiB disk floor. No application container is restarted by a builder.

For the API, the fifteen files in `api-source-manifest.json` map to fifteen exact runtime module leaves in `apps/api/src`. Eleven already exist, including the Stripe webhook and referral store modules; four new leaves hold the sales catalog and the one-time payment policy/store/API helpers. The referral store accepts actual fulfilled one-time payment proof without fabricating invoice records. The checked-in manifest pins every reviewed target file digest and new-file flag. `server.ts` is not copied from the repository: `api-patches.json` requires its actual whole-file source digest and exactly three unique, bounded, nonoverlapping old/new replacements for imports, the payment store and the billing/webhook/poll wiring block. Every original anchor is checked before applying replacements in reverse byte order. All remaining API source and dependencies stay covered by the untouched fingerprint. The worker overlays only its existing provider entitlement parser and store, both required to equal the accepted Git baseline in the original image.

Before each backend build, measure and save a fresh independent JSON proof against its immutable image. `snapshot_script('api')` or `snapshot_script('worker')` returns the read-only Node program. Run it in a network-disabled read-only inspection container with 512/640 MiB memory and 128 PIDs. The proof records every overlay source digest (null for an absent new file), each compiled artifact's digest/size, the compiled tree fingerprint, and the entire untouched tree fingerprint. Do not supply a prior API or worker's proof. Existing containers must remain stable while building; simultaneous Docker inspection/test containers will correctly cause an all-container snapshot mismatch.

```sh
python3 coolify/releases/2026-11-01-packages/build-backend.py SOURCE_REPO --service api --revision FULL_REVIEWED_COMMIT --source-pin INDEPENDENT_API_PROOF.json
python3 coolify/releases/2026-11-01-packages/build-backend.py SOURCE_REPO --service worker --revision FULL_REVIEWED_COMMIT --source-pin INDEPENDENT_WORKER_PROOF.json
```

Default is read-only preflight. Add `--build` to compile and retain the immutable candidate ID; `--verify-existing` independently recompiles without publishing another image, then compares the previously built candidate to that result. Candidate regressions run against the actual verified image source with only readonly test/config mounts and explicit fixture environment. No live secret or provider operation is used. API billing tests import an ephemeral alias of the actual candidate source; they do not test a second copy of the source payload.

Apply the separately reviewed catalog and checkout schema migrations using their own bounded SQL transaction workflow. These image tools do not execute migrations, alter provider lines, create Stripe products, reprice existing subscriptions or modify runtime environment values.

After the website is published, release the API first, then release the worker while protecting the new API:

```sh
python3 coolify/releases/2026-11-01-packages/release-backend.py --service api --revision FULL_REVIEWED_COMMIT --candidate-id VERIFIED_API_ID --protected-web-tag VERIFIED_WEB_TAG --protected-web-id VERIFIED_WEB_ID
python3 coolify/releases/2026-11-01-packages/release-backend.py --service worker --revision FULL_REVIEWED_COMMIT --candidate-id VERIFIED_WORKER_ID --protected-web-tag VERIFIED_WEB_TAG --protected-web-id VERIFIED_WEB_ID --protected-api-tag VERIFIED_API_TAG --protected-api-id VERIFIED_API_ID
```

Every release command defaults to read-only preflight. `--apply` synchronizes only the selected image metadata without restarting; `--recreate` recreates that service only with no dependency build or pull. `--rollback` restores only the selected current registration-compatible baseline: API `249006…` or worker `d5b9ab…`. A failed health check uses that same narrow rollback. The older pre-registration API images are never a rollback target.

The existing completed permanent-registration fence is required and its bytes must remain unchanged. Existing API proxy trust, the two-account IP quota, its stable guard reference and the three other services' literal-empty guard overrides are required in source and target Compose. All environment bytes, database identity and every other project's existing container identity/config/mount/network/start/restart state are protected. Mutating modes hold an exclusive host lock; read-only preflight does not create a lock file. New protected API/website images must have exact caller-provided immutable IDs, package-release tags, revision labels and ancestry from the accepted API/website baseline.

Offline backend contracts: `python3 coolify/releases/2026-11-01-packages/test-backend.py`. They exercise source/pin validation, exact server patching, bounded compiler cleanup, candidate immutability, test isolation, host locking and the real image-swap transaction against mocked Docker/Coolify boundaries for both API and worker, including healthy publication and failure rollback. No production action is performed by these tests.
