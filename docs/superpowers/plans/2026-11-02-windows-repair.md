# Windows Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct desktop installation, remove VLC-induced interface stalls and match the accepted Mac player in a verified Windows 1.0.1 installer.

**Architecture:** Retain the native client and use one serialized VLC worker with generation-guarded GUI snapshots. Keep installer, playback and QML ownership separate until integration; verify the combined artifact on Windows before website publication.

**Tech Stack:** C++20, Qt 6.11.3, libVLC 3.0.24, NSIS 3.11, Windows 10 1809+/11 x64.

**Spec:** `docs/superpowers/specs/2026-11-02-windows-repair-design.md`

## Global Constraints

- Preserve original branding and the native Mac reference; retain the two-second idle behavior and physical click routing.
- Use synthetic media only. Do not change provider, API, worker, database, Mac or Android source.
- Keep previous download bytes and filenames intact. New distribution remains unsigned TEST.
- Reuse the active task checkout and branch. Root owns commits, versioning, CI and guarded publication.

## Review Focus

- A canceled initialization must not attach a stale player or publish a late snapshot.
- Surface destruction must wait for native teardown without a dangling HWND access.
- Repeated polling/control intents must not build an unbounded worker queue.
- A redirected desktop or unrelated same-name shortcut must be handled safely.
- Focused sliders/popovers, native double-clicks and normal application closure must retain their behavior.

### Task 1: Installed shortcuts

**Files:** `apps/windows-native/installer/Flixify.nsi`, `scripts/verify_install.ps1`, `scripts/package_policy.py`, `scripts/package_windows.py`, packaging tests.

- [ ] Pin missing/wrong desktop shortcut and forced-cleanup failures with offline contract tests.
- [ ] Add default current-user desktop link with correct executable, working directory and icon; preserve foreign links.
- [ ] Verify actual shortcut launch, upgrade repair and owned-only uninstall in Windows CI.

### Task 2: Responsive playback

**Files:** `apps/windows-native/src/player.{h,cpp}`, `tests/player_test.cpp`, fake VLC support and CMake registration.

**Interfaces:** `rate`/`setRate(double)` and `aspect`/`setAspect(QString)` expose the exact settings from the spec to QML.

- [ ] Reproduce a stalled GUI heartbeat with deliberately blocked VLC calls.
- [ ] Move VLC operations to a serialized worker; coalesce polling, guard snapshots and cancel stale sessions.
- [ ] Verify open, poll, controls, late events, replacement, rate/aspect and surface teardown with focused tests.

### Task 3: Mac player parity

**Files:** `apps/windows-native/qml/PlayerWindow.qml`, dedicated player icon/button/slider components and `tests/ui_smoke.cpp`.

- [ ] Match the Mac reference layout, icon controls, white sliders and tool order, including settings and live guide.
- [ ] Add meaningful fixture-driven geometry, control-presence, focus, settings and idle checks.
- [ ] Inspect the finished rendered player after implementation; retain physical pointer, seek and close tests.

### Task 4: Integration and publication

- [ ] Independently review the combined source and run the local suites.
- [ ] Set version 1.0.1, compile and verify on actual Windows; inspect installer/privacy/native UI proof.
- [ ] Publish only the accepted EXE through a new guarded website profile; retain Mac/Android/old Windows hashes.
- [ ] Verify the live button's exact download and record receipts, screenshot and trust limitations.
