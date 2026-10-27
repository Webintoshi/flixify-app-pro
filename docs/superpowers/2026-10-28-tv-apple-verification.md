# Native TV Apple reference update — 28 October 2026

## Scope and reference
The user explicitly rejected the player text tiles and requested web research and a close Apple TV UI adaptation. Continue existing feature checkout; user already delegated design, app implementation and publication through the existing website. No new site, provider test or infrastructure maintenance is in scope.

Apple's official tvOS26 player MP4 was downloaded to temporary reference storage and frames4/6/8 visually inspected. Source: https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/ . Explicit26 guide: https://support.apple.com/en-euro/guide/tv/atvb7944597f/26/tvos/26 . Current tvOS27 software note was also checked: https://support.apple.com/en-ie/106336 . Android remote controls: https://developer.android.com/training/tv/playback/controls .

This implements Apple's content-first spatial layout with native Android gradients; it does not claim Apple's proprietary dynamic Liquid Glass renderer or ship Apple artwork/logos/fonts. Flixify's five palette constants remain exact.

## Implementation
- Episode/title left, compact circular subtitle/audio/successor tools right; thin real SeekBar and elapsed/remaining labels; small lower transport capsule. Stable fixed44dp targets and density-aware24dp glyphs. No weighted permanent player text tiles.
- Native translucent right track panel, persistent checked track, accessible Turkish descriptions and originating-icon focus return.
- Hidden center toggles play/pause immediately; up/down reveal; directional/media keys, two-second playing autohide, pause/options/countdown exceptions retained. ENDED VOD play replays explicitly and cancels pending continuation; live never seeks.
- Separate compact right successor card. Actual ENDED five-second trigger and policy/cancellation preserved.
- Browse artwork/hero/rail refined while retaining existing virtualized/adaptive/focus/cache/data behavior.
- No engine/network/cache/admission/provider/backend changes. Same package vip.flixify.tv, min23, version1.2.0-test.1/code3.

## Review and testing
Initial RED: compact chrome and one-press hidden-center tests failed for their expected old behavior. First redesigned PlayerRemote suite27/27 passed. Fresh source review found API29 maxHeight incompatibility, missing selected-track marker and live10-second glyph mismatch; all repaired and re-reviewed. maxHeight now XML style supported by API23.

Actual native gallery passed at1920x1080/density320/font1.0,1280x720/density320/font1.3 and3840x2160/density480/font1.0. Nine fresh images per size include player, track panel, actual-file-end continuation and browse/details. Fixtures use fictional metadata and site's public marketing images; Media3 plays only official Google local sample. All screenshots inspected; temporary gallery source removed from appsrc. A gallery options-dismiss timing issue was fixed by waiting for actual Activity window focus before sending the media key.

One interrupted development test command left underlying test runner cleanup active; test-only packages were force-stopped before a fresh run. The next suite exposed a pre-existing test synchronization gap after IME Back: final OK reopened the editor instead of submitting search. Saved logcat confirmed IME hidden then fresh SHOW_SOFT_INPUT. Test now observes the dialog editor and actual Ara focus after keyboard closure, then asserts the query result marker; no search production behavior was changed.

Offline release tool tests:118/118, including32 for the new pinned wrapper. An initial unittest discover invocation found0 because filenames contain hyphens; direct executions ran the actual cases.

Final full native/unit/lint, signing, install and production acceptance are recorded below once verified.

## Publication constraints
New immutable APK path apps/ops-web/public/downloads/flixify-tv-1.2.0-test.1.apk; existing APK files retained. Descriptor only runtime web change. Guarded web build base5d6d8c04bed380976d9a4c3f8ca0419fe9953c1e; runningweb0798cdec, API8cdbf9, workerd5b9, DB721873. Read-only production precheck found allfour running/restart0, free8.46GiB. Guard requires8GiB before network-none1280MiB/1536MiB build. API/worker/DB must remain unchanged; no unrelated cleanup.

## Final native acceptance
Fresh full acceptance completed successfully in3m51s:70/70instrumentation and21/21unit,0failures/errors/skips. Release lint0errors/27warnings (programmatic constructor, localization/RTL and pre-existing style items; no NewApi error). All six added player cases cover compact fixed icon geometry, one-press hidden-center pause, full two-level Dpad traversal/live hidden timeline, selected track/Back focus, ENDED VOD replay and ENDED live no-seek.

Final runtime source gallery was rebuilt and recaptured at allthree sizes after review fixes:9screens each,27total. Actual END now shows Play and clears stale action caption. Native fixture sources were removed again before source freeze. Physical TV/provider testing remains the user's real-device check; no customer stream was used.
