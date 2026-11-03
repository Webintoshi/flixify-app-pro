# Android TV First Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Remove the measured5–10second nonessential waits from cachedTV navigation and first content delivery.
**Architecture:** Isolate cache-only delivery from serialized authenticated network work; publish verified data before bounded persistence. Keep current theme and authority checks.
**Tech Stack:** Existing Java/Android23+, executors, current binary disk caches, Gradle instrumentation.
**Spec:** docs/superpowers/specs/2026-11-03-tv-first-content-design.md

## Global Constraints

- Preserve one API/token-rotation lane, deferred callbacks,60s bootstrap freshness and all auth/source/expiry/policy guards.
- Preserve cache atomicity, integrity, budgets, revocation and bounded worker/queue behavior; no credentials persisted.
- Root owns builds/devices/version/signing/Git/release; existing clean dedicated checkout reused; sources/ remains read-only.
- No provider playback, real checkout, production API/worker/DB/env changes or new infrastructure needed without measured cause.
- Version1.4.11/code19 only after acceptance; min23/target35 and original single certificate.

## Review Focus

1. Cached result prepared before logout/source/policy/expiry change must be rejected at delivery.
2. Fast-lane miss/freshness expiry must fall back to serialized authority work, never rotate tokens concurrently.
3. Slow persistence/clear/close races must not publish stale bytes or block unrelated reads.
4. Optional refresh/trim/playback pauses must retain foreground demand/coalescing and bounded memory.
5. Cached account paint must keep renewal/welcome/denial states and focus correct.

### Task 1: Repository first delivery and metadata persistence
**Files:** NetworkTvRepository.java, MetadataDiskCache.java; new CatalogFirstContentLatencyTest.java; targeted repository/cache tests.
**Interfaces:** Existing TvRepository callbacks/observers unchanged; new bounded cache-only and persistence workers private.
- [x] Root reproduced the two new real-repository500ms REDs at6050/6870ms; logs/XML saved outsideGit.
- [x] Isolate valid in-memory catalog/favorite delivery from unrelated auth work using existing complete guards. Fall back on miss without API work in cache lane.
- [x] Remove personal-library network/disk dependency before catalog fetch; independently restore/refresh refs.
- [x] Deliver first verified result before bounded optional persistence; make unrelated metadata entry I/O independent while retaining clear/commit integrity.
- [x] Root run new REDs, full Network instrumentation and unit regressions; add slow-disk/large-real-cache measurements.
- [x] Independent review and root fixes/acceptance before commit.

### Task 2: Artwork first bitmap
**Files:** ArtworkLoader.java, ArtworkDiskCache.java; new ArtworkFirstBitmapLatencyTest.java and relevant tests.
**Interfaces:** Existing load/unbind/retire/clear/close API unchanged.
- [x] Add controlled slow-write test with500ms bitmap-delivery budget and generation/unbind guards; root observe RED before production edit.
- [x] Publish decoded valid bitmap before durable write; bound/defer writes and prevent unrelated reads waiting behind fsync. Preserve clear/close/budget/integrity rules.
- [x] Root verify targeted artwork lifecycle/cache tests, memory/trim and new timing gate.
- [x] Independent review and root acceptance.

### Task 3: Account first paint and whole application acceptance
**Files:** MainActivity.java and a new account first-paint instrumentation test; root build.gradle/publication files later.
**Interfaces:** Existing verifiedAccount/verifiedOwner, forced refresh callback and renderAccount methods.
- [x] Add delayed-authority test: same-account snapshot immediately painted; eventual denial/source/account change still handled; root observe RED.
- [x] Paint owned cached snapshot while retaining current background forced check and focus behavior.
- [x] Root measure real disk-cache29k first-result/first-surface, warm navigation and repeated trim; preserve complete archive/search and screen freshness.
- [x] Run full unit/instrumentation suite, lint and release build; report every failure accurately, fix relevant regressions and independent whole-diff review.
- [ ] Freeze accepted native revision, verify original signing continuity, publish1.4.11 metadata/APK separately; guarded existing-site publication and canonical website/updater verification if access permits. Publication execution is recorded outside this frozen plan in the SDD ledger.

