#!/usr/bin/env python3
"""Sequential reviewed channel cohorts; dry by default, resumable within one deadline."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import signal
import stat
import subprocess
import time
import types

FROZEN_OPERATOR_SHA256 = "be6a21caee4f91314894348134b6db15cb7b1d12501aafff8ef8ab69ccfda520"
SOURCE_ORIGIN = "https://sifiriptvdns.com:2087"
API_CONTAINER = "d7633fe6a8a8f200a4b449a1178a6adb35923997bdaf9ca8a94253923ce578f6"
API_IMAGE = "sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6"
API_PROJECT = "eupquokyj7qegufqvqkjmuyr"
API_SERVICE = "api"
API_TAG = "flixify-api:live-registration-8645860e0552-20261031"
MAX_SECONDS = 23 * 60 * 60


def load_pinned(path, expected, name):
    source = Path(path).read_bytes()
    if not re.fullmatch(r"[0-9a-f]{64}", expected) or hashlib.sha256(source).hexdigest() != expected:
        raise ValueError("artifact-hash-mismatch")
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(source, str(path), "exec"), vars(module))
    return module


audit = load_pinned(Path(__file__).with_name("live-channel-audit.py"), FROZEN_OPERATOR_SHA256, "frozen_operator")


def private_json(path, maximum=64 * 1024 * 1024):
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "r", encoding="utf8") as source:
            details = os.fstat(source.fileno())
            if not stat.S_ISREG(details.st_mode) or details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) & 0o077 or details.st_size > maximum:
                raise ValueError("private-regular-file-required")
            return json.load(source)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError("private-input-unreadable") from None


def validate_credentials(value):
    if not isinstance(value, dict) or value.get("providerOrigin") != SOURCE_ORIGIN:
        raise ValueError("unexpected-provider-origin")
    for key, maximum in (("username", 256), ("password", 2048)):
        text = value.get(key)
        if not isinstance(text, str) or not 1 <= len(text) <= maximum or re.search(r"[\x00-\x1f\x7f]", text):
            raise ValueError("invalid-credentials")


def private_directory(path):
    path = Path(path)
    if not path.exists(): path.mkdir(mode=0o700)
    details = path.lstat()
    if not stat.S_ISDIR(details.st_mode) or details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) != 0o700:
        raise ValueError("private-state-directory-required")
    for name in ("state.json", "checkpoint.json"):
        candidate = path / name
        if candidate.exists() or candidate.is_symlink(): private_json(candidate)
    return path


def iso_time(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Pause(Exception):
    def __init__(self, reason): self.reason = reason


class Halt(Exception):
    def __init__(self, reason): self.reason = reason


def run_job(credentials, manifest, remote, state_dir, probe, *, apply_sql=None, expected_count=15800,
            batch_size=25, max_seconds=MAX_SECONDS, max_targets=None, stop_requested=lambda: False,
            clock=time.time, sleep=time.sleep, reconcile=lambda remote: True, scope_check=lambda: True,
            bridge_sha256=None):
    validate_credentials(credentials)
    if not isinstance(manifest, dict) or manifest.get("schema") != 1 or manifest.get("providerOrigin") != credentials["providerOrigin"] or manifest.get("lineFingerprint") != audit.line_fingerprint(credentials):
        raise ValueError("manifest-line-differs")
    channels = audit.normalized_channels(manifest.get("channels"))
    if type(expected_count) is not int or len(channels) != expected_count or not any(row["streamId"] == "90" for row in channels):
        raise ValueError("unexpected-manifest-count-or-control")
    if type(batch_size) is not int or not 1 <= batch_size <= 25 or not isinstance(max_seconds, (int, float)) or isinstance(max_seconds, bool) or not math.isfinite(max_seconds) or not 0 < max_seconds <= MAX_SECONDS or max_targets is not None and (type(max_targets) is not int or max_targets < 1):
        raise ValueError("invalid-job-bounds")
    identity = {"providerOrigin": credentials["providerOrigin"], "lineFingerprint": audit.line_fingerprint(credentials),
                "manifestSha256": audit.digest(channels), "controlStreamId": "90", "operatorSha256": FROZEN_OPERATOR_SHA256,
                "remote": {key: value for key, value in remote.items() if key != "ssh_socket"}, "bridgeSha256": bridge_sha256}
    directory = private_directory(state_dir)
    state_path, checkpoint = directory / "state.json", directory / "checkpoint.json"
    with audit.operator_line_lock(identity["lineFingerprint"]):
        resumed = state_path.exists()
        state = private_json(state_path) if resumed else {"schema": 1, "identity": identity, "startedUnix": clock(), "appliedProofs": {}, "runCount": 0}
        if state.get("schema") != 1 or state.get("identity") != identity:
            raise ValueError("job-resume-identity-differs")
        if "deadlineUnix" not in state:
            if resumed: raise ValueError("missing-persisted-deadline")
            state["deadlineUnix"] = state["startedUnix"] + max_seconds
        if any(not isinstance(state.get(key), (int, float)) or isinstance(state.get(key), bool) or not math.isfinite(state[key]) for key in ("startedUnix", "deadlineUnix")) or not 0 < state["deadlineUnix"] - state["startedUnix"] <= MAX_SECONDS:
            raise ValueError("invalid-persisted-deadline")
        if not isinstance(state.get("appliedProofs"), dict) or any(key not in {row["streamId"] for row in channels} or not re.fullmatch(r"[0-9a-f]{64}", str(value)) for key, value in state["appliedProofs"].items()):
            raise ValueError("invalid-applied-proof-record")
        report_identity = {key: identity[key] for key in ("providerOrigin", "lineFingerprint", "manifestSha256", "controlStreamId")}
        def read_report():
            value = private_json(checkpoint) if checkpoint.exists() else {"schema": 1, **report_identity, "results": {}, "halted": None}
            if value.get("schema") != 1 or any(value.get(key) != item for key, item in report_identity.items()) or not isinstance(value.get("results"), dict) or not set(value["results"]).issubset({row["streamId"] for row in channels if row["streamId"] != "90"}):
                raise Halt("checkpoint-identity-differs")
            for key, proof in state["appliedProofs"].items():
                if value["results"].get(key, {}).get("proofSha256") != proof: raise Halt("applied-proof-differs")
            return value
        def save():
            report = read_report()
            state["checkedTargets"] = len(report["results"])
            counts = {}
            for row in report["results"].values():
                classification = row.get("classification", "unverified")
                counts[classification] = counts.get(classification, 0) + 1
            state["counts"] = counts
            state["updatedUnix"] = clock()
            audit.atomic_json(state_path, state)
            descriptor = os.open(directory, os.O_RDONLY)
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
        last_scope = None
        def guard():
            nonlocal last_scope
            if stop_requested(): raise Pause("operator-stop")
            if clock() >= state["deadlineUnix"]: raise Pause("deadline-reached")
            if last_scope is None or clock() - last_scope >= 600:
                try:
                    if scope_check() is not True: raise ValueError()
                except Exception: raise Halt("production-scope-check-failed") from None
                last_scope = clock()
                if stop_requested(): raise Pause("operator-stop")
                if clock() >= state["deadlineUnix"]: raise Pause("deadline-reached")
        def checked_probe(channel):
            guard()
            try: return probe(credentials, channel, remote, timeout=15)
            except Exception: raise Halt("probe-or-remote-state-uncertain") from None
        def prepare_or_apply(report):
            if report.get("halted"): raise Halt(report["halted"])
            pending = {key: row for key, row in report["results"].items() if row.get("classification") == "confirmed-http-unavailable" and key not in state["appliedProofs"]}
            if not pending:
                state["preparedProofIds"] = []
                return
            guard()
            candidate = {**report, "results": pending}
            try:
                proofs = audit.validated_exclusions(candidate, now=iso_time(clock()))
                sql = audit.render_sql(candidate, now=iso_time(clock()))
            except (ValueError, TypeError, KeyError): raise Halt("invalid-or-stale-proof-recheck-required") from None
            state["preparedProofIds"] = sorted(pending)
            state["preparedSqlSha256"] = hashlib.sha256(sql.encode()).hexdigest()
            save()
            if apply_sql is not None:
                guard()
                try:
                    if apply_sql(sql) is not True: raise ValueError()
                except Exception: raise Halt("database-apply-failed") from None
                state["appliedProofs"].update({row["streamId"]: row["proofSha256"] for row in proofs})
                state["preparedProofIds"] = []
                save()
        state.update(status="running", reason=None, runCount=state["runCount"] + 1)
        count_before = 0
        try:
            report = read_report()
            count_before = len(report["results"])
            save()
            guard()
            prepare_or_apply(report)
            while len(report["results"]) < len(channels) - 1:
                guard()
                remaining = max_targets - (len(report["results"]) - count_before) if max_targets is not None else batch_size
                if remaining <= 0: raise Pause("pilot-limit")
                report = audit.scan_channels(identity["providerOrigin"], identity["lineFingerprint"], channels, "90", checkpoint,
                                             checked_probe, limit=min(batch_size, remaining), now=lambda: iso_time(clock()), sleep=sleep)
                save()
                prepare_or_apply(report)
            state.update(status="completed", reason=None)
        except Pause as error:
            state.update(status="expired" if error.reason == "deadline-reached" else "paused", reason=error.reason)
        except Halt as error:
            state.update(status="halted", reason=error.reason)
        except Exception:
            state.update(status="halted", reason="invalid-checkpoint-or-result")
        finally:
            try:
                if reconcile(remote) is not True: raise ValueError()
            except Exception: state.update(status="halted", reason="remote-cleanup-unconfirmed")
            try: save()
            except Exception:
                state.update(status="halted", reason="checkpoint-state-unreadable")
                audit.atomic_json(state_path, state)
        return state


NODE_DATABASE = r'''
const {Pool}=require('pg');
let text=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',s=>text+=s);
process.stdin.on('end',async()=>{
 let pool,client,begun=false;
 try {
  const p=JSON.parse(text);
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('supabase.com')?{rejectUnauthorized:false}:undefined,connectionTimeoutMillis:8000,query_timeout:15000,statement_timeout:15000,max:1});
  client=await pool.connect();
  if(p.sql){await client.query('begin');begun=true;}
  const result=await client.query('select shared_source_base_url from public.app_settings where id = true'+(p.sql?' for share':''));
  if(result.rows.length!==1||new URL(result.rows[0].shared_source_base_url).origin!==p.origin) throw Error();
  if(p.sql){await client.query(p.sql);await client.query('commit');begun=false;}
  process.stdout.write(JSON.stringify({ok:true}));
 } catch(e) {if(begun&&client)try{await client.query('rollback');}catch(_){}; process.exitCode=70;}
 finally {if(client)client.release();if(pool)await pool.end();}
});
'''


class PinnedDatabase:
    def __init__(self, remote, origin, runner=subprocess.run):
        if not isinstance(remote, dict) or set(remote) != {"ssh_socket", "ssh_target"} or remote.get("ssh_target") != "root@87.76.130.252" or not isinstance(remote.get("ssh_socket"), str) or not Path(remote["ssh_socket"]).is_absolute() or re.search(r"[\x00-\x1f\x7f]", remote["ssh_socket"]) or origin != SOURCE_ORIGIN:
            raise ValueError("invalid-database-scope")
        self.remote, self.origin, self.runner = remote, origin, runner

    def request(self, command, payload=b""):
        args = ["ssh", "-S", self.remote["ssh_socket"], "-o", "ControlMaster=no", "-o", "ProxyCommand=false", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", self.remote["ssh_target"], shlex.join(command)]
        try: result = self.runner(args, input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
        except (OSError, subprocess.TimeoutExpired): raise ValueError("database-transport-failed") from None
        if result.returncode != 0 or len(result.stdout) > 65536 or len(result.stderr) > 65536: raise ValueError("database-operation-failed")
        return result.stdout

    def inspect(self):
        template = '{{.Id}}|{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.State.Running}}'
        result = self.request(["docker", "inspect", "--format", template, API_CONTAINER]).decode().strip()
        if result != "|".join((API_CONTAINER, API_IMAGE, API_PROJECT, API_SERVICE, API_TAG, "true")): raise ValueError("accepted-api-container-differs")

    def execute(self, sql=None):
        self.inspect()
        body = None
        if sql is not None:
            if not isinstance(sql, str) or not sql.startswith("begin;\n") or not sql.endswith("\ncommit;\n"):
                raise ValueError("operator-sql-required")
            body = sql[len("begin;\n"):-len("\ncommit;\n")]
            if not body or any(not row.startswith("insert into public.live_channel_exclusions (") or not row.endswith(";") for row in body.splitlines()): raise ValueError("operator-sql-required")
        output = self.request(["docker", "exec", "-i", API_CONTAINER, "node", "-e", NODE_DATABASE], json.dumps({"origin": self.origin, "sql": body}).encode())
        if json.loads(output) != {"ok": True}: raise ValueError("database-operation-unconfirmed")
        return True

    def check(self): return self.execute()
    def apply(self, sql): return self.execute(sql)


def remote_credentials(remote, path, runner=subprocess.run):
    if not isinstance(path, str) or not path.startswith("/tmp/flixify-live-audit-") or ".." in Path(path).parts: raise ValueError("invalid-remote-credentials-path")
    program = "import os,stat,sys;f=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(f);assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and not stat.S_IMODE(s.st_mode)&0o077 and s.st_size<=16384;sys.stdout.buffer.write(os.read(f,16385));os.close(f)"
    command = ["ssh", "-S", remote["ssh_socket"], "-o", "ControlMaster=no", "-o", "ProxyCommand=false", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", remote["ssh_target"], shlex.join(["python3", "-c", program, path])]
    try: result = runner(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    except (OSError, subprocess.TimeoutExpired): raise ValueError("credentials-unavailable") from None
    if result.returncode or len(result.stdout) > 16384: raise ValueError("credentials-unavailable")
    try: value = json.loads(result.stdout)
    except (ValueError, UnicodeError): raise ValueError("credentials-unavailable") from None
    validate_credentials(value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--bridge-sha256", required=True)
    parser.add_argument("--credentials-file", type=Path)
    parser.add_argument("--expected-count", type=int, default=15800)
    parser.add_argument("--max-targets", type=int)
    parser.add_argument("--apply", action="store_true", help="Apply only freshly validated original-origin exclusions; requires operator review.")
    args = parser.parse_args()
    try:
        config = private_json(args.config, 16384)
        if not isinstance(config, dict) or set(config) != {"remote", "database", "credentialsRemoteFile"}: raise ValueError("invalid-config")
        bridge = load_pinned(Path(__file__).with_name("live-channel-cdn-audit.py"), args.bridge_sha256, "reviewed_cdn_bridge")
        bridge.validate_remote(config["remote"])
        if config["remote"]["ssh_target"] != "root@87.76.130.17": raise ValueError("unexpected-decoder-host")
        credentials = audit.read_credentials(args.credentials_file) if args.credentials_file else remote_credentials(config["remote"], config["credentialsRemoteFile"])
        manifest = private_json(args.manifest)
        database = PinnedDatabase(config["database"], credentials["providerOrigin"])
        stop = {"requested": False}
        def stop_handler(signum, frame): stop["requested"] = True
        previous = {number: signal.signal(number, stop_handler) for number in (signal.SIGINT, signal.SIGTERM)}
        try:
            state = run_job(credentials, manifest, config["remote"], args.state_dir, bridge.probe_channel,
                            apply_sql=database.apply if args.apply else None, expected_count=args.expected_count,
                            max_targets=args.max_targets, stop_requested=lambda: stop["requested"],
                            reconcile=bridge.reconcile_remote, scope_check=database.check, bridge_sha256=args.bridge_sha256)
        finally:
            for number, handler in previous.items(): signal.signal(number, handler)
        print(json.dumps({key: state.get(key) for key in ("status", "reason", "checkedTargets", "counts", "preparedProofIds")}))
        return 0 if state["status"] in {"completed", "paused"} else 1
    except Exception:
        print(json.dumps({"status": "halted", "reason": "configuration-or-private-input-invalid"}))
        return 1


if __name__ == "__main__": raise SystemExit(main())
