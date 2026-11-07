# Trial countdown implementation plan

**Goal:** Show the real remaining trial time on browsing and account screens while examining barriers between trial activation and purchase.

**Architecture:** `/me` adds `trialCountdown: {status, serverNow, endsAt}` without changing its existing user object or access rules. Clients anchor that snapshot to a monotonic clock and update only the timer label locally. No timer starts a new trial, grants access, limits a paid plan or expires the existing welcome discount.

**Scope:** Web/PWA, Android TV and active Windows client; keep macOS source compatible but its downloads withdrawn. Preserve current colors, layout, registration limits, provider expiry checks and one-time payment fulfillment.

## Work

- [x] API: derive none/pending/active/expired/unavailable from actual trial identity and the earlier verified entitlement deadline; test paid users, pending provisioning, invalid dates and expiry boundaries.
- [x] Web: share the existing coarse account refresh, render isolated countdowns in AppShell and account details, use a monotonic local timer and retain account-switch/error guards. No timer overlay on video.
- [x] Android: parse the additive contract into Account without changing playback expiry; use monotonic remaining time in the shared navigation and account details; stop callbacks on background/logout. Test time passing, clock changes, missing snapshots, paid upgrade and expiry.
- [x] Desktop: use the same contract in Windows and macOS. Notify countdown labels separately from catalog state. Test the pure clock and parsing. Do not restore macOS downloads.
- [x] Verify appropriate API/web/native tests, Android signing, Windows CI where available and independent review. Freeze sources and publish only verified artifacts through guarded existing deployment paths.
- [x] Research: use primary conversion reports and streaming evidence, audit actual product friction and obtain anonymized mature-cohort totals. Separate facts, missing measurements and hypotheses; do not invent conversion rates or change pricing/trial duration.

## Acceptance

An actual three-hour trial displays `03:00:00` at its authoritative start and reaches `00:00:00` at its existing deadline. Reloading or reinstalling does not create new time. Pending provisioning has no running timer, paid users have no trial clock, purchase clears the clock, and labels never claim the untimed welcome discount is expiring. Legacy trials retain their actual deadlines. Ticks make no network requests and do not rebuild catalogs or interrupt playback.

## Publication evidence

Published and externally verified on2026-11-07. Application revision2522149cfda9dae514fc81d9820cbbfb70c57ea6; release tooling revision97af27f24050ff2d56e928af9a79c870ff961115. The tooling fixes did not change application artifacts. API image66805232ca883cbd6385c38341d21b4be0b9fc436b5718cc2b8e20d4398de4fb and Web image456b47b777683b67cc1e74d8f3cfd93d6df382f28cad273c6aabe958b6900e33 passed the original preflight/apply/recreate phases inside one release lock. No device sessions were revoked; database, worker, environment, registration fence and other applications were protected.

Android TV1.4.16/code24 uses sourcefa413c7d443c1359cd0451261f42accef902893d/tree d68c758756b1c4f3702cf44688873a90dd191c09. Its2,167,237-byte APK SHA-256 is d84490ca71f6c220a0246426ea639b34d3a13668c46669379bb7c44f63f9d54e, with unchanged signer158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594. Public APK and updater metadata match. Windows1.0.4 uses accepted CI run42371335948 and the unchanged source tree2ed6ef1aabe042b0c7c98b72b5f8c4522cdadbdf; the existing unsigned TEST notice remains. Its public70,367,451-byte installer passed server full SHA and external HEAD/range checks. Mac downloads remain withdrawn.

Relevant validation: API55, Web77, Android unit218, final targeted Android instrumentation16, release guard24, Windows policy15 and packaging29 checks passed, plus the Windows build/install/UI/media/privacy CI. Initial Android full instrumentation was319/321; one new fixture assertion was corrected and the existing keyboard case passed two targeted reruns. Do not report the initial full run as completely passing. API full tsc retains81 baseline errors with no additions; actual baseline/candidate bundling passed. Mac source-only clock checks passed9 tests; the pre-existing invalid legacy Mac workflow was not changed.

The authorized paid account remains active, with trialCountdown.status=none; contact and runtime-only accessHistory fields are preserved. Screenshot, public download proof, native proofs, cohort aggregate and complete release receipt are retained under work/artifacts/trial-conversion-20261107 outside this checkout; server evidence stays in /tmp/flixify-trial-conversion-20261107-root.
