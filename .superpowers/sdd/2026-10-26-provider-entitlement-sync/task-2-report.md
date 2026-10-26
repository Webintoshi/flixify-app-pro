# Task 2 report — open web access refresh

Implemented the existing API contract without API, worker, stylesheet, copy, dependency, deployment-tool or synced-source edits. No external network or real stream was used.

## Exact runtime manifest

- `apps/ops-web/app/platform/session.tsx`
- `apps/ops-web/app/platform/personal-provider.ts`
- `apps/ops-web/app/platform/direct-playback-deadline.ts`
- `apps/ops-web/app/platform/catalog.tsx`
- `apps/ops-web/app/platform/detail.tsx`
- `apps/ops-web/app/canli-tv/page.tsx`
- `apps/ops-web/app/account/components.tsx`

## Behavior

PlatformProvider polls metadata every 60 seconds and on focus. Forced metadata refreshes coalesce. The seeded initial bootstrap is consumed before exposing the client, so the first user/background forced refresh reaches the API. Same identity refresh mutates only the verified expiry and preserves client/catalog/favorites. Transient errors preserve currently valid access; the existing absolute cutoff remains enforced. The endpoint's fixed authoritative ineligible response clears the personal client, scope, pending favorites operations and favorites, and exposes confirmed revoked expiry. Inactive accounts retry automatically. Account changes dispose old effects, abort pending work and ignore late old-account responses.

Context publishes verified expiry and revision. Live and VOD update existing deadline objects separately from engine initialization. `undefined` uses the playback record (including isolated tests); `null` is confirmed revoked access. Initial engine setup uses the latest override, so an old playback record cannot immediately expire newly extended access. Live stall recovery reads a latest-value ref when recreating deadlines. EPG uses the verified cutoff as well.

The mounted production catalog independently refreshes `/me` on 60-second/focus events, keeps confirmed state through outages, and preserves the personal catalog snapshot and pagination when expiry alone changes. Settings resource hooks refresh in the background, retain confirmed data on outage, abort on cleanup, and guard response publication against token/account changes.

## Regression evidence

New tests were replayed against the original session runtime using `git show HEAD:<path>` with automatic restoration. Both failed as expected: extension exposed `undefined` expiry; inactive polling left the provider in legacy mode. Restored implementation passes both. This was a baseline regression replay after implementation, not a claim that all changes were originally authored test-first.

Final rendered/unit command:

`npx vitest run apps/ops-web/app/platform/session-lifecycle.test.tsx apps/ops-web/app/canli-tv/live-stall-recovery.test.tsx apps/ops-web/app/platform/catalog-showcase-ui.test.tsx apps/ops-web/app/platform/catalog-showcase.test.ts apps/ops-web/app/components/player-chrome-focus.test.tsx`

Result: **5 files, 52 tests passed**. Coverage includes inactive recovery without reload, pending recovery coalescing, exact old-account response rejection, initial cached bootstrap plus first forced refresh, extension/outage client preservation, authoritative denial, settings background refresh, mounted catalog gate recovery with page-two preservation, strict absolute expiry, live engine retention on expiry changes, and extension followed by stall recovery past the original cutoff.

All **12 relevant `.test.mts` files passed**, each using its existing import-compatible runner (`node --import tsx --test` for files with local CommonJS default imports; `node --experimental-strip-types --test` for named ESM imports): personal-integration, personal-provider, direct-playback-deadline, vod-player-ui, vod-controls, vod-playback-policy, player-chrome-policy, live-category-selector, live-channel-catalog, live-playback-policy, personal-live, live-recent. Explicit combined subsets: personal/integration/VOD 44 passed; deadline/live policy 26 passed. The final helper cleanup was additionally checked with all 6 deadline tests.

`npx tsc --noEmit -p apps/ops-web/tsconfig.json` passed. `git diff --check -- apps/ops-web` passed.

Existing source-text test expectations were updated to require expiry removal from the VOD engine effect dependencies. The old focus session test now expects a metadata request while requiring the same client and pending catalog to survive. The ineligible polling bound includes the newly required 60-second refresh.

## Limits

No production deployment or real upstream playback was performed. Rendered players use mocked browser media and engines. API/worker behavior is covered by the separate task owners.

## Scoped review corrections

Addressed both P2 findings from `task-2-review.md` in a narrow follow-up touching only `session.tsx`, `account/components.tsx`, the session lifecycle test and this report.

- Initial fixed ineligible fallback now leaves verified expiry `undefined` when no valid personal source has ever been published for the identity. Prior personal revocation still publishes `null`. Rendered VOD regression mounts a valid HTTPS base-path legacy direct record under initial ineligibility and confirms the record expiry survives and its video receives the media URL. Existing active personal denial regression continues to pass.
- Account loads now create a new 15-second controller per attempt, coalesce initial and background loads, clear request timers, abort outstanding controllers on cleanup and retain the existing token/publication guard. A timed-out initial request no longer poisons later polling.

Test-first evidence: both new rendered regressions failed before the runtime fixes (`expected null to be undefined`; `expected undefined to be true` after timed-out initial request then scheduled recovery). Both passed after the fixes. Final focused suite: **5 files, 54 tests passed**. TypeScript and diff checks passed. No production/network/media calls were made; media URL assignment is a mocked DOM operation.
