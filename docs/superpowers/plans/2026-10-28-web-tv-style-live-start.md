# Web TV Style and Live Startup Implementation Plan

> **For agentic workers:** Use subagent-driven development for disjoint ownership, root browser QA and release. The user selected the existing Android TV design and requested implementation directly.

**Goal:** Remove avoidable live-start waits and adapt the current website to its approved native TV presentation.
**Architecture:** Existing Next.js/React app, unchanged personal-provider contract, targeted live lifecycle policy and scoped native-style presentation.
**Tech Stack:** Existing TypeScript, CSS modules, React19/Next15; no dependencies.
**Spec:** docs/superpowers/specs/2026-10-28-web-tv-style-live-start-design.md

## Global Constraints
- Preserve exact web colors, registration and all access/source protections.
- No provider streams or unrelated services during testing.
- Same site and branch; guarded web-only release, at least8GiB free before build.

## Review Focus
- First-start optimizations must never bypass fresh access checks or revive an old source.
- Initial media delay must not trigger premature reconnect; actual established stalls still recover.
- Modal cancellation, focus trap/return, scroll ownership and route/session transitions.
- Rail width must not squeeze the working live layout or cause mobile overflow/notch clipping.
- Exact runtime allowlist and unchanged protected service images after publication.

### Task1: Live startup
- [x] Observe RED regression for forced catalog refresh and duplicate first playback; implement source-scoped reuse and first-start reuse with reconnect refresh retained.
- [x] Observe RED initial-frame grace/recovery cases; implement and verify native-style timing and native-HLS selection order.
- [x] Run personal-provider, session, direct-playback, live policy/stall and player regression tests with deterministic local evidence.

### Task2: Website presentation
- [x] Shell agent: platform/shell.tsx and platform/platform.module.css, preserve behavior/classes; desktop rail, hero/cards/detail and quiet glass tools.
- [x] Catalog agent: catalog.tsx, categories.tsx/CSS and isolated panel helpers/tests; real search/category workflows and accessibility.
- [x] Root: live/account/landing module geometry; preserve existing tokens and live layout.
- [x] Run actual local browser UI at desktop/tablet/mobile against an offline fixture API; inspect accepted native screenshots beside current renders and fix mismatches.

### Task3: Acceptance and delivery
- [x] Independent review, focused automated suites, TypeScript and freeze source.
- [x] Guarded network-none bounded web build from exact current image with exact changed-file allowlist; no API/worker/DB mutation. Published in combined artifact4d7cb29401974bb11fc8946239f8529ba18abdc3.
- [x] Public pages/assets and actual browser design verification, protected-service post-read, save screenshots and final evidence; remove local QA source/routes and stop own processes. Full combined report2026-10-29-tv-direct-play-verification.md.
