# Personal browser catalog and EPG

The provider rejects all requests from the application server, including catalog and EPG. The user explicitly selected viewer-IP requests and confirmed there is no metadata whitelist. Current personal browser API requests are readable with CORS; movie and episode playback was verified from the viewer network. The shared snapshot is stale and cannot be the source for newly selected provider IDs.

## Delivery and authorization

Add authenticated `GET /me/provider-session`. It returns only the current user's personal HTTPS provider origin, username/password, finite `expiresAt`, authenticated `accountId`, and an opaque `sourceVersion` bound to user/line identity. Reuse current playback permission, personal-versus-shared rejection and verified trial provider expiry no later than application expiry. Send private/no-store headers. Never expose shared or reseller credentials. No provider requests run on the server.

The browser uses fixed player_api actions for categories/lists, on-demand series details and selected-channel short EPG. Requests omit browser credentials/referrers, reject redirects, enforce timeout/size/item limits, and keep secrets only in scoped memory. Abort and clear on logout, account/line change or expiry. Refresh bootstrap before play/retry/episode advance. Construct media URLs solely from the server-selected origin, encoded personal credentials, strict decimal IDs and allowed extensions; ignore direct_source and arbitrary provider paths. Existing absolute media deadline cleanup remains.

There is no new server endpoint accepting arbitrary provider media IDs, and no browser data is imported into the shared catalog. Provider JSON is untrusted display data. A bootstrap signature cannot authenticate its categories; do not pretend otherwise. Existing server catalog/playback filters remain intact. Personal movie presentation uses an explicit exact general-audience category allowlist, including only inspected provider aliases; unknown/missing/adult categories fail closed. Apply this filter to catalog/search/detail/favorites hydration/play selection. No new adult enablement or parental-security promise. Live and series retain their separate policies.

Keep existing branding, controls, registration, account and subscription workflows. A personal ref contains sourceVersion/kind/decimal ID (episodes also parent series ID), never credentials or URLs. Separate these refs from legacy snapshot IDs. Preserve favorite/watched behavior through authenticated per-user, per-line reference storage; hydrate current metadata in the browser. Missing items remain unavailable, never rebound to another account or line. Inspect production-only route registrations/schema before adapting this part.

EPG is fetched only for the selected channel, normalizes provider timestamps and base64 UTF-8 titles/descriptions, and renders current/upcoming programmes with an honest empty/error state. Metadata failure must not silently call the blocked server or erase favorites.

## Frozen bootstrap contract

`{ accountId: string, sourceVersion: string, providerOrigin: string, username: string, password: string, expiresAt: string, moviePolicy: "general-audience-only" }`

No added dependencies. All code/source changes require a fresh guarded API/web-only overlay release based on exact current live image/source pins. Preserve production-only source. No backups, retired proxies, suspended host or provider messages.
