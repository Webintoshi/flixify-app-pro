# Provider Entitlement Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Sağlayıcıda yapılan ücretli paket/süre değişikliklerini uygulamaya ve açık kullanıcı ekranlarına otomatik yansıtmak.
**Architecture:** Salt okunur reseller istemcisi, worker'da kiralanmış kişisel hat eşitlemesi, mevcut API sözleşmelerinden yenilenen web erişim metadatası.
**Tech Stack:** Mevcut Node/TypeScript/pg/Vitest/React; eklemeli SQL; sabit imajlı Coolify dağıtımı.
**Spec:** `docs/superpowers/specs/2026-10-26-provider-entitlement-sync-design.md`

## Global Constraints

- Sağlayıcıda yalnız get_lines/get_line; satın alma, hat/süre/şifre değiştirme yok. Şifre/anahtar/ham hata loglanmaz.
- Kesin kişisel kimlik doğrulaması, kaynak sürümü/kiralama CAS, engelli/silinmiş/ortak/çift kimlik dışlama.
- Deneme uzatılmaz/sıfırlanmaz; gerçek sağlayıcı bitişi esas; geçmiş ve audit korunur.
- Yeni bağımlılık, API/Telegram/Edge/DNS/proxy değişikliği ve gerçek yayın testi yok.
- Worker kaynak7731936e27df/9b5d; web kaynak5340ff942194/9b9a; API8cdbf9/gerçekDB721873 sabit kalır.

## Review Focus

- Kiralama süresi dolan veya kimliği istek sırasında değişen eski iş erişim açamaz.
- Ağ hatası ile açık provider-disabled/expired ayrılır; yanlış iptal/uzatma olmaz.
- Ücretli→deneme ve yönetici iptali mevcut denemeyi/iptal edilmiş başka kaydı diriltmez.
- Aynı kaynakta süre değişimi çalışan video motorunu yeniden kurmaz; kısaltma/reddetme eski uzun bitişi kullanmaz.
- Kaynak değişimi/çıkış sırasında geç kalan hesap ve bootstrap yanıtları görünmez; etkin üç saatlik bitiş testleri geçer.

## Task 1: Sağlayıcı ve worker eşitlemesi

**Files:** Create `apps/worker/src/provider-entitlement.ts`, `provider-entitlement-store.ts`, `provider-entitlement-sync.ts` and focused `.test.ts` files. Modify `apps/worker/src/index.ts`, `worker-scheduling.test.ts`. Create `supabase/migrations/202610260001_provider_entitlement_sync.sql`. Do not edit existing reseller.ts/env.ts/API.
**Interfaces:** `createProviderEntitlementClient({url,apiKey,fetchImpl?,now?})` exposes only `lookup({username,password,providerLineId?})`; verified result includes lineId, username/password (memory only), packageId, isTrial, enabled/adminEnabled, expiresAt. `createProviderEntitlementStore(pool)` provides durable discovery/claims/CAS apply/failure. Export `runProviderEntitlementSyncBatch(store,provider)` for index and offline tests; batch5/concurrency2/lease300s/success60s/backoff capped15min. Store/schema exact shape may be designed together inside this task, keeping responsibilities separate.

- [x] Write red tests: paid upgrade from expired trial, exact extension/shortening/expiry/disabled/re-enable, no trial reset, bad identity/duplicates/shared/blocked, malformed/outage, idempotency, stale lease/credentials and admin cancellation, mixed batch errors don't block other jobs.
- [x] Implement bounded metadata reader, additive RLS table/indices and inactive neutral package, durable jobs and transactional audited reconciliation. Do not log sensitive fields. Test real SQL constraints/queries with local PostgreSQL if available; otherwise provide exact migration verification and meaningful store tests.
- [x] Integrate fire-and-track background batches without delaying existing worker jobs; scheduler tests and full worker suite/build.
- [x] Commit only owned files and write task report with red/green output and remaining risks.

## Task 2: Açık sayfada güncel erişim

**Files:** Modify `apps/ops-web/app/platform/session.tsx`, `personal-provider.ts`, `direct-playback-deadline.ts`, `catalog.tsx`, `detail.tsx`, `apps/ops-web/app/canli-tv/page.tsx`, `apps/ops-web/app/account/components.tsx`; focused existing/new tests. No CSS/copy changes required.
**Interfaces:** Existing `/me` and `/me/provider-session` remain unchanged. Add a coalesced forced metadata refresh to personal client preserving same-identity session/cache; context exposes verified current expiry + revision to consumers. Deadline helper may add `update()` so existing engines keep running while timers change.

- [x] Write red rendered/unit tests for inactive→paid recovery without reload, active extension/kısaltma/revocation, same client/cache/engine retained on expiry-only update, late old-account response ignored, outage preserves valid state, settings/catalog refresh, exact trial cutoff.
- [x] Refresh metadata about60sn and focus, with cancellation/single-flight; preserve active client/cache on unchanged source. Initial cached bootstrap must not swallow the first forced refresh. Authoritative denial clears access; transient failure doesn't grant or revoke.
- [x] Refresh actual production catalog/access and account hooks; propagate expiry changes to live/VOD/EPG timers without engine reinitialization. Avoid using the currently unmounted AccessBoundary as sole recovery mechanism.
- [x] Run focused tests, session/personal/live/player/showcase regressions and TypeScript. Commit owned files/report.

## Task 3: Korumalı dağıtım araçları ve üretim

**Files:** New thin source-pinned worker/web build/release adapters plus focused tool tests in `coolify/releases/2026-10-26-edge-recovery/`; minimal shared extension only if needed. Append existing verification report.

- [x] Exact runtime/test manifests; new-path absence and all-candidate regular-blob guards, immutable baseline/config/resource checks. Worker source7731936e27df/9b5d and current web5340ff942194/9b9a. API8cdbf9 and actualDB721873 protected; no floating DB resolution. Worker and web runtime file lists only task1/2 scope.
- [x] Run offline guard tests; review runtime/schema/tooling independently before deploy. Build candidates under finite actual cgroup caps; serialize all host operations.
- [x] Apply exact committed additive migration separately with bounded transaction/advisory lock; verify schema/RLS/indexes. Build/test/release worker only, observe real metadata sync counts safely. Then build/release web only, protected worker pin updated to newly deployed worker. No credential/provider mutation or playback tests.
- [x] Verify exact containers/public health, account context and sync outcomes; clean only each build's newly created reclaimable ancestor IDs after exact preview; retain images/volumes. Record evidence, push, and explain approximate refresh timing and mapping scope.


## Execution evidence / exact revisions

Worker539e01cff3c3b356e4b8db1b060bad20388410b0 and web44bd380f6635fa7ce529125be0ab96ee0138ec7c independently reviewed and approved, including fixes for transferred managed ownership, initial legacy expiry and account timeout recovery. Worker80+build; web54+TypeScript; tools64 passed. Real isolated PostgreSQL13/13 passed with exact committed migration and no production connection; container removed. Exact additive production migration passed transaction/advisory/RLS/index gates. Worker d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee deployed and observed; web ad05c92189313c67836da26df42a2f389e2ab8efe4213af7988f7d9cf970963e deployed and final acceptance passed. Public metadata bundle, actual HVZN account screen/API, zero active-account sync errors and all four running containers verified. Exact own cache cleanup and small temporary-file cleanup completed;13.16GiB free. No actual media test. Original full TDD steps were not all individually run red; reader red and two rendered review regressions were explicitly observed red/green, other acceptance tests verified green. See task reports and release verification for precise evidence.
