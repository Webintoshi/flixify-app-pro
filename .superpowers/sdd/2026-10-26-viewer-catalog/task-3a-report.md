# Task 3a implementation report

Implemented authenticated personal library references using the frozen GET, favorite PUT/DELETE, and watched PUT contract.

## Changed files
- apps/api/src/personal-library.ts: strict ref/body parsing, private responses, current personal session eligibility, historical own favorite removal, bounded reads, additive lazy schema, serialized cap checks, identity-only parameterized storage, classified errors.
- apps/api/src/personal-library.test.ts: 23 focused tests with mocked DB/repository and forbidden fetch.
- apps/api/src/server.ts: import and registration only; existing provider-session and legacy routes retained.
- This report.

## Evidence
RED: new route tests ran before implementation and failed with missing-route 404 responses (18 failures); log /tmp/flixify-3a-red.log.
GREEN: `npm test -w @flixify/api -- src/personal-library.test.ts src/personal-provider-session.test.ts src/personal-provider-session-route.test.ts` passed 3 files, 69 tests. Library coverage includes auth/blocked/session ownership, spoofed account identity, stale source writes, historical deletion, expired and trial eligibility, malformed/extra ref fields, storage identity allowlist, cap limits and duplicate acceptance, schema retry, bounded historical reads, no server provider fetch, classified secret-free errors. Log /tmp/flixify-3a-green.log.
BUILD: `npm run build -w @flixify/api` passed (ESM tsup).

## Behavior and constraints
New table personal_library_refs references public.users, with composite key including user, source version, list, kind, provider ID and parent series ID. Existing account_favorites and progress rows are untouched. Per-user public.users row locking serializes insert/cap transactions across processes; duplicates remain successful at cap. Schema initialization shares one promise per process and clears rejected promises for safe retry on subsequent calls. Storage never persists extension, provider credentials, metadata or URLs. Historical GET refs retain original sourceVersion. DELETE requires authenticated matching account context but can remove historical refs after access expiry. Posted refs are identifiers and do not establish provider membership.

No real DB, browser, provider, production, push or Next build used. Full unrelated suites deliberately not run per brief. Test runner emits the existing FFmpeg unavailable warning; it does not affect these tests. Deployment must patch the import/registration and new module into live API source, preserving live-only account-library code; do not replace server.ts wholesale.

Commit: see implementation commit containing this report (owned API files and report only).
