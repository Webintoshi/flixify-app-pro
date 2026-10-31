# Original-origin CDN audit bridge

`live-channel-cdn-audit.py` supplies `probe_channel(credentials, channel, remote, timeout=15)` to the frozen `live-channel-audit.py` scanner. It keeps the original provider origin, line fingerprint, checkpoint schema and existing exclusion rules. It does not fetch a catalogue, create an account, schedule a job or apply SQL.

The approved viewer client requests only the original channel response headers with redirects disabled. A provider-issued HTTPS redirect to `edge.flixify.vip` is passed unchanged through SSH stdin to one pinned remote decoder. No video body or signed URL is written locally. Logs and exceptions never include the URL, credentials or raw remote stderr.

The remote config must contain exactly these keys:

```text
ssh_socket, ssh_target, directory, unit_name, helper_sha256, runtime_sha256
```

`ssh_target` is the approved root SSH target, `ssh_socket` an existing absolute control-socket path, and `directory` the private runtime directory prepared by the operator. The directory must contain regular, owner-only `helper.py`, `ffmpeg-runtime` and `live-channel-audit.py` files. The source scanner hash is fixed to `be6a21caee4f91314894348134b6db15cb7b1d12501aafff8ef8ab69ccfda520`; the two other hashes come from the reviewed deployment config. Runtime libraries must already have been verified before the job. Do not relocate or rewrite the runtime wrapper.

`unit_name` must be a dedicated `flixify-live-audit-*.service` name. Every decoder runs in that singleton transient systemd unit, with 384 MiB memory, CPU quota 150%, Nice 10, a 25-second runtime limit and control-group termination with a 20-second stop grace. There are no persistent service changes or automatic retries. SSH uses only the existing control master; a missing socket cannot fall back to a new authenticated connection.

Before each probe, the bridge requires an inactive or failed unit, zero main/control PIDs and an unpopulated cgroup. It starts the new unit with empty stdin, then requires this attempt's exact random nonce in the unit Description, an active main PID and the expected populated cgroup before sending any signed URL. The pinned helper must reject empty stdin before starting FFmpeg. A delayed startup after uncertain transport receives only EOF and cannot start media. An empty-input helper process may briefly appear afterward; that is not evidence of a decoded stream.

After every decoder attempt, the bridge stops/reconciles the unit and requires the same complete idle proof before returning or making a confirmation request. Local SSH stdin is closed and its process killed/reaped on every failure or interruption before reconciliation. SSH, malformed response or cleanup uncertainty raises `BridgeHalt`; the driver must stop and require reconciliation. A local SSH process ending alone does not prove remote decoder exit.

The driver must also call `reconcile_remote(remote)` in its final/pause cleanup, then verify it succeeded before allowing another media session. It must retain the frozen scanner's per-line lock. A user interrupt still reconciles the current remote unit before propagating. Do not automatically restart a failed or interrupted job.

Results have exactly the existing four fields: `status`, `httpStatus`, `firstDecodedFrameMs`, and `decodedFrames`. Working means a real decoded frame with successful decoder exit; positive frames never invent an HTTP 200. The elapsed audit metric includes client redirect work, SSH and confirmed cleanup, so it is not the website's click-to-picture time.

Original top-level 404/410 responses can feed the frozen repeated, two-format and healthy-control rules. A CDN decoder's 404/410 alone is insufficient: after remote cleanup, the approved viewer client revalidates the original URL with the frozen HTTPS-only opener. A current top-level 200 protects against a stale HLS segment 404. Access errors 401/403/429 remain blocked and halt the frozen scan; timeouts and 5xx remain unverified. Event-only and proof-freshness rules remain unchanged. No database mutation is part of this bridge.

Run the isolated tests with `python3 tools/test-live-channel-cdn-audit.py`. Actual provider testing requires root's coordinated idle-line window; tests use mocks and local fixtures only.

## Pilot, resume and stop

The separate `live-channel-audit-job.py` driver owns credentials, the full manifest, state directory and original 23-hour deadline. Its default mode performs real sequential channel probes and prepares reviewed SQL evidence without changing the database. The pilot checks at most ten new target channels, plus required working-control probes:

```sh
python3 tools/live-channel-audit-job.py \
  --config <private-config> --manifest <private-manifest> \
  --state-dir <same-private-state-directory> \
  --bridge-sha256 <reviewed-bridge-sha256> \
  --expected-count 15800 --max-targets 10
```

After root reviews the pilot, run the same command with the same private files and state directory, omitting `--max-targets 10`, to resume the remaining targets. This retains the original deadline; a resume never grants another 23 hours. The working control is excluded from the target count. No database flag is required merely to resume.

The driver's `--apply` flag explicitly enables database exclusions from freshly validated frozen-operator proof and SQL, bound to the reviewed original source and protected API image. Add it only after root reviews and authorizes that application path. Without `--apply`, scanning and resuming never apply database changes. Do not mistake it for a generic start or resume flag.

SIGINT or SIGTERM asks the driver to pause. The current bounded probe finishes, completed progress is saved, and no next probe is opened. The driver then reconciles the owned remote unit; wait for finalized paused/completed state and successful remote idle proof before opening a website or TV media session. Partial evidence is rechecked on resume. Any bridge or cleanup uncertainty halts the job and requires review, even if a later status read looks idle.

Resume identity includes the line, manifest, bundle path, unit and artifact hashes. Only an SSH socket reconnection may change without invalidating that identity. This is an availability audit, not a guarantee that every channel opens within three seconds; website and physical TV timing need separate playback measurements.
