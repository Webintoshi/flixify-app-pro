# Viewer Catalog Implementation Plan

**Goal:** Current personal catalog, series details, live channels and EPG are requested from the viewer network.

**Spec:** ../specs/2026-10-26-viewer-catalog-design.md

## Global Constraints

- Personal credentials only; finite access and verified trial expiry; no server provider fetch.
- Secret bootstrap stays memory-only, private/no-store; clear/abort on account, line or expiry changes.
- Preserve existing UI/colors/signup/account/adult rules. Unknown personal movie categories fail closed.
- No arbitrary-ID server playback endpoint, untrusted shared import, entitlement extension or new provider permissions.
- Preserve favorites/watched refs by user/line namespace and current browser hydration.
- Exact pinned live-source overlays; API/web only. No suspended host, proxy restoration, backup or external messages.

## Review Focus

Account switching and expired bootstrap must not issue a provider request or leak old account data. Provider JSON must not inject URLs/HTML, and unclassified movies must not reach detail or playback. New IDs must bypass stale snapshot resolution without creating a new server trust claim. EPG and favorites failure must preserve useful state.

### Task 1: Personal bootstrap

**Files:** apps/api/src/server.ts; new personal-provider-session.ts/tests; route tests.

- Add pure personal-only bootstrap derivation and authenticated route with no-store headers.
- Exact response fields: accountId, sourceVersion, providerOrigin, username, password, expiresAt, moviePolicy general-audience-only.
- Reuse canUseClientIpPlayback and reject missing/same-as-shared credentials, non-root/non-HTTPS origins, invalid/elapsed deadlines and unverified trials.
- sourceVersion is an opaque HMAC of user and current personal line with existing application secret, independent of refreshed access token.
- Test identity, deadline, shared/null credentials and route privacy; no provider calls.

### Task 2: Browser provider adapter

**Files:** new apps/ops-web/app/platform/personal-provider*.ts/tests only; do not modify UI consumers or server.

- Implement frozen bootstrap type, strict refs and direct record construction, bounded fixed-action JSON transport, per-account/line in-memory session and abort/expiry invalidation.
- Normalize movies/series/live and on-demand series episodes into existing shapes with personal descriptors, safe artwork/text and exact movie category allowlist.
- Normalize selected short EPG, decode UTF-8 base64 safely, validate ranges and retain empty/error distinction.
- Test bounds, category rejection, transport/URL construction, expiry, account race and missing/malformed data.

### Task 3: Catalog/detail integration and references

**Files:** platform/catalog.tsx, detail.tsx, session.tsx, types.ts; production-compatible per-user reference routes/storage after inspection.

- Use personal adapter for authenticated current catalog and details; retain existing noneligible/legacy account states.
- Refresh bootstrap before play/retry/advance; use current filtered item and same absolute player expiry.
- Preserve hover/menu/series controls and personal favorites/watched with namespace-safe authenticated refs.
- Inspect deployed library route modules and database definitions first; do not invent incompatible migrations.

### Task 4: Live and EPG integration

**Files:** canli-tv/page.tsx and bounded EPG UI/styles/tests.

- Feed existing live catalog/engine selection with personal data and direct records.
- Show selected-channel current/upcoming EPG; cancel on channel/account change, do not reconnect after expiry.
- Preserve existing live filters, colors, controls and separate content policy.

### Task 5: Verification and release

- Review each task, test complete flows and real CORS metadata/EPG plus player interaction through CUA.
- Build pinned API/web candidates preserving live-only code, run full candidate tests and guarded rollout.
- Verify routes, source/image identities, account deadlines and no server media/metadata request.
