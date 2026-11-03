# QR Device Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Ship phone-approved QR login across Android TV, web, macOS and Windows while keeping manual login and business rules.
**Architecture:** A first-party PostgreSQL-backed challenge grants one normal target session; phone approval and target private proof are separate. Clients share the v1 contract and retain their existing post-login/access paths.
**Tech Stack:** Fastify/TypeScript/PostgreSQL, Next/React, Android Java23+, SwiftUI/macOS13+, Qt/C++ Windows10+.
**Spec:** docs/superpowers/specs/2026-11-03-qr-device-login-design.md

## Global Constraints
- Keep manual16-character account-code login, registration,3h trials, welcome offers, packages and stream concurrency unchanged.
- First-party device linking inspired by RFC8628, not a claim of OAuth conformance. No passkey/Bluetooth implementation.
- Device secret32 random bytes, approval180s, delivery60s, initial poll2s, slowdown+5s; secret only target memory/verifier on server.
- New routes and JSON fields are the spec's Binding public API v1 verbatim. QR contains only first-party public verification URL.
- Preserve current style/colors and secure native storage. No QR/auth material in telemetry/logs or external image services.
- Root owns Git, SDK/device/build/signing/packaging/production. Offline fixtures only; no real checkout/provider playback/customer mutation/messages.
- Android1.4.13/code21 min23/target35 original signer; Mac1.0.2/build4 macOS13+ universal, Windows1.0.3 Windows10+ x64. Older installers retained.

## Review Focus
1. Private proof, public code and authenticated phone authority must never be interchangeable; body account IDs do not choose the approving account.
2. Lost delivery/ACK, refresh rotation and cancellation races must not mint extra sessions, store stale tokens or revoke an acknowledged working session.
3. Device-linked session provenance and master-code redaction survive refresh and all viewer exports; manual owner UX remains compatible.
4. PWA/Safari separation, signed-out continuation, account switching and wrong/expired QR must preserve an explicit matching-code decision.
5. No registration/trial/provider work during pairing; expired package users still reach renewal. Current consent/analytics filters and other projects remain protected.

### Task 1 — shared backend authority (root)
Files: create apps/api/src/device-login.ts, device-login-store.ts, device-login-routes.ts, matching tests, migration202611030001_device_login.sql; modify server.ts/repository.ts/session types/contracts where needed.
Interfaces: spec Binding public API v1; registerDeviceLoginRoutes(app,deps), transaction-aware session insertion; auth_method/family_id preserved by refresh, viewer code projection.
- [ ] Write failing deterministic service/HTTP and SQL integration tests with dummy accounts/time; observe RED.
- [ ] Implement indexed durable state, shared throttles, atomic issuance/envelope retry, ACK/activation/cancel and strict phone boundary.
- [ ] Add origin/family compatibility and master-code projections without changing manual login/register/package/trial handlers.
- [ ] Run API full appropriate suite/build and real local PostgreSQL transaction/race/rollback tests; independent scoped security review.

### Task 2 — web target and phone approval
Files: new apps/ops-web/app/platform/device-login.ts(x)/module.css and tests, app/cihaz/page.tsx, modify login.tsx/giris-yap/page.tsx and account entry only as needed; analytics-policy only deliberate sanitized additions.
Interfaces: exact spec endpoints; existing API_BASE_URL and saveSession; private proof must not enter URL/storage/analytics.
- [ ] Add RED tests for target polling/cancel/adoption and authenticated explicit phone confirmation/return path.
- [ ] Implement QR target shared by login surfaces plus manual fallback; phone approval and short-code account entry preserve pending request through reauth.
- [ ] Verify expiry, denial, wrong account, duplicate response, cancel/manual switch, network/store failure, no URL leakage, package/welcome flow; test/build and rendered browser QA.
- [ ] Scoped spec/quality review before acceptance.

### Task 3 — Android TV
Files: TvRepository/NetworkTvRepository models and narrow pairing controller, MainActivity login surface, new unit/instrumentation fixtures/tests. Root alone edits version/build config and runs SDK.
Interfaces: exact spec API; existing installTokens/account/welcome path; client controller owns private proof and attempt identity.
- [ ] Add RED pure/controller/real repository and remote UI tests; root runs SDK.
- [ ] Implement sharp PNG QR/countdown/renew/manual focus, bounded polling/backoff/pause/cancel and fenced token adoption/ACK.
- [ ] Verify blocked/expired/no-plan/current consent, manual login, cancellation races, retained content speed/full remote tests; root full unit/device/lint/release.
- [ ] Scoped review before freeze; preserve original signing.

### Task 4 — macOS and Windows clients
Files: Mac core Models/Repository/fixture + AppStore/AccessViews and tests; Windows Repository/AccessPage/Qt tests. Own distinct platform files only; root packaging version/release metadata.
Interfaces: exact spec API; existing secure stores/token parsing and post-login flows, private attempt state, first-party PNG decoding only.
- [ ] Add meaningful RED fixture/controller/HTTP tests before code; use saved existing test/tool patterns.
- [ ] Implement target QR/countdown/renew/manual switching on both platforms, pause/abort and fence immediately before secure save; bootstrap retry reuses adopted session.
- [ ] Verify keyboard/accessibility, error/expiry/retry/manual behavior; run allowed isolated tests/builds coordinated with root resource budget.
- [ ] Scoped review; root universal Mac and actual Windows CI build/package/smoke verification.

### Task 5 — integrated verification and existing-site publication (root)
Files: frozen release scripts/profile and immutable downloads/descriptors; exact source/artifact/runtime receipts outside Git.
- [ ] Independent whole-diff review across backend and all clients; one coordinated fix wave if needed, preserve failure evidence.
- [ ] Local end-to-end dummy-account phone/target flows plus all platform regression/QR decoding, privacy, business invariant tests pass. No real provider/customer/checkout.
- [ ] Freeze source; package/sign APK, universal DMG and Windows installer, verify stable identities/version/floors/retained assets.
- [ ] Inspect actual host/live overlays and disk; guarded schema/API/web release, protect worker/DB data/env/registration controls/other projects and rollback.
- [ ] Verify canonical backend+web QR flows with disposable controlled test identity only if safe approved isolation, public downloads/hash/range/update manifest and browser screenshots; report actual limits.
