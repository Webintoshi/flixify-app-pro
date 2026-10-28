# Android TV direct playback implementation plan

> **For agentic workers:** Use subagent-driven-development or executing-plans for each independently testable task.

**Goal:** Horizontal live logos, one-click playback and player favorites in the existing APK.

**Architecture:** Existing MainActivity grid launches the player directly; repository selects a scoped episode and PlayerActivity owns favorite/episode tools.

**Tech stack:** Java, Android API23+, Media3, RecyclerView, existing scoped repository.

**Spec:** ../specs/2026-10-29-tv-direct-play-design.md

## Global constraints

- Retain package/signing key, palette, poster sound, access/expiry and provider routing.
- APK1.3.1-test.1/code6; old downloads retained.
- No provider playback test or API/worker/DB restart.
- Existing pending web source may publish in same guarded image;8GiB disk floor remains.

## Review focus

- Mixed Favorites must contain landscape logos and portrait posters without focus loss.
- Removed or stale resume episode must fall back inside the current canonical series.
- Repeated OK/late callbacks cannot open a second connection or cross source boundaries.
- Returning from player must reload changed Favorites and preserve nearby focus.
- Short screens/large fonts must keep heart and episode controls reachable.

### Task1: Direct selection and live cards

Files: MainActivity.java, TvLayout.java, MainRemoteTest.java, ResponsiveUiTest.java, PosterSoundRemoteTest.java, shared FakeTvRepository.java.

- [x] Observe RED for channel/movie/series direct Player Intent and actual landscape logo dimensions/FIT_CENTER.
- [x] Route selections directly, remove obsolete detail screens, reload Favorites on return; render live-specific spans/cards.
- [x] Verify remote Back/focus/resize and no duplicate poster cue.

### Task2: Series resolution and player tools

Files: TvRepository.java, data/NetworkTvRepository.java, PlayerActivity.java, PlayerIconButton.java and focused repository/player tests.

- [x] Observe RED for latest-resume/first-unwatched/final replay/stale resolution and player favorite action.
- [x] Implement startingEpisode(Item, Callback<Item>); accept SERIES as initial player resolution only.
- [x] Add heart and episode panel with owner guards, keep auto-hide and next-episode behavior.
- [x] Run complete Android unit/instrumentation suite and lint; inspect actual screenshots. See verification for broad-run failures and targeted green repairs.

### Task3: Compatible artifact and existing website delivery

Files: app/build.gradle, README.md, web tv-download.ts, exact new public APK, narrowly scoped release wrappers and verification document.

- [ ] Freeze tested native source, build/sign and verify compatible install over existing release.
- [ ] Pin digest/bytes; test bounded web build/release gates including preserved old public tree.
- [ ] Resolve disk capacity using evidenced safe scoped artifacts only, guarded build then web-only recreate.
- [ ] Independently verify public download bytes and unchanged protected services, save proof and final evidence.
