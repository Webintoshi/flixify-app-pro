# Viewer IP playback

The provider explicitly permits viewer connections and rejects the Flixify server IP. The existing paid browser MP4/HLS route already constructs a personal provider URL; trials, MKV, live preparation and direct-failure recovery still reach the server relay. The user selected viewer-IP delivery and previously authorized implementation and deployment.

Use native browser media/HLS directly with each account's personal line. Never expose shared catalog credentials. Support canonical HTTPS MP4, HLS and MKV sources; MKV compatibility depends on browser and codecs. Do not invent converted provider URLs. AVI/unknown sources need an honest compatibility error rather than a blocked relay attempt.

Trials are direct-eligible only with a completed provisioning job bound to the current user and personal credentials, a verified line ID and finite future provider expiry no later than the app access deadline. Existing three-hour provisioning semantics remain capped at three hours. Return the access deadline in direct playback expiresAt. The player independently destroys/stops media at expiry and on visibility/focus return, including while account refresh fails. Provider hard expiry remains responsible for previously issued URLs outside the app; no blanket trial guard removal.

Direct browser failures retain client retries and never fall back to the known-blocked server. Live browser playback should also bypass server probes when the same access/credential rules pass. Existing UI, colors, registration steps, account restrictions and adult catalog policies stay intact.

Alternatives considered: restoring retired proxies conflicts with the user's instructions; server transcoding cannot fetch blocked media; changing extensions does not convert MKV. Catalog reference repair remains separate because the configured account returns401 and an alternate line cannot pass a server-side catalog preflight.

Verify with regression tests for deadline/identity/shared-line boundaries, a credential-safe real viewer-network MP4/MKV probe, candidate-image tests against the live source, and a guarded API/web-only rollout. Do not touch the suspended server, make backups, or send provider messages. Safari MKV and provider HLS CORS are explicit compatibility limits until observed working.
