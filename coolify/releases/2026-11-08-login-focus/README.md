# Login focus and segmented OTP: WEB only

This profile starts from the published phone-login WEB70af image and protects the running API44ff, worker, database, every environment row, exact `.env` bytes, downloads and other projects. Only the five explicitly listed login React/CSS paths may change; a frozen `manifest.json` chooses the actual subset and binds both before/after source hashes. There are no dependencies, API patches, migrations, session changes or setting changes.

The exact reviewed builder and reader from Git commit `88f27a175567e5be7295763f8a74044da55b2caa` are loaded from verified blobs in a private temporary directory. They are not imported from the mutable phone-release working files. Keep that commit reachable in the server checkout. Their existing1CPU/1280MiB/1536MiB including swap/128PID/480s limits and one-worker Next flags remain. This profile skips contracts compilation and does not exclude dependencies or contracts output from its untouched-tree proof. The original public tree and all prior `.next/static` files are preserved.

After a successful WEB compile, only the disposable `/app/apps/ops-web/.next/cache` directory is removed inside the owned compiler container before static-file merge and image commit. All parent directories and the cache target must be actual directories, with symlinks refused. Source, dependencies, public files and runtime `.next/static`/server output are retained. No running container or existing image is modified.

Wait for UI freeze and local QA before creating a candidate. Commit `manifest.json` at this profile path together with its exact source files. Manifest entries contain `path`, `beforeSha256` (null only for new segmented OTP files), `sha256` and `bytes`; top level contains `schemaVersion:1`, the pinned `sourceImageId`, and `files`. The commands consume exact committed blobs, not working files.

```sh
python3 coolify/releases/2026-11-08-login-focus/build.py SERVER_CHECKOUT --revision EXACT40CHARCOMMIT --manifest coolify/releases/2026-11-08-login-focus/manifest.json --work-dir FRESH_PRIVATE_DIRECTORY
```

Default performs read-only application preflight, including a bounded read-only source-image hash probe. Add `--build` to create only the WEB candidate, its `ops-web-proof.json`, and isolated smoke checks. At least8GiB free space is required; no cleanup/pruning is performed.

```sh
python3 coolify/releases/2026-11-08-login-focus/release.py SERVER_CHECKOUT --revision EXACT40CHARCOMMIT --manifest coolify/releases/2026-11-08-login-focus/manifest.json --proof FRESH_PRIVATE_DIRECTORY/ops-web-proof.json
```

Default is read-only, including an in-memory metadata preview. Then use `--apply` for WEB tag metadata only and `--recreate` for WEB only. The metadata transaction updates WEB's raw/rendered image field, WEB application image, and generated compose file. It never writes `.env`, saves an environment row, or changes API/worker/database. All environment rows are protected, including PHONE/VATANSMS keys. Full API runtime configuration and state are included in the protected snapshot. The service uses the existing shared phone-release lock; its new journal is `.login-focus-release.json`.

Immediately before compose up, target tag identity, exact model/generated-file/environment fingerprints and every protected container are checked again. After restart, WEB image, runtime environment, health and all protected state must match. `--rollback` restores only the original WEB70af image and retains API44ff with its remembered-session behavior. It never restores an old API.

Local pure-guard tests and Python syntax checks must pass. The installed Coolify PHP preview still requires an actual-host read-only check before metadata mutation. This profile does not use the phone release's environment-mutating PHP_APPLY or its unsaved-row prediction path.

```sh
python3 -m unittest discover -s coolify/releases/2026-11-08-login-focus -p test_release.py -v
python3 -m py_compile coolify/releases/2026-11-08-login-focus/build.py coolify/releases/2026-11-08-login-focus/release.py
```
