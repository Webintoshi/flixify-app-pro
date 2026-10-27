# Flixify TV test APK

## Intent and decisions

User requests a simple fast Android TV app, all controls reachable with the remote, one APK for TVs and boxes, published on the existing homepage for testing. They explicitly prefer one common APK and no model-specific builds. Existing colors, signup, trial/subscription rules and production services stay intact.

Builder choices: native Java Android Views plus Media3, minSdk23 (Android6), compile36/target35, package vip.flixify.tv, version1.0.0-test.1/code1. One architecture-independent APK (no packaged native decoder libraries) covers ARM32/64 and x86 TV/box devices. Hardware media-format support still belongs to Android devices; no assertion of universal physical-device codec compatibility. Existing Qt desktop remains intact; its checked-in Android path lacks Android sources and has inaccessible remote controls. WebView wrapping would inherit the desktop navigation and media constraints. The native approach is the one selected by the builder under the user's explicit request to build and publish a working test APK; no additional design approval loop is introduced.

## Experience

Existing16-character account code login, remembered encrypted session. Native left navigation: home, live, films, series, favorites, account. Search and category selection use remote-accessible native controls. Poster grid, visible focus, logical Back path and focus restoration. Series have season/episode selection. Player has pause/play, seek for VOD, previous/next channel for live, next episode, audio/subtitle selection and2-second controls autohide while playing. Remote media keys work. No touchscreen/mouse required, no browser navigation or purchase/signup flow on TV.

## Existing contract and ownership

API stays https://api.flixify.vip. Login/refresh serialize rotating tokens. /me/provider-session supplies verified personal origin/credentials and absolute expiresAt; provider metadata and media are requested by TV directly. Never use native legacy relay endpoints or shared credentials. /me/personal-library stores existing personal favorites and watched episodes. Resume positions are local and scoped by account+sourceVersion. Provider bootstrap refresh every60s, on resume and before playback. Expiry changes update the current cutoff without reloading playback; authoritative denial stops, transient failures preserve access only until confirmed cutoff. Logout/source changes invalidate old responses. Media releases before switching and on stop, preserving single connection limits. No real account, provider or live media is used for automated testing.

Metadata validates exact IDs, root HTTPS provider origin, existing general-audience movie category allowlist, safe extensions/artwork and bounded15s/20MiB/50k rows/5k episodes. Secrets stay out of logs, artwork and APK. AndroidKeyStore encryption for tokens, no provider credentials on disk, backup disabled and plaintext networking disabled. All UI callbacks on main thread; callback generations guard disposed screens/accounts. Catalog work is off UI thread; bounded artwork cache, lazy grid images, no duplicate simultaneous stream.

## Build, test and delivery

Pinned AGP8.13.2/Gradle8.13, Java17, Media3 stable1.11.1, SDK36 local. APK signed with existing local Android test keystore; explicitly a test build, stable signature/version, no keys in repo. Unit tests cover metadata/policy/source/cutoff; isolated instrumentation uses fake repository/local media only and D-pad input. Verify emulator install/start, focus traversal/login/search/category/seasons/favorites/back and player control/cutoff lifecycle. Publish a new versioned APK filename, retain old downloads. Homepage visible to anonymous and signed-in users and /indir installation page link to it. Verify signature, checksum, APK MIME, HEAD/GET/range and actual homepage link in production. No claim of physical TV testing; user will test real TV/box.

Only web is redeployed, source-pinned to current44bd380/ad05c921; protect worker539e01c/d5b9, API8cdbf9, DB721873. Exact APK binary path/hash verified as well as source. No API/worker/bot/Edge/DNS/provider changes, no new lines, no suspended/expired hosts, no broad disk/image/volume cleanup. Finite1280MiB/1536MiB build caps,8GiB disk floor and scoped own build cache cleanup remain required.
