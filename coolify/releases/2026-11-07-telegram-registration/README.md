# Telegram registration notification rollout

This helper changes only the existing single-file bot bind. Its exact source baseline is `aabba2e98c0cc46e4323a38674dfd94d73003e2b3cc12afba5a371ea74cf229a`. It does not replace the bot with older repository source, create accounts, send a synthetic Telegram message, modify the API/database, or create a persistent script backup.

Root creates the candidate with the separate hash-gated live patcher, then records the actual candidate SHA-256 and this profile's `offline-probe.mjs` SHA-256. Preflight is the default:

```sh
python3 release.py /absolute/candidate.mjs --candidate-sha256 CANDIDATE_SHA256 --probe-sha256 PROBE_SHA256
```

Add `--apply` only after reviewing the candidate and preflight. `--probe /absolute/offline-probe.mjs` is available when the profile files were staged separately.

The candidate syntax check and registration probe run as bounded, read-only, network-isolated Docker containers. The probe extracts only the injected pure factory and uses synthetic in-memory adapters; it never imports or starts the whole bot. The probe containers are explicitly removed even on failure.

Apply requires the exact source/candidate hashes, three expected binds, the same existing bot configuration, a nonempty unchanged administrator set, and unchanged other-container identities/configurations. It writes the script through its existing inode, retaining mode and ownership, and restarts only `flixify-telegram-bot`. Core Flixify services additionally retain their original lifecycle identifiers. An absent registration journal is created exclusively with a durable cutoff immediately before the script write, mode `0600` and the existing state's owner. Existing journals are retained intact. This prevents registrations during the short restart from falling between cutoffs while avoiding historical replay.

Success requires a fresh healthy bot heartbeat, a fresh successful registration checkpoint, preserved administrators and bot configuration, unchanged protected containers, and the exact candidate bytes/inode. Failure restores original source bytes held only in the running helper's memory and restarts the original bot. The write uses unbuffered cursor-based short-write handling. If our own write fails midway, a typed failure carries only the bounded partial-file digest observed through the held descriptor; rollback accepts that exact digest with the original inode/configuration, while refusing any subsequent foreign edit. Stopped candidates can still be restored through a configuration-only inspection. The new registration journal is never deleted during rollback. A concurrent unexpected source/configuration change causes rollback to refuse overwriting it and report failure for manual inspection.

Validation:

```sh
python3 -m unittest discover -s coolify/releases/2026-11-07-telegram-registration -p test_release.py -v
```

The helper passing locally is not proof of a successful live deployment or Telegram delivery. Root must inspect its actual preflight/apply result and live journal/heartbeat. A synthetic external message requires the user's explicit authorization.
