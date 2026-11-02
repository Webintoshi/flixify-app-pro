# Windows 1.0.1 download repair

The native Windows 1.0.1 installer was accepted from [Windows run 41398563074](https://github.com/Webintoshi/flixify-app-pro/actions/runs/41398563074), source `72eb2eec98499e414650ea250dc895ef98fb652f`, native tree `b9dfd09946becc55ac62366210b18dde1985c0c2`. Every Windows compile/test/package step passed, including real native video/input/idle proof, dynamic audio-menu anchoring, desktop shortcut launch, normal close, upgrade repair, uninstall preservation, dependency and privacy checks. The installer is 70,316,933 bytes (70,3 MB), SHA256 `9b40a987ee342e60b425fbd87698e80ebc9ab4cfff40b71dc522352c4d0aa8e9`. These five accepted pins are now filled; website publication remains a separate guarded operation below.

The required pins are `WINDOWS_REVISION`, `WINDOWS_TREE`, `EXE_SHA256`, integer `EXE_BYTES` and the Turkish display size `EXE_SIZE`. Their values must come from accepted Windows evidence. The descriptor identifies version `1.0.1`, the exact accepted installer bytes and `signed: false` with the existing visible unsigned-test notice. This profile does not establish signing trust or activate an updater.

## Confirmed baseline and protected services

- Website source and rollback image: `flixify-ops-web:windows-test-download-3af295bf1eac-20261101`, `sha256:a2a57bf8cb381a159921344d7e3c9e3165aea2bfebc3733d6f959dc97b4008a3`.
- Website baseline revision: `3af295bf1eac40974461757757a9ac63e8a016e5`.
- Frozen Mac source: revision `0e00365010566c5291153dcff7cdc451dc7adbd5`, tree `5f3078b1c58a64e01d2596ff462cc43d83345fdd`.
- Protected API: `flixify-api:welcome-offer-a052006305ed-20261101`, `sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496`.
- Protected worker: `flixify-worker:packages-8fa66d103053-20261101`, `sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57`.
- Protected database: `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.

The only runtime overlay is the existing `apps/ops-web/app/platform/windows-download.ts`; `NEW_PATHS` is empty. The only public addition is `downloads/flixify-pro-windows-1.0.1-x64-test-setup.exe`. No other page, layout, descriptor, dependency or public file is overlaid. API, worker, Android and shared-package source trees must match the baseline. The accepted Windows native commit must descend from that baseline and its exact native tree must persist into the website publication revision; the Mac native tree remains frozen.

The full public manifest preserves every previous byte, mode and link. Explicit retained downloads are:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `flixify-pro-windows-1.0.0-x64-test-setup.exe` | 70,307,673 | `a77def878ffecb6080d2e80a7db491e2745e8be91b239fbf15be308cfa9e5927` |
| `flixify-pro-macos-1.0.0-build2-test.dmg` | 44,517,156 | `ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d` |
| `flixify-tv-update.json` | 462 | `f439fd197839cbc3773dacc226801718c8688a3c438467f74ac87d619a838680` |
| `flixify-pro-1.4.7.apk` | 1,398,255 | `4c509e19ed410834a1e93bcf3ea3e57c0895a3f6a2e9fa33a411d56bbcb75284` |

## Offline checks

```sh
python3 coolify/releases/2026-11-02-windows-repair/test-release.py
python3 -m py_compile coolify/releases/2026-11-02-windows-repair/build-web.py coolify/releases/2026-11-02-windows-repair/release-web.py coolify/releases/2026-11-02-windows-repair/test-release.py
```

These contracts use synthetic Git histories, intercepted Docker calls and an in-process Node fetch fixture. They do not contact Docker, production, accounts or a real HTTP server. They prove local guard behavior, not native or website compilation. The tests stub only the unused YAML parser; production release operations still require the inherited PyYAML dependency.

## Future guarded sequence after acceptance

Run host operations serially. First accept native CI, fill the five verified pins and commit the reviewed descriptor plus the new installer. Then independently measure the current immutable source with this profile:

```sh
python3 coolify/releases/2026-11-02-windows-repair/build-web.py --measure
python3 coolify/releases/2026-11-02-windows-repair/build-web.py SOURCE_REPO --revision FULL_PUBLICATION_REVISION --source-untouched-sha256 FRESH_SHA256 --source-untouched-files FRESH_FILE_COUNT
```

Keep the full measurement receipt private. A historical fingerprint cannot be reused: this complete `/app` measurement excludes only the one descriptor, the new 1.0.1 EXE and `.next`. The existing 1.0.0 EXE, Mac/TV downloads, all other source and dependencies remain included.

The second command defaults to read-only preflight. After successful preflight, run the same command with explicit `--build`. The candidate tag is `flixify-ops-web:windows-repair-<revision12>-20261102`. Compilation retains the inherited 8 GiB free-space floor, disabled network, 1280/1536 MiB memory limits, actual cgroup verification and 256 PID cap. Only owned temporary containers are removed. The original Next configuration and runtime environment are retained. `--verify-existing` verifies an existing candidate without rebuilding.

Candidate verification compares the complete untouched fingerprint and public manifest. In a bounded container without network access it checks `/`, `/indir` and `/paketler`, and verifies exact HEAD lengths/MIME, 206 ranges, bounded full checksums and file headers for the new Windows EXE and retained Windows/Mac/TV downloads. A verified `web_candidate_verified:sha256:...` result is required before release preflight:

```sh
python3 coolify/releases/2026-11-02-windows-repair/release-web.py --revision FULL_PUBLICATION_REVISION --candidate-id VERIFIED_IMAGE_ID --protected-api-tag flixify-api:welcome-offer-a052006305ed-20261101 --protected-api-id sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496
```

After that preflight, the owner may run the same release command with explicit `--apply`, then `--recreate`, serially. The inherited exclusive release lock, protected service and other-project snapshots, literal-empty web `REGISTRATION_GUARD_SECRET`, raw environment digest `c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42`, and registration-fence checks remain in force. The fence retains its original `249006...` API proof independently of the current `241bbd...` API service. `--rollback` restores the exact current Windows 1.0.0 website source `a2a57bf8...` above.

After a future cutover, repeat public Windows 1.0.1 and retained 1.0.0/Mac/TV HEAD, range and full-checksum checks, check API health, and inspect hydrated home and `/indir#windows` for version 1.0.1, the working download link and the full unsigned notice on desktop and mobile. This profile authorizes no migration, backend recreation, pruning, security/signing change or unrelated deployment. Publication evidence must be recorded only after those operations actually succeed.
