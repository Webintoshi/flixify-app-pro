# Flixify Pro for Windows

The user approved direct implementation, delegated technical choices and requested the quality and features of the current native macOS application. The user selected a design audit after implementation. This document records implementer decisions; it does not create another approval gate.

## Approach and scope

Build a dedicated Windows 10 1809+/11 x64 Qt Quick application in `apps/windows-native`. Reuse the existing dynamically loaded native libVLC integration, not the obsolete Qt API/session/update implementation. Keep the existing Android, native Mac, website, API and worker behavior unchanged. A browser wrapper would reintroduce browser codec limitations; a separate Windows framework would discard working native playback components. Native ARM64 is not claimed for this first release.

Use the original website wordmark/favicon and existing poster navigation sound. Match the Mac palette: background #07090C, panel #13171E, accent #FF3545, primary #F5F6F8, muted #A7B0BE. The desktop window is resizable (default1280x800, minimum900x620), with six navigation destinations, cinematic artwork, landscape contained channel logos and keyboard/pointer controls. The Windows frame follows Windows conventions. No invented logo, statistics or testimonials.

## Feature contract

- Code login, refresh/logout, Windows-protected session storage and source/account-scoped metadata/progress. No bundled account, provider credentials, video or private build/signing material.
- Current `/me/provider-session`, viewer-origin direct provider catalog/media, current personal library and welcome endpoints. Metadata/media requests must originate on the viewer device. Bound and validate untrusted payloads/URLs, cancel obsolete requests, reject stale source/account work and check absolute access expiry before/during playback.
- Logo/spinner startup, bounded disk metadata/artwork caches with stale-while-revalidate, fast cached favorites, complete Turkish search, intersecting categories/countries, virtualized shelves/archive and incremental rendering on scroll.
- Verified2026 home movies/series; movie2026/Marvel/covered-action/fantasy collections; current live naming, exclusions, FHD-preferred deduplication, Turkish order and EPG. Preserve the Mac live-analysis performance improvement.
- Direct poster/channel/search playback. Series resume/first-unwatched selection, manual seasons/episodes, source-scoped resume, watched threshold final5% capped120s, cancellable5s true-end next episode across seasons.
- Bundled stable VLC runtime, hardware decoding and native video surface. Compact controls: favorite, audio/subtitles, volume, allowed timeline, episode/channel switching, fullscreen. Space toggles; arrows seek; Escape closes. Hide controls after2s playing; retain during pause/interaction. Release the old stream before opening another. Quiet recovery is bounded to2attempts and must not advance a true VOD end, overlap connections or bypass expiry.
- Existing silver free3h/red50%-off welcome choice, same-account website payment handoff, no additional trials or new payment/access policies.
- Updates may hand off to the fixed HTTPS download page. Do not execute an arbitrary downloaded file. A future trusted updater must validate origin/version/size/SHA and the approved publisher; no unsigned automatic install or fake trust claim.

## Distribution and verification

Produce a self-contained per-user EXE installer plus a portable diagnostic package through a real Windows CI runner. Include native/Qt/compiler dependencies and third-party licenses. Missing compile, package, runtime or verification output fails the job; do not silently accept loose binaries or automatically create a normal public release.

Use neutral app-owned build paths and metadata, omit debug symbols and scan owned output/resources for personal/host/path/email/credential markers. Preserve upstream license/provenance. No personal signing identity is authorized, and no anonymity or warning-free SmartScreen claim is made. An unsigned test package must be labeled honestly if offered for download; no Windows security bypass instructions.

Tests cover parser/lineup/search/progress/expiry/cache isolation and actual repository fixture HTTP behavior. Windows smoke verification must launch the rendered application and exercise fixture discovery and local-media playback, then record screenshots and logs. A Mac-side preview can help inspect the UI but does not prove Windows execution. The final design audit follows the user's selected AFTER mode.
