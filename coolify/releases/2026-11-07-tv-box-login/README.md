# Android TV 1.4.15 download publication

This helper changes only the existing Flixify website image. The overlay has exactly three files:

- `apps/ops-web/app/platform/tv-download.ts`: replace version `1.4.14` with `1.4.15`, with no other edits.
- `apps/ops-web/public/downloads/flixify-pro-1.4.15.apk`: add the independently verified native binary.
- `apps/ops-web/public/downloads/flixify-tv-update.json`: publish the matching version 23 updater metadata.

The pinned source is `flixify-ops-web:tv-catalog-artwork-caf9294582cd-20261107`, image `sha256:88712123f810837114853e585346beba0d5d54dc152d4b441851033c57b23fdd`. The source Git baseline is `e7497e914820848613af26dbd8531fc1dfad7f1c`. This baseline has the same `apps/ops-web` tree as the published image revision `caf9294582cd22475e4b6b56e9a6010d733d3d8d`; the later commit only updates the previous release helper. Actual image source, existing public files, dependencies, complete runtime configuration, public build settings, environment file, registration fence and every other host container are checked. Mac downloads remain withdrawn. The API, worker and database remain pinned and running.

## Required native evidence

Supply an independently reviewed `native-proof.json` populated from this release's actual native build, signing and test results. The helper requires exactly these fields:

- `schemaVersion`: integer `1`.
- `nativeRevision` and `nativeTree`: the full immutable commit and Android source-tree IDs frozen after native validation.
- `packageName`: `vip.flixify.tv`; `versionName`: `1.4.15`; `versionCode`: integer `23`; `minSdk`: integer `23`; `targetSdk`: integer `35`.
- `apkSha256` and `apkBytes`: the measured digest and byte length of the newly built release APK.
- `signerSha256`: `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`, preserving existing installations' update identity.
- `checks`: exactly `releaseBuild`, `releaseLint`, `unitTests` and `instrumentationTests`, each boolean `true` supported by the reviewed build/test evidence.

An earlier release's revision, tree, binary digest or byte length must not be relabelled as 1.4.15 evidence. The native freeze and publication commits and all binary measurements are supplied after validation; they are not invented in this profile.
The booleans record accepted external evidence; this website helper does not rerun Android tooling on the production host. It does verify the exact native commit/tree freeze, version declarations, APK bytes and digest, and matching updater manifest. A stale or different signer, package, version or binary is rejected. The publication commit must follow the native freeze and retain its Android source tree exactly.

## Build and rollout

Use the existing server-side Git repository without checking out or altering its active branch. All revision arguments must be full immutable commit IDs. Keep the independently captured source pin and native proof outside the Git repository.

```sh
python3 /path/to/helper/build-web.py --measure > /path/to/independent-source-pin.json

python3 /path/to/helper/build-web.py /path/to/existing/repo \
  --revision FULL_PUBLICATION_COMMIT \
  --native-proof /path/to/native-proof.json \
  --source-pin /path/to/independent-source-pin.json
```

The first command only measures the pinned source. The second is a read-only preflight. Repeat the second command with `--build` to compile a candidate, or `--verify-existing` to verify an already built candidate without replacing its tag. Record the returned complete candidate image ID.

```sh
python3 /path/to/helper/release.py /path/to/existing/repo \
  --revision FULL_PUBLICATION_COMMIT \
  --candidate-id sha256:EXACT_VERIFIED_CANDIDATE_ID \
  --native-proof /path/to/native-proof.json \
  --source-pin /path/to/independent-source-pin.json
```

This is also read-only by default. Run it with `--apply` to change only the website image references in the locked Coolify transaction, then with `--recreate` to replace only the website container. Candidate verification includes APK HEAD, range, full-file SHA-256, updater bytes, the download page's served client descriptor and the principal website routes. The installed vendor Compose-only writer persists the reviewed Compose change without regenerating `.env`.

The existing download page initially serves its branded loading screen until client hydration completes. Therefore the check reads its strictly same-origin, root-relative `/_next/static/*.js` script references and requires a served descriptor object with the exact APK href, filename and displayed version together. It rejects external URLs, traversal, redirects, stale descriptors and invalid JavaScript MIME types. Reads are bounded to 1 MiB of HTML, 64 script paths, 8 MiB per script, 32 MiB total script text and a 20-second script-read deadline. No application source or rendering behavior is changed by this verification adjustment. Verify the hydrated page in the browser after cutover as well.

Use the same arguments with `--rollback` to restore the retained source website. Rollback does not depend on free build space or a healthy candidate. A failed recreation verifies the protected recovery context before restoring the source. Retain the source image, Git revision, native proof and source pin until final verification is complete. Never delete unrelated images, volumes, files or containers.

## Resource and disk budget

The compiler runs offline with one CPU, 1280 MiB memory, 1536 MiB total memory/swap and 256 PIDs. It checks the actual kernel cgroup limits. The CPU/PID check expects cgroup v2; an unavailable or unbounded limit stops the build. It uses a normal Docker commit with the pinned parent layers, without filesystem export/import or flattening.

The measured source `.next` must be between 1 byte and 64 MiB. The initial free-space requirement is:

```text
1 GiB host reserve + max(256 MiB, 4 × (measured .next bytes + exact overlay bytes))
```

The source measured shortly before this release had approximately 10 MiB of `.next` output; the APK is approximately 2 MiB. The 256 MiB workspace floor therefore exceeds the observed output by more than twenty times. It covers compiler output and commit duplication separately from the untouched 1 GiB host reserve. If other deployments consume the remaining margin, the helper stops rather than reducing the reserve or pruning shared Docker storage.

During compilation and commit, free space is checked every second. A reserve breach stops the owned compiler and fails publication; it never stops another project's container. Before commit, the writable layer must fit half the workspace budget and free space must still cover the host reserve plus another full writable-layer copy. These are conservative admission and monitoring checks, not a filesystem quota against unrelated concurrent deployments. A failed candidate remains unpublished; the helper removes only its own temporary compiler/check containers.

## Local verification

```sh
python3 -m unittest discover \
  -s coolify/releases/2026-11-07-tv-box-login \
  -p test_release.py -v
```

The 25 focused tests cover exact scope, native and manifest pins, public asset preservation, Mac withdrawal, regular file modes, disk admission and reserve failure, bounded compiler cleanup, generated JavaScript syntax, Compose-only persistence, protected service pins, failed-cutover recovery and rollback without candidate or disk dependencies. They also exercise the complete current host inventory: all currently existing containers remain protected, while retired containers from unrelated projects are not required to exist. Configuration, lifecycle, network and inventory drift still fails verification. Served client-bundle fixtures confirm that loading-screen HTML with the current descriptor passes, stale or mismatched APK/version descriptors fail, and oversized/external assets fail; the aggregate script budget constrains each next body read and APK/manifest/range/page failures remain enforced. They do not constitute a live publication or a physical TV performance result.
