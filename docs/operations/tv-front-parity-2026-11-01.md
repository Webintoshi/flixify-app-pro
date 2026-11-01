# Android TV 1.4.7 frontend parity publication

Published 2026-11-01. The signed Android TV 1.4.7/code 15 update is available through the current website download and update manifest. Final artifact, package-only upgrade, guarded website publication and public HTTP/browser checks passed.

## Implemented scope

- Carry the current website presentation into compiled native TV screens: a combined movie/series/live homepage, verified 2026 heroes and separate shelves; movie collections for 2026, Marvel, action and fantasy before the full recycled archive; organized series and favorites shelves.
- Preserve the full scoped catalogue for search. Release-year parsing and model/reader/cache propagation distinguish verified years from invalid/conflicting metadata. Metadata format 2 retains safe format 1 reads and background refresh.
- Mirror website live ordering, friendly country/category filtering, normalized search and white contained-logo tiles while retaining canonical feed IDs, source/expiry checks, exclusions, quality selection and saved aliases.
- Keep welcome/package handoff, direct playback, player controls and existing cache behavior. Scoped HOME loading retains late results across navigation, reloads missing kinds after resume, ignores old-source callbacks and releases inactive catalogue references under memory pressure. Recycled holders retire artwork work; focused hero/item identity survives enrichment and playback return.
- Move uncached/forced HOME provider metadata work to the existing bounded background executor after serialized bootstrap/library preparation. API token rotation stays on its serial lane; explicit section loading is unchanged. Playback and memory pressure can cancel optional work.
- Add the durable both-surfaces frontend policy in `apps/tv-android/README.md`: a web deployment cannot replace compiled Java UI. Corresponding native changes, remote navigation checks, actual APK screenshots and a signed APK/update manifest accompany future frontend work.

## Native verification

- The stable build passed 141 JVM tests with zero failures/errors. Release lint reported zero errors and 47 warnings.
- Two final runs on the same stable APK passed 30/30 and 48/48 connected tests: Discovery 12, LiveCards 4, Startup 14; MainRemote 14, DeviceCache 9, Responsive 9, PosterSound 5 and SearchResult 11. These cover the changed screens and reproduced regressions. Actual final screenshots cover home, curated movies, series, favorites, live logos and a short viewport. Test records and public website poster assets were used; no provider stream was opened.
- The first broad connected run executed 242 tests with 11 failures, exposing old flat-layout/movie-only assumptions, short-card clipping and search/focus behavior. An intermediate 163-case run had two geometry failures, resolved by excluding transient RecyclerView measured heights from final viewport calculations. The final focused runs verify those changes; neither earlier run is recorded as a full-suite pass.
- The HOME lane follow-up passed five focused tests plus ten existing isolated network tests. Controlled blocked-provider fixtures verify playback/access callbacks within 1200 ms and cached HOME delivery within 750 ms, source replacement rejection, joined force requests and optional connection disconnection. These are fixture bounds, not measured production channel-start guarantees.
- Independent reviews covered scoped callbacks/lifecycle, memory eviction, focused hero identity, remote navigation, favorite pending-token cleanup, source/auth leases, forced-refresh admission and queue/cancellation behavior. Final targeted device execution passed on the accepted source freeze.
- The publication profile passed 21 pure Python contracts, including descriptor-only scope, exact baseline/service pins, retained public files/modes/links, inherited 32 MiB APK-reader integration, bounded compiler cleanup and a mocked explicit package-only upgrade. No device/server mutation is performed by those contracts.
- Actual published 1.4.6/code 14→signed 1.4.7/code 15 `install -r` passed on the owned unrooted emulator. Public UID and first-install time were preserved; exact installed APK bytes, cold launch/focus, five-second same-process survival and absence of fatal app logs were verified. Explicit package-only mode reports private-file and session-decryption checks false.

Evidence is retained outside Git in `work/artifacts/tv-front-parity-20261101/`: `native-stable-device.log`, `native-final-regressions.log`, `native-stable-build.log`, `native-full-device.log`, `guard-first.log`, `source-measurement.json` and the six final `discovery-*.png` screenshots. Available JVM XML and lint reports corroborate the final 141/0 and 0-error/47-warning counts. Earlier failed runs remain recorded as failures.

## Exact release and protected baseline

