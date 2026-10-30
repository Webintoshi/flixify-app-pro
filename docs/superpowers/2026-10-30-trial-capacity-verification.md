# Trial capacity verification

## Source acceptance

- Full API suite: initially 302/302 passed; after the production-signature fixture regression, root reran 303/303 successfully. API bundle build passed; the later changes affect tests only.
- Production Fastify 5.12.5 proxy behavior was checked separately from local Fastify 5.8.2. Seven actual dependency cases passed. Broad mapped-IPv6 regressions were observed failing before the fix; 36 final configuration/proxy cases passed.
- Existing atomic UPSERT now binds the configured cap as its second parameter. Transaction rollback, registration/authentication and three-hour trial invariants remain covered. No new real PostgreSQL concurrency test or customer signup was performed.
- Full TypeScript check remains unsuccessful with 79 pre-existing diagnostics; clean HEAD has the same 79 and the change adds none. API bundle compilation succeeds.
- Fresh deployment contract tests: 21 builder + 23 release tests passed. The release helper also passed actual PHP list/map add/remove round trips, duplicate rejection and full transaction syntax checking in the existing Coolify container, without accessing its database or changing configuration.
- Root independently reran all 302 API tests and the 21/23 guard tests. The first root API command lacked required fixture environment; the corrected command passed. The initial standalone PHP import lacked local PyYAML; string-helper/syntax checks then ran successfully with the same import-only stub used by offline tests. Server deployment uses its real PyYAML installation.

## Production acceptance

The first candidate at `52244b2d7a5e79fc5da52ac1e405d9e5a083fedd` passed original-source/dist equivalence, surgical overlay compilation and untouched-runtime/dependency/configuration gates. Its isolated regression gate correctly stopped publication: the actual production repository has a referral-store pool constructor and seven-argument `createUser` signature; repository fixtures assumed the older six-argument signature. No live API change occurred. The two fixtures now accept exactly the reviewed six/seven signatures, insert an explicit null referral only for seven, reject unknown signatures before calling them, and verify the precise source-IP HMAC. A pool stub fails on unexpected I/O. Existing transaction/quota/job assertions remain intact. Focused tests passed 12/12, then the full local API suite passed 303/303. A new frozen candidate must pass all production gates before rollout.

Pending the guarded candidate build and API-only rollout. This document must be completed with the frozen revision, image identity, baseline/source/dist preservation checks, runtime settings and external IP probes before claiming the daily-limit fix is live.
