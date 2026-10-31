# Live channel audit

Run only from an approved provider location using an idle, dedicated line. The tool does not create accounts, change the provider or delete provider channels/favorites. Never run browser/TV playback on the same single-connection line during an audit.

The credential JSON must be a regular file owned by the invoking user with mode `0600` or stricter. Required keys are `providerOrigin` (canonical HTTPS origin without trailing slash), `username` and `password`. Credentials are read from that file only, never command arguments or printed logs.

```sh
python3 tools/live-channel-audit.py catalog --credentials-file /private/line.json --output /private/live-manifest.json
python3 tools/live-channel-audit.py scan --credentials-file /private/line.json --manifest /private/live-manifest.json --control-id 123 --checkpoint /private/live-audit.json --ids-file /private/cohort.json --limit 20
python3 tools/live-channel-audit.py apply --checkpoint /private/live-audit.json --output-sql /private/live-exclusions.sql
```

`cohort.json` is an optional array of current provider stream-ID strings. The control must exist in the same freshly fetched account catalog. Default scan limit is 50; default per-decoder timeout is 15 seconds. An operator lock rejects two scanner processes using the same line. It cannot detect a separately running customer player; the operator must establish that the line is idle first.

Each successful working probe uses one HTTPS-only ffmpeg chain and proves at least one decoded video frame. `firstDecodedFrameMs` covers that decoder invocation, including startup and network work. It is **not** click-to-picture time in the website or on a physical TV. Its HTTP status remains null because a decoded frame does not reveal the exact HTTP response code. Child output is bounded to 64 KiB per pipe, is never printed, and the owned process is killed and reaped on timeout.

Missing provider extensions become primary `ts` with alternate `m3u8`; explicit provider formats remain primary. Only a failed decoder reporting possible HTTP 404/410 triggers a subsequent top-level media-URL HTTP check after the decoder has exited. This distinguishes an unavailable channel from a stale HLS segment. The same User-Agent is used, HTTPS-to-HTTP redirects fail unverified, and the response is closed before another probe.

A global stream-ID exclusion requires **both TS and HLS** to produce two independent hard-unavailable results each, with decoded working controls in that same format before and after. If a different explicit primary format is declared, it must fail as well. Any working alternate protects the ID. Each sample carries its stream ID and extension; `formatChecks` is covered by the proof digest, and the SQL validator rejects earlier single-format evidence. `[MAÇTA AKTİF]`, `MAÇ ZAMANI`, `ONDEMAND` and equivalent event-only labels are marked `proposed-event-only`; they are never automatically excluded during their off-air period. 401, 403 and 429 halt the batch; timeouts, network/5xx failures or undecodable media never automatically exclude a channel. Repeated HTTP-200 undecodable media is proposal-only and needs separate review.

The checkpoint is atomically replaced after each target and is bound to provider origin, a credential fingerprint, the exact ID/extension manifest and control ID. Repeating the scan resumes unfinished targets. Use a new checkpoint for a new inspection period; completed results are intentionally not probed again. Only sanitized IDs, status/timing evidence and hashes are retained, without source URLs or credentials.

`apply` prepares a transaction but **never connects to a database**. It verifies proof hashes, strict IDs/origin, repeated hard statuses, control evidence, ordering and a maximum six-hour proof age. Review the generated SQL, apply migration `202610310002_live_channel_exclusions.sql`, then execute the transaction separately through the existing protected database workflow. Rows are origin-scoped upserts; no provider data or favorites are deleted. The command reports `databaseChanged: false` until that external execution occurs.

Recovery of an excluded channel requires a fresh separately reviewed inspection and resolution operation. This first version does not automatically remove exclusions or promote the `proposed-undecodable` class. Do not claim the whole catalog is clean based on a small cohort.
