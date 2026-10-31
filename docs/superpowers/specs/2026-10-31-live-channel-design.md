# Live channel availability and startup

The user reports 30–40-second starts and unavailable channels across clients, requests only working channels and a maximum three-second first picture. Measure click-to-bootstrap, media redirects/manifest/fragments and decoded/displayed first frame separately. Prior sole-client HLS evidence of 2,229 ms is a useful comparison, not proof of the current site or every channel. Do not shorten authentication or trial expiry checks or blindly change playback buffers.

Current personal-provider catalogs bypass legacy shared health. The old probe's 4xx classification includes geo/auth/rate limits and cannot support safe bulk deletion. Add source-origin-scoped, evidence-backed channel exclusions without deleting raw provider records or favorite identities. Deliver an optional revisioned policy with provider-session metadata; never change sourceVersion to represent health. Apply it to current and cached catalogs, favorites and playback in both web and APK. Keep the last valid policy during a temporary policy read failure.

Use a dedicated idle provider line, one media connection, sequential resumable checks and working control channels. Confirm 404/410 more than once; geo/auth/rate/transport outages must not remove channels globally. Separate HTTP-200-but-undecodable evidence for review. Record exact scan coverage; never claim every channel was checked when only a sample was tested. A 15,800-channel repeated one-connection scan takes hours and cannot be represented as instantaneous.

Target three seconds on measured healthy representative channels and retain smooth playback. Provider response, keyframe/segment production and viewer bandwidth remain measured external constraints; do not promise a universal bound without evidence.
