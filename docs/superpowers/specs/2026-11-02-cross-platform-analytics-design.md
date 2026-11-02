# Flixify cross-platform Google Analytics

## Intent and decisions

The owner requests Google Analytics with detailed usable reporting, covering the website/PWA, Android TV, native macOS and native Windows. Their prior delegation of technical implementation remains in force. This work adds measurement without altering access, playback recovery, pricing, provisioning or personal-signing policy. Business size is 11–100 employees, as supplied by the owner.

Use one dedicated Flixify Pro GA4 property, Europe/Istanbul reporting and TRY currency. Keep unrelated Google properties unchanged. Additional Google data sharing, advertising signals and personalized ads remain off. Legal acceptance of any new Google terms remains an explicit owner action/confirmation at the actual terms screen.

## Approaches

1. A website-only Google tag is insufficient for the explicitly requested native apps.
2. A single embedded Measurement Protocol secret in every client is rejected: it exposes the secret, corrupts reporting, and misses native SDK support.
3. Selected implementation: Google tag for web/PWA, Firebase Analytics for Android TV and macOS, and a first-party authenticated Measurement Protocol relay for Windows. Windows uses a clearly named Windows Native Web stream and a custom client_platform dimension; no fictitious Firebase app ID. Measurement-Protocol-only Windows standard acquisition/device reporting has documented limits.

This is an engineering choice made by the implementer under the owner's delegation. Existing installed native binaries require a new app release before they can emit the added events.

## Consent and data contract

Analytics starts disabled. Persist a versioned choice (unknown/accepted/rejected) separately from login or device-registration identity. Offer an equal, understandable choice and an editable account/settings control. Declining must not limit functionality. Withdrawing stops new collection, clears queued events and resets the local analytics identifier. Never load Google on the web before consent. Automatic Google history/form/search/download extraction is disabled; route tracking is explicit. Advertising storage, user data and personalization are denied.

Allowed dimensions: client_platform = web|pwa|android_tv|macos|windows, app_version, screen_name, content_type = live|movie|series|episode, opaque content_id, safe catalog-derived category ID, safe enumerated reason, package_id, package_months, package_users, offer_id. Do not expose auth codes/suffixes, tokens, provider scope/credentials, stream URLs, payment secrets/customer/session IDs, device-registration identifiers, raw search queries, raw errors or arbitrary DOM text. No login-code-derived User ID. Analytics instance IDs are random and consented.

Allowed bounded numeric values include result_count, query_length, startup_ms, buffer_ms, watch_ms, progress_percent, session_id, engagement_time_msec. Server-only purchase uses an opaque one-way transaction reference, TRY, actual verified paid amount and package item data. Do not publish high-cardinality account/content IDs as custom dimensions unnecessarily.

Readable popular-content reports also allow verified public catalog content_name (100 characters) and category_name (80). These are never taken from search input, DOM, errors or URL text. Reject control/format characters, URLs, emails, credential-style assignments, percent-encoded payloads and standalone 16-character uppercase account-code patterns. Clients omit an unsafe label while preserving the anonymous event/hash. This engineering decision makes owner reports usable without a separate hash lookup.

## Events and counting

- Navigation: page_view on web, screen_view with supported native SDKs, app_screen_view for Windows relay; one per real transition. A static allowlisted route/title drops query strings/fragments and sensitive referrers.
- Account: sign_up after successful registration, login after successful authentication, logout; no identifiers in params.
- Discovery: search with query length and result count, select_content, category_select, catalog_page_loaded, add_to_wishlist/remove_from_wishlist after successful mutation.
- Welcome/packages: trial_select, welcome_offer_select, view_item_list/select_item for packages, begin_checkout only after a usable checkout is returned. Native payment launches preserve a safe platform attribution without auth data.
- Downloads/update: file_download with platform/version/file kind; update offered/selected/completed where the app has reliable lifecycle evidence.
- Playback: playback_request, video_start only after actual first frame/confirmed playing, video_progress once at 25/50/75 percent for finite media, video_complete only at real end, playback_buffer with bounded duration/count, playback_error with enumerated reason, playback_end with watch duration and final status. No timeupdate firehose; no stream opening for analytics QA.
- Revenue: purchase emitted once from authoritative verified-payment handling; package_activated only after successful fulfillment. Repeated Stripe callbacks/reconciliation must not duplicate revenue. A purchase is distinct from delayed provisioning.

Events/params are allowlisted at every native relay boundary. A failed or unavailable analytics service never blocks app startup, navigation, playback, registration or payment. Native queues have a fixed bound and asynchronous flush. No persistent queue keeps auth material.

## Backend integration

Current production Stripe sources are the welcome-offer release overlay, not canonical apps/api/src. Preserve the deployed payment validation/provisioning behavior. New telemetry routes and any checkout-attribution/outbox additions must be narrow overlays against independently verified current source. Keep secrets on the server and fail disabled when configuration is absent.

An authenticated analytics route validates payload bytes, event count/name/param schema, platform/version, consent version, anonymous client/session IDs and bounded numeric ranges. No reserved automatic events may be forged. Use bounded expiring abuse controls and event deduplication. Delivery has deadlines and bounded retry; no logging of payloads/secrets. Config response exposes only public stream/config values. Outbox/attribution schema changes are additive, independently tested and deployed before modified code uses them.

## Reporting setup

Create or verify web/PWA, Android TV, macOS and Windows Native streams in the same property/Firebase project. Register useful event-scoped dimensions (client_platform, app_version, content_type, screen_name, package_id, package_months, package_users, reason, offer_id) and numeric custom metrics (startup_ms, buffer_ms, watch_ms). Mark sign_up, trial_select, begin_checkout and purchase as key events where appropriate. Configure 14-month event retention, preserving consent withdrawal and deletion behavior. Keep internal/test traffic separated with debug mode/test sinks and report filters rather than injecting synthetic customers into normal revenue.

Provide a concise owner guide with live report links for traffic, devices/platforms, registration/trial/checkout funnel, popular content, start latency, buffering/errors and revenue. Verify real collection in DebugView/Realtime; a successful HTTP response alone is not proof of GA ingestion.

## Verification and release

Prove zero collection before/rejected/withdrawn consent, strict privacy allowlists, no duplicates under rerenders/repeated media events, correct first-frame timing, bounded nonblocking queues and unavailable-Google behavior. Test authoritative purchase replay/mismatch/test-payment behavior with fixtures only. Build every changed native client and preserve Mac identity restrictions and Windows unsigned notices. New versions/download hashes must match actual accepted artifacts, and Android update metadata must point to the matching APK.

Use a new guarded release profile based on the live Windows 1.0.1 web source eba4d62b3893e0e173392be0421101279bfe3bac / image 3f882fa9bc2029bc4cad6cd4635fb6d304900085e89e0e97ddba900ad040bfd3. API/worker/database changes require their own bounded compatible sequence. Preserve every retained download and the registration fence; do not prune unrelated projects, alter provider channels or touch suspended servers.