The accepted release is package `vip.flixify.tv`, 1.4.7/code 15, minSdk 23/target 35, nondebuggable with v1/v2 signatures and unchanged certificate SHA256 `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`. The baseline published 1.4.6 APK is 1,374,125 bytes, SHA256 `911bbfc9d6513676d6c6605af1e07a4d9e81f9997bb44c32c17688ae9b34a4b6`.

| Accepted artifact | Exact identity |
| --- | --- |
| Native freeze | `4466921b1b2ad3bd83e6d8f8d37b6db83d441852` |
| Native tree | `40cf16cfeb888132ad5fb5bf88391df8399d3910` |
| Publication commit | `7ceb5becb0060e5d768c24ae2aeb99f9cb9fb981` |
| Live website | `flixify-ops-web:tv-front-parity-7ceb5becb006-20261101`, `sha256:9bd0bd2ad50aef4faec981fbffb4ba6e4d121004d3f6a9dab71b740eee904db4` |
| APK | 1,398,255 bytes; SHA256 `4c509e19ed410834a1e93bcf3ea3e57c0895a3f6a2e9fa33a411d56bbcb75284` |
| Independent artifact proof | `artifact-proof-final.json`, SHA256 `ccfc5795bf9e2862f903152a931748b6968bf00710b2e912d61c07d1349e0a11` |

The release ZIP was checked to exclude instrumentation fixture images. `upgrade-proof-final.json` records the actual same-certificate upgrade, without clearing/uninstalling the app, granting permissions or changing device security.

The APK-only profile is `coolify/releases/2026-11-01-tv-front-parity/`. It derives from the previous live website `sha256:65a3d81e5337f292d180ffe98dee4e5661b29bf783fee0a33d16c9bfe86c59d2`, Git publication baseline `3010833e1c4b1a7ebe059580d820f6c6a02d03e7`. The existing download descriptor changed only through exact 1.4.6→1.4.7 substitutions; public changes are the new immutable APK and existing update JSON. All other website runtime, dependencies and public files were preserved. The baseline update JSON was 483 bytes, SHA256 `4d48c55550a17bd55ba8c5247da22ccae966ebe11fad4c2ab11f92bfcbd5a838`.

Fresh source measurement and final production proof preserve 18,266 files with untouched fingerprint `32ad50edf0d1d6c9089042446d62f71e81f9c1fd1f811715abd430ef0cca5890`. The exclusions are only that descriptor, the new APK, update JSON and `.next`. Remote release evidence is under `/tmp/flixify-parity-release-0gu6qqxk`; the guarded build retained the 8 GiB free-space floor and isolated compiler limits.

API `sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496`, worker, database and other projects remained unchanged. No backend deployment or migration was performed. Raw environment SHA256 remains `c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42`; original registration-fence SHA256 remains `5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b`. The new native catalogue/UI implementation is a compiled APK change; the website cutover publishes its download artifacts over the current frontend.

## Production verification and limits

- Website guarded apply/recreate and final target preflight passed. The exact live image above and protected production state are recorded in `production-proof-final.json` (SHA256 `98434508a173443ae9987f74dca2fbb560d3d47b90ebcaf2642812670de28331`).
- Public APK HEAD returned 200 with Android-package MIME and 1,398,255 bytes; Range returned 206; full download matched SHA256 `4c509e19ed410834a1e93bcf3ea3e57c0895a3f6a2e9fa33a411d56bbcb75284`. Update JSON matched SHA256 `f439fd197839cbc3773dacc226801718c8688a3c438467f74ac87d619a838680`. The retained 1.4.6 APK matched its original bytes and digest.
- API health and public `/`, `/paketler`, `/indir` checks passed; unauthenticated welcome status returned 401. Actual browser `/indir` rendered 1.4.7 and linked to `/downloads/flixify-pro-1.4.7.apk`. `production-browser-proof-final.json` and `production-download.png` retain the hydrated browser evidence.
- The owned emulator was stopped and only the newly created QA AVD removed; the original AVD was retained. The two owned QA browser tabs were closed; user tabs were retained.

Final public, native and upgrade evidence is retained alongside the production proof in `public-proof-final.json`, `verification-summary.json` and `upgrade-proof-final.json`.

No physical-TV, private-session/decryption, real card charge or provider-playback claim is made. New-hash Play Protect classification is neither changed nor asserted. The final 30+48 connected checks do not imply an all-242-test full-suite pass.
