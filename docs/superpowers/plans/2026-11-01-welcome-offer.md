# Welcome Offer Implementation Plan

> **For agentic workers:** Use subagent-driven-development for isolated backend, web and release tasks; root implements native and verifies integration.

**Goal:** Show the approved first-login choice only to newly registered accounts and fulfill their first monthly purchase at50%off.

**Architecture:** Persist campaign grants separately from existing trial provisioning. Bind server-approved offer net amounts to the existing Checkout reservation/fulfillment and expose one account-scoped contract to web/native clients.

**Tech Stack:** Existing Fastify/Postgres/Stripe one-time embedded Checkout, Next/React and Java AndroidTV.

**Spec:** docs/superpowers/specs/2026-11-01-welcome-offer-design.md

## Global Constraints

- Campaign welcome-monthly-50-v1; monthly single12500/dual19950kuruş. No global price or sale-catalog-version change.
- No old-account grants/backfill; free choice never restarts/provisions trial. No token-bearing payment URLs.
- Final approved silver-left/red-right/confetti composition; no automatic-renewal footer. Android1.4.6/code14, same signer/min23.
- Retain worker/current features, registration fence and environment; measured immutable current API/web sources are the build baseline.

## Review Focus

- Two simultaneous browsers/accounts cannot share, duplicate or reuse offer/Checkout reservations.
- Paid-but-unfulfilled, abandoned and uncertain sessions must preserve eligibility safely without duplicate provider writes.
- Automatic trial and paid activation interleavings must not create competing provider lines.
- Gate loading/errors/account switches/lifecycle cannot reveal stale account contents or disable existing-user players.
-199.50must display/charge199.50; old full-price pending/legacy/referral flows remain accepted.

## Tasks

- [x] Backend: new-release-only API source overlay, private additive schema and registration grant patch; authenticated status/choice; persisted offer quote/reservation and 50% coupon verification; exact net fulfillment and trial-settlement defer. Ownership/concurrency/amount/replay coverage passes 124 unit/HTTP tests and 24 actual isolated PostgreSQL checks. Real unpaid Stripe sessions verified 12500/19950 minor amounts and were expired without card/provider operations.
- [x] Web: identity-scoped gate before SiteShell children, responsive approved visual with current count metadata, one/two-user selector, persistent free choice and embedded Checkout. Current-user monthly pricing and fractional currency covered by regression tests. Local browser QA verified desktop and 320/390 px mobile, free-choice persistence, old-account bypass and unchanged regular pricing.
- [x] Native: account-scoped API/parser/cache contract and MainActivity pre-catalogue gate; separate focusable responsive WelcomeOfferScreen with silver/red styles, static confetti and explicit payment browser/phone fallback. Frozen revision 015c147/tree fb15086: 112 JVM tests, 57 final connected regressions, zero lint errors. Actual compact single/dual screenshots inspected; category/hidden-keyboard one-OK navigation regressions pass.
- [x] Release preparation: fresh current-source snapshots and explicit changed leaf manifests; additive migration and stable coupon preparation; protected API-only candidate, then web and same-signer APK 1.4.6 candidate. 15 guard contracts pass. Signed native freeze/artifact proof and exact 1.4.5→1.4.6 package-only upgrade verified; no unrelated services/pruning. API a052/241 is live; website 65a3 candidate is verified.
- [x] Final deployment/integration: API and website apply/recreate plus target preflight passed. Public HTTP/APK/update JSON hashes, retained 1.4.5 download, rendered 1.4.6 link, existing-account gate bypass/regular prices and protected production state verified. New-account interactions were verified with owned local fixtures; no live customer registration was needed. Final production/public/browser proofs are retained, and owned QA servers/emulator were cleaned up. No real-card/provider, physical-TV/private-session or full 229-test-suite claim.

**Evidence:** `docs/operations/welcome-offer-2026-11-01.md`; detailed private artifacts under `work/artifacts/welcome-offer-20261101/`.
