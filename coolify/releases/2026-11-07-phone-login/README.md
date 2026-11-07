# Website phone login and remembered sessions

This profile overlays the reviewed login work onto the exact running API and web images. It does not rebuild from the checkout's complete API tree. Commands are intended for the authenticated Flixify application host, run as root. The provider/CDN host is outside this release.

The commands below use an exact 40-character committed revision. All payload files must exist at that revision, including `web-whitelist.json`, `api-edits.json`, the API patcher, its seven new modules, the two migrations, the separate session backfill SQL, and every web file listed in the manifest. Transport only the reviewed release paths. Do not transport private environment files or local preview secrets.

## Pinned starting images

| Service | Tag | Image ID |
| --- | --- | --- |
| API | `flixify-api:trial-countdown-2522149cfda9-20261107` | `sha256:66805232ca883cbd6385c38341d21b4be0b9fc436b5718cc2b8e20d4398de4fb` |
| Web | `flixify-ops-web:trial-countdown-2522149cfda9-20261107` | `sha256:456b47b777683b67cc1e74d8f3cfd93d6df382f28cad273c6aabe958b6900e33` |
| Worker, protected | `flixify-worker:packages-8fa66d103053-20261101` | `sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57` |
| Database, protected | `postgres:16-alpine` | `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` |

Every phase checks the four-service Coolify identity. Worker, database, and all other projects are never recreated by this profile. Before build or rollout, at least 8 GiB must remain free under `/var/lib/docker`; the profile never prunes data.

## Build and isolated verification

Set `release_repo`, `release_revision`, and `release_work` to the server checkout, reviewed commit, and a fresh private staging directory. These variables contain no secrets.

```sh
release_repo=/root/flixify-phone-login
release_revision=REPLACE_WITH_40_CHARACTER_COMMIT
release_profile="$release_repo/coolify/releases/2026-11-07-phone-login"
release_work=/root/flixify-phone-login-build
python3 "$release_profile/build-release.py" "$release_repo" --revision "$release_revision" --web-manifest "$release_profile/web-whitelist.json" --work-dir "$release_work"
```

Without `--build`, this is read-only. It verifies image identity and committed payload hashes, but does not extract images, run a compiler, contact the provider, migrate data, or change services. The API patcher's manual actual-image preflight may be run first; unknown source contexts fail closed.

Append `--build` to build both candidates. The compiler has no network, a 1 CPU cap, a 1280 MiB memory limit with at most 1536 MiB including swap, a 128-process limit, and an eight-minute build timeout. Before compilation the profile downloads only two official npm archives, verifies their pinned SHA-512 integrity, and checks every file against the frozen manifest. Installation scripts are not run.

Only reviewed source, dependency subtrees, contract output, and API/web build output may change. Web contract source must match the original API contract source before applying the API's reviewed delta. Existing public files, including downloads, must remain byte-identical. Old `.next/static` files are merged into the candidate; collisions require identical bytes. Existing tabs retain their old chunk URLs.

Candidates are tested without access to production databases or providers. The API uses demo fixtures with phone authentication disabled. The web smoke test checks the five public routes and new login markup. Image ancestry, configuration, source hashes, and untouched trees are checked before and after. Results are written to `api-proof.json`, `ops-web-proof.json`, `api-overlay-proof.json`, and `build-proof.json`.

The build refuses an existing candidate tag or a reused API extraction directory. To retry only one service, use a fresh work directory and `--service api` or `--service ops-web`; keep both service proofs from the same exact revision. A changed payload requires a new reviewed commit.

## Private configuration

Create a root-owned regular JSON file with mode `0600`, outside Git. It must contain exactly these eight string keys:

```json
{
  "PHONE_AUTH_ENABLED": "false",
  "PHONE_AUTH_LOCAL_ONLY": "false",
  "PHONE_AUTH_ALLOWED_ORIGINS": "https://flixify.vip,https://www.flixify.vip",
  "PHONE_AUTH_SECRET": "INDEPENDENT_RANDOM_SECRET_AT_LEAST_32_CHARACTERS",
  "PHONE_AUTH_PROVIDER_DIAGNOSTICS": "false",
  "VATANSMS_WHATSAPP_API_KEY": "PRIVATE_PROVIDER_KEY",
  "VATANSMS_WHATSAPP_REG_ID": "PRIVATE_NUMERIC_REGISTRATION_ID",
  "VATANSMS_WHATSAPP_BASE_URL": "https://api.toplusmspaketleri.com"
}
```

