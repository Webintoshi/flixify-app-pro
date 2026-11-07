# Trial countdown implementation plan

**Goal:** Show the real remaining trial time on browsing and account screens while examining barriers between trial activation and purchase.

**Architecture:** `/me` adds `trialCountdown: {status, serverNow, endsAt}` without changing its existing user object or access rules. Clients anchor that snapshot to a monotonic clock and update only the timer label locally. No timer starts a new trial, grants access, limits a paid plan or expires the existing welcome discount.

**Scope:** Web/PWA, Android TV and active Windows client; keep macOS source compatible but its downloads withdrawn. Preserve current colors, layout, registration limits, provider expiry checks and one-time payment fulfillment.

## Work

- [ ] API: derive none/pending/active/expired/unavailable from actual trial identity and the earlier verified entitlement deadline; test paid users, pending provisioning, invalid dates and expiry boundaries.
- [ ] Web: share the existing coarse account refresh, render isolated countdowns in AppShell and account details, use a monotonic local timer and retain account-switch/error guards. No timer overlay on video.
- [ ] Android: parse the additive contract into Account without changing playback expiry; use monotonic remaining time in the shared navigation and account details; stop callbacks on background/logout. Test time passing, clock changes, missing snapshots, paid upgrade and expiry.
- [ ] Desktop: use the same contract in Windows and macOS. Notify countdown labels separately from catalog state. Test the pure clock and parsing. Do not restore macOS downloads.
- [ ] Verify appropriate API/web/native tests, Android signing, Windows CI where available and independent review. Freeze sources and publish only verified artifacts through guarded existing deployment paths.
- [ ] Research: use primary conversion reports and streaming evidence, audit actual product friction and obtain anonymized mature-cohort totals. Separate facts, missing measurements and hypotheses; do not invent conversion rates or change pricing/trial duration.

## Acceptance

An actual three-hour trial displays `03:00:00` at its authoritative start and reaches `00:00:00` at its existing deadline. Reloading or reinstalling does not create new time. Pending provisioning has no running timer, paid users have no trial clock, purchase clears the clock, and labels never claim the untimed welcome discount is expiring. Legacy trials retain their actual deadlines. Ticks make no network requests and do not rebuild catalogs or interrupt playback.
