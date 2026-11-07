# Trial countdown API and Web release

This profile patches the actual current API image and overlays exactly the reviewed Web countdown files, Android TV 1.4.16/versionCode24, and the accepted Windows 1.0.4 installer. It does not change trial duration, account/IP limits, prices, schema, worker, database or environment. Mac downloads remain withdrawn. Existing installers and other public assets are preserved. The unsigned Windows installer notice is unchanged.

The source pins are API `bdf418ab…` / `flixify-api:qr-device-login-20cad131f98f-20261103` and Web `2d465dff…` / `flixify-ops-web:tv-box-login-1a673bc4808e-20261107`. Existing source files must match their independent measured fingerprints. The API recipe is tied to the full measured actual `server.ts` SHA `a827ea38…`, adds one import and replaces only `/me`; it preserves the runtime-only `accessHistory` field and the following `/me/referrals` route.

The API build first recompiles unmodified actual source and requires the original dist fingerprint. The candidate may change only `server.js` and add `trial-countdown.js`. Untouched files, dependencies and runtime configuration remain equal. The compiler runs offline with one CPU, 1280 MiB memory, 1536 MiB total memory/swap and 128 PIDs. The existing one-GiB host disk reserve is monitored; no flattening or pruning is performed.

Use full immutable Git revisions and independently captured pin files outside the checkout. All build/release commands are preflight-only unless an action flag is supplied.

```sh
python3 build-api.py --measure > /outside/repo/api-source-pin.json
python3 build-web.py --measure > /outside/repo/web-source-pin.json

python3 build-api.py /existing/repo --revision FULL_PUBLICATION_REVISION \
  --source-pin /outside/repo/api-source-pin.json \
  --build-proof /outside/repo/api-build-proof.json --build

python3 build-web.py /existing/repo --revision FULL_PUBLICATION_REVISION \
  --source-pin /outside/repo/web-source-pin.json \
  --native-proof /outside/repo/accepted-android-proof.json \
  --windows-installer /outside/repo/windows-1.0.4-installer.exe \
  --windows-proof /outside/repo/accepted-windows-proof.json --build
```

`accepted-android-proof.json` uses the same fields as the previous1.4.15 release, with actual1.4.16/code24 revision/tree, APK SHA/size and passing build/lint/unit/instrumentation evidence. The signer is unchanged. The helper verifies the committed APK and updater exactly; it does not invent or rerun native acceptance on the production host.

The Windows artifact is deliberately external to Git. Its fixed provenance is CI run `42371335948`, artifact `13573554970`, source commit `e9e67d34bc577adb6f4fbc234513b4ff04b37650`, Windows source tree `2ed6ef1aabe042b0c7c98b72b5f8c4522cdadbdf`. The 70,367,451-byte installer SHA-256 is `ccd82397fc41ed54903cca0fe2febc51f5ab775cd1fff110dd5d91883914d0a0`; the 187,961,560-byte artifact ZIP SHA-256 is `52937fae9032b99ad02cee3a7a840c2f64801531917a039043b56d462b072b41`. The proof must record actual passing CI build, install smoke and privacy checks. Both the CI revision and publication revision must retain the accepted Windows source tree. Only the Windows download descriptor is changed in Git; there is no Windows updater request/metadata in the measured current API/native runtime to modify.

To stage the accepted installer on the server, put a fresh temporary artifact URL in a private file outside Git and run:

```sh
python3 stage-windows.py --download-url-file /outside/repo/temporary-artifact-url.txt \
  --windows-proof /outside/repo/accepted-windows-proof.json \
  --output /outside/repo/windows-1.0.4-installer.exe
```

The transfer uses HTTPS only, accepts the expected first-party artifact storage hosts, prints no URL or credentials, checks the entire ZIP's exact size and digest, and extracts only `Flixify-Pro-Windows-1.0.4-x64-TEST-Setup.exe` into a new external path. It verifies the installer size, digest and PE signature. Temporary files created by that command are removed on completion/failure. It does not overwrite an existing output. The disk allowance is specific to this accepted installer plus the accepted APK and at most two MiB of UI source; general APK/source limits are unchanged.

Pass `--verify-existing` with the same arguments and the saved API build proof to verify existing candidate images. Retain both original source images and accepted proofs for rollback.

```sh
python3 release.py /existing/repo --revision FULL_PUBLICATION_REVISION \
  --api-proof /outside/repo/api-build-proof.json \
  --api-source-pin /outside/repo/api-source-pin.json \
  --web-source-pin /outside/repo/web-source-pin.json \
  --native-proof /outside/repo/accepted-android-proof.json \
  --windows-installer /outside/repo/windows-1.0.4-installer.exe \
  --windows-proof /outside/repo/accepted-windows-proof.json \
  --web-candidate-id sha256:EXACT_VERIFIED_WEB_IMAGE
```

Repeat with `--apply` to persist only the two image references, then with `--recreate` to replace only API and Web. API precedes Web in the changed-service order. The Coolify4.6 adapter uses the installed Compose-only writer inside the reviewed transaction and preserves `.env`; every other host container, worker, database and registration fence remains protected.

Use the same arguments with `--rollback` to restore the two pinned current images. Rollback does not require a healthy candidate or free build space. It does not run QR rollback SQL and does not revoke device-link sessions. Confirm `/me` on a trial/paid fixture or an authorized existing account and the hydrated trial banner/download page after cutover; no real payment or provider stream is required.

```sh
python3 -m unittest discover -s coolify/releases/2026-11-07-trial-countdown -p test_release.py -v
```
