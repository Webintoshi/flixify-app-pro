# Android TV frontend parity implementation plan

**Goal:** Carry the already approved website catalogue presentation into the native TV APK and prove the result in the APK itself.

**Architecture:** Native discovery selectors use complete, scoped, cached catalogues. A recycled TV discovery surface renders cinematic heroes and horizontal shelves, retaining the existing player, welcome gate, search handoff and offline preparation. Publication replaces only the download descriptor and new APK/update manifest over the current live website.

**Reference:** Current `apps/ops-web/app/platform/homepage-showcase.ts`, `movie-showcase.ts`, `catalog-showcase.ts`, `live-channel-lineup.ts` and their tests. This is parity with approved screens, not a new design direction.

## Constraints and review focus

- APK 1.4.7/code15, same certificate/package/minSdk23/target35. Do not change Media3, payment/trial policies, provider endpoints or running backend services.
- Verified 2026 films and series supply home hero/rows; older contents remain searchable and reachable. Invalid/conflicting year metadata stays unknown; old disk caches remain readable safely.
- Movies show 2026, Marvel, covered action and genuine fantasy collections before the complete archive. Series and favorites receive corresponding organized shelves.
- Home merges all three kinds without mixing account/source scopes. Late results, activity stop/resume and source changes cannot reveal another catalogue or remount a playing screen.
- Rows and archive are recycled, artwork requests bounded, remote focus/scroll restored after playback, and small TV viewports can scroll rather than hide content.
- Live presentation uses the existing cleaned channel identities, quality/exclusion policy and favorite aliases. Add website ordering, friendly filters/search and white contained-logo tiles without changing playback sources.

## Work and verification

- [x] Metadata/selectors: Item, reader/parser/copy/cache paths carry strict release years and deterministic discovery. Conflict/date/title/legacy-cache and collection membership/deduplication coverage is implemented; the final 141-test JVM run passed.
- [x] Native presentation implementation: combined scoped HOME and recycled hero/shelf/archive views replace the earlier movie-only home/plain grids. Final APK discovery tests passed 12/12 and six final screenshots cover home, movies, series, favorites, live and short windows. Lifecycle/source/memory/hero/favorite regressions are addressed. The native README now requires corresponding changes and verification on both surfaces.
- [x] Live presentation implementation: website reference ordering/classifications, friendly filters, normalized search and contained white-logo treatment are ported with canonical quality/exclusion/favorite identities preserved. Parser/lineup/filter tests and independent review cover ordering, foreign aliases, filter disappearance and mixed-catalogue behavior; final LiveCards device tests passed 4/4.
- [x] HOME loading follow-up: serialized auth/bootstrap/library preparation precedes optional provider-only work on the existing metadata executor. Five focused plus ten existing isolated network tests passed blocked-provider/playback/access, cached-hit, source-replacement, force/singleflight and cancellation checks with controlled 1200/750 ms bounds. These are fixture results, not production playback guarantees.
- [x] Release preparation: single-descriptor APK-only profile based on live web 65a3/API 241; 21 pure Python contracts passed. Fresh untouched fingerprint `32ad50edf0d1d6c9089042446d62f71e81f9c1fd1f811715abd430ef0cca5890` covers 18,266 files. Version is 1.4.7/code 15; signing identity and published 1.4.6 baseline remain pinned.
- [x] Final native QA/freeze: final stable build passed 141 JVM tests with zero lint errors and 47 warnings. Same-APK connected runs passed 30/30 and 48/48, covering changed UI and prior reproductions without claiming all 242 tests passed. Native freeze `4466921b1b2ad3bd83e6d8f8d37b6db83d441852`, tree `40cf16cfeb888132ad5fb5bf88391df8399d3910`; accepted same-signer APK/proof and final screenshots are recorded in the ops evidence.
- [x] Publication/integration: actual exact 1.4.6→1.4.7 unrooted package-only upgrade passed, preserving public UID/first-install time and installed bytes/cold launch/focus. Frozen candidate build, website-only apply/recreate and final preflight passed. Public APK/update hashes, hydrated 1.4.7 download/link, retained 1.4.6 APK and protected services/environment/fence verified. Publication commit `7ceb5becb0060e5d768c24ae2aeb99f9cb9fb981`, live web `sha256:9bd0bd2ad50aef4faec981fbffb4ba6e4d121004d3f6a9dab71b740eee904db4`; final proofs retained and owned QA emulator/AVD cleaned up. No real-card/provider playback, physical-TV/private-session, new-hash Play Protect or full-242-suite claim.

**Publication evidence:** `docs/operations/tv-front-parity-2026-11-01.md`; detailed private artifacts under `work/artifacts/tv-front-parity-20261101/`. Implementation, native acceptance, upgrade and publication are complete within the recorded QA limits.
