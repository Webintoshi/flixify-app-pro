# Trial capacity verification

## Source acceptance

- Full API suite: 302/302 passed; API bundle build passed.
- Production Fastify 5.12.5 proxy behavior was checked separately from local Fastify 5.8.2. Seven actual dependency cases passed. Broad mapped-IPv6 regressions were observed failing before the fix; 36 final configuration/proxy cases passed.
- Existing atomic UPSERT now binds the configured cap as its second parameter. Transaction rollback, registration/authentication and three-hour trial invariants remain covered. No new real PostgreSQL concurrency test or customer signup was performed.
- Full TypeScript check remains unsuccessful with 79 pre-existing diagnostics; clean HEAD has the same 79 and the change adds none. API bundle compilation succeeds.
- Fresh deployment contract tests: 21 builder + 23 release tests passed. The release helper also passed actual PHP list/map add/remove round trips, duplicate rejection and full transaction syntax checking in the existing Coolify container, without accessing its database or changing configuration.
- Root independently reran all 302 API tests and the 21/23 guard tests. The first root API command lacked required fixture environment; the corrected command passed. The initial standalone PHP import lacked local PyYAML; string-helper/syntax checks then ran successfully with the same import-only stub used by offline tests. Server deployment uses its real PyYAML installation.

## Production acceptance

Pending the guarded candidate build and API-only rollout. This document must be completed with the frozen revision, image identity, baseline/source/dist preservation checks, runtime settings and external IP probes before claiming the daily-limit fix is live.
