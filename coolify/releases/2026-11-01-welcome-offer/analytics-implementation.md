# Analytics backend overlay

The runtime payloads in this folder target the existing welcome-offer API. New runtime leaves are `analytics-policy.ts`, `analytics-delivery.ts`, `analytics-routes.ts`, `analytics-store.ts`, and `analytics-runtime.ts`. Existing changes are restricted to four Stripe leaves: billing routes/store and payment processor/store. The server patch description adds one import and one registration call; its deliberately invalid source pin must be replaced only after independent measurement of the actual current server file. Do not replace production `server.ts` with the canonical checkout copy or reuse the historical release manifest.

Apply `supabase/migrations/202611020001_analytics.sql` separately before enabling the new API. It adds private RLS consent/attribution/outbox tables; it does not alter account, package, provider or financial rows. The exact Windows event/parameter and optional checkout attribution contract is in `analytics-contract.json`.

## Server configuration

- `GA4_ENABLED=true` explicitly enables valid configured streams.
- `GA4_WEB_MEASUREMENT_ID`: public web/PWA stream ID.
- `GA4_WEB_API_SECRET`: server-only Measurement Protocol secret for verified web purchases.
- `GA4_WINDOWS_MEASUREMENT_ID` and `GA4_WINDOWS_API_SECRET`: dedicated Windows Native Web stream.
- `GA4_ANALYTICS_HASH_SECRET`: stable random server-only value, 32–256 characters. Keep it stable across rebuilds; it supplies anonymous transaction/event deduplication keys.
- `GA4_DEBUG_MODE=true` optionally adds debug mode for verification. Disable after verification; it does not manufacture ingestion proof.

Missing or malformed settings disable the affected server stream. The public config response contains only schema/consent versions, enabled flags and the two public measurement IDs. The web Google tag can operate with a valid web ID before server revenue credentials exist; Windows and verified revenue require the private configuration as well.

## Delivery and billing behavior

Windows events are validated and durably accepted before returning HTTP 202. Client purchase/activation and reserved automatic events are rejected. The authenticated route permits at most 20 events/32 KiB, with 120 events per minute per user, a bounded expiring abuse map, a 200 pending-event user cap and a 10,000 pending-event ingest cap. Google is contacted only by the asynchronous dispatcher, with a five-second request deadline. Ten-row exclusive leases last 90 seconds to cover sequential request deadlines. Retries stop at five attempts; events older than 72 hours become dead, and completed/dead rows are removed after four days in bounded batches.

Consent withdrawal tombstones the anonymous client, revokes its checkout attribution and removes pending/sending events. A stale batch cannot re-enable that identity. The dispatcher rechecks consent after claiming. Requests already transmitted before withdrawal cannot be recalled.

Optional malformed/absent checkout attribution is discarded. Analytics persistence errors do not fail checkout or change the existing Stripe idempotency, price, discount, ownership or provider checks. A verified live paid PaymentIntent is pinned before purchase measurement. A separate activation event follows successful entitlement completion. The outbox and its attribution checkpoint commit together. Reconciliation uses only already-verified persisted PaymentIntent pins and consented attribution, so a temporary analytics storage failure can recover without calling Stripe or repeating provider work. Stable opaque transaction IDs and unique outbox keys suppress webhook/reconciliation replay. Test-mode, unpaid, mismatched and withdrawn purchases are excluded.

## Verification

Run `vitest run --config coolify/releases/2026-11-01-welcome-offer/analytics-vitest.config.ts`. Its task-local Fastify/PG dependency aliases point to `work/artifacts/analytics-backend-tools`; production uses the existing API dependencies without changing the package lock. Policy, transport, real Fastify routes, bounded dispatcher and checkout/paid-fulfillment tests exercise the actual implementation using synthetic dependencies at external boundaries.

`welcome-tests/analytics-postgres-fixture.ts` is a standalone fixture entry. Its compiled `fixture.mjs` plus the exact migration is supplied in `work/artifacts/analytics-backend-fixture.tar.gz`. It requires an explicitly isolated local PostgreSQL database named `flixify_analytics_fixture` owned by `flixify_fixture`, rejects unknown public tables and owns a sentinel before resetting only its fixture tables. It uses the API image's existing `pg`, no Vitest downloads or Google/provider traffic. Actual migration/outbox persistence success requires this fixture receipt, separate from the local unit suite. A successful Measurement Protocol response also remains separate from visible GA DebugView/Realtime ingestion.
