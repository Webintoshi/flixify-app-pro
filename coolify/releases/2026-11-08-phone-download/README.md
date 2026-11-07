# Android phone1.0.0 download publication

This profile publishes exactly six committed paths: the download page, new phone descriptor, two narrow download-analytics changes, the general applications header link, and the audited1,345,139-byte APK. It starts from live WEB b9f0545c and retains API44ff, all settings, sessions, TV1.4.16, Windows1.0.4, withdrawn Mac and the latest login/OTP fixes. There is no native rebuild, dependency change, update JSON or API migration.

Use the production payload frozen in `runtime-source-freeze.json`, rather than unrelated dirty local page contents. The canonical `manifest.json` binds those production bytes to current source-image hashes. APK SHA-256 is `cef2e7a2a904e1182708680feabe44550dc14012bc854b033f82b2e9a2c73899`; its small public binary is transported as an exact Git blob with the other five files. Only the new phone descriptor and APK may be absent in the source image; no old download may be replaced.

The exact focus builder/release blobs from commit673e760a3b768c0e369540f426eb1390b839ebec are verified before loading, and they retain their pinned88 helpers. Only one exact journal-name anchor is transformed in the private temporary release copy, selecting `.phone-download-release.json`. Existing release/helper working files and existing journals are never altered. The proven WEB-only metadata transaction never writes `.env` or saves an environment row. API/worker/database and other projects remain protected.

Build defaults are application-read-only; append `--build` for the bounded COW candidate. The existing8GiB disk guard,1CPU/1280MiB/1536MiB including swap/128PID limits, one-worker flags and post-compile `.next/cache` cleanup remain. Prior public files and static chunks remain byte-identical. Isolated smoke verifies normal application HTML at `/indir` and the complete APK HTTP stream, length and SHA. Loading SSR is valid; root browser QA verifies the hydrated phone/TV/Windows links.

```sh
python3 coolify/releases/2026-11-08-phone-download/build.py SERVER_CHECKOUT --revision EXACT40CHARCOMMIT --manifest coolify/releases/2026-11-08-phone-download/manifest.json --work-dir FRESH_PRIVATE_DIRECTORY --build
python3 coolify/releases/2026-11-08-phone-download/release.py SERVER_CHECKOUT --revision EXACT40CHARCOMMIT --manifest coolify/releases/2026-11-08-phone-download/manifest.json --proof FRESH_PRIVATE_DIRECTORY/ops-web-proof.json
```

The release default is a read-only Coolify preview. Then use `--apply` for WEB metadata only and `--recreate` for WEB only; the installed PHP preview must pass first. Existing tag/file/environment/container guards are rechecked before compose up. Post-cutover the phone APK is also fetched from the running WEB container and fully hashed. `--rollback` retains API44ff and restores only the preceding b9f WEB. No general metadata adoption is added.

```sh
python3 -m unittest discover -s coolify/releases/2026-11-08-phone-download -p test_release.py -v
python3 -m py_compile coolify/releases/2026-11-08-phone-download/build.py coolify/releases/2026-11-08-phone-download/release.py
```
