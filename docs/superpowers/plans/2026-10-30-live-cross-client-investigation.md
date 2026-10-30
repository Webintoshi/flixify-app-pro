# LIVE cross-client investigation — 30 October 2026

The user reports both persistent low smoothness and intermittent freezes in LIVE playback in the Android TV app and website; movies and series work normally. This investigation therefore moved to the shared LIVE delivery path. No native APK patch, application deployment, provider setting, CDN setting or player-buffer configuration was changed during the measurements below. End-to-end resolution is not yet established.

## Scope and shared path

Both personal-provider clients construct `/live/<personal credentials>/<verified channel ID>.<provider extension>` from the same verified HTTPS provider origin. Missing LIVE extensions default to `m3u8` in both clients. Private CDN routing is performed by the provider; the old Flixify server-side live relay/transcode pipeline is bypassed in personal mode. GeoProxy's implementation and configuration are not in this repository.

The affected provider line permits one simultaneous connection. Measurements were intended to be sequential, with only the parent's diagnostic browser opening media. The later provider-session evidence below showed that the initial assumption that the TV connection was closed was not reliable. Usernames, credentials, source URLs, signed media paths and client IP values are deliberately omitted from this record.

## Measurement cohorts

### Initial diagnostic fixture: instrumentation contamination

The local diagnostic used the installed HLS.js 1.6.15. Initial samples showed approximately 50 FPS and zero dropped frames, followed by playlist load failures. However, the fixture also produced internal exceptions involving a detached `ArrayBuffer`: its optional capture callback attempted to read a payload already transferred to the transmux worker. The isolated diagnostic was corrected to copy the existing payload before transfer without fetching another fragment. This was not an application or production change, and the contaminated run is not treated as a clean demonstration of the delivery failure.

### Clean second HLS.js run: real network failure repeated

After correcting the diagnostic, a second run initially played normally: the sample at about 132 seconds showed 1920×1080 at 50 FPS. The captured MPEG-TS fragment's aggregate bitrate was approximately 8.45 Mbit/s. Roughly 10 MB segments loaded in about 0.9 seconds, and a sampled playlist returned HTTP 200 in about 240 ms. These are individual successful samples, not a claim about every request.

The run started at **20:34:10.048 UTC+03:00**, equivalent to **17:34:10.048 UTC**. Its first recorded playlist reload `levelLoadError` with status 0 occurred at elapsed **440632 ms**, or **17:41:30.680 UTC**; further failed attempts followed. A fatal playlist failure was recorded at elapsed **462054 ms**, or **17:41:52.102 UTC**. An actual HTTP response status was not captured for those failed requests; status 0 does not distinguish a transport failure from a browser CORS rejection or establish an upstream HTTP error code. This clean run reproduced the network failure after the fixture's internal exceptions were fixed.

### Provider LIVE-table evidence during that failure

The parent filtered the provider's LIVE connection table by the exact username of the measured line. The visible row identified an **Android 11 / Dalvik** client on a **different channel**, reported as VIP BEINSPORT 1 (MAÇ ZAMANI). Its displayed client IP did not match the edge host. No IP or username was printed or stored here.

The diagnostic browser's observed navigator identified **Chrome 156 / MacIntel**; it was measuring BEINSPORT 1 FHD 7/24, not the channel shown for that Android row. A boolean-only scan found neither Android nor Dalvik strings in the GeoProxy binary; that negative string search does not prove the proxy can never rewrite a user agent. The stronger evidence is the mismatched channel/client row and the subsequent state transition.

The user was explicitly asked to fully exit the TV application using Back and confirmed doing so. The same filtered provider table then immediately showed **zero rows**. This supports a competing TV connection on the one-connection line during the previous measurement. It does not establish the exact TV lifecycle action that had kept that connection active, nor does it by itself prove that every earlier freeze or smoothness complaint had the same cause.

### New measurement after verified TV exit: completed bounded check

The parent started a new sole-browser HLS.js measurement directly from the source already held for the test. No initial production-player handshake was opened for this run.

At elapsed **62.881 seconds**, the provider table showed the diagnostic's own matching **Chrome / Mac** row and **BEINSPORT 1 FHD 7/24** channel. First-frame time was **2229 ms**; the diagnostic reported approximately **50 FPS**, **3031 total frames**, **0 dropped frames**, **0 errors**, and approximately **29.5 seconds of media buffered ahead**.

