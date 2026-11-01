# Windows unsigned test-download website publication

This website-only profile uses the accepted native Windows run [41348716138](https://github.com/Webintoshi/flixify-app-pro/actions/runs/41348716138), source `2091b8f675e3ce6dea387c85e1bc2e6ba4746512`, native tree `a216267047b82727bfdc71d498feac4f475c6ee1`. Compile, four test suites, real native media/input/idle/close proof, dependency/privacy checks and installed launch/normal exit/upgrade/uninstall all passed. The installer is 70,307,673 bytes (70,3 MB), SHA256 `a77def878ffecb6080d2e80a7db491e2745e8be91b239fbf15be308cfa9e5927`.

The installer remains an unsigned TEST build (`signed: false`); SmartScreen/browser warnings or blocking are possible. No Windows trusted updater, automatic execution or security bypass is added. The descriptor and five native/artifact pins are filled from this accepted artifact. Website publication remains a separate guarded operation below.

## Pinned source and scope

- Current website/rollback source: `flixify-ops-web:macos-test-download-850032567861-20261101`, `sha256:52fc1c2081385e3c61f4b4f5807ef8b32881531b6670e663b989d30d66e6a136`.
- Website source commit: `85003256786115509bfd95c7ff659a03cb0d379a`.
- Frozen native Mac commit: `0e00365010566c5291153dcff7cdc451dc7adbd5`, tree `5f3078b1c58a64e01d2596ff462cc43d83345fdd`.
- Protected API: `flixify-api:welcome-offer-a052006305ed-20261101`, `sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496`.
- Protected worker: `flixify-worker:packages-8fa66d103053-20261101`, `sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57`.
- Protected database: `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.

The eight exact source leaf paths in `PATHS` are the only runtime overlays; `app/platform/windows-download.ts` is the only new source leaf. The only public addition is `downloads/flixify-pro-windows-1.0.0-x64-test-setup.exe`. `mac-download.ts` and `tv-download.ts` are neither overlaid nor excluded. Native Mac, Android, API, worker and shared-package source trees are frozen separately. The accepted Windows native commit must descend from the website baseline and its exact tree must persist through the website publication commit.

The full public manifest retains every existing byte, mode and link. Explicit retained download pins are:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `flixify-pro-macos-1.0.0-build2-test.dmg` | 44,517,156 | `ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d` |
| `flixify-tv-update.json` | 462 | `f439fd197839cbc3773dacc226801718c8688a3c438467f74ac87d619a838680` |
| `flixify-pro-1.4.7.apk` | 1,398,255 | `4c509e19ed410834a1e93bcf3ea3e57c0895a3f6a2e9fa33a411d56bbcb75284` |

The complete untouched `/app` fingerprint excludes only the eight source leaves, the new EXE and `.next`. It keeps dependencies, existing descriptors, APKs, DMG, manifests and all other source files. A fresh independent fingerprint is mandatory because the exclusion set differs from the Mac publication.

## Offline contracts, without actual compilation

```sh
python3 coolify/releases/2026-11-01-windows-download/test-release.py
python3 -m py_compile coolify/releases/2026-11-01-windows-download/build-web.py coolify/releases/2026-11-01-windows-download/release-web.py coolify/releases/2026-11-01-windows-download/test-release.py
```

Tests use synthetic Git repositories, mocked Docker calls and an in-process mocked fetch implementation in Node. They do not contact Docker, a real HTTP server, production or accounts. They are not evidence of native compilation, real website compilation or a real installer. The installer reader uses its own exact verified byte limit; the shared 32 MiB APK limit remains unchanged. Both local validation and candidate HTTP checks validate MZ, a bounded PE-header offset, `PE\0\0` and the pinned SHA256.

## Owner-operated production sequence after accepting CI

These commands document the later owner-operated process. They have not been run as part of profile preparation. Keep the full measurement JSON private and run host operations serially.

```sh
python3 coolify/releases/2026-11-01-windows-download/build-web.py --measure
python3 coolify/releases/2026-11-01-windows-download/build-web.py SOURCE_REPO --revision FULL_PUBLICATION_REVISION --source-untouched-sha256 FRESH_SHA256 --source-untouched-files FRESH_FILE_COUNT
```

The second command defaults to read-only preflight. Only after accepted native CI, filled pins, reviewed source/asset commit and successful preflight may the owner use `--build`. The compiler retains the 8 GiB free-space floor, network-disabled 1280/1536 MiB memory limits, actual cgroup verification and 256 PID cap. `--verify-existing` verifies an existing candidate without rebuilding. Temporary containers are removed by ownership, and the exact original Next configuration and runtime environment are retained.

Candidate verification compares the complete untouched tree and full public manifest. In a bounded network-disabled container it requires 200 responses from `/`, `/indir` and `/paketler`, exact Windows HEAD size and an executable/octet-stream MIME type, a 206 range response, bounded full download, pinned checksum and MZ/PE headers. It repeats public read checks for retained Mac DMG and TV APK/manifest bytes. A verified `web_candidate_verified:sha256:...` result is required before cutover.

```sh
python3 coolify/releases/2026-11-01-windows-download/release-web.py --revision FULL_PUBLICATION_REVISION --candidate-id VERIFIED_IMAGE_ID --protected-api-tag flixify-api:welcome-offer-a052006305ed-20261101 --protected-api-id sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496
```

The standalone release command requires the inherited PyYAML dependency in the production Python environment. Offline contracts stub only the unused YAML parser and do not prove real YAML parsing. Default is preflight. The owner may then run explicit `--apply` and `--recreate` serially. The inherited exclusive release lock, protected services/other-project snapshots, literal-empty web `REGISTRATION_GUARD_SECRET`, raw environment digest `c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42` and original registration fence are retained. The fence continues to reference the original `249006...` API proof, independently of the current `241bbd...` API service. `--rollback` restores the exact `52fc1c...` Mac-download website source.

After cutover, the owner must repeat public HEAD/range/full-checksum Windows and retained Mac/TV download checks, check API health and inspect hydrated home and `/indir#windows` for the working test link, full visible unsigned warning and responsive layout. No migration, trusted Windows update JSON, updater activation, backend recreation, pruning or unrelated deployment is part of this profile.
