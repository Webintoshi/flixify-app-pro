# Apple TV Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Replace the rejected text tiles with an Apple TV reference native UI and publish a compatible APK.
**Architecture:** Keep PlayerActivity playback logic; introduce a focused icon view and native chrome layout. Independent browse refinement remains in MainActivity/TvUi.
**Tech Stack:** Java native Android Views, existing Media3, minSdk23.
**Spec:** docs/superpowers/specs/2026-10-28-tv-apple-player-design.md

## Global Constraints
- Preserve exact palette, package/signature, access policies and provider-free test fixtures.
- No new dependency or API/worker/DB change.
- 2000 ms chrome hide, actual ENDED five-second continuation and cancellation preserved.

## Review Focus
- 560x320 initial layout and long titles must fit.
- Hidden next/live timeline must leave valid remote targets.
- Panel Back must restore originating icon focus.
- Focus paints must not move surrounding geometry.
- Countdown must remain reachable and immune to hide timer.

### Task 1: Native player chrome
- [x] Add failing PlayerRemoteTest compact icon geometry and hidden-center toggle assertions; run and confirm behavioral failures.
- [x] Implement PlayerIconButton.java, PlayerActivity bottom title/utility/timeline/transport layout, transient caption and explicit graph. Preserve tags.
- [x] Replace track alert with compact right native options panel; keep actual engine track selection and return focus.
- [x] Update traversal tests and run PlayerRemoteTest.

### Task 2: Browse presentation
- [x] Independently refine MainActivity.java/TvUi.java artwork, rail and hero without changing responsive mechanisms.
- [x] Run ResponsiveUiTest/MainRemoteTest and inspect actual captures.

### Task 3: Verification and delivery
- [x] Run full instrumentation/unit/lint; fresh independent source review and repairs.
- [x] Capture actual native screenshots at three sizes using official local sample; inspect player/countdown/panel/browse.
- [ ] Freeze source, bump code3/version1.2.0-test.1, sign and verify certificate/hash/contents/install compatibility.
- [ ] Update APK descriptor and publish existing download route with guarded web-only deployment; verify public APK hash/range/links.
