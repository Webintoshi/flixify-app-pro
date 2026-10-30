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

Deployed frozen application revision`996d4e434e47cb1e22cd936a406f2fc7e95a1052`; tag`flixify-ops-web:edge-recovery-996d4e434e47-20261026`; immutable image`sha256:bd2e42822516acedabd2480e5d85a1cb524c86097269df9069d375b8c4a185ca`. Candidate ID was read from owned verified artifact at`/tmp/flixify-live-reliability-996d4e434e47.candidate`; release record is`.released`. Bounded offline compile, unchanged public/native tree, source/config/ancestry checks, dry run, image sync and web-only recreate passed. Independent postcheck: web/API/worker/DB running, protected images and restart counts unchanged, all restart counts0.

Rollback retained: tag66930da3835c/imagef7f38e513b8cdf21b8a10983fc7c2ce12f792562dd7a0f87168ff486dca4ab38.

Owned local HLS fixture was stopped/closed; it used only public Apple sample and existing installed hls.js. No customer line was opened. End-user playback improvement and provider-side configuration remain unverified; do not claim all channels are fixed. Provider login request remains pending.
