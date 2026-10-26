# Web activation and live playback recovery

Use the reviewed full application commit containing the player watchdog. The builder requires exactly three runtime differences from the current `5002a7a` web base: `session.tsx`, `onboarding.tsx`, and `canli-tv/page.tsx`. Test files and development package changes are excluded. A different runtime manifest stops preflight.

The source is pinned to `sha256:93f913bc8f06137b83187d656d44c139b008df1ed92483f5ac82638e81db41f8`. The builder compares every original runtime file to exact baseline Git bytes, keeps all other source/dependency files inherited, and verifies candidate source/configuration and image ancestry. Existing public build settings are read silently. Only during the build, static workers are limited to one, the Webpack build worker and memory optimizations are enabled, and Webpack disk cache is disabled; original Next config bytes are restored and the cache is removed in the same layer. Build needs 8 GiB free. It uses Buildx per-step resource caps of 1280 MiB memory and 1536 MiB total memory plus swap. Its single RUN checks actual kernel cgroup limits before invoking Next; missing, unbounded or relaxed limits stop the build. No builder command deploys.

Reviewed web application commit: `2a7c60e07826fc3dd81606f8eb5534641a931bb7`.

```sh
python3 coolify/releases/2026-10-26-edge-recovery/build-web.py . --revision 2a7c60e07826fc3dd81606f8eb5534641a931bb7
python3 coolify/releases/2026-10-26-edge-recovery/build-web.py . --revision 2a7c60e07826fc3dd81606f8eb5534641a931bb7 --build
```

Record the accepted immutable `sha256:...` printed after `web_candidate_built:` and substitute it for `ACCEPTED_WEB_IMAGE_ID` below. The commands pin the verified worker candidate `9b5d544`; run only after that worker rollout succeeds. The adapter requires both worker tag and ID explicitly and stops if the running worker differs.

```sh
python3 coolify/releases/2026-10-26-edge-recovery/release-web.py --revision 2a7c60e07826fc3dd81606f8eb5534641a931bb7 --candidate-id ACCEPTED_WEB_IMAGE_ID --protected-worker-tag flixify-worker:edge-recovery-7731936e27df-20261026 --protected-worker-id sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3
python3 coolify/releases/2026-10-26-edge-recovery/release-web.py --revision 2a7c60e07826fc3dd81606f8eb5534641a931bb7 --candidate-id ACCEPTED_WEB_IMAGE_ID --protected-worker-tag flixify-worker:edge-recovery-7731936e27df-20261026 --protected-worker-id sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3 --apply
python3 coolify/releases/2026-10-26-edge-recovery/release-web.py --revision 2a7c60e07826fc3dd81606f8eb5534641a931bb7 --candidate-id ACCEPTED_WEB_IMAGE_ID --protected-worker-tag flixify-worker:edge-recovery-7731936e27df-20261026 --protected-worker-id sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3 --recreate
```

Apply synchronizes only web image metadata across Coolify raw/rendered/generated Compose and its application record. Recreate changes only web with dependencies/build/pulls disabled. API, worker, and the actual running database identity/config/environment/networks/mounts remain protected. Exact Compose/env bytes and model metadata are checked immediately before recreation and after health. A failed web start attempts a guarded source rollback; an interrupted rollout can use the same arguments with `--rollback`. An existing candidate can be reverified with builder `--verify-existing`.

The web adapter imports `release-worker.py` from the same folder to reuse its reviewed transaction, preservation and rollback guards. Keep both scripts together. Health checks the exact web container's local HTTP endpoint, followed by ten seconds of stable container identity. Browser playback recovery acceptance remains separate. The live Telegram bot is unchanged.

Offline checks:

```sh
python3 coolify/releases/2026-10-26-edge-recovery/test-worker-tools.py
python3 coolify/releases/2026-10-26-edge-recovery/test-web-release.py
python3 coolify/releases/2026-10-26-edge-recovery/test-web-builder.py
```

Buildx resource flags require the daemon per-step resource capability; unsupported flags or failed cgroup verification stop the operation. Caps apply to compilation, not the Docker daemon itself. No swap or other host service settings are changed. The temporary settings follow the [Next.js 15 memory guide](https://nextjs.org/docs/15/app/guides/memory-usage); resource semantics follow the [Docker Buildx reference](https://docs.docker.com/reference/cli/docker/buildx/build/#set-cpu-and-memory-limits-for-build-containers---resource).

## Quiet player badge follow-up

Application revision `f8737c27d1d161d5268e8003bf53ef0a7a91147d` removes only the transient player badge. Use `build-quiet-web.py` and `release-quiet-web.py`; they pin the observed current web `sha256:1a1e54ab741b5564462ed62645a7590617420ea5005b68595676f6e63df52552` / `edge-recovery-2a7c60e07826-20261026`, compare against base revision `2a7c60e07826fc3dd81606f8eb5534641a931bb7`, and overlay only `canli-tv/page.tsx`.

```sh
python3 coolify/releases/2026-10-26-edge-recovery/build-quiet-web.py . --revision f8737c27d1d161d5268e8003bf53ef0a7a91147d --build
```

Use that same full application revision with `release-quiet-web.py`, the new accepted candidate ID, and the unchanged explicit worker tag/ID shown above. Preflight, `--apply`, `--recreate` and `--rollback` behave as above; rollback restores the healthy `2a7c60e07826` web. The 8 GiB free-space gate and all resource/configuration/preservation guards remain required. Focused adapter checks: `python3 coolify/releases/2026-10-26-edge-recovery/test-quiet-web.py`.
