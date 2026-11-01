# Flixify Pro for macOS

The user requested a macOS application with Android TV 1.4.7's features and a download/install flow that passes Apple's normal security checks. The existing approved TV presentation is the visual reference: preserve the logo, black/white/red palette, cinematic discovery, direct playback and account policies. Adapt navigation for a resizable desktop window, pointer, keyboard and standard Mac menus.

## Architecture decision

Use a dedicated SwiftUI/AppKit macOS 13+ application with Foundation networking, Keychain sessions and bundled stable VideoLAN VLCKit. Produce a universal arm64/x86_64 application. This is the implementer's choice within the requested APK parity. The existing Qt client was considered but uses obsolete server catalogue/playback endpoints and plaintext token storage. A website wrapper or AVPlayer-only implementation would not establish equivalent direct-provider and codec behavior for progressive TS, MP2 and MKV. Reuse branding assets, not the legacy network implementation.

## Feature contract

- Existing 16-character code login, encrypted Keychain tokens, refresh/logout and account/source-scoped state. Registration and purchase continue through the existing trusted website, as in the TV app.
- `/me/provider-session` and viewer-IP direct provider metadata/media; no shared credentials, cancelled proxies or legacy native relay endpoints. Credentials and media URLs stay ephemeral. Source/account changes invalidate asynchronous results and cached data. Check absolute access expiry before and during playback; refresh access without restarting an eligible stream.
- Logo/spinner startup; cached catalogues/library, bounded artwork cache and background refresh. Cache metadata only, never video. Complete catalogue search and intersected categories; virtualized shelves and archive.
- Verified 2026 movie/series home and movie 2026/Marvel/covered-action/fantasy collections. Current live curation, friendly filters, Turkish reference ordering, landscape contained logos and EPG. Favorites and watched state synchronize with the personal-library API; resume positions stay account/source-scoped.
- Direct card playback; series resume/first-unwatched selection, manual seasons/episodes, true-end cancellable five-second next episode across seasons. Episodes reaching the final 5% (at most 120 seconds) count as watched, matching TV behavior. Custom compact player includes favorites, audio/subtitles, next episode/live switching, volume, seeking where allowed and full screen. Hide controls after two seconds of playback, retain during interaction/pause, and release the stream on close. Keyboard equivalents include Space, arrows, Escape and full screen.
- Quiet bounded recovery refreshes access and the media URL after decoder failure, live EOF or a watchdog timeout. Never retry a true VOD end, overlap provider connections, bypass expiry or display recovery-status text over established video.
- Existing welcome campaign: silver free choice acknowledges the granted trial; red monthly choice opens the fixed same-account website package URL with the existing 50% eligibility. Never provision another trial or implement different payment/access policy.
- Trusted HTTPS macOS update descriptor with version/size/SHA validation and a signed/notarized disk-image handoff. Installation uses a drag-to-Applications DMG. No Gatekeeper disabling, quarantine removal, trust-policy change or fake signature/notarization.

## Distribution boundary

Local build/QA may use the existing development identity or ad hoc signing. Public distribution must fail closed until a Developer ID Application identity and notary credentials exist, every bundled executable is signed with hardened runtime, Apple returns Accepted, the app is stapled before the final DMG is created, the DMG is notarized/stapled, and Gatekeeper checks pass. The initial audit found only Apple Development, so final public readiness is conditional on the user's Apple Developer setup. Do not label a development build warning-free or publish it as a trusted release.

## User's privacy clarification

The user subsequently confirmed paid **individual** Apple Developer membership and required that their personal name/information not be discoverable from the application, even by reverse engineering. Apple Developer ID certificates identify the individual or legal entity; individual signing cannot satisfy that requirement. Do not create or use a personal distribution certificate, submit notarization or publish a development artifact. Public packaging additionally requires an explicitly approved organization identity policy bound to its actual certificate fingerprint and Team ID. A corporate identity remains externally pending.

Reduce avoidable application leakage: map personal build paths to neutral paths, omit debug symbols from the distributed executable, strip release symbols and scan owned binaries/resources for detected local identity and build-path markers. Do not embed provider credentials, tokens, private keys, account data or Git metadata. Preserve third-party licensing and distinguish upstream VideoLAN build provenance from the user's identity. These checks are bounded evidence, not a guarantee of anonymity, resistance to all reverse engineering or lack of attribution through public services/records.

## Verification and scope

Build/run a real `.app`, exercise native UI with fixture catalogues and local media, inspect screenshots and test data/security/cache/selection/player policies. Validate both binary architectures and absence of external library paths. No real card charge, registration, provider stream or live backend mutation is needed. Do not claim physical hardware/Intel execution or public Gatekeeper acceptance without the corresponding evidence. Website/backend/Android behavior and other projects remain protected.
