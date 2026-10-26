# Task 3b — personal catalog, session and VOD integration

Implemented owned `session.tsx`, `catalog.tsx`, `detail.tsx`, `types.ts`, new `personal-integration.ts` and its focused test. No adapter, API, live-page, account/signup, CSS, dependency, build or release files edited.

## Shared UI context

`usePlatform()` exposes:

```ts
personalProvider: ReturnType<typeof createPersonalProviderClient> | null
providerMode: 'loading' | 'personal' | 'legacy'
providerError: string // fixed safe display text; no raw provider error
providerScope: string // current sourceVersion, empty when unavailable
```

Independent live consumer example:

```ts
const {personalProvider, providerMode, providerScope} = usePlatform();
// Include providerScope in selection/data effect dependencies to clear a changed line.
if (providerMode === 'personal' && personalProvider) {
  const channels = await personalProvider.catalog('live');
  // Match selected namespaced ID to these channels, then use its personalRef.
  const epg = await personalProvider.shortEpg(channels[0].personalRef);
  const playback = await personalProvider.playback(channels[0].personalRef);
}
```

One scoped client per authenticated UI identity. Stable JWT subject keeps it across token refresh; decoded identity is only a UI cache scope, never authorization. Every API call uses the current API helper authentication. Synchronous storage/logout handlers clear old client and pending state. Unmount, abort, generation checks and the scoped bootstrap loader reject stale identity/late bootstrap publication. Scope changes clear catalog/detail/favorites; access uses the existing absolute deadline helper including focus/visibility checks. Bootstrap API calls are bounded to 15 seconds. Secrets remain in the client/loader closure and are never persisted or placed on React item metadata.

Successful validated bootstrap is required before personal mode. Only the endpoint's fixed ineligible message permits legacy mode. Bootstrap network/server failures stay unavailable with safe retry; provider catalog/detail/playback failure never falls back to server snapshot data.

## Behavior

Personal movie/series catalogs, genres, Turkish search and 48-item pagination use current filtered provider catalogs. Detail query values are matched exactly against current namespaced IDs; no parsing query strings into refs or numeric rebinding. Series details come from `provider.series(current.personalRef)`.

Each start, player retry, episode selection and automatic/manual next invokes `provider.playback(ref)` via the new helper. Retry preserves bounded progress only for the same current selection; a new episode resets it. Actual final URL pathname determines HLS/MP4/MKV transport; AVI/TS/unknown paths are rejected immediately with a fixed compatibility message. No personal server playback/transcode request. Absolute expiry is passed unchanged to the existing player.

Personal favorites read/write only `/me/personal-library` and `/me/personal-library/favorites`. IDs hydrate against current filtered catalogs; unavailable/old-line refs become generic unavailable placeholders that can be removed. Favorite hydration runs independently of catalog display. Legacy favorite behavior remains in legacy mode. Personal movie policy remains general audience only, so legacy adult preference control is shown only in legacy mode.

Personal series watched state hydrates by exact line/parent/episode identity and writes `/me/personal-library/watched`. Optimistic completion rolls back on failure with feedback; an already-watched episode remains watched on replay failure. Pending hydration merges completions instead of erasing them. Legacy progress routes remain in legacy mode.

Browser category filtering is a display policy; this change makes no claim that it is server authorization.

## Verification

TDD: new helper tests initially failed because the helper module was absent; detail/playback test additions then failed before their exports existed; late-bootstrap publication test failed before its helper existed. Implemented each and reran.

`node_modules/.bin/tsx --test apps/ops-web/app/platform/personal-integration.test.mts apps/ops-web/app/platform/personal-provider.test.mts` — 27/27 pass (8 new UI integration/helper tests + 19 reviewed adapter regressions). Covers old-line favorite placeholders, filtered pagination/groups, exact watched parent membership, actual pathname transport and absolute expiry, stable refresh identity, exact detail resolution, fresh start/retry/next calls, and rejection of stale late bootstrap publication/cleared identity.

`node_modules/.bin/tsc --noEmit --incremental false -p apps/ops-web/tsconfig.json` — exit 0 after final edits.

`git diff --check` — clean.

`node --test apps/ops-web/app/platform/direct-playback-deadline.test.mts` — 5/5 pass under native Node TypeScript stripping. An earlier attempt through TSX produced import-shape failures before execution; root identified the existing test runner convention and the correct native command passes without source edits. Total focused evidence: 27 integration/adapter tests plus 5 existing deadline tests pass.

No Next build/cache, browser, provider/production request or push. Root owns browser/end-to-end verification. Commit contains only the owned files listed above and this report; commit hash supplied in task completion message.

## Review fix round 1 — watched hydration/rollback ordering

Addressed review P2 at the watched PUT rollback. Replaced the captured `previouslyWatched` flag with separate confirmed and optimistic state. Hydration and successful PUTs add confirmation; failure removes only that request's optimistic addition. Attempt IDs also prevent an older failed request from clearing a newer pending completion. The displayed watched IDs are the union of confirmed and optimistic IDs. Existing server-confirmed initial watched state remains confirmed.

TDD: added the required completion → hydration containing episode → failed PUT regression; it failed before the new state helper existed. After wiring that same helper into Detail hydration, completion and PUT success/failure, the regression passes. It additionally verifies unconfirmed failures roll back, successful PUT confirmation survives stale empty hydration, and an earlier failed request cannot remove a later optimistic request.

- `node_modules/.bin/tsx --test apps/ops-web/app/platform/personal-integration.test.mts apps/ops-web/app/platform/personal-provider.test.mts` — 28/28 pass (9 integration/helper +19 adapter).
- `node_modules/.bin/tsc --noEmit --incremental false -p apps/ops-web/tsconfig.json` — exit 0.
- `git diff --check` — clean.

Only owned Detail/helper/test/report files changed. No build, provider/production/browser request, subagent or push.
