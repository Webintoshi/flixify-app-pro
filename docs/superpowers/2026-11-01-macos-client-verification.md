# macOS client verification — 2026-11-01

> Historical build 1 record. The current build 2 branding, performance and local-test installer evidence is in `2026-11-01-macos-branding-performance.md`; its final artifact supersedes the hashes below.

## Delivered source and scope

`apps/macos-native` is a native SwiftUI/AppKit client using the current Android TV 1.4.7 contract. It targets macOS 13+ and builds Apple Silicon and Intel slices. The existing Qt viewer was not used for its obsolete network implementation. No API, website, Android, provider-panel or production-server changes form part of this delivery.

The client includes account-code/Keychain sessions, viewer-IP provider requests, scoped metadata/library caching, 2026 discovery, movie collections, live lineup and EPG, search/category filters, favorites, series seasons/episodes, resume/watched state, the existing welcome campaign, account/package handoff and a native update screen. Bundled stable VLCKit covers the formats supported by the TV player. The player has desktop keyboard controls, two-second auto-hide, audio/subtitle selection, fullscreen, live channel switching, actual-end next-episode countdown and bounded quiet recovery.

No video, provider credentials, access tokens or media URLs are persisted in catalogue caches. Public update installation requires matching Developer ID teams, verified checksum/size, accepted Gatekeeper assessment and a matching contained app. End-user verification does not depend on Xcode or command-line developer tools.

## Verification performed

- Final shared Swift suite: **55/55 passed**. Final Python packaging/privacy suite: **39/39 passed**. The actual-controller quiet-recovery probe passed all nine scenarios; inactive-next regression passed all three checks. A separate strict startup-resume RED/GREEN reproduced loss of the saved 45-second offset and verified that opening/early-frame snapshots and both recovery requests now retain it. The independent final source review has no remaining important findings in its focused scope.
- Data/security/cache tests use controlled HTTP transports, temporary stores and a fake clock. They cover the real current provider/personal-library/welcome payloads, source/expiry races, bootstrap and token-refresh singleflight, live canonicalization, favorites, near-end watched state and update/binary policy.
- The packaging/privacy suite passed 39 tests. Its notary/Gatekeeper fixtures do not contact Apple or create certificates.
- Local runtime probes decoded H.264 + MP2 TS, H.264 + AAC HLS, MPEG-4 + MP3 AVI, and MKV with two audio tracks and subtitles. Pause, seeking, track selection, actual-end detection and serialized stop/replacement were exercised. A live item exposes no seek timeline.
- Actual native-window fixture QA covered home, movies and the complete archive, live landscape cards, friendly live category counts/filtering, search result activation, direct playback, favorites, seasons/episodes, keyboard seeking, audio/subtitles, EPG and fullscreen. Fullscreen controls disappeared after two seconds even with the pointer stationary over the toolbar. Underlying navigation is hidden from accessibility while a player overlay is active.
- With only local media and fixture metadata, automatic playback advanced from season 1 episode 1 through episode 2 to episode 3. No real provider stream, user registration, charge or live backend mutation was performed.
- Final debug QA additionally verified mouse activation of the single movie search result directly into playback, the player favorite appearing immediately in the favorites list, both welcome prices (125 TL / 199.50 TL), free-choice entry into content and expired-account gating. The final universal release was launched separately and its real account-code login screen inspected.

## Exact final local artifact

- App: `apps/macos-native/dist/Flixify Pro.app`; version 1.0.0/build 1, macOS 13+, local ad hoc signing.
- Main executable SHA256: `9b75ee81659f915189f3c24ad1a1b9eed004188d0230d0339b822688df283f90`.
- Both actual bundled Mach-O binaries contain `arm64` and `x86_64`. Independent dependency/minimum-system/runtime-path and strict nested signature checks passed.
- Independent privacy scan: 65 files; zero known personal identifiers, owned user/temp paths, owned email patterns, credential-URL markers or private/source files. Project/chat IDs and build-home/build-temp markers also zero. VideoLAN's 762 upstream paths and 61 email patterns remain classified and retained as third-party provenance.
- Evidence: `swift-tests-final.log`, `release-policy-final.log`, `player-recovery-proof-final-candidate.json`, `player-startup-resume-green.json`, `player-inactive-next-proof.json`, `privacy-independent-final.json`, `privacy-independent-verification.json`, `final-universal-local-build-proof.json` and `final-universal-build-privacy-report.json` in the evidence directory.

The evidence directory is the project-local ignored `work/artifacts/macos-client-20261101`. Native screenshots contain the visible test-mode label and are not represented as production content playback.

## Privacy and distribution status

The user confirmed an individual Apple Developer membership and required that personal identity not be exposed in the app. An individual Developer ID certificate discloses its holder's legal name. Consequently no personal distribution certificate was created or used, no notarization was submitted, and no Mac download/update was published.

The local app is ad hoc signed for local testing. It is not a public Gatekeeper-approved release. The public packaging path refuses to proceed without a reviewed organization policy bound to the actual certificate fingerprint and Team ID, an appropriate Developer ID identity and notary credentials. It requires successful app notarization/stapling before DMG creation, separate signed/notarized/stapled DMG verification and a mounted-app check before emitting public artifacts.

Release compilation remaps personal build paths, excludes debug symbols, strips local symbols and scans owned content for known local identity, user/temp paths, email and credential-URL markers. Upstream VideoLAN provenance and license notices are retained and classified separately. These are bounded artifact checks; they cannot establish absolute anonymity or prevent reverse engineering. A corporate identity also does not provide an absolute anonymity guarantee.

No physical Intel Mac execution was available. Intel support was cross-compiled and verified in the exported universal binaries. No claim is made for an Apple-approved public installation until the actual organization-signed final artifact passes the recorded public pipeline.

## Remaining handoff

1. Convert the eligible individual membership to an organization, or use a separately approved organization membership. Review the legal entity that will be publicly identified by the certificate.
2. Supply the organization Developer ID identity and a locally configured notary Keychain profile; keep private keys and credentials outside Git.
3. Run the documented public packager against the verified universal release, perform physical Intel QA, and publish only its accepted final DMG and update descriptor to the existing website.

Apple references: [Developer ID certificate policy](https://images.apple.com/certificateauthority/pdf/Apple_Developer_ID_CPS_v3.2.pdf), [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [program enrollment](https://developer.apple.com/help/account/membership/program-enrollment).

## Follow-up: user-authorized real login

The user then explicitly requested login with an existing account. Native UI reproduced a submission race: a valid 16-character entry enabled the button, but pressing it cleared the `@State` value before the asynchronous task read it, producing the invalid-code message. `LoginView.submit` now captures the submitted value immutably before clearing the field. A focused independent review found no other instance of this immediate-clear capture pattern.

The universal release was rebuilt and actual UI GREEN verified successful authentication and the correct masked account with active package/access. The application remains signed in on the home screen. No provider stream, registration, purchase or package mutation was performed. The supplied code and authentication tokens were not written to source, logs or verification files; session tokens use the existing app Keychain vault.

The unchanged core and packaging suites were not repeated for this view-only fix. Actual native submission was checked end to end, both release architectures compiled, strict artifact verification and release privacy scanning passed. Evidence: `login-fix-universal-build.log`, `native-account-login-verified.png`, and the replacement final build/privacy proofs in the local evidence directory. Public distribution remains pending the organization identity prerequisite.
