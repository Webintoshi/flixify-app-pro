# Cross-platform Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track completed checks below.

**Goal:** Deliver consent-aware, privacy-safe GA4 reporting for web/PWA, Android TV, macOS and Windows, including verified revenue and playback quality.

**Architecture:** One property, native Google SDKs on supported platforms, explicit web instrumentation and authenticated Windows relay. Current Stripe overlay supplies authoritative payment events through an idempotent durable delivery path.

**Tech Stack:** Next 15/React 19, Fastify/Postgres, Java Android/Firebase, SwiftPM/Firebase Apple, C++20/Qt and GA4 Measurement Protocol.

**Spec:** `docs/superpowers/specs/2026-11-02-cross-platform-analytics-design.md`

## Global Constraints

- No PII, auth/provider/payment secrets or raw search/error/URL values in measurement.
- Consent disabled until explicit acceptance; full functionality remains available after rejection.
- No real customer/provider streams or charges for tests; use test sinks and synthetic fixtures.
- No personal Mac signing identity, security bypass or false trust/ingestion claim.
- Preserve billing rules, registration fence, retained downloads and unrelated services.

## Review Focus

- A late async callback must not emit after consent withdrawal or playback replacement.
- Failed first-frame attempts must never count as successful starts.
- Replayed payment callbacks must not duplicate revenue or entitlement changes.
- Rerenders, history updates and player polling must not duplicate/firehose events.
- Network/configuration failure must not stall UI or leak raw data in logs.

### Task 1: Google resources and contract

- [ ] Create dedicated account/property with correct timezone/currency and owner legal confirmation.
- [ ] Register/link supported native apps and Windows stream, keeping secrets private.
- [ ] Pin public configuration and report definitions; validate payloads with official schema.

### Task 2: Web/PWA

**Files:** `apps/ops-web/app/platform/analytics*`, layout, account settings, discovery/player/registration/package/download hooks.

- [ ] Write meaningful consent/leakage/deduplication/lifecycle tests and observe baseline failure.
- [ ] Implement a small explicit provider and typed safe event API; sanitize routes and parameters.
- [ ] Add reliable event hooks without changing existing business logic.
- [ ] Verify tests/typecheck/build and real rendered consent/navigation flow.

### Task 3: Backend relay and verified revenue

**Files:** new analytics modules/tests in current welcome-offer `api-source`, narrow route/checkout/fulfillment integration and additive migration.

- [ ] Define exact authenticated config/events/attribution interfaces for clients.
- [ ] Pin replay, unknown parameters, bounded limits and successful/mismatched payments with fixture tests.
- [ ] Add private configuration, asynchronous bounded transport and durable idempotent purchase delivery.
- [ ] Verify modified live-source compatibility and narrow deployment scope independently.

### Task 4: Native SDKs and Windows relay client

**Files:** Android TvApplication/MainActivity/PlayerActivity, Mac AppStore/PlaybackController/settings/package setup, Windows telemetry QObject/repository/player/account settings.

- [ ] Implement versioned editable consent and disabled SDK bootstrap/config validation.
- [ ] Wire the same safe event vocabulary to real navigation/discovery/playback/update lifecycle.
- [ ] Add nonblocking Windows queue/authenticated relay without client secrets.
- [ ] Verify privacy/lifecycle/queue tests and actual native builds/fixture interactions.

### Task 5: Publication and owner reports

- [ ] Independently review integration and accepted native artifacts.
- [ ] Publish compatible backend and web changes, then new app downloads/update metadata through guarded profiles.
- [ ] Verify exact live bytes, retained artifacts, API health and rendered UI.
- [ ] Confirm consented events in Google DebugView/Realtime and report filters/key events.
- [ ] Deliver report links, short usage guide, screenshots and explicit outstanding limitations.
