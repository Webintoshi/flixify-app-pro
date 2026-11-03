# Forced analytics acceptance publication

This profile records the guarded publication inputs for the temporary forced-acceptance change. It authorizes an ops-web-only replacement plus the immutable Android TV 1.4.12 artifact. API, worker, database, environment, registration fence, payment and provider services remain protected.

The accepted source revision is `4e0936ed11ecd704c4b9131ba271784d0b1843db`. Web/PWA, Android TV, macOS and Windows begin their app-managed analytics preference as accepted, rewrite a previous rejection, and expose no consent popup or account preference. Existing configuration gates, event allowlists, privacy filters and advertising-consent denials remain unchanged.

## Android publication inputs

`android-proof.json` binds the source tree and exact APK bytes. The APK was produced by `./gradlew clean testReleaseUnitTest assembleRelease`; v1/v2 signature verification, package identity, version/code, minSdk/targetSdk and non-debuggable status were checked with Android build-tools 35.0.0. Its certificate matches the currently published 1.4.11 APK.

Only these public leaves may change for Android publication:

- `apps/ops-web/app/platform/tv-download.ts`
- `apps/ops-web/public/downloads/flixify-pro-1.4.12.apk`
- `apps/ops-web/public/downloads/flixify-tv-update.json`

The full web source change is the reviewed `4d6cb8548e1c17047b78d516599f6d7ba86bbe40..4e0936ed11ecd704c4b9131ba271784d0b1843db` range. A candidate must be built from the exact publication commit with no network during compilation and must preserve all retained public downloads byte-for-byte. Release preflight must verify the current live 1.4.11 descriptor and APK before applying an ops-web-only replacement. Public HEAD, range and complete GET bytes must match the proof after recreation.

`build-web.py` pins the currently running 1.4.11 web image plus the API, worker and database images. It accepts only the reviewed web diff, compiles with no network under the existing 1280/1536 MiB limits, verifies the complete public tree and APK identity, and proves that protected containers and host configuration did not change:

```sh
python3 coolify/releases/2026-11-03-forced-analytics-consent/build-web.py /data/flixify/app --revision EXACT_COMMIT
python3 coolify/releases/2026-11-03-forced-analytics-consent/build-web.py /data/flixify/app --revision EXACT_COMMIT --build
```

The builder never deploys or edits the live checkout or Compose configuration. Deployment remains a separate web-only transaction with the pre-build image retained as the rollback target.

## Native gates

- macOS public publication remains blocked: the available app is ad-hoc signed, only an Apple Development identity is installed, and the reviewed organization identity policy is absent. Do not weaken signing, notarization, stapling or Gatekeeper requirements.
- Windows publication requires the `Windows native TEST package` workflow for source revision `4e0936e` to succeed. Its verified installer may be accepted only after CTest, UI smoke, dependency, privacy, packaging and hash steps pass.

## Live application gate

The live release requires either the reviewed root SSH identity or an authenticated Coolify operator session. Source push alone is not evidence of publication. After deployment, verify `/`, `/ayarlar`, `/indir`, `/downloads/flixify-tv-update.json`, the exact APK bytes and `https://api.flixify.vip/analytics/config`; then verify a clean browser session has no analytics consent copy/control and no console error.
