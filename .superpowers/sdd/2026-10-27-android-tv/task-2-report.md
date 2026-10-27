# Task 2 — native TV remote UI

## Implemented scope

- Native 16-character login with validation, password-style TV IME entry, progress/error recovery and remembered repository session. The UI does not store the account code.
- Home, live, films, series, favorites and account rail entries with selected state and visible focus. Native search and category dialogs filter the recycled poster grid.
- Movie/live details, play launch carrying only the scoped serializable `Item`, personal favorite toggles, live programme information, season selection and episode choice.
- Account/package/expiry/status and confirmed local logout, including during loading and account outages. Back restores the previous poster, removes filters, moves to the rail and returns home before exit confirmation. Page/filter/poster/season state survives Activity recreation.
- Screen generations, account/source checks and stopped/destroyed guards discard late callbacks. Resume refresh invalidates changed source/catalog/detail state and handles revoked access. Initial remembered-session bootstrap accepts legitimate success/errors after an empty scope becomes verified; repository auth/source generation checks still reject stale work.
- Lazy HTTPS artwork uses two workers, a 32-entry pending queue, an 8 MiB cache, a 2 MiB response cap, sampled decode, no redirects and recycling tickets.

## Test-first evidence and verification

Eight offline Android instrumentation cases were written before the initial UI implementation. The parent's initial `javac` red check observed missing `MainActivity`, with AndroidX classes also unavailable outside Gradle: this was compile-red only. The cold-start and two outage regressions were subsequently written before their corresponding fixes and observed failing on the expected missing content/actions.

The first connected API 36 Android TV run completed 22 tests with four failures: login focus and native search from this task, plus player `nextEpisodeAndTrackDialogsAreRemoteReachable` and `onlyNearEndEpisodePlaybackIsMarkedWatched`. An initial IME retry still failed. Login/search then gained explicit field-to-submit movement, and tests began waiting for actual `TYPE_INPUT_METHOD` window visibility and asserting native dialog text entry. Remote OK opens the keyboard, Back dismisses it, and DOWN/OK submits; character text is injected at the native editable boundary. The corrected login/search tests passed. The cold-start success regression was observed red and fixed. The first integrated green result was 31 connected tests, including all nine UI cases; the parent also verified unit tests, lint and release build.

Independent review identified two uncovered outage branches. An exact two-method run observed both red: first-bootstrap NETWORK error was discarded, and logout was absent during held account loading. Ordinary errors now use the legitimate initial-scope guard, with STALE excluded and AUTH kept separate. Local logout now exists before account requests and remains beside retry on error.

The latest completed connected-result XML was inspected by this agent: **33 tests, zero failures, zero errors**, including all **eleven UI cases** and both outage regressions. The final XML timestamp is `2026-10-27T19:41:05`. Report: `apps/tv-android/app/build/reports/androidTests/connected/debug/index.html`. The fixture captures screenshots/window hierarchies before teardown for diagnostics. This agent ran source/whitespace checks, read parent-run results and did not run Gradle or download tooling.

## Files owned and limits

Owned files are `MainActivity.java`, `TvUi.java`, `ArtworkLoader.java`, `MainRemoteTest.java`, `FakeTvRepository.java` and this report. No data, playback, build, manifest, branding, web or deployment files were modified by this task.

No production account/provider/catalog/media access or physical TV/box testing was used. Artwork fixtures omit network images. The small fixture does not establish large grid/episode-list performance or physical Android 6 behavior. Playback/media/cutoff verification and final release lint/build verification belong to the parent/player tasks.
