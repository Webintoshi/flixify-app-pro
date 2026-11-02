# Android TV renewal recovery implementation plan

> **For agentic workers:** Use subagent-driven development for the scoped Android, web handoff and release-profile tasks. Preserve disjoint ownership and review each result before publication.

**Goal:** An expired/no-plan TV user can select an existing package, open its website purchase control, and regain content only after authoritative activation.

**Architecture:** Extend the existing Android account/repository routing and add a provider-independent native package surface. Keep financial processing on the existing website. Publish only a signed Android update and the small web handoff change against the current immutable production web image.

**Tech stack:** Existing Java Android views/Media3, Gradle, repository fixture instrumentation; existing React/Next.js package UI; bounded Python/Docker release helpers.

**Spec:** `docs/superpowers/specs/2026-11-02-tv-renewal-recovery-design.md`

## Global constraints

- Reuse the current clean checkout. Preserve synced `sources/` and unrelated product behavior.
- User delegated direct implementation; no extra design or publication approval is required.
- APK 1.4.9/code17, minSdk23, existing signer, analytics configuration/consent intact.
- No backend/billing-rule changes, fake prices, new discounts, provider playback or real charges.
- Explicit user click for website handoff; plan validation and focus never initiate checkout.
- Root owns public installers, version/download metadata, Git and production operations.

## Review focus

- Generic provider 403 while a package is active must not be called expiry.
- Old-account and stale source callbacks must not restore previous access or package state.
- Welcome resolution/resume/navigation must not invalidate the authoritative refresh result.
- Package load failure and unavailable catalog entries must remain usable with a remote.
- Payment return must remain locked until a fresh verified account response allows viewing.

### Task 1: Android access routing and native packages

Owner: Android implementer. Files: `apps/tv-android/app/src/main/java/vip/flixify/tv/{MainActivity,TvModels,TvRepository}.java`, the existing data repository/parser area, focused package/access model and screen files, corresponding unit and instrumentation fixtures/tests. Root owns `app/build.gradle` version bump.

- [x] Write regression tests for initial expired/no-plan access, warm expiry and all-Home INELIGIBLE callbacks before changing production code. Observe the expected failure.
- [x] Preserve account authority/reasons and route inactive state before catalog requests. Fix resume generation/account staleness without remounting working playback on routine refresh.
- [x] Add bounded public package parsing/retrieval independent of provider bootstrap. Test malformed, inactive, missing, wrong-term and failed responses without invented prices.
- [x] Add remote-operable one/two-user and 1/6/12-month package cards, status/retry/account actions and compact sizing. Preserve focus across retry/resize.
- [x] Build canonical explicit handoff URLs with `users`, `plan`, `from=android_tv`; preserve separate welcome links and safe phone fallback.
- [x] Test intercepted Intent and activation return before/after authoritative access, blocked/provisioning/provider/network distinctions, late callbacks and unchanged active browsing.
- [x] Run unit suite, release lint/build and fixture-only Android UI tests. Save exact commands/results and screen evidence. No real provider or payment.

### Task 2: Web plan handoff focus

Owner: web implementer. Only `apps/ops-web/app/paketler/{page.tsx,packages-model.ts,packages-model.test.mts,packages-ui.test.tsx}` and `apps/ops-web/components/ui/pricing.tsx`.

- [x] Add failing tests for valid canonical plan/users selection and rejection of unknown, unavailable, duplicate or mismatched input.
- [x] Add a pure validated selection helper and `data-package-slug` on existing cards.
- [x] Focus/scroll the validated card's existing enabled purchase control once after loading; retain welcome landing behavior and subsequent manual choices.
- [x] Run targeted tests and typecheck. Do not invoke checkout or edit prices, financial handlers, layout or native files.

### Task 3: Guarded publication profile

Owner: release-profile implementer. New files only under `coolify/releases/2026-11-02-tv-renewal-recovery/`; never edit historical helpers.

- [x] Pin current 07fbf0b production web/API identities and protected worker/database/env/fence. Require fresh current-web untouched fingerprint.
- [x] Permit only one new immutable APK, manifest/descriptor changes and the three named web handoff runtime files; allow the accompanying model and UI tests as undeployed test source. Preserve every other public byte/mode/link and product source.
- [x] Fail closed until root accepts exact source/tree, APK hash/bytes/version/minSdk/same-signer proof and hashed fixture UI evidence.
- [x] Keep compiler network isolation, 1280/1536MiB memory, one CPU, 256 pids and 8GiB disk floor. Web-only transactional recreation must preserve API/worker/database/GA environment.
- [x] Run meaningful offline guard/regression tests, then freeze files for root review.

### Task 4: Root acceptance and delivery

- [x] Independently review Android, web and profile diffs; fix material findings with the owner. Verify active-account behavior, all inactive cases, DPAD and explicit purchase handoff from actual fixture UI.
- [x] Build optimized APK with existing signer; verify package/version/minSdk, release config, signature continuity, size/SHA and no debug-only injection surface.
- [ ] Copy the accepted immutable APK, update descriptor/manifest, commit/push exact source, fill acceptance pins outside Git.
- [ ] Obtain fresh live web measurement, build/verify bounded candidate and run web-only preflight/apply/recreate. Preserve rollback images and all other services.
- [ ] Verify actual public new APK full bytes/SHA/HEAD/range and retained installers, manifest and rendered website links; verify clean package-query focus with no checkout creation.
- [ ] Record Android UI and deployment receipts, remove only owned temporary test/cache material, and give the user the real update link and concise verification limits.
