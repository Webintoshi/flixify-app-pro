# Actual playback attempt / origin outage —2026-10-30

User reported996fix still slow/freezing, signed into provider panel, and then explicitly authorized one real channel test after closing their other device. No parallel probe/media request was opened.

## Read-only provider checks

- Current VPS card:87.76.130.17 / edge.flixify.vip, online,6cores,0%CPU,7%RAM563/7936MB,0connections at observation. Only this current VPS listed; no restart/edit/delete applied.
- Active app account expires26Nov2026; matched current provider line4442 expiry2026-11-26. Line has Private CDN andEPG enabled, max_connections1, future expiry. No form value or subscription changed. Another legacy paid line2739 lacks CDN, but was not assumed to be the affected account and was not touched.
- Connections page was read passively with identifiers/credentials/IP redacted. A prior4442session reported Windows UA and series content; user subsequently confirmed their other player was closed.

## One authorized attempt

- Chose Atv HD in existing authenticated production tab10. At+343ms no video element yet, UI preparing. By+23.861s there was still NOvideo/LiveVideo, with generic LIVE startup error and EPG error. Console/warnings empty. No media resource/first frame was reached. Closed selected player afterward, confirming zero videos/player shell.
- The code path and shared bootstrap strongly implicate the pre-media API authorization path, but browser ResourceTiming is unavailable in CUA read-only scope and exact HTTP response/status of that authenticated request was not captured. Do not invent timings beyond those wall-clock samples.

## Concurrent current infrastructure evidence

- Coolify /terminal returned500 with `php_network_getaddresses: getaddrinfo for coolify-redis failed: Try again`.
- From the Mac: https://api.flixify.vip/health TLS connect timeout at5s; subsequent https://flixify.vip/canli-tv TLS handshake timeout at10s; SSH to87.76.130.252 timed out waiting for banner at5s, before authentication. No key/password failure was diagnosed.
- DNS resolves flixify.vip, api.flixify.vip, coolify.flixify.vip to87.76.130.252; edge.flixify.vip to87.76.130.17.
- Read-only SSH to edge17 still worked with negligible load. From that independent Turkey host, HTTPS root requests to all three origin domains timed out at6.1s and SSH252banner timed out at5.01s. SSH17was closed afterward. This confirms current origin accessibility failure from two locations, separate from the healthy edge host; exact OS/resource/Docker cause remains unknown without console.
- Existing local ~/.ssh/coolify_host_key referenced by scripts/ssh-server.mjs is not present; ssh-agent has no identities. Unrelated Hetzner key was not the issue in the252attempt because server never sent its SSH banner. No credential/key/security setting changed.

## Access required

Opened Verisunucu customer panel; it is at login. User was asked to sign in for out-of-band console access to active87.76.130.252. Historical product3931 link is NOT a verified IP mapping and must be inspected before any action. Suspended191.44.68.37/expired191.44.68.249 remain out of scope. No reboot/host-wide/DNS mutation has been performed.

Current production source remains996d4e434e47cb1e22cd936a406f2fc7e95a1052 / imagebd2e42822516acedabd2480e5d85a1cb524c86097269df9069d375b8c4a185ca. No new application change is justified by this infrastructure failure.
