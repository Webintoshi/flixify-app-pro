#!/usr/bin/env python3
"""Sequential operator-only live audit. No customer account or raw provider row is deleted."""
import argparse
from contextlib import contextmanager
import fcntl
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata

MAX_IDS = 50000
HARD = {404, 410}
EXTENSIONS = {"m3u8", "ts", "mp4", "mkv", "avi"}
STATUSES = {"working", "http-unavailable", "blocked", "unverified", "timeout", "undecodable"}
USER_AGENT = "Flixify-owned-live-audit"

@contextmanager
def operator_line_lock(line, directory=Path("/tmp")):
    if not isinstance(line, str) or not re.fullmatch(r"[0-9a-f]{64}", line): raise ValueError("invalid-line-fingerprint")
    path = Path(directory) / ("flixify-live-audit-" + line + ".lock")
    fd = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        details = os.fstat(fd)
        if not stat.S_ISREG(details.st_mode) or details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) & 0o077: raise ValueError("invalid-operator-lock")
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError("operator-line-already-in-use") from None
        yield
    finally: os.close(fd)

def canonical_origin(value):
    if not isinstance(value, str) or len(value) > 256 or re.search(r"[\s\\]", value):
        raise ValueError("invalid-origin")
    parsed = urllib.parse.urlsplit(value)
    try: port = parsed.port
    except ValueError: raise ValueError("invalid-origin")
    host = parsed.hostname or ""
    host = "[" + host + "]" if ":" in host else host
    canonical = "https://" + host + (":" + str(port) if port and port != 443 else "")
    if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or value != canonical or port == 0:
        raise ValueError("invalid-origin")
    return value

def stream_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,14}", value):
        raise ValueError("invalid-stream-id")
    return value

def timestamp(): return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
def parsed_time(value):
    if not isinstance(value, str) or len(value) > 40: raise ValueError("invalid-time")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None: raise ValueError("invalid-time")
    return parsed
def canonical_json(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
def digest(value): return hashlib.sha256(canonical_json(value).encode()).hexdigest()

def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".new-" + str(os.getpid()))
    try:
        with temporary.open("x", encoding="utf8") as output:
            os.chmod(temporary, 0o600)
            json.dump(value, output, sort_keys=True, separators=(",", ":"))
            output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists(): temporary.unlink()

def read_json(path, maximum=64*1024*1024):
    path = Path(path)
    if path.stat().st_size > maximum: raise ValueError("input-too-large")
    return json.loads(path.read_text())

def read_credentials(path):
    try: fd = os.open(Path(path), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError: raise ValueError("credentials-require-owner-only-regular-file") from None
    with os.fdopen(fd, "r", encoding="utf8") as source:
        details = os.fstat(source.fileno())
        if not stat.S_ISREG(details.st_mode) or stat.S_IMODE(details.st_mode) & 0o077 or details.st_uid != os.getuid() or details.st_size > 16384:
            raise ValueError("credentials-require-owner-only-regular-file")
        value = json.load(source)
    canonical_origin(value.get("providerOrigin"))
    for key, maximum in [("username", 256), ("password", 2048)]:
        text = value.get(key)
        if not isinstance(text, str) or not 1 <= len(text) <= maximum or re.search(r"[\x00-\x1f\x7f]", text): raise ValueError("invalid-credentials")
    return value

def line_fingerprint(credentials):
    return digest([credentials["providerOrigin"], credentials["username"], credentials["password"]])

def event_only(row):
    label = " ".join(str(row.get(key, "")) for key in ("title", "name", "groupTitle"))
    label = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode().upper()
    return row.get("eventOnly") is True or bool(re.search(r"\b(?:MAC(?:TA)?\s*(?:AKTIF|ZAMANI|SAATI|GUNU)|ON[\s-]?DEMAND|EVENT[\s-]?ONLY|MATCH[\s-]?(?:TIME|ONLY))\b", label))

def normalized_channels(channels):
    if not isinstance(channels, list) or len(channels) > MAX_IDS: raise ValueError("invalid-channel-list")
    result, seen = [], set()
    for row in channels:
        if not isinstance(row, dict): raise ValueError("invalid-channel")
        key = stream_id(row.get("streamId")); extension = row.get("extension", "ts")
        if extension not in EXTENSIONS or key in seen: raise ValueError("ambiguous-channel")
        alternate = row.get("alternateExtension")
        if alternate is not None and (alternate not in {"ts", "m3u8"} or alternate == extension): raise ValueError("invalid-alternate-format")
        if "eventOnly" in row and not isinstance(row["eventOnly"], bool): raise ValueError("invalid-event-policy")
        normalized = {"streamId": key, "extension": extension, "eventOnly": event_only(row)}
        if alternate: normalized["alternateExtension"] = alternate
        seen.add(key); result.append(normalized)
    return result

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl): return None

class HttpsOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https": raise ValueError("insecure-media-redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def open_media_http(request, timeout):
    return urllib.request.build_opener(HttpsOnlyRedirect()).open(request, timeout=timeout)

def fetch_catalog(credentials):
    opener = urllib.request.build_opener(NoRedirect())
    def request(action):
        query = urllib.parse.urlencode({"username": credentials["username"], "password": credentials["password"], "action": action})
        with opener.open(urllib.request.Request(credentials["providerOrigin"] + "/player_api.php?" + query, headers={"User-Agent": "Flixify-owned-catalog-audit"}), timeout=15) as response:
            raw = response.read(16*1024*1024 + 1)
        if len(raw) > 16*1024*1024: raise ValueError("catalog-too-large")
        rows = json.loads(raw)
        if not isinstance(rows, list) or len(rows) > MAX_IDS: raise ValueError("invalid-catalog")
        return rows
    categories = {str(row.get("category_id")): str(row.get("category_name", ""))[:256] for row in request("get_live_categories") if isinstance(row, dict)}
    channels, seen = [], set()
    for row in request("get_live_streams"):
        if not isinstance(row, dict): continue
        key = str(row.get("stream_id", ""))
        if not re.fullmatch(r"[1-9][0-9]{0,14}", key) or key in seen: continue
        declared = row.get("container_extension")
        extension = declared or "ts"
        if extension not in EXTENSIONS: continue
        seen.add(key)
        channel = {"streamId": key, "extension": extension, "title": re.sub(r"[\x00-\x1f\x7f]", " ", str(row.get("name", "")))[:512], "groupTitle": categories.get(str(row.get("category_id")), "")}
        if not declared: channel["alternateExtension"] = "m3u8"
        channel["eventOnly"] = event_only(channel)
        channels.append(channel)
    if not channels: raise ValueError("empty-catalog")
    return {"schema": 1, "providerOrigin": credentials["providerOrigin"], "lineFingerprint": line_fingerprint(credentials), "channels": channels, "fetchedAt": timestamp()}

def run_bounded(args, timeout):
    process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector(); buffers = {"stdout": b"", "stderr": b""}; deadline = time.monotonic() + timeout
    try:
        selector.register(process.stdout, selectors.EVENT_READ, "stdout"); selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise subprocess.TimeoutExpired(args, timeout)
            for key, _ in selector.select(remaining):
                chunk = os.read(key.fileobj.fileno(), 8192)
                if not chunk: selector.unregister(key.fileobj); key.fileobj.close()
                else: buffers[key.data] = (buffers[key.data] + chunk)[-65536:]
        code = process.wait(timeout=max(0.001, deadline-time.monotonic()))
        return subprocess.CompletedProcess(args, code, buffers["stdout"], buffers["stderr"])
    finally:
        selector.close()
        if process.poll() is None: process.kill(); process.wait()
        for stream in (process.stdout, process.stderr):
            if stream and not stream.closed: stream.close()

