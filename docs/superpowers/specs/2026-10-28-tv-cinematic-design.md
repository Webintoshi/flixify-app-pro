# Android TV cinematic update

## Intent and authorization

User installed the universal APK on their actual TV and reports it works without errors. They request a responsive premium theme/player, automatic next episode and faster live startup. They selected “Sinematik tasarım; detayları sana bırakıyorum”. Retain native Java Views/Media3, Android 6+, one universal APK, existing code login, colors, remote navigation, access expiry and personal direct provider networking.

## Approaches

1. Polish the current grid: smaller navigation risk but little visual change.
2. Cinematic native UI: artwork-led catalog/detail, responsive grid and modern player. Recommended and selected direction; builder owns details.
3. Live-first dashboard: deprioritizes films/series without evidence that this suits the request.

## Experience

Keep the existing TV palette (#07090c, #13171e, #ff3545, #f5f6f8, #a7b0be). Use measured usable bounds, bounded overscan padding, readable text, consistent artwork aspect ratios and clearly different selected/focused states. A restrained rail, artwork hero on home and artwork-rich details supply the cinematic direction. Real metadata only; no invented ratings, year, quality or popularity. Keep catalog virtualization, missing-artwork fallbacks and logical focus/Back restoration. Login, account and long Turkish text must also fit. Handle both width and height changes, including IME.

Player: dark gradient, title and episode information, real seekable progress bar, transport controls and a separate secondary actions row/options surface so every action fits. Keep audio/subtitles, live zapping, media keys, pause visibility, Back behavior and two-second playing autohide. Do not show technical recovery messages. At actual episode end, show a five-second next-episode countdown with “Şimdi izle” and “İptal”; no automatic credits skip. Cancellation is latched for the selected episode across engine recreation. Unknown duration/final episode/movie/live never auto advance. A switch releases the prior engine before admission/prepare. Guard duplicate ENDED callbacks, stale callbacks, source changes, expired access and leaving/backgrounding. Save the current selected item/state for recreation.

## Live delay evidence and change

Every current play forces bootstrap and a full provider catalog download; EPG also blocks the only worker. Keep authoritative pre-play bootstrap, resolve LIVE against the verified scoped cache, with cold cache/unknown ID handled safely. Separate optional EPG network I/O from the serialized auth/bootstrap lane without concurrent token rotation; preserve generation/scope/absolute expiry checks on results. Do not guess buffer sizes. Distinguish initial startup from a stalled established playback so a still-buffering valid first start is not recycled every 12 seconds. Use real first-frame signal and bounded startup handling; synthetic timings do not claim physical-TV latency.

## Verification and delivery

Meaningful failing regressions before behavioral fixes, existing unit/instrumentation suite, real local Media3 file and first frame, responsive bounds/font/remote tests and actual emulator screenshots. No real provider stream or customer mutation in automated testing. Test logical widths/heights, not just pixel resolutions. Do not claim every firmware/codec or “100% all devices” verified.

Publish a newly versioned signed test APK (same package/certificate, higher versionCode) through existing /indir/home links, retaining previous APK. Production release follows existing source-pinned web-only bounded build; no API/worker/bot/DB/Edge/DNS/provider changes or cleanup of unrelated data. Release requires fresh signature/hash, install, MIME/range/full GET and link verification. Existing release remains until the candidate passes.
