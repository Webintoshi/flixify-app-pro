# Lifetime registration limits

The user explicitly confirmed two accounts per real IP across all time, with one account per device/browser identity. This replaces the daily quota. Existing accounts and three-hour trials remain valid; deletion must not replenish either allowance.

Use two permanent HMAC-keyed ledgers, claimed atomically with the user and provisioning job in one PostgreSQL transaction. Seed known retained IP counts (clamped to the two-account allowance) and every retained installation ID, including deleted users. Historical real IPs lost before the trusted-proxy fix cannot be reconstructed and must not be invented. Keep the explicit proxy allowlist.

A dedicated stable `REGISTRATION_GUARD_SECRET` initially copies the current JWT secret internally, preserving known IP hashes while allowing future JWT rotation independently. Never print either secret. Seed through a transaction-local bound parameter and the existing public pgcrypto extension. No raw IP storage or new fingerprinting is introduced. Browser storage clearing/profile changes and device resets can change client-provided identity; this implementation does not claim physical hardware identification in a browser.

Build and verify the candidate before briefly stopping only API for final backfill/cutover, preventing old writers from racing the seed. Preserve web, worker, database identity and all unrelated source drift. Rollback requires ledger reconciliation before reopening registration.
