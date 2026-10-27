# Task 2 — native TV remote UI

## Implemented scope

- Native 16-character login with validation, password-style TV IME entry, progress/error recovery and remembered repository session; the UI does not store the account code.
- Home, live, films, series, favorites and account rail entries with selected state and explicit visible focus. Native search and category dialogs filter the recycled poster grid.
- Movie/live details, play launch carrying only the scoped serializable `Item`, personal favorite toggles, live programme information, season selection and episode choice.
- Account/package/expiry/status and confirmed logout. Back restores the previous poster, removes filters, moves to the rail and returns home before exit confirmation. Page/filter/poster/season state is restored across Activity recreation.
- Screen generations, account/source checks and stopped/destroyed guards discard late callbacks. Resume refresh handles changed sources and revoked access. All provider/session/playback work remains in the frozen repository contract.
- Lazy HTTPS artwork uses two workers, a 32-entry pending queue, an 8 MiB cache, a 2 MiB response cap, sampled decode, no redirects and recycling tickets. All limits are independent of the catalog size.

## Test-first evidence and verification

Nine Android instrumentation cases and a fully offline repository fixture were authored before implementation. They exercise invalid/valid login and recreation; rail and movie favorite/back; native search; category filtering; series season/episode/back; failed loading/retry and stale responses; live details/EPG; account/logout.

The parent ran an initial `javac` red check: missing `MainActivity` was observed, with AndroidX test classes also unavailable outside Gradle. This is compile-red evidence only; no claim is made that behavioral red was observed.

The parent subsequently reported successful `compileDebugJavaWithJavac`, `compileDebugAndroidTestJavaWithJavac` and `testDebugUnitTest` (35 tasks in that integrated run). The first connected Android TV API 36 run completed 22 tests: 18 passed and four failed. Six of this task's eight UI cases passed; login field-to-submit focus and TV-IME search submission failed. Two independent player cases also failed (`nextEpisodeAndTrackDialogsAreRemoteReachable`, `onlyNearEndEpisodePlaybackIsMarkedWatched`). Full report: `apps/tv-android/app/build/reports/androidTests/connected/debug/index.html`.

The UI failures exposed actual remote input handling: a native single-line edit field could retain DOWN, and Enter while the TV keyboard was visible could select a virtual key instead of submitting Search. Login/search now initially keep the IME hidden, expose explicit DOWN-to-submit movement, and retain native IME Go/Search support. The tests use a legitimate OK-to-open keyboard, Back-to-dismiss and DOWN/OK-to-submit flow. A second focused parent run verified that the corrected login and search tests passed after condition-based IME visibility polling and asserted native dialog text entry. Its newly added cold-start case failed on the expected missing poster: a remembered session begins with empty scope, and the repository establishes the verified source during catalog retrieval. The UI guard now allows that initial operation while requiring an active session/screen and the repository's frozen auth/source-generation checks. Already scoped stale detail/catalog state is cleared on resume/source change. Final green verification of the cold-start fix is pending the parent's next run. This agent did not run Gradle, download tooling or access production accounts/catalogs/media.

## Files owned

`MainActivity.java`, `TvUi.java`, `ArtworkLoader.java`, `MainRemoteTest.java`, `FakeTvRepository.java` and this report. No data, playback, build, manifest, branding, web or deployment files were modified by this task.

The initial retry did not fully resolve the IME cases: login focus remained in the field and search query was empty. Test diagnostics now wait for actual `TYPE_INPUT_METHOD` window visibility and save fixture-only screenshots/window hierarchies before teardown. Native dialog text injection uses its accessibility edit boundary; remote OK opens the keyboard, Back dismisses it, and DOWN/OK submits. This avoids treating TV keyboard Enter as an app Search action.

Lint initially found two `@UnstableApi` errors at the `PlayerActivity` reference; the player owner is applying the appropriate annotation opt-in. No API 23 lint error was reported to this task.

## Limits

Physical TV/box testing is not available. The artwork network path has no production-network test; navigation fixtures deliberately omit remote artwork. Playback controls and media/cutoff verification belong to the player task. Final connected test results must be recorded before declaring remote navigation verified.
