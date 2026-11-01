# Flixify Pro for macOS

Native SwiftUI/AppKit client for macOS 13 or newer, using the current Android TV 1.4.7 feature contract. Bundle identifier `vip.flixify.mac`; version 1.0.0, build 1. Public builds contain both Apple Silicon and Intel code.

The client uses the existing account-code, provider-session, personal-library and welcome-offer services. Provider metadata and media requests originate from the viewer's Mac. The TV branding, discovery collections, live channel identities and access/payment policies remain the reference. Keyboard, pointer, menus and a resizable window adapt those features to the desktop.

## Local build and run

Requirements: Xcode with its macOS SDK, Swift 5.9 or newer, Python 3 and an Internet connection for the first runtime preparation. No Qt, Homebrew VLC or separately installed media player is required.

```sh
cd apps/macos-native
./script/build_and_run.sh --verify
```

This stops the existing `FlixifyMac` process, makes a host-architecture debug build, stages a real `dist/Flixify Pro.app`, signs it ad hoc for local development, and opens the bundle. Optional modes are `--logs`, `--telemetry` and `--debug`. Additional app arguments follow `--`.

```sh
python3 scripts/build-app.py --configuration release
```

The default release build compiles `arm64-apple-macosx13.0` and `x86_64-apple-macosx13.0` separately, joins the executables with `lipo`, and audits every bundled Mach-O. It embeds the runtime, icon, SwiftPM resource bundles and third-party license. Apple's `swift-stdlib-tool` stages any required Swift compatibility libraries before compiler-only runtime search paths are removed from the copied binaries. `dist/local-build-proof.json` records its actual architectures and audit. This app still has **local development signing** and is not a public trusted release.

SwiftPM resource bundles are installed under `Contents/Resources`. Application resource lookup must use that installed location; SwiftPM's generated `Bundle.module` accessor can otherwise fall back to the developer's absolute build directory. Do not place unsealed resource files beside `Contents` to work around that behavior.

## Pinned playback runtime

```sh
python3 scripts/prepare-runtime.py
```

The preparation script downloads only the official VideoLAN HTTPS archive and requires its exact size and SHA256:

- VLCKit 3.7.3: `https://download.videolan.org/cocoapods/prod/VLCKit-3.7.3-319ed2c0-79128878.tar.xz`
- 88,186,488 bytes; SHA256 `019afdae4e2e2d0f3ac325fac8f7ba0af25dca70b9d157df7d60db88e0be8e5d`.
- The framework executable contains `arm64` and `x86_64`; runtime proof is retained under ignored `Vendor/runtime-proof.json`.

Only the macOS XCFramework slice and `COPYING.txt` are retained. Samples, AppleDouble files and the 339 MB debugging-symbol file are excluded. The XCFramework's unshipped `DebugSymbolsPath` entry is omitted. Temporary archives are removed automatically. Runtime downloads, build outputs and distribution staging stay project-local and outside Git.

## Public distribution

Public packaging is a separate, deliberately strict operation. It is currently suspended until an **organization** signing identity is reviewed and approved. An individual Developer ID certificate exposes its holder's legal name; that subject cannot be hidden from a recipient inspecting the signature. An installed **Developer ID Application** organization certificate with its private key and a previously configured `notarytool` Keychain profile are required. The local Apple Development certificate is not sufficient. Certificate creation, Apple account sign-in and credential setup are user-controlled; the scripts never create credentials or change security settings.

After the release app and credentials are ready:

```sh
python3 scripts/package-release.py \
  --identity 'Developer ID Application: Your Organization (TEAMID)' \
  --notary-profile FlixifyRelease \
  --organization-identity-policy Vendor/organization-identity-policy.json
```

`FLIXIFY_NOTARY_PROFILE` can provide the profile name instead. Do not put passwords, private keys or certificate exports in the repository.

The private reviewed identity policy has schema 1, `identityKind: "organization"`, `organizationEnrollmentVerified: true`, `publicDistributionApproved: true`, and exact `teamIdentifier`/`certificateSha1` values for the approved certificate. It is an operator approval record, not a way to convert an individual Apple membership into an organization. Missing approval, a different team/certificate or a certificate subject matching a known local personal identity blocks signing and notarization before any public submission. The policy is not included in the app or update descriptor.

The public pipeline:

1. Rejects debug builds, single-architecture apps, identity/version drift, external symlinks, missing bundled libraries and dependencies on developer paths.
2. Signs nested code inside out with the selected Developer ID, hardened runtime and secure timestamps. It never uses `--deep` for signing.
3. Submits the signed app archive and requires Apple's status to be `Accepted`.
4. Staples and validates the **app** ticket and requires Gatekeeper acceptance before constructing the final disk image.
5. Creates the drag-to-Applications DMG, signs it, separately notarizes it, staples it and verifies both its ticket and Gatekeeper assessment.
6. Mounts the image read-only, validates the contained app again, then writes the immutable DMG, proof and update descriptor under `dist/public/`.

Expected public files are `Flixify-Pro-1.0.0-macos-universal.dmg`, `release-proof.json` and `flixify-macos-update.json`. The descriptor uses the fixed `https://flixify.vip/downloads/` origin and includes the final DMG's size and SHA256. Publication to the existing website is performed only after the real release checks pass.

Missing signing credentials, rejected/incomplete notarization or failed Gatekeeper checks stop public packaging. Development output must not be published as an approved release. The workflow does not disable Gatekeeper, remove quarantine metadata, weaken certificate verification or request unnecessary entitlements. Intel slices are inspected during packaging; execution on a physical Intel Mac requires separate QA.

## Release metadata privacy

Release compilation remaps developer home, source and temporary paths in Swift/C file and debug metadata, disables serialized Swift debugging options and strips the main executable's debug/local symbols. It retains runtime-required Swift metadata; this is not source obfuscation.

The release artifact scan checks owned binary/resources for developer paths, temporary paths, email patterns, private/source files and known local account/Git/host/development-certificate identifiers. UTF-8, UTF-16 and JSON-escaped forms of known identifiers are checked without writing their matched values to reports. `dist/privacy-report.json` contains counts and hashed relative file paths. A failed owned-content or known-identity check prevents accepting the release bundle.

Official VideoLAN build paths, contributor contacts and license metadata remain categorized as third-party provenance. They are not represented as the app owner's personal identity, and license notices are preserved. Public signing separately rechecks the actual certificate subject and artifact. These checks reduce known metadata leaks; they cannot guarantee anonymity or prevent reverse engineering. Debug builds may contain local source paths and are never public distribution candidates.

## Verification

```sh
python3 -m unittest discover -s scripts/tests -v
swift test
```

Release-policy tests cover trust prerequisites, artifact identity/architecture restrictions, dependency and archive path safety, inside-out signing, app-before-DMG ticket ordering, and refusal to publish after notarization or Gatekeeper failures. They use controlled fixtures and do not contact Apple's notary service. Actual Apple approval and Gatekeeper readiness require the signed exported artifact and its recorded release proof.
