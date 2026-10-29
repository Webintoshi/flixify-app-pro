# Flixify Pro1.3.2 verification

## Bounded correction

The user's existing native movie/series player loses only its redundant on-screen play/pause, rewind, forward and Back actions. Their complete transport/caption row is GONE, avoiding an empty44dp strip. LIVE retains that row. Timeline, elapsed/remaining time, tracks, favorite, manual episode picker, next episode, automatic continuation, original colors, sound and playback/access/network policies remain.

Known-duration VOD focus defaults to the enabled timeline. Unknown-duration or fatal VOD uses the existing player root, with a generated focus ID. OK on timeline/root toggles playback; Up from root reaches enabled utilities and Down returns. Utility OK keeps its original action. Countdown exit/cancel/return and failure focus never target a removed icon. Existing media-key and Back logic remains.

Native source frozen at `58261f21adf3a92646725ef408f0594a183ffcee`; PlayerActivity SHA256`02ad6b35834e5cbac5eef17df96afacbff2944b3fe386adc25d61f2ac3e81775`. Only PlayerActivity changed native runtime behavior. No engine, policy, repository, catalog, resources, signup, API, worker, bot, provider, proxy or DNS edits.

## Behavioral and visual evidence

Initial RED exposed three VOD failures (icons still shown, old default focus, fatal focus); LIVE preservation passed. A further RED caught the unknown-duration fallback opening subtitles instead of resuming. The final fallback uses the player root. Back assertions wait for the actual Activity destruction instead of assuming its asynchronous transition has completed.

All49PlayerRemoteTest cases passed with the offline repository/engine (208.3s native;3m47s Gradle). Full XML has49tests/0failures/0errors/0skipped, preserved in `/tmp/flixify-tv-vod-full-player-results`. The expanded single unknown-duration case separately passed both0and-1 (4.434s), in `/tmp/flixify-tv-vod-unknown-final-results`. These are separate runs, not a fabricated larger single run. Logs `/tmp/flixify-tv-vod-transport-{red,full-player}.log` and `flixify-tv-vod-unknown-duration-final.log`.

Independent review identified the same unknown-duration issue and confirmed the fix, hidden-control focus graph, utility OK, failure/Back, countdown and LIVE preservation. Ten actual native screenshots inspected: movie, series, episode panel, LIVE player and LIVE guide at1920x1080/density320/font1.0 and1280x720/density320/font1.3. Both profile runs passed (19.036s/17.065s); display/font overrides reset. Evidence and source/image hashes: task visualization directory `android-tv/pro132/capture-manifest.json`. Root independently viewed normal series and compact movie frames. Ignored gallery source/assets are invocation-local AndroidTest inputs only; no production fixture hooks/assets. No customer/provider media connection was opened.

Normal release script, without the gallery init script, passed unit/lint/optimized assembly in47s. Unit XML:31tests/0failures/0errors. Release lint:0errors/40existing warnings (programmatic native UI/metadata/RTL/hardcoded text); Gradle retains its existing deprecation notice. Snapshot `/tmp/flixify-pro-132-final-native-results`; build log `/tmp/flixify-pro-132-build.log`. Web TypeScript exited0, log `/tmp/flixify-pro-132-web-tsc.log`.

UI delivery checks PASS: original visual direction/palette/type/icons retained; no invented product content or new assets; real utility/media/focus behavior covered by49cases; both actual screen profiles fit; only the redundant transport row removed. The gallery's explicitly named Örnek content is isolated fixture data, not a provider playback claim.

## Stable compatible artifact

Package`vip.flixify.tv`, launcher label**Flixify Pro**, version**1.3.2**, code**7**, minAPI23/target35/compile36. No architecture-specific native libraries and not debuggable. Existing signer certificateSHA256`158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594`; apksigner verified v1/v2. Original poster WAVSHA256`3e96335f0f9e74b2975b274306e0748a7d8314ee819667073086141e0c713bea` is present unchanged. Optimized archive contains no gallery/sampleMP4/fixture identifiers or repository/engine injection hooks.

Immutable new file`apps/ops-web/public/downloads/flixify-pro-1.3.2.apk`, mode644,1,321,719bytes, SHA256`3472dd34ab96c121310f55ef9380af5cdf14899cf1bfc1ec458411f7bcd36c86`. Artifact commit`f35c4c227787cc3cb7c6ca35e62b19fec2aaee7e`. Evidence `/tmp/flixify-pro-132-{apk-verification.json,signing.log,badging.log}`. The local verifier initially expected a legacy aapt field name; it was corrected to this installed aapt2's actual `minSdkVersion`, then all checks passed before copying the file.

