# Android TV persistent data and updates

The user approved implementing the proposed device cache and in-app APK updates on 30 October 2026. Continue directly with implementation and publication on the existing website; no further design approval is required by this session.

## Behavior

- Preserve the native design, remote controls, player, sounds, favorites, signup and all existing playback/access checks.
- Keep verified catalog snapshots and series details in private device storage. A cold open reuses the current verified account/source snapshot instead of downloading the full catalog again. Fresh authorization and absolute expiry still gate playback; no provider credentials or playable URLs are persisted in metadata caches.
- Display cached data promptly and refresh stale data in the background, with scoped notifications to the visible catalog. Explicit Yenile requests fresh data. Cache failures do not prevent using the network. Logout/source changes cannot reveal another identity's data.
- Persist poster/logo image bytes in a bounded disk LRU as well as the existing small decoded-bitmap memory cache. Fetch visible assets lazily; no full-catalog image crawl. Use account/source-qualified hashed keys, bounded responses and decode sizes. Low disk space, corrupt images and interrupted writes degrade to the existing placeholder/network behavior.
- Background catalog/image work yields while a player is active. Authentication, playback authorization and required selected-program requests retain their existing availability.
- Add an account-screen update action in the existing visual style. Check a small HTTPS manifest at https://flixify.vip/downloads/flixify-tv-update.json; download only after the user's update action. Verify exact size, SHA256, application ID, newer version code and the installed signing certificate before requesting the Android system installer. Respect unknown-source permission and installation confirmation; do not promise silent installation on every TV.
- Use a static Android-only manifest; leave the existing desktop update API/manifest unchanged. New application version is 1.4.0/code8, package vip.flixify.tv, minimum API23, existing signer. Keep old APK URLs immutable.

## Approach

Persistent per-device metadata and artwork caches were selected over bundling a changing personal catalog into every APK. UI assets already ship locally. Data refreshes do not require APK releases; executable/UI changes use the verified APK installer. Full video downloads are outside this change. Cache and updater failures must never grant playback or disrupt an active stream.

## Verification and delivery

Test persistence/corruption/eviction/account isolation, fresh authorization and expiry, no background catalog/image starts during playback, stale callback rejection, update URL/hash/package/version/signer validation, remote account controls and actual decoder/remote regressions. Build and verify a compatible signed release, upgrade the owned emulator, and publish the APK and static manifest through the protected web-only deployment. No customer/provider media test is needed for this data/update feature. Leave API, worker, DB, edge, bot and unrelated services untouched.
