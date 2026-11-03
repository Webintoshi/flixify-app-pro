# QR device login release helpers

These helpers are prepared source. Root owns commits, verified artifacts, actual-image builds, SQL execution, publication and rollback. No helper installs from the network, migrates PostgreSQL, changes environment keys, deletes old installers or prunes images.

## Source merge

`merge.py` derives only the frozen revision's QR changes from canonical base `cef1a113d5c88821e78cddfd1cb6d222ce3711e2`. It applies unique exact changed-line anchors to actual operational `server.ts` and `repository.ts`; ambiguity or conflict stops preparation. All actual direct `authenticateUser(request.headers.authorization)` calls receive their request for linked-session response projection. Existing operational billing, welcome-offer and analytics modules remain untouched. Dependency JSON is merged by object key: only `qrcode-generator` 2.0.4 is added, with the committed npm SHA-512 integrity. The package archive is verified before extraction; no lifecycle scripts run.

The merger accepts `--actual-root` containing an exported `/app` tree, `--qrcode-tarball`, `--revision`, `--output` and a repository positional argument. Output must not already exist. It emits only overlay files and `merge-receipt.json`, containing actual/merged hashes and viewer-call counts.

## Candidate builds

Both build helpers accept repository, exact `--revision`, `--base-image-id`, `--base-image-tag`, `--source-pin`, and either `--measure`, `--build` or `--verify-existing`. Default is preflight. First measure to a root-owned independent JSON file, inspect the actual source and then pass that file as `--source-pin`. The API also requires `--qrcode-tarball`. The web requires `--artifacts` with exactly `android`, `macos`, `windows`, each containing `path`, `sha256`, `bytes`; values must be root's verified final artifacts. No fabricated example pins are supplied.

The API compiles actual baseline source and verifies its distribution fingerprint, merges the QR source into actual operational source, copies only the verified package archive and compiles again. An isolated candidate test run executes canonical API tests plus actual operational billing/welcome/analytics modules. PostgreSQL integration tests require root's separate actual SQL run; the network-disabled candidate suite cannot replace that evidence.

The web applies QR hunks to actual source, retaining preexisting consent behavior when the actual image predates canonical base. Runtime paths are explicit, public scope is exactly three new installers and the update JSON, and the complete old public tree is preserved. Native metadata expects Android 1.4.13/code21. Root must freeze actual native artifacts and update descriptors before the web preflight can pass.

Compilation runs with network disabled, 1 CPU, 1280 MiB memory, 1536 MiB total memory/swap and 256 processes. Each temporary compiler is removed. Source/runtime fingerprints preserve all unowned `/app` paths. New package and `/cihaz` directories are excluded from the unchanged-tree fingerprint because those directories did not exist before; their owned files are individually verified. Existing image IDs and complete host container snapshot are checked after successful build. The 8 GiB minimum remains mandatory. Root must serialize host work; these builders do not acquire the shared release lock.

## Image transaction

`release.py` reuses the existing locked Coolify transaction and changes exactly API and ops-web image references. It retains worker, DB, environment, registration fence, other containers and old source images. Pins reflect root's measured 2026-11-03 host. A concurrent publication changes those pins and requires reinspection/review before use.

Arguments: `--revision`, `--api-candidate-id`, `--web-candidate-id`, `--migration-sha256`, `--migration-receipt`. Receipt must record the actual migration digest and booleans `applied: true`, `postgresTestsPassed: true`, supplied by root only after executing and verifying the additive migration. No receipt is generated here.

Default preflight is read-only. `--apply` updates only image metadata; `--recreate` performs the guarded two-service recreation and attempts exact-image rollback on failure; `--rollback` restores prior images. Both rollback paths first stop only the pinned candidate API container and verify its processes exited. Through the pinned DB container, one transaction revokes every `device_link` session, cancels QR request anchors and clears envelopes, then verifies those conditions before commit. Only then can the old API start: it does not understand linked-session origin and would otherwise disclose the account code or convert a QR refresh into an owner session. Database or stop/identity verification failure blocks image restoration and leaves the candidate API stopped. Manual `account_code` sessions and business tables are not modified; additive schema remains.

Rollback does not require a migration receipt. A wholly absent QR schema is accepted only with the exact baseline API container present; partial schema or absent schema after candidate creation fails closed. Deploy and read-only deployment preflight still require the actual migration/test receipt. Root must run public download hash/HEAD/range checks, actual QR/auth/business-flow verification and browser QA in addition to helper health checks.

## Offline evidence and remaining gates

Run `python3 -m unittest discover -s coolify/releases/2026-11-03-qr-device-login -p 'test_*.py' -v`.

The suite covers reviewed QR hunk reconstruction, operational text preservation, dependency/archive guards, compiler constraints, two-service release scope, locked explicit/automatic rollback, API stop/restart and database failure ordering. Four PostgreSQL rollback tests use only a unique disposable schema: selective revocation including expired/orphan linked rows, owner/business preservation, idempotence, absent/partial schema and full transaction rollback on failed verification. Set `QR_ROLLBACK_TEST_DATABASE_URL` to a disposable PostgreSQL database and optionally `QR_ROLLBACK_TEST_PSQL` to its client binary; without that URL those four tests are skipped. The release configuration tests stub the unavailable local PyYAML import; actual YAML/Coolify transaction tests remain root/host verification. QR changes also merge cleanly onto the four existing web runtime files at actual image's source revision `4d6cb8548e1c17047b78d516599f6d7ba86bbe40`.

Actual API snapshot merge, verified tarball extraction, image builds, actual SQL migration, candidate suite execution, downloads and cutover have not been run by this preparation agent.

Root remeasured the concurrently completed consent publication before QR preparation: web `flixify-ops-web:forced-consent-eb3867d7dfdc-20261103`, image `sha256:85892877db795825c23fc51ad3f56c77bcb503d0000f2fd35bd1c263a208f7f5`. QR now builds on and rolls back to that image. API, worker, DB, environment and registration pins remain unchanged. Actual host free space was 8.762 GiB.

API regression collection is restricted to the exact frozen Git test paths. The offline logo fixture maps only `example.com` to a public-shaped fixture address; networking remains disabled. The API test gate requires every non-PostgreSQL QR assertion to pass and the 13 PostgreSQL assertions to be represented by root's separate real-database receipt. If existing operational behavior differs from canonical non-QR fixtures, the exact same frozen non-QR cases run on the immutable prior API image: new failures, changed first-error-line hashes, missing cases, new skips, hook/load/unhandled errors or inconsistent counts block acceptance. `candidateTests.status` distinguishes `all_passed` from `passed_no_new_failures`; known baseline failures remain explicit in the sanitized report. Raw assertion values stay inside the disposable fixture container.