Actual `adb install -r` over1.3.1-test.1/code6 succeeded without uninstall. `firstInstallTime` remained2026-10-27 22:50:01; new installed version7/1.3.2. Signed cold launch Statusok/596ms, no AndroidRuntime fatal for the new process. Actual login screenshot`android-tv/pro132/signed-release-launch.png`. No login or provider stream test. This emulator proof does not assert every physical-TV codec works or measure provider startup. Upgrade/launch/runtime evidence `/tmp/flixify-pro-132-{upgrade-before.json,upgrade-after.json,launch.log,runtime.log}`.

## Publication controls

Exact existing website changes are descriptor filename/version, homepage test-status wording and three download-page wording replacements. No website player/layout/color changes. All prior public files/modes/link targets must remain identical; only the new APK may be added. Pre-release web tag`flixify-ops-web:edge-recovery-4d7cb2940197-20261026`, authoritative image`sha256:e83c21103c3cb8d21b36cf148eaca873c41c21d81caa044944691cf527a0cc21`.

The first production preflight correctly stopped: an earlier handoff and verification docs transcribed that image ID incorrectly with63hex digits. Docker's current tagged image, running container image, initial read-only snapshot and prior successful candidate file all matched the corrected64digit ID and revision4d7cb294. Exact-pin tests observed two failures before correction, then40/40passed; a full64digit shape check was added. Historical audit docs were corrected too. APK/native source bytes did not change. Corrected publication source`6491e529c6d070d0b100481ba6495a71bf7f4fc7` pushed/fetched; full source/version/artifact/public-tree production preflight then passed. Four untracked Python cache directories in the old release checkout were preserved; tracked files were clean and no reset/delete was used.

The wrapper retains the8GiB build floor,1280MiBmemory/1536MiBtotal cgroup limits, network-none compiler, isolated APK HEAD/MIME/range/fullGET validation, exact image/config/ancestry/public-tree verification and web-only rollback/recreate guard. Fresh40new release contracts passed after correction; root then reran all15release test scripts:305/305passed. Log `/tmp/flixify-pro-132-release-guards.log`.

## Production acceptance

Bounded network-none candidate build exited0; actual cgroup bounds, exact source/config/runtime/ancestry, complete old public tree plus only the pinned new APK, and private APK HEAD/MIME/range/fullGET all passed. Candidate`sha256:84942fb59d00e681d4edef6258693da502dfc988ae9da4c25e50d011c9a2e4e5`, tag`flixify-ops-web:edge-recovery-6491e529c6d0-20261026`. Remote evidence prefix`/tmp/flixify-pro-132-6491e52`: `.start`, `.result`0, `.log`, `.candidate`, `.release-args.json` and three release logs.

Release dry run passed with only web changing. Exact Coolify web-image metadata sync then scoped web recreation passed with healthy/stability checks. Candidate was read from the verified marker/file and matched the frozen start revision; it was not retyped into release commands. Independent post-read matched the new web image/ref and all four services running/restart0. API, worker and DB retained their exact container IDs, image IDs, image references and restart counts from the initial snapshot. No owned build/download-check containers remained;15.88GiB free. Detailed server evidence `.production-acceptance.json`; no cache cleanup, unrelated image deletion or service/daemon restart this turn.

Public HEAD200 with correct1,321,719length and Android APK MIME; range0-31returned206/exactContent-Range/32bytes; public full GET200 matched the exact APK SHA256 above. `/` and `/indir` HTTP200; download page contains Flixify Pro,1.3.2 and the new immutable link with no old test wording. The first HTTP probe incorrectly expected the client-rendered homepage APK link in raw SSR HTML; actual hydrated browser home instead verified the new href and visible Flixify Pro notice. No application change was needed for that probe assumption. Final HTTP evidence `/tmp/flixify-pro-132-public-http.json`.

Actual retained browser download page visibly shows Flixify Pro/1.3.2 and its new link. Clicking Android TV APK indir produced a completed download event. Actual screenshot`android-tv/pro132/public-download.png` was captured and inspected; home/download tabs retained for the user. No account preferences/favorites were changed. The owned emulator was closed and `adb devices` confirmed none attached. Final source-only verification docs are committed separately from the deployed6491e52image.
