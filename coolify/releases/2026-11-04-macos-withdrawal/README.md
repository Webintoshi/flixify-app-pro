# Withdraw Mac website downloads

The user requested removal of the Mac application from the website. Root has paused the separate Apple approval/publication heartbeat. This release changes only the website; it does not delete the locally installed app, revoke signing certificates, change native applications, or alter API/database rules.

The source web image is `flixify-ops-web:qr-device-login-20cad131f98f-20261103`, immutable image `sha256:af9e74473b7ea55e077a3cbb5c8ce3aa3f302e0cb58e4cc16fb91df25228e437`. Canonical Git baseline is `f820673242b543f849eb2bee2e1e9c48eef10971`. Any live drift fails closed and requires a new review, rather than replacing another deployment.

The exact website source delta is:

- Modify `app/platform/landing.tsx`, `app/platform/shell.tsx`, `app/indir/page.tsx`, and `app/indir/page.module.css`.
- Delete `app/platform/mac-download.ts`.
- Delete only `public/downloads/flixify-pro-macos-1.0.0-build2-test.dmg`, `flixify-pro-macos-1.0.1-build3-test.dmg`, and `flixify-pro-macos-1.0.2-build4-test.dmg`.

All paths above are relative to `apps/ops-web/`. No new download or Apple acceptance flag is required. Source status must be precisely four modifications and four deletions. UI merging retains actual operational changes outside unique reviewed anchors. Every removed source/public file must match the canonical original, and each removed file must be absent in the final candidate image. Deleted DMGs use a separate Git binary reader that checks the pinned object size against a 50 MiB bound before reading and hashing; the descriptor retains the ordinary 4 MiB source limit. Every other public file retains its exact contents and metadata, while an independent fingerprint protects untouched source, configuration and dependencies.

After root commits and pushes the real removal revision, first invoke:

```sh
python3 build-web.py REPO --revision FULL_COMMIT --measure
```

Root independently reviews the returned untouched-source fingerprint and saves that exact JSON to a private file. Then run read-only preflight:

```sh
python3 build-web.py REPO --revision FULL_COMMIT --source-pin SOURCE.json
```

Add `--build` for the bounded compiler, or `--verify-existing` to verify an existing candidate. Compilation needs 5 GiB free, runs offline at 1 CPU/1280 MiB RAM/1536 MiB total memory and swap/256 processes, disables Next's disk cache only while compiling and restores the original Next configuration. It deletes only the four named regular files within its own compiler container, then commits normally on the pinned source image. No whole-filesystem flatten, Docker pruning, shared data deletion or existing image/container removal occurs.

After reviewing the candidate receipt, use:

```sh
python3 release.py --revision FULL_COMMIT --candidate-id sha256:EXACT_CANDIDATE_ID
```

The default is read-only release preflight. `--apply` synchronizes only the web image in Coolify records and Compose; `--recreate` performs guarded `--no-build --pull never` web-only cutover. Forward actions require 4 GiB free. The shared release lock serializes the changes. API, worker, database, environment, registration fence and other project containers remain protected by immutable pins and host-state fingerprints. Failed cutover verifies recovery context and restores only the previous QR-enabled web image. Explicit `--rollback` is allowed below the forward disk floor.

The installed Coolify `Service::saveComposeConfigs()` method has no parameters and writes both Compose and a regenerated environment file. This release replaces exactly that unique call in the inherited image-swap PHP with the method's actual `instant_remote_write_file` Compose writer. The writer runs inside the original locked database transaction and targets the existing service `docker-compose.yml`; it does not regenerate `.env`. All original metadata checks, environment-byte assertions, protected-service checks and rollback behavior remain intact. Each configure call derives this adapter from the immutable original PHP, and a missing or repeated anchor fails closed. The prepared candidate image does not need rebuilding when only this deployment adapter changes.

Root must verify actual HTTPS pages after publication: no Mac navigation/card/download links, Android TV and Windows downloads still present, all three removed DMG URLs returning 404, and existing QR/manual login routes healthy. These helpers and passing local tests alone are not evidence that publication has happened.

Local validation:

```sh
python3 -m unittest discover -s coolify/releases/2026-11-04-macos-withdrawal -p test_release.py -v
```