def decode_probe(credentials, channel, timeout=15, ffmpeg="ffmpeg"):
    url = credentials["providerOrigin"] + "/live/" + urllib.parse.quote(credentials["username"], safe="") + "/" + urllib.parse.quote(credentials["password"], safe="") + "/" + channel["streamId"] + "." + channel["extension"]
    result = {"status": "unverified", "httpStatus": None, "firstDecodedFrameMs": None, "decodedFrames": 0}
    started = time.monotonic()
    try:
        process = run_bounded([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "https,tls,tcp,crypto", "-user_agent", USER_AGENT, "-rw_timeout", str(int(timeout*1000000)), "-analyzeduration", "1000000", "-i", url, "-map", "0:v:0", "-frames:v", "1", "-an", "-progress", "pipe:1", "-f", "null", "-"], timeout)
        frames = [int(value) for value in re.findall(rb"(?m)^frame=(\d+)\s*$", process.stdout)]
        if process.returncode == 0 and frames and max(frames) >= 1:
            result.update(status="working", firstDecodedFrameMs=round((time.monotonic()-started)*1000), decodedFrames=max(frames))
            return result
        errors = re.findall(rb"(?:HTTP error|Server returned)\s+(\d{3})(?:\s|$)", process.stderr)
        status = int(errors[-1]) if errors else None
        result["httpStatus"] = status
        result["status"] = "blocked" if status in {401, 403, 429} else "unverified" if status else "undecodable"
        if status in HARD:
            # A stale HLS segment can return 404 while its channel manifest is healthy.
            try:
                with open_media_http(urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"}), min(timeout, 6)) as response:
                    result["httpStatus"] = response.status; result["status"] = "undecodable"
            except urllib.error.HTTPError as error:
                result["httpStatus"] = error.code
                result["status"] = "http-unavailable" if error.code in HARD else "blocked" if error.code in {401, 403, 429} else "unverified"
                error.close()
            except (TimeoutError, socket.timeout): result["status"] = "timeout"
            except (OSError, ValueError): result["status"] = "unverified"
    except subprocess.TimeoutExpired: result["status"] = "timeout"
    except OSError: raise ValueError("ffmpeg-unavailable")
    return result

def valid_result(result):
    if not isinstance(result, dict) or result.get("status") not in STATUSES: raise ValueError("invalid-probe-result")
    status, code = result["status"], result.get("httpStatus")
    first, frames = result.get("firstDecodedFrameMs"), result.get("decodedFrames", 0)
    if code is not None and (not isinstance(code, int) or isinstance(code, bool) or not 100 <= code <= 599): raise ValueError("invalid-probe-status")
    if not isinstance(frames, int) or isinstance(frames, bool) or frames < 0: raise ValueError("invalid-frame-count")
    if first is not None and (not isinstance(first, (int, float)) or isinstance(first, bool) or not math.isfinite(first) or first < 0): raise ValueError("invalid-frame-time")
    if status == "working" and (frames < 1 or first is None or code not in {None, 200, 206}): raise ValueError("unproved-working-result")
    if status == "http-unavailable" and code not in HARD: raise ValueError("unproved-hard-failure")
    return {"status": status, "httpStatus": code, "firstDecodedFrameMs": first, "decodedFrames": frames}

def scan_channels(origin, line, channels, control_id, checkpoint, probe, *, limit=50, now=timestamp, sleep=time.sleep, repeat_delay=1, ids=None):
    canonical_origin(origin)
    if not re.fullmatch(r"[0-9a-f]{64}", line) or not 1 <= limit <= MAX_IDS or repeat_delay < 1: raise ValueError("invalid-scan-options")
    channels = normalized_channels(channels)
    control = next((row for row in channels if row["streamId"] == stream_id(control_id)), None)
    if control is None: raise ValueError("control-not-in-current-catalog")
    identity = {"providerOrigin": origin, "lineFingerprint": line, "manifestSha256": digest(channels), "controlStreamId": control_id}
    checkpoint = Path(checkpoint)
    report = read_json(checkpoint) if checkpoint.exists() else {"schema": 1, **identity, "createdAt": now(), "results": {}, "halted": None}
    if report.get("schema") != 1 or any(report.get(key) != value for key, value in identity.items()) or not isinstance(report.get("results"), dict): raise ValueError("checkpoint-identity-differs")
    if ids is not None:
        if not isinstance(ids, list) or len(ids) > MAX_IDS: raise ValueError("invalid-cohort")
        wanted = set(stream_id(value) for value in ids)
        if not wanted.issubset({row["streamId"] for row in channels}): raise ValueError("cohort-not-in-current-catalog")
    else: wanted = {row["streamId"] for row in channels}
    targets = [row for row in channels if row["streamId"] != control_id and row["streamId"] in wanted and row["streamId"] not in report["results"]][:limit]
    def measure(channel):
        output = valid_result(probe(channel)); output.update(checkedAt=now(), streamId=channel["streamId"], extension=channel["extension"])
        parsed_time(output["checkedAt"]); return output
    report["halted"] = None
    before = measure(control) if targets else None
    if before and before["status"] != "working":
        report["halted"] = "control-unavailable"; report["updatedAt"] = now(); atomic_json(checkpoint, report); return report
    def check_format(channel, extension):
        nonlocal before
        control_format = {**control, "extension": extension}
        if before is None or before["extension"] != extension: before = measure(control_format)
        checks = {"extension": extension, "attempts": [], "controls": [before]}
        if before["status"] != "working": return checks
        target = {**channel, "extension": extension}; attempts = checks["attempts"]
        attempts.append(measure(target)); first = attempts[0]
        if first["status"] in {"http-unavailable", "undecodable"}:
            repetitions = 3 if first["status"] == "undecodable" else 2
            for _ in range(repetitions-1):
                sleep(repeat_delay); attempts.append(measure(target))
                if attempts[-1]["status"] != first["status"]: break
            before = measure(control_format); checks["controls"].append(before)
        return checks
    def hard_checked(check):
        return len(check["attempts"]) >= 2 and all(item["status"] == "http-unavailable" and item["httpStatus"] in HARD for item in check["attempts"]) and len(check["controls"]) == 2 and all(item["status"] == "working" for item in check["controls"])
    for channel in targets:
        formats = [channel["extension"]] + [extension for extension in ("ts", "m3u8") if extension != channel["extension"]]
        checks = [check_format(channel, formats[0])]
        if hard_checked(checks[0]) and not channel["eventOnly"]:
            for extension in formats[1:]:
                checks.append(check_format(channel, extension))
                if not hard_checked(checks[-1]): break
        attempts = [item for check in checks for item in check["attempts"]]
        controls = [item for check in checks for item in check["controls"]]
        control_ok = all(item["status"] == "working" for item in controls)
        classification = "working" if any(item["status"] == "working" for item in attempts) else "unverified"
        if channel["eventOnly"] and hard_checked(checks[0]): classification = "proposed-event-only"
        elif len(checks) == len(formats) and all(hard_checked(check) for check in checks): classification = "confirmed-http-unavailable"
        elif len(checks[0]["attempts"]) >= 3 and all(item["status"] == "undecodable" and item["httpStatus"] in {200, 206} for item in checks[0]["attempts"]) and control_ok: classification = "proposed-undecodable"
        proof = {"streamId": channel["streamId"], "extension": channel["extension"], "eventOnly": channel["eventOnly"], "classification": classification, "attempts": checks[0]["attempts"], "controls": checks[0]["controls"], "formatChecks": checks}
        proof["proofSha256"] = digest(proof)
        report["results"][channel["streamId"]] = proof
        if not control_ok: report["halted"] = "control-unavailable"
        elif any(item["status"] == "blocked" for item in attempts): report["halted"] = "access-or-connection-rejected"
        report["updatedAt"] = now(); atomic_json(checkpoint, report)
        if report["halted"]: break
    if not checkpoint.exists(): report["updatedAt"] = now(); atomic_json(checkpoint, report)
    return report

def validated_exclusions(report, *, now=None):
    if not isinstance(report, dict) or report.get("schema") != 1: raise ValueError("invalid-report")
    canonical_origin(report.get("providerOrigin")); control = stream_id(report.get("controlStreamId"))
    if not re.fullmatch(r"[0-9a-f]{64}", str(report.get("lineFingerprint", ""))) or not isinstance(report.get("results"), dict) or len(report["results"]) > MAX_IDS: raise ValueError("invalid-report")
    current = parsed_time(now or timestamp()); output = []
    for key, row in report["results"].items():
        if not isinstance(row, dict) or row.get("classification") != "confirmed-http-unavailable": continue
        if stream_id(key) != stream_id(row.get("streamId")) or key == control or row.get("extension") not in EXTENSIONS: raise ValueError("invalid-proof-identity")
        proof = dict(row); supplied = proof.pop("proofSha256", None)
        if supplied != digest(proof): raise ValueError("proof-digest-differs")
        checks = row.get("formatChecks")
        required = {row["extension"], "ts", "m3u8"}
        if row.get("eventOnly") is not False or not isinstance(checks, list) or len(checks) != len(required) or {check.get("extension") for check in checks} != required: raise ValueError("both-live-formats-must-be-confirmed")
        if checks[0].get("extension") != row["extension"] or row.get("attempts") != checks[0].get("attempts") or row.get("controls") != checks[0].get("controls"): raise ValueError("primary-format-proof-differs")
        previous_after = None
        for check in checks:
            attempts, controls = check.get("attempts"), check.get("controls")
            if not isinstance(attempts, list) or len(attempts) != 2 or not isinstance(controls, list) or len(controls) != 2: raise ValueError("incomplete-proof")
            for item in attempts:
                checked = valid_result(item)
                if checked["status"] != "http-unavailable" or checked["httpStatus"] not in HARD or item.get("streamId") != key or item.get("extension") != check["extension"]: raise ValueError("not-a-hard-channel-failure")
            for item in controls:
                if valid_result(item)["status"] != "working" or item.get("streamId") != control or item.get("extension") != check["extension"]: raise ValueError("unverified-control")
            first, last = parsed_time(attempts[0]["checkedAt"]), parsed_time(attempts[-1]["checkedAt"])
            before, after = parsed_time(controls[0]["checkedAt"]), parsed_time(controls[-1]["checkedAt"])
            if not before <= first < last <= after <= current or (last-first).total_seconds() < 1 or (after-last).total_seconds() > 120 or (current-last).total_seconds() > 6*60*60 or previous_after is not None and before < previous_after: raise ValueError("invalid-or-stale-proof-window")
            previous_after = after
        output.append(row)
    return output

def sql_literal(value): return "'" + str(value).replace("'", "''") + "'"

def render_sql(report, *, now=None):
    proofs = validated_exclusions(report, now=now)
    statements = ["begin;"]
    for row in proofs:
        checks = row["formatChecks"]
        values = [report["providerOrigin"], row["streamId"], "confirmed-http-unavailable", str(sum(len(check["attempts"]) for check in checks)), checks[0]["attempts"][0]["checkedAt"], checks[-1]["attempts"][-1]["checkedAt"], report["controlStreamId"], checks[-1]["controls"][-1]["checkedAt"], row["proofSha256"], canonical_json(row)]
        quoted = [sql_literal(value) for value in values]; quoted[-1] += "::jsonb"
        statements.append("insert into public.live_channel_exclusions (provider_origin,stream_id,reason,failure_count,first_failed_at,last_failed_at,control_stream_id,control_verified_at,proof_sha256,proof) values (" + ",".join(quoted) + ") on conflict (provider_origin, stream_id) do update set reason=excluded.reason,failure_count=excluded.failure_count,first_failed_at=excluded.first_failed_at,last_failed_at=excluded.last_failed_at,control_stream_id=excluded.control_stream_id,control_verified_at=excluded.control_verified_at,proof_sha256=excluded.proof_sha256,proof=excluded.proof,updated_at=now() where public.live_channel_exclusions.last_failed_at <= excluded.last_failed_at;")
    return "\n".join(statements + ["commit;", ""])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    catalog = commands.add_parser("catalog"); catalog.add_argument("--credentials-file", type=Path, required=True); catalog.add_argument("--output", type=Path, required=True)
    scan = commands.add_parser("scan"); scan.add_argument("--credentials-file", type=Path, required=True); scan.add_argument("--manifest", type=Path, required=True); scan.add_argument("--control-id", required=True); scan.add_argument("--checkpoint", type=Path, required=True)
    scan.add_argument("--limit", type=int, default=50); scan.add_argument("--timeout", type=float, default=15); scan.add_argument("--ffmpeg", default="ffmpeg"); scan.add_argument("--ids-file", type=Path)
    apply = commands.add_parser("apply", help="Validate proof and write SQL; never connects to a database")
    apply.add_argument("--checkpoint", type=Path, required=True); apply.add_argument("--output-sql", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "apply":
        report = read_json(args.checkpoint); sql = render_sql(report); args.output_sql.write_text(sql); os.chmod(args.output_sql, 0o600)
        print(json.dumps({"confirmedExclusions": len(validated_exclusions(report)), "sqlPrepared": True, "databaseChanged": False})); return
    credentials = read_credentials(args.credentials_file)
    if args.action == "catalog":
        manifest = fetch_catalog(credentials); atomic_json(args.output, manifest)
        print(json.dumps({"catalogChannels": len(manifest["channels"]), "manifestSaved": True, "mediaConnectionsOpened": 0})); return
    if not 1 <= args.timeout <= 60: raise ValueError("invalid-timeout")
    manifest = read_json(args.manifest)
    if manifest.get("providerOrigin") != credentials["providerOrigin"] or manifest.get("lineFingerprint") != line_fingerprint(credentials): raise ValueError("manifest-line-differs")
    with operator_line_lock(line_fingerprint(credentials)):
        report = scan_channels(credentials["providerOrigin"], line_fingerprint(credentials), manifest["channels"], args.control_id, args.checkpoint,
                               lambda channel: decode_probe(credentials, channel, args.timeout, args.ffmpeg), limit=args.limit,
                               ids=read_json(args.ids_file) if args.ids_file else None)
    counts = {}
    for row in report["results"].values(): counts[row["classification"]] = counts.get(row["classification"], 0) + 1
    print(json.dumps({"checkedChannels": len(report["results"]), "classifications": counts, "halted": report.get("halted"), "checkpointSaved": True, "databaseChanged": False}))

if __name__ == "__main__":
    try: main()
    except KeyboardInterrupt: print(json.dumps({"auditStopped": "interrupted", "databaseChanged": False})); sys.exit(130)
    except Exception as error:
        code = "credentials-require-owner-only-regular-file" if isinstance(error, PermissionError) else str(error) if isinstance(error, ValueError) and re.fullmatch(r"[a-z0-9-]{1,80}", str(error)) else type(error).__name__
        print(json.dumps({"auditStopped": code, "databaseChanged": False}), file=sys.stderr); sys.exit(1)
