#!/usr/bin/env python3
"""Decode one exact provider-issued HTTPS redirect from stdin; never exclusion evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import types
import urllib.parse

OPERATOR_SHA256 = "be6a21caee4f91314894348134b6db15cb7b1d12501aafff8ef8ab69ccfda520"
FFMPEG_SHA256 = "4d57fcc582c15dd72a6a5f44abb8035810f234b3ec5a12d870ecc88eeb5e7a58"
USER_AGENT = "Flixify-owned-live-audit"
DIAGNOSTIC_PATTERNS = {
    "protocolNotWhitelisted": rb"\bprotocol\b[^\n]{0,128}\bnot on whitelist\b",
    "unsupportedProtocol": rb"\bprotocol not found\b|\bunsupported protocol\b",
    "optionError": rb"\bunrecognized option\b|\boption\b[^\n]{0,80}\bnot found\b|\berror splitting the argument\b",
    "tlsError": rb"\b(?:tls|ssl)\b[^\n]{0,80}\b(?:error|failed|failure)\b|\bcertificate\b[^\n]{0,80}\b(?:failed|verification)\b|\bhandshake\b[^\n]{0,80}\b(?:failed|failure|error)\b",
    "dnsError": rb"\bfailed to resolve\b|\bname or service not known\b|\btemporary failure in name resolution\b|\bgetaddrinfo\b",
    "connectionError": rb"\bconnection (?:refused|reset|timed out)\b|\bnetwork is unreachable\b|\bno route to host\b",
    "invalidInput": rb"\binvalid data found when processing input\b|\bmoov atom not found\b",
    "codecError": rb"\bcould not find codec parameters\b|\bunsupported codec\b|\bunknown decoder\b|\berror while (?:opening decoder|decoding)\b",
    "inputOpenError": rb"\berror opening input\b|\bfailed to open input\b",
    "httpError": rb"(?:HTTP error|Server returned)\s+\d{3}(?:\s|$)",
}

def validate_url(url):
    if not isinstance(url, str) or not 1 <= len(url) <= 32768 or re.search(r"[\x00-\x20\x7f\\]", url): raise ValueError("invalid-signed-url")
    try:
        parsed = urllib.parse.urlsplit(url)
        allowed = parsed.scheme == "https" and parsed.hostname == "edge.flixify.vip" and parsed.port in {None, 443} and not parsed.username and not parsed.password and not parsed.fragment and parsed.path.startswith("/")
    except ValueError: allowed = False
    if not allowed: raise ValueError("invalid-signed-url")
    return url

def read_request(source):
    raw = source.read(65537)
    if len(raw) > 65536: raise ValueError("input-too-large")
    try: value = json.loads(raw)
    except (ValueError, UnicodeError): raise ValueError("invalid-input-json") from None
    if not isinstance(value, dict) or set(value)-{"url", "streamId"} or "url" not in value: raise ValueError("invalid-input-json")
    validate_url(value["url"])
    key = value.get("streamId")
    if key is not None and (not isinstance(key, str) or not re.fullmatch(r"[1-9][0-9]{0,14}", key)): raise ValueError("invalid-stream-id")
    return value

def verified_bytes(path, expected):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as source:
        details = os.fstat(source.fileno())
        if not stat.S_ISREG(details.st_mode) or details.st_uid != os.getuid() or stat.S_IMODE(details.st_mode) & 0o077: raise ValueError("private-artifact-required")
        data = source.read()
    if hashlib.sha256(data).hexdigest() != expected: raise ValueError("artifact-hash-mismatch")
    return data

def load_runner(operator, ffmpeg):
    if not operator.is_absolute() or not ffmpeg.is_absolute(): raise ValueError("absolute-artifact-path-required")
    source = verified_bytes(operator, OPERATOR_SHA256)
    verified_bytes(ffmpeg, FFMPEG_SHA256)
    if not os.access(ffmpeg, os.X_OK): raise ValueError("ffmpeg-not-executable")
    module = types.ModuleType("pinned_live_audit")
    exec(compile(source, str(operator), "exec"), vars(module))
    return module.run_bounded

def decode_url(url, ffmpeg, runner):
    validate_url(url)
    result = {"status": "unverified", "decoderHttpError": None, "firstDecodedFrameMs": None, "decodedFrames": 0, "returnCode": None, "capturedStderrBytes": None, "stderrAtCaptureLimit": False, "failureClass": None, "diagnostics": {key: False for key in DIAGNOSTIC_PATTERNS}, "exclusionEvidence": False, "sourceEntryRevalidated": False, "databaseChanged": False}
    started = time.monotonic()
    try:
        process = runner([str(ffmpeg), "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "https,tls,tcp,crypto", "-user_agent", USER_AGENT, "-rw_timeout", "15000000", "-analyzeduration", "1000000", "-i", url, "-map", "0:v:0", "-frames:v", "1", "-an", "-progress", "pipe:1", "-f", "null", "-"], 15)
        diagnostic_text = re.sub(rb"https?://[^\x00-\x20<>\"']+", b"[url]", process.stderr.replace(url.encode(), b"[url]"), flags=re.IGNORECASE)
        flags = {key: bool(re.search(pattern, diagnostic_text, re.IGNORECASE)) for key, pattern in DIAGNOSTIC_PATTERNS.items()}
        result.update(returnCode=process.returncode, capturedStderrBytes=len(process.stderr), stderrAtCaptureLimit=len(process.stderr) >= 65536, diagnostics=flags)
        frames = [int(value) for value in re.findall(rb"(?m)^frame=(\d+)\s*$", process.stdout)]
        if process.returncode == 0 and frames and max(frames) >= 1:
            result.update(status="working", firstDecodedFrameMs=round((time.monotonic()-started)*1000), decodedFrames=max(frames))
        else:
            errors = re.findall(rb"(?:HTTP error|Server returned)\s+(\d{3})(?:\s|$)", diagnostic_text)
            code = int(errors[-1]) if errors else None
            result.update(decoderHttpError=code, status="blocked" if code in {401, 403, 429} else "unverified" if code else "undecodable")
            ordered = [("protocolNotWhitelisted", "transport-not-whitelisted"), ("unsupportedProtocol", "unsupported-protocol"), ("optionError", "decoder-option-error"), ("tlsError", "tls-error"), ("dnsError", "dns-error"), ("connectionError", "connection-error")]
            result["failureClass"] = next((kind for flag, kind in ordered if flags[flag]), None)
            if result["failureClass"] is None:
                result["failureClass"] = "delivery-access-rejected" if code in {401, 403, 429} else "delivery-http-error" if code else next((kind for flag, kind in [("invalidInput", "invalid-input"), ("codecError", "codec-error"), ("inputOpenError", "input-open-error")] if flags[flag]), "decoder-signal" if process.returncode < 0 else "no-decoded-frame")
    except subprocess.TimeoutExpired: result.update(status="timeout", failureClass="timeout")
    except OSError: raise ValueError("ffmpeg-unavailable") from None
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--operator", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    args = parser.parse_args()
    os.set_blocking(sys.stdin.fileno(), True)
    request = read_request(sys.stdin.buffer)
    runner = load_runner(args.operator, args.ffmpeg)
    result = decode_url(request["url"], args.ffmpeg, runner)
    if "streamId" in request: result["streamId"] = request["streamId"]
    print(json.dumps(result))
    return 0 if result["status"] == "working" else 20

if __name__ == "__main__":
    try: sys.exit(main())
    except KeyboardInterrupt:
        print(json.dumps({"probeStopped": "interrupted", "exclusionEvidence": False, "databaseChanged": False})); sys.exit(130)
    except Exception as error:
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[a-z0-9-]{1,80}", str(error)) else type(error).__name__
        print(json.dumps({"probeStopped": reason, "exclusionEvidence": False, "databaseChanged": False}), file=sys.stderr); sys.exit(1)