### Task 4: Large catalog presentation hot paths
**Evidence:** Full on-device diagnostic with12k LIVE/12k MOVIE/5k SERIES found warm natural LIVE sorting10566ms and movie showcase preparation1466ms. Production runs preparation off the UI thread, but the work can still delay first content.
**Files:** LiveChannelLineup.java, CatalogShowcase.java and focused equivalent-order/performance tests.
**Interfaces:** Existing output order, friendly categories, source identity, stable ties, daily rails and fallback rules unchanged.
- [x] Preserve original comparator as a test reference and compare Unicode/numeric/mixed/stable cases before using precomputed per-sort keys.
- [x] Add a realistic on-device direct preparation budget and observe RED before optimization.
- [x] Remove repeated per-comparison collation and per-item repeated category classification without global unbounded caches.
- [x] Root verify focused RED/GREEN, current ordering/showcase tests and final unfiltered suite; independent review before native freeze.

### Task 5: Persist ready LIVE presentation for verified raw snapshots
**Measured need:** Actual complete12k raw LIVE projection still costs4778ms after Task4 (previously9703ms). Raw disk read is269ms; persisting the prepared representation removes that repeated CPU work on process restart.
**Files:** MetadataDiskCache.java, NetworkTvRepository.java, LiveChannelCuration.java, narrow LiveChannelLineup.java snapshot/prime helpers; targeted unit tests and new real-repository restart/first-surface instrumentation.
**Design:** .superpowers/sdd/2026-11-03-tv-first-content/ready-live-cache-design.md is supporting scratch. Binding requirements are here and in the spec.
- [x] Root reproduce a1000ms first complete LIVE callback RED after real repository/strict fakeHTTPS seed, actual disk persistence, close/reopen and verified bootstrap;12kraw/11997selected plus exact aliases, no provider catalog fetch after reopen. Existing500ms warm gates unchanged.
- [x] Bind ready records to version, raw format and VERIFIED payload SHA, raw savedAt/effective expiry, scope and complete policy identity. Same-clock changed content must miss. Obtain digest only from validated read or successful atomic raw commit for the exact object/ticket; never attach a header digest to an arbitrary memory object.
- [x] Raw encoder confirms exact roundtrip compatibility before network-origin projections may seed; otherwise only verified disk-origin raw can seed. Preserve raw bytes, display/URI sanitation and legacy stale behavior.
- [x] Store exact selected order/display names, complete alias map and versioned immutable lineup presentation fields. Restore metadata from exact raw originals and prime existing weak Info cache before publication. Validate all IDs/aliases/counts/policy/exclusions/UTF8/finite bounds; reject entire malformed record and fall back.
- [x] Restore on existing disk path before favorites rebuild; memory-delivery lane remains memory-only. Preserve single authority lane/coalescing,60s bootstrap and all deferred auth/source/policy/expiry checks.
- [x] Queue ready writes on existing bounded optional persistence worker after raw writes; capture exact raw identity, auth/source/policy/ticket/memory epoch and strict optional playback permission. Missing/dropped/canceled receipt means skip. Preserve existing shared cache budget/entry/free-space/checksum/atomicity/clear guards.
- [x] Root run codec/equivalence/expiry/source/policy/same-clock refresh/corruption/queued-write tests and real first callback plus first visible surface timing, then final full suite/review. No backend/API/DB/infrastructure/UI/player changes.

## Native acceptance evidence

Root final unfiltered run completed successfully:198 unit tests and292 instrumentation tests, no failures/errors/skips; lintRelease and assembleRelease passed. All154 frozen native input hashes matched after the run. The12k verified LIVE restart measured307ms callback and332ms including complete category/presentation preparation; these are not pixel timings. Independent static integration and harness reviews passed. The separate29k Activity fixture observed ready complete surfaces within369ms for the initial movies view,163ms for series and45ms for LIVE, with navigation heartbeat and memory/trim gates passing. All transport/assets were controlled offline fixtures; first install/new content/policy misses and physical-TV/provider latency remain separate practical limits. Signing and website publication follow this native freeze.
