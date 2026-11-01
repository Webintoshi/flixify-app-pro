# TV Cache Repair Implementation Plan

> **For agentic workers:** Execute scoped native/cache/artwork tasks in parallel, then independently review and verify the combined result before publication.

**Goal:** Fast cached catalogue/favorites and bounded background updates without a large APK or media downloads; remove demonstrated UI stall/allocation pressure paths.

**Architecture:** Existing per-source private snapshots and current access bootstrap remain authoritative. Stream catalogue parsing/cache I/O; precompute projections outside main callbacks; keep optional metadata/artwork work bounded and suspended during playback.

**Tech Stack:** Java17, Android API23+, Android JsonReader, existing private binary caches, Media3 and unchanged production services.

**Spec:** docs/superpowers/specs/2026-11-01-tv-cache-repair-design.md

## Global Constraints

- Same package vip.flixify.tv and existing signer; release1.4.5/code13, min23/target35.
- Preserve entitlement/expiry/source/policy checks, credential privacy, audience restrictions, UI colors and remote/player behavior.
- No video/full-artwork bundle, new server cache service, security changes or unrelated deployment.

## Review Focus

- Logout/source switch/expiry during background cache or projection cannot publish stale results.
- Slow remote library cannot block already usable cached catalogue/favorites.
- Large provider arrays/unknown fields/corrupt cache cannot grow full duplicate JSON trees or crash UI.
- Retired artwork and low storage/memory cannot block main or starve visible cards.
- Upgrade preserves signer/session/cache and current website/billing code.

## Tasks

- [x] Repository/cache: failing regressions for cold disk restore with held library, main-thread projection, stale policy race and no full catalogue re-download on playback; implement library snapshot, streamed cache I/O and idle prepareOfflineData; run focused Android/JVM tests.
- [x] Parser: same DTO/filter semantics with row-streaming, malformed/deep/trailing/big fields and cancellation tests; integrate through the existing secured request seam.
- [x] Artwork/UI: disk work off UI, queue retirement/low-memory bounds, prefetch/prepare hooks and unchanged remote focus; run lifecycle/artwork tests.
- [x] Combined review: full native unit and connected suite, lintRelease, bounded heap/large catalogue cold/warm QA and same-signer upgrade/cold launch evidence.
- [ ] Publish: freeze native source/APK proof; update immutable APK/update descriptor only; guarded web candidate over current6f0; confirm download manifest/hash/range and protected production state, report actual remaining limitations.

Memory-pressure follow-up: actual TV-launcher exits clarified by the owner; added RAM-only eviction/optional-work pause and preserved pending-live callback dependencies. Verified49 repository and14 startup/lifecycle device cases. Original full203-device suite passed; physical user crash stack remains unavailable. Public release upgrade QA uses the explicit non-root package-identity mode on the production Android TV image; private-file hashes/decrypted real login are not claimed.
