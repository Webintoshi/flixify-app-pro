# LIVE startup incident —2026-10-30

User reports slow start and frequent freezes across all channels. No actual customer stream was opened.

Confirmed defect: the playback watchdog returned forever while start awaited an optional engine import or recovery authorization. The existing30s startup budget therefore never fired in those cases. Fix expires that async generation at the existing bound and follows the existing single-connection cleanup, fresh authorization and retry policy; late results cannot attach. EPG/favorite renders do not restart the engine.

RED observed with blocked HLS import; final53/53 focused UI/session/recovery tests and TypeScript pass.48/48 specialized release guard cases pass. UI, deadlines, provider policy and APK remain unchanged.

Independent edge read-only SSH inspection87.76.130.17: load0.06, availableRAM7346MiB,11GiBfree, geoproxy running80/443;7TCP connections observed, maxRTT64.8ms and0retransmits. Public TLS/root returned expected400 in257ms. This excludes current resource pressure, not intermittent provider/network faults. No server restart or OS/network setting changes made. All-channel user symptom is broader than the isolated reproducible client bug; end-user playback still needs observation after rollout.

## Deployed acceptance

Frozenapprevision`66930da3835c5c9030c139117b4b12c78455d78c`; tag`flixify-ops-web:edge-recovery-66930da3835c-20261026`; image`sha256:f7f38e513b8cdf21b8a10983fc7c2ce12f792562dd7a0f87168ff486dca4ab38`. Candidate ID read from owned build artifact; network-disabled bounded compiler, public-tree/ancestry/config verification, release dry run, image sync and web-only recreate passed. Independent postcheck confirms API/worker/DB exact image IDs and restart counts unchanged, all running. Web restart count0.

Rollback image58b46c80e4579be67f8adfe2666d835f533d616ab57f7ce3ed9ac98215992afd/tag5f8014386833 retained. No actual IPTV stream was opened, no provider/OS/network changes made. End-user confirmation remains pending; do not claim all-channel startup or freezing is resolved. Ten-minute requested window was exceeded during build/release; confirmed client defect was isolated within that first window.

