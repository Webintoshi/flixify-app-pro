# Cross-platform analytics release — 2 November 2026

This profile prepares the website, the narrow API analytics overlay, three new application downloads, and the additive analytics tables. It does not alter the worker, the database container, the permanent registration fence, payment rules, provider connections, or other projects. The checked-in acceptance template deliberately fails closed. No host operation has been performed by this profile's author.

The live baseline is `eba4d62b3893e0e173392be0421101279bfe3bac`. The website image is **`sha256:3f882fa9bc2029bc4cad6cd4635fb6d304900085e89e0e97ddba900ad040bfd3`**. This is the independently corrected 64-character image digest; the earlier 63-character transcription must not be reused. All four immutable service pins are in `policy.py`.

## Required acceptance inputs

Copy `release-pins.json` outside Git and fill its remaining placeholders after accepting the final source and artifacts. The publication revision cannot be embedded into its own Git commit: pass the filled external file with `--pins`.

- `revision`: exact final publication commit.
- `apiServerSha256`: fresh hash of `/app/apps/api/src/server.ts` from the current immutable `241bbd…` image, obtained from the API measurement below. The old welcome-offer `analytics-server-patches.json` is intentionally not accepted as evidence. This profile applies its two reviewed, unique anchors to those actual bytes and preserves every other byte.
- `migrationSha256`: exact migration blob in the publication commit. The template contains the current local migration hash; recheck it after final acceptance.
- `postgresFixtureSha256`: actual successful V3 `proof.json`, `a2e4279c684388f8e9598e36fe117c2db41cd4e6e778f1187d337d2176ab8b58`. The fixture payload was `069a5c8ab697c0427a08674048b5678ebaa2505a1a8a0d3e2351d1ec6a5eb781`. The full receipt must report success, no Google/provider/production-database access, unchanged protected and other containers, and successful cleanup. Supply the actual file, not a handwritten success receipt.
- Native entries: accepted source commit and Git tree, exact artifact bytes/hash, verification kind, and the hash of its acceptance evidence. Windows requires the actual Windows CI installer; a macOS-host compile is insufficient. Android requires the existing published signer. macOS remains an explicitly unnotarized universal test DMG and must retain honest distribution notices.

The native acceptance evidence directory contains `android.json`, `macos.json`, and `windows.json`. Each JSON must contain these matching fields; additional actual build/signature/CI evidence may be included:

```json
{
  "platform": "windows",
  "sourceRevision": "exact accepted native commit",
  "sourceTree": "git rev-parse COMMIT:apps/windows-native",
  "artifactSha256": "exact accepted installer SHA256",
  "artifactBytes": 0,
  "verification": "actual-windows-ci"
}
```

Verification kinds are `configured-release-same-signer` for Android and `configured-universal-local-test` for macOS. The byte count above is an example placeholder and is rejected. Hash each real evidence file into its matching native `evidenceSha256`. The publication commit must descend from each accepted native commit and preserve its complete app tree exactly.

Three explicit new public files are permitted:

- `downloads/flixify-pro-1.4.8.apk` (versionCode 16).
- `downloads/flixify-pro-macos-1.0.1-build3-test.dmg`.
- `downloads/flixify-pro-windows-1.0.2-x64-test-setup.exe`.

The three download descriptors must match the accepted files. Only `flixify-tv-update.json` is replaced, with the exact new APK URL/hash/size/version. Every old public file, mode, directory and symlink is retained, including Windows 1.0.0/1.0.1, macOS build 2 and Android 1.4.7. Candidate checks validate old and new downloads by HEAD, MIME, byte ranges, complete bounded body and hash, plus executable/DMG/APK signatures of their file formats. These checks open no video streams.

## Private Google configuration

Stage a root-owned, regular **0600 JSON file outside Git**, for example `/tmp/flixify-analytics-private-env-20261102.json`. It must contain exactly these six keys, with the real values supplied privately:

```text
GA4_ENABLED = true
GA4_WEB_MEASUREMENT_ID = G-…
GA4_WEB_API_SECRET = …
GA4_WINDOWS_MEASUREMENT_ID = G-…
GA4_WINDOWS_API_SECRET = …
GA4_ANALYTICS_HASH_SECRET = stable random secret, 32–256 characters
```

The actual file is a JSON object whose values are strings. Do not paste secrets into commands, screenshots, receipts, Git, or tool output. Keep the hash secret stable: it controls opaque transaction identifiers and deduplication. No debug-mode key is accepted in this production profile. Android/macOS public Firebase configurations are already native source inputs; they do not contain these Measurement Protocol secrets.

The transaction adds these keys **only to API service environment entries**, preserving dictionary/list form, unrelated environment entries, all other service definitions, and the raw `.env` file. It never writes credentials into the candidate images. Rollback removes only the exact keys owned by this rollout and refuses to overwrite a key another operator changed. Retain the private file until the release is verified or rolled back.

## Root operator sequence

Use a fresh owned stage such as `/tmp/flixify-analytics-release-20261102` (0700). A local `git clone --no-hardlinks --no-local --no-checkout` of `/tmp/flixify-windows-repair-20261102-72eb2ee/source` copies the approved old repository without changing it or copying its remote credentials. In the **new clone only**, set the known clean repository URL (no user information, query or fragment), fetch the exact accepted publication commit and check it out detached. Validate that exact SHA and the three native Git trees before building. Keep source measurements, accepted pins, real fixture/evidence files and sanitized operation receipts as 0600 files in the owned stage. The private six-key Google file may remain at the separately staged root-only path. Do not prune or clean the old checkout.

