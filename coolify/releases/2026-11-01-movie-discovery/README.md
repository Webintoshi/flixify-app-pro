# Movie discovery and automatic pagination: web-only overlay

The profile builds from published revision `b0def990e266c133acabd859e3de6e3638ee9751`, website tag `flixify-ops-web:embedded-page-b0def990e266-20261101`, image `sha256:3f123ce5af46e71106221917cd4eeb175d60e3ba8a3218834629bf316c814bf6`. It accepts exactly these runtime leaves:

- Existing `apps/ops-web/app/platform/catalog.tsx` and `apps/ops-web/app/canli-tv/page.tsx`.
- New `apps/ops-web/app/platform/movie-showcase.ts`, `movie-showcase-source.ts`, and `use-infinite-scroll.ts`.

Only those five leaves and generated `apps/ops-web/.next` are excluded from the complete source-image fingerprint. New leaves must be absent from the baseline Git tree and immutable image; existing leaves must match baseline Git bytes in that exact image. Regular web test files, Markdown plans under `docs/`, and these four release files may accompany the payload. No other file changes are accepted. Payment pages/components, provider/API/worker code, CSS, dependencies, APKs, public assets and the native tree remain protected.

Before committing, independently measure the source image with this profile's `snapshot_script()`. Keep its SHA and file count outside the checkout and supply both explicitly. Read-only preflight compares that proof to the actual immutable image before compiling. The compiler retains the reviewed 8 GiB free-space floor, actual 1280/1536 MiB cgroup limits, 256 PID cap and isolated network. It restores exact Next configuration bytes, removes only its own temporary container and generated Next cache, then verifies candidate ancestry, configuration, build settings and source bytes. Full untouched and public-tree proofs plus APK 1.4.4 HTTP HEAD/range/body/update-manifest checks are retained. Next output is validated; its nondeterministic build ID is not described as byte reproduction.

The current API is pinned to `flixify-api:embedded-page-b0def990e266-20261101`, `sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1`. Worker remains `flixify-worker:packages-8fa66d103053-20261101`, `sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57`; database remains `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`. Build and release protect exact host identities/configuration, raw environment/fence bytes and all other applications. The previously measured external Keycloak crash-loop exception retains its exact static identity/configuration restrictions. The completed registration fence still requires its original API proof `249006…`; the current payment API does not replace that proof.

```sh
python3 coolify/releases/2026-11-01-movie-discovery/test-web.py
python3 coolify/releases/2026-11-01-movie-discovery/build-web.py /path/to/checkout --revision EXACT_40_CHARACTER_REVISION --protected-api-tag flixify-api:embedded-page-b0def990e266-20261101 --protected-api-id sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1 --source-untouched-sha256 INDEPENDENT_SOURCE_SHA256 --source-untouched-files INDEPENDENT_SOURCE_FILE_COUNT
```

The build command is read-only by default. Add `--build` once to produce `flixify-ops-web:movie-discovery-REVISION12-20261101`; use `--verify-existing` for an existing candidate. Both require the original published source services to remain live throughout verification. No dependency downloads or service restart occurs during compilation.

Publish only after independently reviewing the candidate image ID:

```sh
python3 coolify/releases/2026-11-01-movie-discovery/release-web.py --revision EXACT_40_CHARACTER_REVISION --candidate-id VERIFIED_CANDIDATE_IMAGE_ID --protected-api-tag flixify-api:embedded-page-b0def990e266-20261101 --protected-api-id sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1
```

That command is read-only. Run it first as shown, then with `--apply` to synchronize only the website image, then with `--recreate` to replace only the website container. The inherited exclusive release lock, permanent registration profile/fence, all environment values and protected API/worker/database checks remain active. `--rollback` restores only the original b0def99 website image. No migration, provider write, financial-record mutation, environment change or broad cleanup belongs to this release.
