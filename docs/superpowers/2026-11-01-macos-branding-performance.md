# Mac branding, performance and local installer — build 2

## Scope and findings

The user requested application testing, the original logo/website favicon, responsiveness improvements and a downloadable Mac installer. Changes are limited to the native Mac app, its packaging and verification documentation. No website, API, provider settings or server services were modified.

The in-app wordmark is already byte-identical to the live website's `/logo/flixify-logo.png`. The packaging script was taking a stale Qt ICNS with a scratched angular F. It now uses an app-owned ICNS generated from the verified website `/logo/icon-512.png` favicon master. `Resources/branding-origin.json` records public origins and hashes. Standard icon sizes decode; 128px and larger match the source pixels after roundtrip. Apple's low-resolution icon normalization is documented in the local icon proof. No replacement logo was invented.

The dominant reproducible catalogue cost was repeated live-channel title/category analysis. A bounded, thread-safe content-keyed cache now reuses that immutable analysis; source title, fallback distinction and category changes remain distinct inputs. Live shelves group categories in one pass rather than scanning and analyzing the catalogue separately for each category. Existing channel selection, names, ordering, exclusions, access/source checks and repository behavior remain unchanged.

## Measured evidence

Identical optimized synthetic 15,000-channel fixture, seconds:

| Operation | Before | After |
| --- | ---: | ---: |
| Initial live curation | 3.337 | 1.684 |
| Warm metadata pass | 1.646 | 0.009 |
| Live shelf preparation | 16.858 | 0.029 |

These measure catalogue computation, not provider latency or click-to-video time. Movie shelf computation and warm personal-library reads were not material bottlenecks in this fixture; no Redis, server cache or unrelated repository rewrite was introduced. A 500-favorite warm library fixture remained approximately 34ms/read with no network calls.

The initial live-app sample observed an elevated SwiftUI layout workload. A later pre-fix navigation capture was idle at 0% CPU, so that transient observation is not represented as a proven before/after benefit of the core change. Performance claims above use the reproducible identical fixture.

## Verification

- Shared app/core Swift suite: **57/57 passed**; two regressions cover large prepared live shelves and exact source/group changes after cache warmup.
- Packaging/privacy/local-image Python suite: **53/53 passed**. Local-image tests cover source immutability, debug/private-file rejection, image failure, mounted tampering, no overwrite and cleanup while mounted.
- Universal release compilation and bundled dependency/signature/privacy checks passed. Version 1.0.0, build 2, macOS 13+, Intel and Apple Silicon.
- Main executable SHA256: `d9dddf2b65b312029fe486c4e571a3e13d9776de9937c759a2d217de7715f529`.

The local evidence directories are ignored `work/artifacts/macos-client-20261101` and `work/artifacts/macos-brand-20261101`; the synthetic before/after JSON and RED/GREEN suite logs sit beside the former directory with the `macos-client-20261101-core-performance-` prefix. No real provider stream is required for these tests. Existing prior local-media player verification remains applicable; player code is unchanged.

## Native UI and final artifact

On the actual signed-in release, film categories showed 981 action results; archive scrolling worked. A real regression was reproduced by scrolling that archive and switching to Live: the previous offset left a blank viewport. The scroll view now has identity based on route, query, category, country and source scope. It resets for intentional navigation/filter/source replacement, without resetting on background catalogue/library revisions. Focused independent review passed. Repeating the same sequence then showed the Live header, Turkish channels beginning with TRT 1/Kanal D/Star TV and scroll position zero.

Additional actual UI checks: global Avengers search returned five movie results, the existing eight favorites loaded, series browse opened a real provider detail with one season/eight episodes, and returning home retained the signed-in account. No real provider stream, favorite write, purchase or account/package mutation was performed in this test round. The unchanged player code is covered by the previous local-media verification. The final macOS file icon was obtained through IconServices/AppKit using the absolute bundle path and visually confirmed as the website favicon.

- Final DMG: `apps/macos-native/dist/local-test/Flixify-Pro-1.0.0-macos-universal-LOCAL-TEST-d9dddf2b65b3.dmg`.
- Size: **44,517,156 bytes**.
- DMG SHA256: `ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d`.
- Actual image checksum, mounted app manifest, universal slices, dependencies, minimum OS, runtime paths and strict nested signatures passed. Source bundle remained unchanged.
- Independent privacy audit found zero known personal/owner/host/path/email/credential markers in owned app content, stored image metadata/UDIF resources, raw DMG, root payload and extended attributes. Three current-file-location URLs produced by querying imageinfo were excluded as query diagnostics, not stored image content. VideoLAN provenance is preserved and classified separately.
- Image root contains only the app, Applications symlink and Turkish installation notice. All verification mounts were detached; no user data or Keychain material was copied.
- Current proof set: `final-build2-{local-build-proof,build-privacy-report,independent-verification,independent-privacy,local-test-dmg-proof,local-test-container-privacy}.json`. UI evidence includes `native-scroll-navigation-{red,green}.png`, `native-search-build2.png`, `native-series-details-build2.png` and `native-system-icon-final.png`. Earlier candidate reports were archived separately.

## Installer and public trust

`scripts/package-local-test.py` produces a clearly labeled local-test DMG from the unchanged audited release app, with an Applications shortcut and a short Turkish installation notice. It verifies the image, mounts read-only, rechecks the contained app against the source manifest, and detaches. It never signs, creates credentials, submits to Apple or emits an update descriptor. The existing public packaging gate is unchanged.

A DMG is an installation container, not proof of developer trust. This local-test image remains unnotarized and may receive a macOS developer-verification warning. Organization Developer ID signing and actual accepted notarization are still required before publishing a normal trusted download. The user's individual identity must not be used for that public signing; no absolute anonymity claim is made.

Apple guidance: [packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution), [Installer signing requirements](https://help.apple.com/xcode/mac/current/en.lproj/deve51ce7c3d.html).
