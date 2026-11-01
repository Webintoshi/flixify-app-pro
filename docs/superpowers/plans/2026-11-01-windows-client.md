# Windows Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a real downloadable Windows application matching the current macOS feature contract.

**Architecture:** Dedicated Qt Quick desktop shell and current direct-provider repository, reusing the existing native VLC runtime. Keep legacy clients and live backend protected. Compile/package and run fixture smoke checks on Windows; use local Qt tooling for additional review where available.

**Tech Stack:** C++20, Qt6 Quick/Network/Concurrent/Test, stable libVLC3, Windows DPAPI, CMake/CTest, NSIS, GitHub Actions Windows runner.

**Spec:** `docs/superpowers/specs/2026-11-01-windows-client-design.md`

## Global Constraints

- Windows10 1809+/11 x64; default1280x800, minimum900x620.
- Exact Mac brand colors and original website logo/favicon; no UI redesign of other platforms.
- Current provider-session and personal-library APIs; no `/me/native` relay or plaintext stored tokens.
- Metadata/artwork only in caches; credentials ephemeral; expiry and stale-source checks fail closed.
- Controls hide2s; recovery max2; true-end next episode5s; watched final5% capped120s.
- No personal publisher identity, automatic unsigned install, security bypass or warning-free claim.

## Review Focus

- Source/account changes while a catalog, library write or playback refresh is in flight must not leak old results.
- Large catalogs, Turkish dotted/dotless I and repeated live variants must remain searchable and responsive.
- Decoder failure and live EOF must never mark a VOD watched or start another episode.
- Native child video and overlay controls must resize correctly under Windows scaling/fullscreen.
- Missing package dependencies, corrupt artifacts and untrusted update destinations must stop publication.

### Task1: Current repository and catalog policies

**Files:** `apps/windows-native/src/{catalog,session_store,repository}.{h,cpp}`, `tests/catalog_test.cpp`, `tests/repository_test.cpp`.

**Interfaces:** `DesktopRepository` exposes the QObject contract in `apps/windows-native/CONTRACT.md`; produces scoped item maps and `playbackReady(media)`; consumes only current Flixify/provider APIs.

- [ ] Write and observe failing behavioral tests for source isolation, normalization/deduplication, search, strict expiry, cache partitioning and current fixture HTTP requests.
- [ ] Implement bounded parsing/cache, Windows vault, current repository, discovery/library/progress/EPG and welcome handoff.
- [ ] Run Qt tests and verify malformed/stale/expired fixture inputs are rejected.

### Task2: Cinematic desktop shell

**Files:** `apps/windows-native/qml/*.qml`, `resources/` original brand assets.

**Interfaces:** Consumes `repository` and `player` QObject properties/methods from CONTRACT.md; emits normal UI actions through them. Uses virtualized Qt views and bounded visible slices.

- [ ] Implement login/startup, six-route sidebar, responsive discovery/search/categories, archive/favorites, series picker, account and existing welcome choice.
- [ ] Implement native-video overlay window with keyboard navigation, compact accessible controls and real loading/empty/retry states.
- [ ] Record fixture screenshots of home/live/search/series/account/player and test min-size/high-DPI layout.

### Task3: Native player and app integration

**Files:** `apps/windows-native/src/{player,native_surface}.{h,cpp}`, `src/main.cpp`, `tests/player_policy_test.cpp`, `tests/ui_smoke.cpp`.

**Interfaces:** Consumes `playbackReady(media)` and repository refresh/progress; exposes `DesktopPlayer` from CONTRACT.md. Reuses existing `libvlc_runtime` without changing the legacy app.

- [ ] Write failing tests for true-end/countdown/recovery/expiry and connection-release sequencing.
- [ ] Implement native session/controller, track/volume/timeline actions,2s hide and bounded recovery.
- [ ] Launch actual Windows UI using fixture repository HTTP/local media; capture rendered screenshots and assert end/recovery behavior separately.

### Task4: Windows package and CI

**Files:** `apps/windows-native/CMakeLists.txt`, `scripts/*`, `installer/*`, `.github/workflows/build-windows-native.yml`, README/licenses.

**Interfaces:** Builds production source plus independent test targets; outputs verified versioned x64 installer, portable package, hashes, dependency/privacy and UI proofs. No automatic public release.

- [ ] Add fail-closed dependency/source/installer verification tests.
- [ ] Pin official Qt/VLC/toolchain inputs and verified runtime digest; package compiler/Qt/VLC dependencies and licenses.
- [ ] Run Windows compile, CTest, rendered smoke/local-media check, installer creation and owned-content scan; download exact successful artifacts.

### Task5: Final review and download integration

**Files:** verification documentation and, only after artifact checks, narrowly scoped website Windows download descriptor/link/card and guarded web release profile.

- [ ] Independently inspect implementation, run relevant tests and check whole Windows artifact rather than relying on agent reports.
- [ ] Run AFTER design audit, record any findings for user selection; fix implementation/runtime failures within the authorized application work.
- [ ] Verify installer bytes and trust status, then publish an accurately labeled Windows download beside Mac/Android using the existing guarded website process.
- [ ] Verify live link, actual download/hash, mobile/desktop layout and unchanged Mac/APK/service state; report actual remaining limitations.
