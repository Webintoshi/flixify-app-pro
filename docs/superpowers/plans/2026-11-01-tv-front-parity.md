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

- [ ] Metadata/selectors: extend Item and all reader/parser/copy/cache paths; implement strict release years and deterministic discovery. Pin conflict/date/title/legacy-cache and collection membership/deduplication tests before considering selectors complete.
- [ ] Native presentation: replace the movie-only home and plain discovery grids with scoped combined home and hero/shelf/archive views. Test home series/live, hero actions, movie collection order, search of older records, remote navigation and playback return; capture actual APK screenshots at TV sizes.
- [ ] Live presentation: port current website reference ordering and classifications, friendly category filters, normalized live title/group search and logo treatment. Test TRT1/Star order, retained foreign identities, filter counts/preview consistency and quality/favorite mappings.
- [ ] Release: add a single-descriptor APK-only profile based on live web65a3/API241; fresh untouched fingerprint, signed native freeze/proof, actual 1.4.6→1.4.7 upgrade, protected web-only cutover and public download verification.
- [ ] Integration: independently review changed surfaces, run meaningful JVM/instrumentation/guard checks, inspect real rendered APK screens, publish and document exact pins and QA limits. No real-card/provider playback or physical-TV claims without such tests.