Use a new production `PHONE_AUTH_SECRET`, never the preview secret, JWT secret, or registration guard secret. Once installed, sender IDs and secrets cannot silently rotate through this profile. All unrelated environment rows and runtime values are protected. The profile persists the eight settings in both Coolify's model and generated service files; it does not copy the local `.env`.

Keep `PHONE_AUTH_ENABLED=false` until actual provider acceptance is verified. With the disabled feature, the approved website preserves anonymous account creation and existing account-code/QR login. An outage is not treated as an explicit disabled feature. To enable phone login, supply a private delivery proof JSON containing `schemaVersion: 1`, `deliveryAccepted: true`, and a string `checkedAt`, derived from the real provider test. The rollout scripts never send messages themselves.

The initial release may use `PHONE_AUTH_ENABLED=true` after that proof and the UI flow are verified. This profile has no separate in-place enable phase after a disabled rollout; do not rerun its original apply phase against changed production images. A later enablement requires a separately reviewed metadata transition.

## Ordered rollout

For each command supply the same exact revision and candidate proofs. The private configuration path is an input file, not an environment value in the shell command.

```sh
release_private=/root/private/flixify-phone.json
python3 "$release_profile/release.py" "$release_repo" --revision "$release_revision" --api-proof "$release_work/api-proof.json" --web-proof "$release_work/ops-web-proof.json" --private-env "$release_private"
```

The default is a read-only preflight, including an in-memory Coolify mutation preview. It rejects disk/model drift and does not write metadata or restart a container. If enabled is true, append `--delivery-proof /root/private/provider-acceptance.json` to every rollout command.

Run the following explicit phases in order by appending the flag to the preflight command:

1. `--schema`: apply only the two additive schema migrations in one bounded database transaction. Existing session expiries are not backfilled yet.
2. `--apply`: persist API/web candidate tags and only the eight approved settings in Coolify and service files. Record private digest-only release state. No container is restarted in this phase.
3. `--recreate`: recreate only API, verify health, then web, verify health. Check candidate identity, unchanged unrelated environment values, and unchanged worker/database/other project containers.
4. `--backfill`: after all primary API instances use the nullable-aware candidate, convert only unrevoked, still-valid sessions to remembered sessions. Expired or revoked sessions are not revived.

Sessions remain governed by explicit revocation and logout. Trial expiry, package entitlement, registration limits, and payment rules are not extended by remembering a session.

Immediately before each compose operation, the profile rechecks target tags against immutable image IDs, the Coolify raw/rendered/generated compose and environment fingerprint, permitted current API/web image pairs, and protected container state. Before web is replaced, API must be running the exact candidate with all intended phone settings and unchanged unrelated environment. Protected state includes host configuration, mounts, networks, running/paused state, restart count, and start time. No arbitrary build/smoke name prefix bypasses that protection. The schema phase performs its protected-container comparison after its transaction too.

## Failure handling

Stop on any guard error. Raw command stderr, private configuration, model environment values, and provider credentials are suppressed. Fixed error categories identify the failed phase; inspect only a redacted, scoped diagnostic when needed. Do not loosen the source-image, environment, disk, or protected-container guards to continue.

After the new API has started, `--disable-phone` is the compatible recovery path. It disables phone authentication, restores the pinned previous web image, and retains the new nullable-aware API. It can inspect a stopped API/web container for recovery, but still requires worker/database to be running and unchanged. It never returns to the old API after nullable remembered sessions have been introduced. It is an explicit operator action; a failed rollout does not silently restart other services.

The profile must be verified against the installed host's Docker, cgroup v2, PHP/Coolify helpers, exact source contexts, and generated environment before rollout. Local unit tests prove the pure guards; they do not substitute for these actual-host checks.

## Local guard tests

```sh
python3 -m unittest discover -s coolify/releases/2026-11-07-phone-login -p test_release.py -v
python3 -m py_compile coolify/releases/2026-11-07-phone-login/build-release.py coolify/releases/2026-11-07-phone-login/release.py
```
