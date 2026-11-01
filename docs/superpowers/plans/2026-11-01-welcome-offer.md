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

- [ ] Backend: new-release-only API source overlay, private additive schema and registration grant patch; authenticated status/choice; persisted offer quote/reservation and50%coupon verification; exact net fulfillment and trial-settlement defer. Write failing ownership/concurrency/amount/replay tests, run them before/after, then actual PG migration/interleaving checks.
- [ ] Web: identity-scoped gate before SiteShell children, responsive approved visual with current count metadata, one/two-user selector, persistent free choice and embedded Checkout. Update current-user monthly pricing and fractional currency. Verify hidden-child, late-response, dismissal, availability, payment activation and old-player preservation tests; visually inspect desktop/mobile.
- [ ] Native: account-scoped API/parser/cache contract and MainActivity pre-catalogue gate; separate focusable responsive WelcomeOfferScreen with silver/red styles, static confetti, explicit payment browser/phone fallback. Unit/parser and actual Android lifecycle/remote/error/old-account regression tests.
- [ ] Release: fresh current-source snapshots and explicit changed leaf manifests; additive migration and stable coupon preparation; protected API-only candidate, then web+same-signerAPK1.4.6 candidate. Guard contracts and no unrelated services/pruning.
- [ ] Integration: independent review, focused plus appropriate full checks, signed native freeze/proof and actual1.4.5upgrade; deploy in sequence, verify old/new account behavior with owned fixtures, current public HTTP/UI/APK and protected production state. Report physical/payment QA limits accurately.
