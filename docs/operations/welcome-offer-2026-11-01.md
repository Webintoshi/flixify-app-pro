# New-account welcome offer and Android TV 1.4.6

Published 2026-11-01. Guarded API and website apply/recreate operations each exited successfully; final target preflight and public HTTP/browser checks passed.

## Delivered behavior

- Only newly registered accounts receive the private `welcome-monthly-50-v1` grant. Existing accounts are not backfilled. The first-login choice precedes catalogue content on web and Android TV.
- Free selection dismisses the prompt and retains the existing three-hour trial. It neither restarts the trial nor consumes the first monthly discount. Single-user monthly payment is 125 TRY; two-user monthly payment is 199.50 TRY. Six/twelve-month and existing-account prices remain unchanged.
- Server-owned eligibility, exact net amounts, checkout ownership and verified fulfillment govern redemption. Dismissed/abandoned payment screens do not prove payment. Trial settlement precedes paid provider provisioning; legacy payments and referral qualification remain covered.
- Web retains embedded one-time checkout. TV uses the system browser with a fixed same-account payment URL containing only the capacity selection, with a phone/browser fallback. No account token is placed in the URL.
- Android TV retains the cache/player behavior and signing identity. Its compact welcome choices fit the tested 960×540 dp viewport, with aligned actions and remote focus. Login/search hidden-keyboard navigation and category one-OK confirmation have regression coverage.

## Exact artifacts

| Item | Accepted revision or identity |
| --- | --- |
| API revision | `a052006305edf3177f5739ea82388eaf895b3ed6` |
| Live API | `flixify-api:welcome-offer-a052006305ed-20261101`, `sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496` |
| Native freeze | `015c14799ac37977e4fdfac03a2f1b08daff0a44` |
| Native tree | `fb15086c59fe00062956872890f60f9d41dfe3ea` |
| Website/APK publication revision | `3010833e1c4b1a7ebe059580d820f6c6a02d03e7` |
| Live website | `flixify-ops-web:welcome-offer-3010833e1c4b-20261101`, `sha256:65a3d81e5337f292d180ffe98dee4e5661b29bf783fee0a33d16c9bfe86c59d2` |
| APK | `vip.flixify.tv`, 1.4.6/code 14, minSdk 23/target 35, 1,374,125 bytes, nondebuggable v1/v2 signed release |
| APK SHA256 | `911bbfc9d6513676d6c6605af1e07a4d9e81f9997bb44c32c17688ae9b34a4b6` |
| Certificate SHA256 | `158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594` |
| Independent APK proof SHA256 | `09aca2ba55a386386607e37f98d9f4962a992d6d6cfe1ed7343681aa55315366` |

## Verification evidence

- Actual API candidate: 124 unit/HTTP tests passed. The separate isolated PostgreSQL run passed 24 persistence, migration and interleaving tests without production volumes or published ports. Offline release contracts passed 15/15.
- Real Stripe unpaid-session verification used the actual candidate source and confirmed both TRY totals: 12500 and 19950 minor units, against unchanged regular amounts 25000 and 39900. Both owned sessions remained unpaid and were expired afterward. No card was submitted, confirmation called or provider operation performed.
- Local browser fixtures covered 1440×900, 390×844 and 320×740: no horizontal overflow, both prices, keyboard focus, free-choice persistence across reload/relogin, old-account gate bypass and regular 250/399 prices. Actual TV screenshots covered single/dual selection and visible aligned actions.
- Frozen native sources: 112 JVM tests passed, zero lint errors and 43 warnings. The final connected regression run passed 57 tests: MainRemote 14, CatalogPanels 8, CategoryListView 4, WelcomeOfferUi 9, WelcomeOfferRepository 4, StartupScreen 14 and RemoteEditText 4. Category panels plus key-pairing tests passed 12/12. Earlier full runs exposed the input issues; an interrupted full run is not counted as a passing full suite.
- Actual published 1.4.5/code 13 to signed 1.4.6/code 14 `install -r` passed on the owned unrooted Android TV API 36 emulator. Exact installed APK bytes, signer, public UID, first-install time, cold launch/focus, five-second same-process survival and absence of fatal app logs were verified. Package-only mode explicitly reports private-file/session checks false.
- Guarded candidates derive from the measured current API/web images and preserve all source outside explicit leaf allowlists, dependencies and prior immutable APKs. API compilation reproduced its original compiled baseline. The website protected 18,255 files with fingerprint `de88e8aa7ffcf99f5b06238be4375d07d5d2f75cfe4602ceeef900fe59694ecd`.
- Additive migration 003 enabled private-table protection without historical grants. Package and channel-exclusion checksums were unchanged. The stable 50% once coupon was prepared without a charge.

Evidence is retained outside Git under `work/artifacts/welcome-offer-20261101/`: `final-api-financial-proof.json`, `browser-qa.json`, `billing-final.log`, `guard-final.log`, `native-frozen-regressions.log`, `native-frozen-build.log`, `artifact-proof-final.json`, `upgrade-proof-final.json` and the final native single/dual screenshots. Native XML/lint reports corroborate the counts above. Release tooling and exact scopes are documented in `coolify/releases/2026-11-01-welcome-offer/README.md`.

## Production verification and limits

- Final production proof confirms the exact API/web images above, successful guarded apply/recreate and target preflight, with worker, database and other projects unchanged. Raw environment SHA256 remains `c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42`; registration-fence SHA256 remains `5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b`.
- Public APK HEAD returned 200 with Android-package MIME and 1,374,125 bytes; Range returned 206; full download matched the accepted APK SHA256. Update JSON matched SHA256 `4d48c55550a17bd55ba8c5247da22ccae966ebe11fad4c2ab11f92bfcbd5a838`. The retained 1.4.5 download matched its original 1,367,652 bytes and SHA256.
- API health and `/`, `/paketler`, `/indir` returned 200; unauthenticated welcome status returned 401. The existing authenticated production account bypassed the welcome gate, retained regular single/dual monthly 250/399 and six/twelve-month prices, and did not open a checkout. Hydrated `/indir` showed 1.4.6 and the correct APK link. New-account interaction was verified through owned local fixtures, not a new live customer registration.
- Owned fixture servers and the emulator were stopped after verification. Only the freshly created welcome QA AVD was removed; the original AVD was retained.

Final evidence is `production-proof-final.json` (SHA256 `65b3f64498372992597484cd3ded5798ed909ddffbdc0f3590aebc7b6a89f612`), `public-proof-final.json` and `production-browser-proof-final.json` in the artifact directory. Production screenshots are `production-old-single.png`, `production-old-dual.png` and `production-download.png`.

No real card payment or live provider fulfillment/playback was tested. No physical-TV, private-file preservation or decrypted-session claim is made. The final focused 57-test run does not imply an all-229-test full-suite pass. New APK Play Protect classification was neither changed nor asserted.
