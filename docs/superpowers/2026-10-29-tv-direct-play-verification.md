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

Compatible signed artifact and production publication are pending. No production completion is claimed by this intermediate record.
