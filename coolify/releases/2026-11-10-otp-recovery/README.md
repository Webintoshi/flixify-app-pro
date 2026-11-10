# OTP recovery website publication

This profile changes only the four reviewed website sources and adds the signed Android phone 1.0.1 APK in `manifest.json`. It carries structured authentication reasons to the existing phone screen so a valid code rejected by an account rule does not become a misleading retry of a consumed code. No API, schema, OTP/security rule, account/session, package/trial rule, TV release or Telegram source is changed. The existing phone 1.0.0 APK remains byte-identical.

Phone 1.0.1 is versionCode 2, signed by the existing `5369b205…406a1` identity, with Android 6 (API 23) minimum and unchanged permissions. Its exact audited binary is 1,345,844 bytes, SHA-256 `44eab6ddf5d2e79e0f1aab29548bae9ba0ea60297db2a1973de494c50093d84c`; the manifest rejects a different digest or size.

The source images are WEB `6f50c798…97db7` and unchanged API `0258811e…7a38c`, both at runtime revision `438ae41`. The original `673e760a` WEB-only publication helpers and their `88f27a17` compiler/metadata dependencies are loaded by exact immutable Git digests. The bot's existing raw `7053b1c9…00d70` source, inode, owner and mode join the protected API/container snapshot. All environment rows and exact `.env` bytes remain protected.

Both commands default to application-read-only preflight. Every payload byte is taken from the exact committed revision, and each current source must match its fixed pre-change digest. Build with one CPU, 1280 MiB memory, 1536 MiB including swap, 128 PIDs and 480-second compilation timeout, keeping the existing single-worker Next compiler and 8 GiB free-space floor. Only this successful compiler's generated `.next/cache` can be removed; there is no prune. Existing public files/downloads and immutable static chunks are preserved and checked.

```sh
python3 coolify/releases/2026-11-10-otp-recovery/build.py SERVER_CHECKOUT --revision EXACT_COMMIT --manifest coolify/releases/2026-11-10-otp-recovery/manifest.json --work-dir FRESH_PRIVATE_DIRECTORY --build
python3 coolify/releases/2026-11-10-otp-recovery/release.py SERVER_CHECKOUT --revision EXACT_COMMIT --manifest coolify/releases/2026-11-10-otp-recovery/manifest.json --proof BUILD_DIRECTORY/ops-web-proof.json
```

After candidate smoke tests and preflight pass, run release `--apply`, then `--recreate`. Only the website image tag changes and only `ops-web` restarts. The separate `.otp-recovery-release.json` journal and shared release lock guard these stages. `--rollback` restores the prior WEB image while retaining the closed API and every protected service.

Verification sends no phone request, OTP, registration or code-login request. The candidate smoke checks existing GET pages and streams the new phone APK to verify its HTTP length and SHA-256. The same download check follows live WEB recreation; rollback skips the new asset check because the prior release predates it. Root must verify the published image identities, preserved services/settings, public health and published login pages and tested recovery actions before reporting completion.
