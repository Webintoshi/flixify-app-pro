# Search activation and Android 1.4.3 publication

These adapters start from the website that is already running: `flixify-ops-web:live-registration-40882233677b-20261031`, image `sha256:0f3b05ed0f699f85afb305cdc5dc1870fba94fd856c1d4a29c4d0949d7eddee6`. The source Git baseline is `40882233677b007e2a63aed8f77bb23a4b202df8`. The older D6 website is not a valid baseline or rollback target for this release.

## Reviewed source boundary

Only these existing website files may change, plus their tests:

- `apps/ops-web/app/platform/catalog-search.tsx`
- `apps/ops-web/app/platform/catalog.tsx`
- `apps/ops-web/app/platform/detail.tsx`
- `apps/ops-web/app/platform/catalog-panels.module.css`
- `apps/ops-web/app/platform/platform.module.css`
- `apps/ops-web/app/platform/tv-download.ts`

Every existing source file must first match the Git baseline byte for byte in the exact source image. Next configuration must also match its reviewed pure-object source. Any drift stops the build; there is no generic overwrite exception. No package installation or dependency update is performed. The descriptor is restricted to its three existing 1.4.2→1.4.3 replacements.

The public boundary is exactly one added immutable `downloads/flixify-pro-1.4.3.apk` and the existing `downloads/flixify-tv-update.json`. All earlier APKs, logos, file modes and symbolic links remain unchanged. The baseline update manifest is 378 bytes, SHA-256 `f97edb5fdda3c944c01dd168f22793d6093a118913463dc00ba437a2ab77dcdd`. The new manifest must agree with the independently accepted signed APK on package `vip.flixify.tv`, version1.4.3/code11, minSdk23, exact HTTPS URL, size and digest. Native source must be frozen at a full commit and remain identical through the publication commit. Native configuration must retain the Flixify Pro label and targetSdk35.

## Build

Both commands default to read-only preflight. Pass only full accepted Git revisions and independently recorded artifact/fingerprint values:

```sh
python3 coolify/releases/2026-10-31-search-activation/build-web.py /tmp/flixify-playback-release --revision FULL_PUBLICATION_COMMIT --native-revision FULL_NATIVE_FREEZE --apk-sha256 ACCEPTED_APK_SHA256 --apk-bytes ACCEPTED_APK_BYTES --source-untouched-sha256 4787a06559742625f7ed41df508b5be27fd79639b50315278a9e90d2c9142d28 --source-untouched-files 18236 --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

Obtain the source fingerprint using this adapter's `snapshot_script()` against exact source image0f3, independently of the candidate build. Its JSON shape is `{"sha256":"64 lowercase hex characters","files":positive_integer}`. Exclusions are exactly the six source paths above, the new1.4.3 APK, the update manifest and `apps/ops-web/.next`. Dependencies, existing APK1.4.2, API/worker source and every other file remain included. The preflight requires this independently accepted fingerprint to match the actual source image; the candidate must then retain it exactly. Do not reuse the older five-path/18,237-file fingerprint after adding the hover-surface CSS path.

The parent's independent read-only production proof recorded the final six-path fingerprint as `4787a06559742625f7ed41df508b5be27fd79639b50315278a9e90d2c9142d28`,18,236 files. It also verified that all six existing source/descriptor files match Git408 exactly, including `platform.module.css` at `d2319b28a6b07c284411395db15205449143949d984b8d89f357eda44b27a3cf`. This is source-image acceptance, not a claim that the new candidate or release has been built or deployed.

Add `--build` to compile in an owned network-none container capped at1280MiB memory/1536MiB total,256 processes and an unchanged8GiB free-space floor. Actual cgroup limits are verified before Next and child workers start. Temporary compiler settings are restored exactly and webpack cache removed. No other service is rebuilt or restarted. `--verify-existing` validates an already built candidate without compiling again. Compiler/checker containers are removed on failure as well as success.

Candidate acceptance covers exact runtime sources, base-image ancestry and labels, configuration/environment equality, the untouched fingerprint, the full public tree and real isolated HTTP responses. The latter checks APK HEAD/MIME/length,206 byte range, complete digest and exact update JSON, with no provider media or customer account.

## Website-only release

```sh
python3 coolify/releases/2026-10-31-search-activation/release-web.py --revision FULL_PUBLICATION_COMMIT --candidate-id ACCEPTED_IMMUTABLE_IMAGE_ID --protected-api-tag flixify-api:live-registration-8645860e0552-20261031 --protected-api-id sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6
```

After the read-only dry run passes, `--apply` synchronizes only the website image in the guarded Coolify model/file transaction; it does not restart a container. `--recreate` recreates only that website with `--no-deps --no-build --pull never`. The API249, workerD5 and database721 images and all protected runtime identities/configurations are verified. The current `.env` bytes stay unchanged.

Raw, rendered and generated Compose documents must already contain the three literal-empty `REGISTRATION_GUARD_SECRET` overrides on web, worker and database. This release cannot add, remove or transform those overrides, and its PHP transaction contains only image changes. Every environment mapping/list stays identical. A current full Compose hash must match the website container label; there is no historical container/hash compatibility shortcut. Runtime health checks require an empty website key and the accepted API's nonempty stable key.

`--rollback` restores only the accepted0f3 website, retaining existing isolation and all other configuration. It must never start the API from before the permanent-registration migration. Candidate health failure can trigger this same website-only rollback. Independent post-release checks must still confirm public pages/APK/update JSON, the protected service snapshots, `.env` bytes, current disk space and the real search click/remote result behavior.

Offline contracts: `python3 coolify/releases/2026-10-31-search-activation/test-web.py`. Tests use owned temporary Git fixtures and replace only external Docker/Coolify boundaries; they do not build or deploy a real service or access provider media. Native signing, signature identity, optimized contents and actual upgrade acceptance remain the publisher's separate gates.