Run only on the current Flixify host (`87.76.130.252`) in its root shell. Scripts require the existing Docker/Coolify/PyYAML tooling and the complete committed repository. Do not run through another project's application container. Use task-specific paths for the committed repository, accepted inputs and proof directory.

1. Obtain independent source measurements **before building**:

```bash
python3 coolify/releases/2026-11-02-analytics/build.py "$ANALYTICS_REPO" --service api --measure > "$ANALYTICS_STAGE/api-source-pin.json"
python3 coolify/releases/2026-11-02-analytics/build.py "$ANALYTICS_REPO" --service web --measure > "$ANALYTICS_STAGE/web-source-pin.json"
```

The API measurement includes the fresh server hash, all nine source-leaf hashes, distribution manifest and untouched-tree fingerprint. The web measurement excludes only the explicit overlay, new artifacts, update manifest and Next build output. Measurements use bounded, network-isolated inspection containers and print hashes only.

2. Fill the external acceptance file; verify final native evidence, the actual V3 PostgreSQL proof, and the final Git revision. Preflight each candidate, then repeat with `--build`:

```bash
python3 coolify/releases/2026-11-02-analytics/build.py "$ANALYTICS_REPO" --service api --pins "$ANALYTICS_PINS" --source-pin "$ANALYTICS_STAGE/api-source-pin.json" --native-proof-dir "$ANALYTICS_NATIVE_PROOFS"
python3 coolify/releases/2026-11-02-analytics/build.py "$ANALYTICS_REPO" --service web --pins "$ANALYTICS_PINS" --source-pin "$ANALYTICS_STAGE/web-source-pin.json" --native-proof-dir "$ANALYTICS_NATIVE_PROOFS"
```

`--build` creates new immutable candidates without restarting services. A pre-existing candidate tag requires `--verify-existing`. API verification reproduces the old distribution before overlaying five new analytics modules, four Stripe module changes, and the two exact server insertions. It then checks unchanged dependencies/configuration and runs actual candidate-source analytics and payment regression tests with Google/Stripe/database access disabled. Web compilation inherits the reviewed cgroup checks and restores Next configuration exactly. Both candidates are isolated from the network and have bounded memory/process counts. An 8 GiB disk floor and the shared exclusive release lock apply. Nothing is pruned automatically.

3. Inspect and then apply the pinned additive migration:

```bash
python3 coolify/releases/2026-11-02-analytics/migrate.py "$ANALYTICS_REPO" --pins "$ANALYTICS_PINS" --postgres-proof "$ANALYTICS_POSTGRES_PROOF"
python3 coolify/releases/2026-11-02-analytics/migrate.py "$ANALYTICS_REPO" --pins "$ANALYTICS_PINS" --postgres-proof "$ANALYTICS_POSTGRES_PROOF" --apply
```

This uses the current API's existing database connection without printing it. The database container/image/project and connection hostname are checked. Only the three analytics tables and their own indexes/RLS/privileges may be added. The migration executes twice under its existing lock/statement timeouts and must produce identical catalog hashes; every unrelated public relation's catalog hash must remain unchanged. A private version receipt records `202611020001` and the hashes. An existing analytics schema without that owned receipt stops for review. A process failure after DDL never triggers a destructive cleanup.

4. Preflight the paired release using the verified candidate IDs:

```bash
python3 coolify/releases/2026-11-02-analytics/release.py --pins "$ANALYTICS_PINS" --api-candidate-id "$ANALYTICS_API_ID" --web-candidate-id "$ANALYTICS_WEB_ID" --environment-file "$ANALYTICS_PRIVATE_ENV" --postgres-proof "$ANALYTICS_POSTGRES_PROOF" --native-proof-dir "$ANALYTICS_NATIVE_PROOFS"
```

Repeat that exact command with `--apply` to update only Coolify's API/web image references and the six owned API environment keys, then with `--recreate` to recreate **API first, website second** using `--no-deps --no-build --pull never`. Payment behavior is compatible during the short mixed-version window; unavailable analytics configuration does not block the application. The migration is checked again before every phase. API health verifies registration isolation and public analytics configuration without calling Google. Web health checks the homepage, downloads and payment page.

A failed recreate attempts the exact compatible source images and owned-key rollback. Explicit `--rollback` performs the same restoration. Rollback preserves the analytics schema, checkout/financial rows and all unrelated environment changes. The worker/database containers and all other project containers must retain their identities/configurations throughout each operation. The historical registration-fence file is never rewritten.

5. Parent/root release verification remains mandatory: actual consent/rejection/withdrawal, no requests to Google before consent, safe events in each real stream, purchase/activation from a real verified payment path without making a test charge, public artifact bytes, and a repeat health/configuration observation. These scripts do not claim that Google has ingested an event or that a Windows runtime test happened merely because a candidate builds.

## Offline checks

```bash
python3 -m unittest discover -s coolify/releases/2026-11-02-analytics -p 'test_*.py'
python3 -m py_compile coolify/releases/2026-11-02-analytics/*.py
```

Local execution used a task-local PyYAML 6.0.3 directory (`../artifacts/analytics-release-python`) because macOS's system Python lacks PyYAML; no global Python package was changed. Nineteen tests pass, including actual temporary Git publications, native freeze drift, unreviewed canonical server/runtime changes, private file permissions, exact public retention, environment rollback isolation, unsafe SQL rejection, and placeholder paths that fail before any Docker call. Historical helper hashes are checked before importing the inherited transaction/build helpers.
