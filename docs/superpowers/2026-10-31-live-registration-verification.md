# 31 October: registration and live channel verification

## Source acceptance

The user confirmed two registrations per IP across all time, plus one per retained device/browser installation identity. Existing accounts and three-hour trials remain valid. New ledgers use a dedicated stable HMAC key initially copied internally from the existing JWT key; later JWT rotation does not reset the ledgers. Browser storage/profile resets remain an identity limitation, not physical hardware attestation.

Root ran all 353 API tests successfully after observing the policy route regression fail before implementation. The helper's real PostgreSQL fixture passed ten scenarios, including concurrent eight-device/same-IP requests committing exactly two accounts, same-device/different-IP requests committing once, transactional rollback, retained deleted identities and non-expiring counters. The three exact fixture inputs are pinned in the task evidence; no production database or customer/provider account was used.

The exact exported migration runner passed six real PostgreSQL scenarios in a separate network-isolated fixture: both migration files and two markers commit atomically; exact replay succeeds without recreating table002; source/schema drift and unmarked target tables are rejected; a forced second-migration error rolls back all new schema and markers while retaining original users. The first fixture run started before Docker's final TCP database listener was ready; a diagnostic run identified the fixture readiness boundary, and the original unmodified runner passed after the fixture waited explicitly on TCP. No speculative SQL change was applied.

Root independently passed 24 builder, 13 release and 20 channel-operator tests. Real read-only Coolify preview proved existing `.env` bytes plus exactly one new encrypted stable-key row/line, and literal quoting with dollar signs, quotes and backslashes. Actual production source overlays were reviewed: referral, billing, playback and existing proxy validation are retained; only the intended registration and policy changes are applied. The existing 79 API type diagnostics are unchanged; no new helper diagnostics remain. Web type checks passed separately.

## Observed media delivery

The historical shared/reference line returns HTTP401 and cannot support channel deletion decisions. An owned active idle line reported zero active connections and permits one stream. Its live catalog contains 15,800 rows, including 897 names beginning TR; all omit a container extension. Metadata returned in approximately 1.1 seconds. No new provider line was created.

The current default HLS path on ATV90 failed to load its manifest in the browser after approximately10.5 seconds, without a displayed frame. An independent secure manifest request returned200 after10.397 seconds, with a ten-second target duration and one segment; KanalD102's manifest took3.249 seconds. Requests remained HTTPS through the configured edge and allowed the site origin. This isolates a pre-frame HLS delivery delay; it does not establish every viewer's delay.

With the repository's unchanged MPEG-TS playback profile and one stream at a time, actual browser frame callbacks recorded first displayed frames at1,448.2 ms (ATV90),1,610.8 ms (previously unopened ShowTV98) and1,621.4 ms (beIN283). The latter two reported no dropped frames/errors during their short checks, with1080p25/50FPS respectively. The first ATV HLS/TS comparison may benefit from a warmed source; the independent ShowTV sample avoids that particular ordering. These are source-to-frame measurements, not production click-to-authorized-play or physical-TV measurements. No universal network/provider latency bound is asserted.

The transport change therefore uses TS for absent/empty LIVE formats when the actual MPEG-TS engine supports live playback, retains HLS on native-only/no-MSE browsers, and preserves valid explicitly declared formats. Media3 defaults missing LIVE formats to TS. Existing UI, colors, sounds, access/expiry checks, player buffer configuration and recovery budgets are retained.

## Publication and channel cleanup

Pending guarded deployment, signed APK acceptance, production click measurement and actual channel scan coverage. The operator never treats401/403/429, timeouts, network failures or a stale HLS segment as a globally dead channel. Automatic exclusions require repeated top-level404/410 in both TS and HLS with working controls in each format; event-only channels require review. Raw provider records and favorite identities are retained. Do not claim the whole15,800-channel catalog is clean from a partial cohort.
