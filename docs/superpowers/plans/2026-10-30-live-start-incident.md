# LIVE startup incident —2026-10-30

User reports slow start and frequent freezes across all channels. No actual customer stream was opened.

Confirmed defect: the playback watchdog returned forever while start awaited an optional engine import or recovery authorization. The existing30s startup budget therefore never fired in those cases. Fix expires that async generation at the existing bound and follows the existing single-connection cleanup, fresh authorization and retry policy; late results cannot attach. EPG/favorite renders do not restart the engine.

RED observed with blocked HLS import; final53/53 focused UI/session/recovery tests and TypeScript pass.48/48 specialized release guard cases pass. UI, deadlines, provider policy and APK remain unchanged.

Independent edge read-only SSH inspection87.76.130.17: load0.06, availableRAM7346MiB,11GiBfree, geoproxy running80/443;7TCP connections observed, maxRTT64.8ms and0retransmits. Public TLS/root returned expected400 in257ms. This excludes current resource pressure, not intermittent provider/network faults. No server restart or OS/network setting changes made. All-channel user symptom is broader than the isolated reproducible client bug; end-user playback still needs observation after rollout.

Deployment pending.
