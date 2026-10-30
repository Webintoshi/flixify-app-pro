# Trial capacity implementation

- [x] Trace the exact signup error and verify the live proxy/quota cause.
- [x] Add explicit proxy validation, configurable daily quota and regressions.
- [x] Review the proxy boundary, atomic quota write and unchanged trial behavior.
- [x] Run API tests/build, compare typecheck against the unchanged baseline, and validate deployment guards including PHP list/map round trips.
- [ ] Freeze source and build a bounded candidate against actual production dependencies; require original source/dist equivalence and unchanged runtime fingerprints.
- [ ] Apply the API-only image/settings transaction and verify health, proxy identity and protected services.
- [ ] Verify real client IP separation and spoof resistance through non-mutating health requests; record deployment evidence and clean temporary access.
