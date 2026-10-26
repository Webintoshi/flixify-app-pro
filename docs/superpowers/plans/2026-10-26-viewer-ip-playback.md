# Viewer IP Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

**Goal:** Deliver personal media from the viewer's IP while preserving the three-hour access deadline.

**Architecture:** Load verified trial identity/expiry into internal user context. Return personal HTTPS direct records before server probes. Browser media stops at direct expiresAt and retries only the client path.

**Tech Stack:** Existing TypeScript/Fastify/Postgres/Next.js/native video/HLS.js; no added dependencies.

**Spec:** ../specs/2026-10-26-viewer-ip-playback-design.md

## Global Constraints

- Personal credentials only; shared reference lines never enter direct responses.
- No trial provider expiry later than the app deadline; no app access extension.
- Preserve live adult/catalog code during overlay deployment.
- API and web only; no suspended host, retired proxy, backup or external message.

## Review Focus

- Mismatched/stale provisioning identity cannot authorize a trial URL.
- Provider expiry one millisecond after app expiry must fail closed.
- A background tab or failed account refresh cannot leave app playback running after expiry.
- Direct retry cannot silently switch to the blocked relay.
- MKV extension support does not establish Safari/codec compatibility.

### Task 1: Verified direct access

**Files:** apps/api/src/repository.ts; new client-playback-access.ts and tests.

**Interface:** UserContext.trialProviderExpiresAt?:string|null; canUseClientIpPlayback(context,now?):boolean. Repository derives expiry only from completed job with verified line ID and matching current personal credentials.

- [ ] Write failing identity and expiry boundary tests, run them red.
- [ ] Add minimal metadata loading and pure eligibility helpers; run tests green.

### Task 2: Client deadline and retry

**Files:** apps/ops-web/app/platform/detail.tsx; app/canli-tv/page.tsx; new platform/direct-playback-deadline.ts and tests.

**Interface:** Direct Playback.expiresAt is an absolute access deadline; a disposable watcher stops once at deadline and rechecks on visibility/focus.

- [ ] Test deadline, delayed timer, disposal and repeated events; run red then implement.
- [ ] Stop/destroy media and pending reconnects on expiry. Direct VOD failures show a client retry and never issue direct=0.
- [ ] Verify rendered controls and console using CUA in the viewer's local browser.

### Task 3: Personal direct VOD/live responses

**Files:** apps/api/src/server.ts and route regression tests; candidate route tests.

- [ ] Write tests for exact-bound trial and paid personal direct records, MKV, shared/missing line, overlong expiry, unsupported transport and expired access; assert no blocked server probe.
- [ ] Use Task1 eligibility before VOD/live server preparation; include expiresAt and retain HTTPS/personal line checks.
- [ ] Run focused API/web tests and builds; independently review changes.

### Task 4: Viewer and production verification

**Files:** guarded coolify/releases/2026-10-26-viewer-ip scripts and documentation.

- [ ] Test canonical MP4/MKV via temporary local native video harness; suppress all credential-bearing URLs and stop after bounded progress/seek.
- [ ] Pin current production image/source hashes; apply only reviewed diffs to preserve live-only catalog policies.
- [ ] Build and test candidates, dry run, synchronize metadata, recreate API/web with health rollback.
- [ ] Verify target preflight, site/API health and real playback when an eligible viewer account exists; report remaining Safari/provider limits accurately.
