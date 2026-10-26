# Worker release — 26 October 2026

Run only on the active Coolify host. Tools default to preflight and never print environment values. No backups. The live Telegram bot already sets numeric private_cdn=1; leave it unchanged.

Reviewed application revision: `7731936e27df42925405f0686ccb8b625cb24abc`. Keep this exact revision after committing tooling; never substitute HEAD.

Base worker is pinned to `sha256:be19dd2e8d8cf67dcb9a2b9804eb9f7263ea04a9f486b385affc513effe4b924`. Its reseller.ts must match the observed SHA and exact pre-fix committed bytes. Only reseller.ts is copied; inherited build regenerates worker dist. Packages, lockfile and unrelated sources remain inherited. The candidate must pass the exact application commit auto-trial.test.ts with networking disabled before its accepted ID is printed.

From the existing host checkout:

```sh
python3 coolify/releases/2026-10-26-edge-recovery/build-worker.py . --revision 7731936e27df42925405f0686ccb8b625cb24abc
python3 coolify/releases/2026-10-26-edge-recovery/build-worker.py . --revision 7731936e27df42925405f0686ccb8b625cb24abc --build
```

Candidate tag: `flixify-worker:edge-recovery-7731936e27df-20261026`. Replace ACCEPTED_IMAGE_ID below with the full sha256 ID printed after candidate_built:

```sh
python3 coolify/releases/2026-10-26-edge-recovery/release-worker.py --revision 7731936e27df42925405f0686ccb8b625cb24abc --candidate-id ACCEPTED_IMAGE_ID
python3 coolify/releases/2026-10-26-edge-recovery/release-worker.py --revision 7731936e27df42925405f0686ccb8b625cb24abc --candidate-id ACCEPTED_IMAGE_ID --apply
python3 coolify/releases/2026-10-26-edge-recovery/release-worker.py --revision 7731936e27df42925405f0686ccb8b625cb24abc --candidate-id ACCEPTED_IMAGE_ID --recreate
```

Apply syncs only worker image in raw/rendered/generated Compose and its Coolify application model. Recreate restarts worker only. API, web, database identities/config/environment/networks/mounts are guarded. Exact Compose/env and metadata are rechecked before recreation and after health. The actual running database digest remains pinned despite floating-tag drift. Process health does not prove real provider trial provisioning.

Interrupted build: repeat build command with --verify-existing instead of --build. Interrupted deployment: same release arguments with --rollback restores pinned worker baseline. Rollback repeats the exact source configuration guards before mutation and after success.

Build requires 3GiB free. Temporary context and intermediate containers are removed. Check free Docker storage after build. Do not remove running images, source worker or rollback sources. Broad image/volume/system pruning is outside these tools. Web build is separate due prior cache disk exhaustion.

Offline policy checks: `python3 coolify/releases/2026-10-26-edge-recovery/test-worker-tools.py`.
