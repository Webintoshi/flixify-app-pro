# macOS Client Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans for the assigned implementation. The user explicitly requested implementation using the existing approved APK features and presentation; routine platform adaptations are implementer decisions.

**Goal:** Deliver a native macOS client matching Android TV 1.4.7 and a distribution pipeline that admits only correctly signed, notarized releases.

**Architecture:** SwiftUI desktop executable plus a testable Foundation core, actor-isolated direct-provider repository and a bundled VLCKit player. Source lives in `apps/macos-native`; all build/runtime downloads are project-local and ignored. Existing backend and APK are unchanged.

**Tech Stack:** Swift 5 language mode on installed Xcode, macOS 13+, SwiftPM, SwiftUI/AppKit, Security/Keychain, URLSession, VideoLAN VLCKit 3.7.3, Developer ID/notarytool/stapler.

**Spec:** `docs/superpowers/specs/2026-11-01-macos-client-design.md`

## Global constraints

- Bundle `vip.flixify.mac`, version 1.0.0/build 1; universal arm64/x86_64; min macOS 13.0.
- Fixed API `https://api.flixify.vip`, website `https://flixify.vip`; current viewer-IP provider contracts only.
- Preserve TV colors, features, source/expiry and welcome/payment policies. Never cache credentials/media URLs/video.
- Public release requires Developer ID, hardened runtime, accepted notarization, stapling and Gatekeeper acceptance. Local QA signing is not distribution readiness.

## Review focus

- Account/source changes or expiry while requests, cached artwork, favorite writes or playback are pending.
- Provider error/malformed metadata, missing years/artwork, large catalogues and unsupported formats.
- Refresh-token singleflight, persisted sessions and library references without leaking credentials.
- Player seeking/end/replay/close/foreground changes and exactly-once cancellable episode advancement.
- Update descriptor tampering, redirects, missing certificates, architecture mismatch and nested unsigned dependencies.

## Tasks

- [x] **Core/repository:** `Sources/FlixifyCore/{Models,Repository,ProviderParser,Discovery,LiveLineup,Cache,KeychainStore,UpdatePolicy}.swift`; unit tests cover exact current JSON contracts, strict years, canonical ordering, scoped caching, source/expiry and trusted updates. Shared types and `FlixifyRepositoryProtocol` are the integration boundary.
- [x] **Native player:** `Sources/FlixifyMac/Player/`; VLCKit-backed controller/surface and testable next-episode policy. Verify audio/subtitles, seek, pause, close and two-second controls with local media, not provider streams.
- [x] **Desktop UI:** `Sources/FlixifyMac/{App,Views,Stores,Support,Resources}/`; shared root state and fixture-only debug mode, splash/login, discovery, live/EPG, search/categories, favorites, series, account/welcome, desktop menus and player overlay. Inspect actual resizable-window screenshots and keyboard paths.
- [x] **Build/distribution:** `Package.swift`, `scripts/{prepare-runtime,build-app,package-release}`, `script/build_and_run.sh`, `.codex/environments/environment.toml`; pin official stable VLCKit, stage a real app with icon/licenses, verify universal nested binaries and refuse untrusted public packaging. Run release-policy tests and inspect the actual exported artifacts.
- [x] **Local integration:** independent review, 55 core tests, 39 packaging/privacy tests, native UI/local-media QA and universal local release build completed. Verification and the signing handoff are recorded in `docs/superpowers/2026-11-01-macos-client-verification.md`.
- [ ] **Public distribution (external prerequisite):** approved organization Developer ID and notary credentials, actual Apple acceptance/Gatekeeper checks, then publish the verified DMG/update to the existing website. Individual membership cannot satisfy the user’s personal-name privacy requirement.
