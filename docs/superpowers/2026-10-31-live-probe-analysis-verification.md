# Operator-only input analysis measurement — 31 October 2026

## Scope and provenance

The parent approved synthetic-only offline measurements. No provider media, network request, account creation, database operation, edge file or production service configuration was used or changed by this subtask. The deployed client/API code and release guards remain unchanged. Only the operator argument list, its regression test and operator documentation are proposed for review; no commit or rollout was performed.

Read-only inspection of the accepted API image `sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6` found:

- Portable binary `/app/node_modules/ffmpeg-static/ffmpeg`: ffmpeg 7.0.2-static, package `ffmpeg-static` 5.3.0, 79,826,272 bytes, SHA-256 `e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99`.
- `/usr/bin/ffmpeg`: dynamic ffmpeg 8.1.2, 411,792 bytes; it is not the portable-copy candidate.
- The edge's ordinary PATH did not contain ffmpeg at the observation. No binary was copied there.
- Static 7.0.2's own help reports `probesize` default 5,000,000, `analyzeduration` default 0/automatic and `fpsprobesize` default -1. Those defaults alone do not prove a fixed wall-clock delay.

The runnable local binary was the parent's already verified `imageio-ffmpeg` 0.6.0 wheel binary at `/tmp/flixify-live-ffmpeg-verified/ffmpeg`, ffmpeg 7.1, SHA-256 `6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617`. No dependency or software was downloaded during this subtask.

## Synthetic measurement

A temporary locally generated twelve-second MPEG-TS fixture contained H.264 160×90 at 25 FPS, GOP 50, AAC audio and 400 kbit/s constant mux rate. It was 601,036 bytes, SHA-256 `822861490b828add2ca5ca945eb412d2bcaf13f0e36013a5bddd3779228a8cde`. The fixture was paced into a pipe at 50,000 bytes/second, once from the beginning and once after skipping 39,856 bytes to join inside a GOP. Both generation passes produced the same fixture digest; temporary fixture files were removed.

Each case/profile below was measured once. Elapsed time includes decoder process startup and exit after emitting one real decoded video frame. There is no HTTP/TLS/authentication or browser rendering in this fixture.

| Input options | From stream start | Mid-GOP join |
| --- | ---: | ---: |
| Existing defaults | 5,160 ms | 5,092 ms |
| 500 ms analysis + 1 MiB probe size | 660 ms | 1,708 ms |
| 1 s analysis + 1 MiB probe size | 1,183 ms | 1,690 ms |
| **1 s analysis only** | **1,162 ms** | **1,668 ms** |

All eight invocations exited 0 and emitted one decoded video frame. Mid-GOP input naturally produced missing-initial-parameter decoder diagnostics before the next keyframe; every profile still emitted a frame and none reported the specific insufficient-codec-parameters warning. These are bounded synthetic observations, not statistical performance claims or a guarantee across codecs and provider conditions.

The single input option `-analyzeduration 1000000` captures the observed improvement without changing the default probe-size limit or dropping analyzed packets. No `nobuffer` flag, hardware-decoder change or shortened network/decode deadline was introduced. This changes operator scanning overhead only, not the website/APK player or its first-picture measurements.

## Regression and limits

The new argument-placement regression was observed RED because the existing command contained zero analysis options. After adding the one input option before `-i`, all 21 operator tests passed. Tests require exactly one 1,000,000 µs analysis option, the original 15-second deadline and `rw_timeout`, one decoded frame, no invented HTTP status, the original probe-size behavior, and no packet-dropping flag. Existing same-line lock, HTTPS, bounded output, two-format 404/410/control proofs, event-only protection and transient-response tests remain green; 503 was added to the explicit non-exclusion cases.

Evidence is in `/tmp/flixify-live-probe-analysis-bench.json`, `/tmp/flixify-live-probe-analysis-single-flag.json`, `/tmp/flixify-live-audit-analysis-red.log` and `/tmp/flixify-live-audit-analysis-green.log`. The Linux 7.0.2 binary's option support was inspected, but its live-provider timing was not measured. A separately authorized, idle dedicated line is still required before broader media scanning. Existing channel 125/145/390 observations of repeated TS timeouts and HLS 503 remain unverified; this optimization does not reinterpret those results or produce an exclusion.
