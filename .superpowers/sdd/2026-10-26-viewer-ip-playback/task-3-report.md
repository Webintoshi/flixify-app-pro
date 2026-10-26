# Task 3 report

Base: 84bf449. Implemented only API route changes and tests.

## Behavior

Browser VOD accepts direct=1 or vodDirect=1, with direct=0 still opting out. Eligible paid and bound trial users receive direct_provider for canonical HTTPS HLS, MP4, and MKV, with expiresAt equal to accessUntil. Uses the existing primary-only personal URL builder, rejecting credentials identical to shared credentials. No provider path or extension alternatives are fabricated. A pathname extension check prevents substring-only matches from being accepted as supported direct media.

Browser live returns the same personal direct_provider record before shared 404 cooldown, source probing, health updates, or relay preparation. Supports detected HTTPS HLS, TS, MP4 and MKV. Access eligibility is delegated to Task 1's canUseClientIpPlayback. Native routes were not changed.

## Verification

TDD red: new route regression suite initially reported 9 failures and 7 passes, including all intended direct response cases.

Final focused command:

    npx vitest run apps/api/src/viewer-ip-playback-route.test.ts apps/api/src/trial-playback-route.test.ts apps/api/src/client-playback-access.test.ts apps/api/src/playback-credentials.test.ts coolify/releases/2026-10-26-viewer-ip/candidate-viewer-playback.test.ts

Result: 5 files, 47 tests passed. API production build passed with npm run build --workspace @flixify/api. git diff --check passed.

Route assertions cover paid/bound trials and exact canonical MP4/MKV/HLS URLs, personal credentials, live bypass despite broken shared catalog health, no live/VOD probe calls or fetch on direct responses, no health mutation on successful live direct, shared/missing credentials, provider expiry +1ms, malformed provider expiry, expired/current-expired access, absent paid deadline, HTTP and unsupported transport. Existing trial/native safeguards remain green.

Candidate test is self-contained with relative API imports and mocks for authentication repositories, episode/live lookups, provider probe exports, health and diagnostics writes. Uses episode rather than movie lookup to avoid production-image movie/adult repository differences; no external network or database is needed. Both route and candidate copies passed together locally. Actual network-none container execution belongs to the release verification stage.

## Review and limits

Reviewed route diff manually: live addition is a small insertion immediately after channel lookup and before cooldown. Production source contains separate adult/catalog changes; apply this diff as an overlay without replacing server.ts. Confirm production adult authorization still executes before this added direct response block. No worker/contracts/UI/source/release script edits, deployment, pushes, or production access.

Browser codec support for MKV and provider HLS CORS remain unverified runtime constraints. Existing non-direct behavior remains in place for unsupported/ineligible requests. No real viewer-network media probe was performed by this task.