The final sample was at **516.881 seconds (8 minutes 36.881 seconds)**: approximately **50 FPS**, **25731 total video frames**, **1 dropped frame**, **0 corrupted frames**, **0 recorded HLS errors**, and **25.493 seconds buffered ahead**. Playback remained active and not ended. The provider table still showed only the matching Chrome/Mac channel, with session duration 00:08:37 and no Android client. This run exceeded the prior run's first error time (440.632 seconds) and fatal error time (462.054 seconds).

Stopped the diagnostic and confirmed the video source attribute was removed. No test media connection was intentionally left open. The sanitized final observation is `/tmp/flixify-live-hls-single-client-20261030.json`; the prior failed run is `/tmp/flixify-live-hls-confirmed-20261030.json`. These temporary artifacts contain derived scalar measurements, not provider credentials or signed source URLs.

The checked player was HLS.js in a Mac/Chrome diagnostic, using the same provider LIVE source. It was not a physical-TV FPS measurement or a complete website-native-player verification. The result supports eliminating the competing TV connection before changing playback code; it does not prove all LIVE playback, every device's display cadence or every intermittent freeze is fixed.

## Captured source fragment

Offline examination of a captured 10-second fragment reported H.264, **1920×1080 progressive**, frame rate **50/1**, **500 frames in 10 seconds**, approximately **8.447 Mbit/s aggregate MPEG-TS bitrate**, and approximately **130 kbit/s AAC audio**. Hashing the decoded frames after downscaling to 160×90 grayscale produced **500 unique hashes**, with no exactly duplicated adjacent frame in that representation. This does not establish the original camera cadence or exclude interpolation or small differences introduced by re-encoding. ffprobe emitted one initial buffering-period/SPS-reference warning while still decoding all 500 frames. The result covers this fragment only and is not a guarantee about the entire live source, rendering on every device, or later delivery continuity.

## Passive edge transport cohort and its time boundary

The release-audit agent sampled only existing GeoProxy sockets, process statistics and interface counters through an already established SSH control connection. It opened no media or HTTP requests, created no new login, made no server changes and stopped after 120 seconds.

The passive interval was **17:38:50.489–17:40:50.490 UTC**, with 80 samples. It ended approximately **40.190 seconds before** the clean second run's first recorded playlist error at 17:41:30.680 UTC. The zero observed retransmissions in this earlier interval must not be presented as a measurement of the later failed request.

- Observed TCP retransmission delta: viewer 0, upstream 0. Maximum sampled RTT: viewer 64.817 ms, upstream 64.422 ms.
- Maximum viewer send queue: 3,766,676 bytes; queue duration was not recorded. Maximum sampled upstream send queue: 0.
- All-nonloopback interface delta: RX 138,028,001 bytes, TX 134,445,041 bytes, RX dropped 63, RX errors 0, TX errors 0, TX dropped 0. These counters cover aggregate interface traffic and do not attribute the RX drops to the measured stream.
- Maximum GeoProxy CPU: 5.265% of one core. Maximum RSS: 14.121 MiB. No sampler read errors occurred.
- Only six upstream socket-observations were captured because segment transfers could finish between the 1.5-second samples. Closed-socket retransmissions could be missed; host-visible sockets and aggregate interface counters cannot exclude every short transport failure.

The local, sanitized observation artifact is `/tmp/flixify-edge-passive-20261030.jsonl`. It contains UTC aggregate metrics, not source URLs, process arguments, environments or remote IPs. It is an ephemeral local artifact and is not required to remain available after this investigation.

## Current conclusion and remaining validation

There is direct evidence that the previous supposedly sole-client measurement overlapped a TV connection on the same one-connection line. Fully exiting that TV client removed its provider row, and the next measurement's provider row matched the diagnostic browser and channel. The captured source fragment and early sole-client samples showed real 50 FPS without recorded dropped frames.

The completed single-client measurement remained healthy beyond the earlier failure time. No native playback, buffer, codec, provider or GeoProxy change was justified by a demonstrated FPS cap or decoder frame-loss defect. The competing-session evidence is relevant to the one-connection limit, but the provider did not expose an explicit eviction reason for the earlier failed HTTP requests; causality for every earlier freeze remains unproven.

The current Android code only calls `player.pause()` for manual pause, whereas leaving the player releases its engine in `onStop()`. A paused LIVE player can retain its loading/session work. When moving between devices on this subscription, return from the TV player to the channel list, or close the website player, so that the old engine releases its connection. No connection limit, authentication, subscription, APK or website behavior was changed in this investigation.
