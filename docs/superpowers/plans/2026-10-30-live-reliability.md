# Single-device LIVE reliability follow-up —2026-10-30

User confirms only one device is open. Parallel-use hypothesis is excluded by that report; current browser tab had no playing video, so no customer's actual stream was opened or observed.

## Confirmed defects and final implementation

1. `playback()` and the60s metadata check both force fresh bootstrap. Overlapping calls used to advance bootstrapSequence independently, rejecting an otherwise valid older playback response. RED reproduced both call orderings. Forced calls now share an already-forced in-flight request; a cached/nonforced request cannot replace a fresh authorization. clear/generation/identity/deadline checks remain authoritative. Failed shared authorization clears so a subsequent fresh request can succeed.
2. HLS fatal media errors called in-place recovery without a limit. First repair retains the exact library behavior; repeated fatal errors in that engine use the existing bounded reconnect, or show existing manual retry when already paused. Other play failures are no longer swallowed while declaring live. NotAllowedError and interrupted AbortError preserve manual fallback instead of launching an autoplay-policy reconnect loop. No buffers, grace periods, codecs, transport/source or UI changes.

## Evidence and limits

- Root used installed hls.js1.6.15 with Apple's official public Bip Bop sample, no autoplay attribute, in a local-only fixture. Normal real `recoverMediaError()` resumed by itself in877ms and continued advancing; user pause remained paused after recovery. Thus the initial fake paused-reset hypothesis and explicit replay changes were discarded. This is no claim about the customer's actual failure.
- Primary references: [HLS1.6.15 recovery API](https://github.com/video-dev/hls.js/blob/v1.6.15/docs/API.md#fatal-error-recovery), [Apple public example](https://developer.apple.com/streaming/examples/advanced-stream-hevc.html).
- Nine rendered React test files99/99pass; Node policies82/82 and personal adapter/integration45/45pass. TypeScript passes. Independent review: no blocker.18release guard suites452/452pass. Test output lives under `/tmp/flixify-live-reliability-*.log`.
- Full repository npm test was attempted by the provider worker: contracts and202API cases passed; six API suites (`auth-register`, `iptv`, `live-catalog`, `live-logo-route`, `auto-trial-registration`, `live-logo`) could not load because required local test environment variables including DATABASE_URL/APP_JWT_SECRET were absent. Worker stage did not execute. These backend files were not changed; no backend test-completion claim is made. Log `/tmp/flixify-bootstrap-npm-test.log`.
- Provider panel is logged out behind username/password/CAPTCHA. User was asked to sign in, without sharing credentials. Provider-side live routing/configuration remains unverified pending access.
- No new telemetry, customer stream, provider account mutation, OS/network change, native APK, public asset or backend change.

## Rollout

Pending: current protected source imagef7f38e513b8cdf21b8a10983fc7c2ce12f792562dd7a0f87168ff486dca4ab38/tag66930da3835c, app66930da3835c5c9030c139117b4b12c78455d78c. New candidate must be built and released using the live-reliability wrappers and its owned verified artifact.
