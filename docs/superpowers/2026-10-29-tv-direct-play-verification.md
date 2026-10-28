# Android TV direct playback verification

## Scope

User-requested three corrections to the approved native theme: landscape live-logo cards, immediate playback from a channel/movie/series card, and favorite controls inside the player. Package, exact palette constants, poster sound asset, provider paths, access validation and decoder/buffer settings remain. No registration, API, worker, Telegram, DNS or cancelled proxy changes.

MainActivity no longer builds an intermediate detail/watch screen. LIVE cards have a16:9 FIT_CENTER logo area with padding; mixed Favorites allocate wider spans to live items. Movie/series posters retain their existing treatment. The player owns a heart action; EPISODE favorites resolve the parent SERIES through the existing authoritative repository. Returning to Favorites reloads it and restores the remaining card focus. A launch latch prevents two rapid selections from stacking players before lifecycle changes.

SERIES cards enter PlayerActivity immediately. `startingEpisode` validates the canonical current series and chooses the latest available scoped saved position, otherwise first unwatched, otherwise first episode for replay. Existing position timestamps and watched references are reused. The method does not issue media requests; the chosen episode still goes through existing fresh playback admission. The player includes a season/episode picker so removing the detail screen does not remove manual episode selection. Optional LIVE EPG moved from the removed detail screen into a player tool; metadata loads only when opened, off the playback startup path.

## Test-first evidence and review

- Six Main/card cases observed actual RED: all three kinds failed to launch PlayerActivity directly; live/mixed Favorite logo geometry failed; player-return favorite reload failed. Evidence `/tmp/flixify-tv-direct-main-red.log`.
- Seven player cases observed RED before heart/initial-series/picker implementation. Six then passed; the picker exposed a real compact-window sizing problem and a selected-row visibility investigation. Final results follow below.
- Six new episode-selection repository cases plus sixteen existing cases passed22/22. A seventh new case exposed an invalid kind/scope candidate joining a pending valid selection; the operation key now partitions by candidate kind, length-prefixed scope and id. Evidence `/tmp/flixify-tv-player-direct-green.log`, `/tmp/flixify-tv-series-network-green.xml`.
- Rapid double click observed RED with two activity launches; focused GREEN after latch and lifecycle/window ownership checks. Evidence `/tmp/flixify-tv-main-launch-{red,green}.log`.
- Actual measured560x320 player exposed an overflowing episode panel; sizing now uses the measured root bounds and reflows while open. Existing playback engine and access rules remain unchanged.
- Two EPG cases observed RED before the guide tool; optional metadata, empty/error states and stale owner callbacks subsequently passed focused GREEN.
- Independent read-only review covered scoped resume/favorite ownership, stop/recreate/recovery, release-before-replace, live card spans/focus, Favorites reload and old-detail removal. It identified the launch latch, compact picker and EPG retention issues above.

## Website and release guard checks

Pending reviewed website source `fddc6cc555c13077dba8ae1b8ca9ede563207fd7` is included in this branch. Its runtime changes are unchanged; only the central APK descriptor advances to1.3.1-test.1. Root reran all60 React UI/player/session/catalog cases successfully and TypeScript exited0. Logs `/tmp/flixify-tv-direct-web-{regressions,tsc}.log`.

The new combined wrapper pins the current production web image81cb964, baseline120b35f, exact16 website source files and one new immutable APK. Old public content, modes and symlink targets must remain identical. Native source is revision scope only, not copied into the web runtime. Gradle is constrained to version5to6/1.3.0to1.3.1 only. Release preserves actual cgroup limits, network isolation,8GiB pre-build floor and protected API/worker/DB pins. New guards38/38, all release tools265/265 passed; root independently reran the38new cases. Executable-mode APK acceptance was observed RED and corrected to require100644.

## Final acceptance

The broad native command ran102cases:100passed, including all41Player and23Network cases. Two failures identified the mixed-row GridLayoutManager height stretching and an early fixture mutation before Main reachedSTOPPED. Mixed live favorites now use a compact full-width row with16:9logo on the left; the fixture explicitly waits for actual lifecycle transitions before mutating Favorites.

