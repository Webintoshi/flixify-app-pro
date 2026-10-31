# Lifetime registration implementation

**Goal:** Two registrations per real IP for all time, one per retained installation identity, without changing trial or access behavior.
**Spec:** `docs/superpowers/specs/2026-10-31-registration-lifetime-design.md`

- [x] Confirm lifetime rather than daily scope; inspect existing active-only device guard and actual production proxy/dependency state.
- [ ] Observe failing regressions, add permanent ledgers and stable HMAC key, and preserve transactional rollback and referral signatures.
- [ ] Exercise real PostgreSQL concurrency for same device and third account on one IP in an isolated fixture.
- [ ] Build a surgical candidate over actual production sources and dependencies, preserving existing source/dist and unrelated application fingerprints.
- [ ] Apply additive schema, seed retained history during an API-only cutover, set the stable guard secret without exposing it, and recreate only API.
- [ ] Verify exact runtime limits, health, preserved services, client-IP spoof rejection and clean temporary access; record evidence.