The final affected40-case run passed39; its sole remaining PosterSound test incorrectly sent Back before the new PlayerActivity owned the window and required a replacement View identity after resize. The corrected test waits for PlayerRESUMED/MainSTOPPED, then MainRESUMED, and checks actual new viewport dimensions, fully visible same-poster focus and unchanged cue count. All5PosterSound cases subsequently passed. All other39affected cases passed, including the two LiveCards corrections and three new continuation cases: opening during a pending countdown cancels it, an actual end under manual episode selection keeps that panel stable, and browsing/closing before end retains normal automatic continuation. Evidence is across these runs, not a fabricated single all-green102-case command.

All31unit cases passed. Release lint:0errors/40warnings (metadata, native programmatic view/backup/icon attributes, Turkish hardcoded strings and absolute RTL gravity); no correctness error. XML snapshots/logs are under `/tmp/flixify-tv-direct-{full-first-results,final-first-results,poster-final-results,final-unit-results}` and `final-lint.xml`.

Actual native visual QA captured12screens:1920x1080/density320/font1.0 and1280x720/density320/font1.3. It caught the compact refresh label wrapping and background player text showing through new guide/episode panels. Refresh is single-line with sufficient width; the new panels composite the existing glass over an opaque existing PANEL color. Audio/subtitle panel is unchanged. All12postfixframes were recaptured and inspected; both gallery runs passed. Measured channel/favorite logo proportions, visible focused heart, program guide, season/episode panel and selected marker are evidenced under the task visualization directory `android-tv/direct/{normal,compact}`. Inputs are explicitly offline fixtures and existing public marketing artwork; no customer/provider stream was opened. Gallery source/assets remain ignored and added only to AndroidTest by an invocation-local init script, absent from production source sets. Display overrides reset to physical1920x1080/density320/font1.0.

## Compatible artifact

Frozen source `aad46a0153172b9de8f06f82899f94a42dfc5152`. Standard `scripts/build-test-apk.sh` (without the gallery init script) passed unit/lint/optimized assembly in1m44s. APK1,321,313bytes, SHA256`e0aa6c2687307af9b10442c56bbce235fbd74b3aea65807b7ae2c4c2e14023e9`; immutable file `apps/ops-web/public/downloads/flixify-tv-1.3.1-test.1.apk`, mode644.

`apksigner` verified v1/v2 and exact existing certificateSHA256`158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`. `aapt2` verified packagevip.flixify.tv, code6, version1.3.1-test.1, min23/target35, TV launcher/banner and not debuggable. No ABI libraries, fixture account identifiers, gallery classes/assets, sampleMP4 or debug repository/engine hooks in the optimized archive. Exact poster WAV hash `3e96335f0f9e74b2975b274306e0748a7d8314ee819667073086141e0c713bea` is present unchanged.

Verified emulator prior release1.3.0-test.1/code5; `adb install -r` succeeded without uninstall, now1.3.1-test.1/code6. Real signed cold launch succeeded1384ms; no AndroidRuntime fatal. Actual release login screenshot saved `android-tv/direct/signed-release-launch.png`. This does not measure real provider startup or every physical TV codec. APK proof `/tmp/flixify-tv-direct-apk-verification.json` and signing/launch logs.

## Publication capacity

Production remains on the known source image while publication is pending. Fresh disk free7.37GiB is below the unchanged8GiB build floor. Exact-ID attempts on two unused immutable dependency cache records returned0B; changing space thresholds did not change eligibility, and no image/volume was removed. One exact8KiB private mutable source cache record was reclaimed successfully; it did not release the two larger snapshots. All four Flixify container identities/images/restart counts stayed unchanged. Investigation of other package caches, old checkout and archived journal zero blocks was read-only; no log, journal, source or application data was deleted. Shared unused build-cache cleanup approval was requested because this host also serves other projects. Full website/APK publication is not claimed by this intermediate record.
