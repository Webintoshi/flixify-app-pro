"""Copy existing reseller settings into the Flixify worker's private Compose env file.

The source is the already running Telegram bot. Values never appear in stdout,
command arguments, or the repository. The target is backed up before changes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


REQUIRED = ("RESELLER_API_BASE_URL", "RESELLER_API_KEY")
SAFE_VALUE = re.compile(r"^[A-Za-z0-9:/?&=._%+@-]+$")
ENV_KEY = re.compile(rb"^([A-Za-z_][A-Za-z0-9_]*)=")
EXPECTED_RESELLER_HOST = "sifiriptvdns.com"
HTTPS_RESELLER_PORT = 2087


def run(*args: str, cwd: Path | None = None) -> bytes:
    result = subprocess.run(args, cwd=cwd, capture_output=True, check=False, timeout=30)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed; details suppressed to protect credentials")
    return result.stdout


def source_settings(container: str) -> dict[str, str]:
    raw = run("docker", "inspect", "--format={{json .Config.Env}}", container)
    entries = json.loads(raw)
    settings = dict(item.split("=", 1) for item in entries if "=" in item)
    selected: dict[str, str] = {}
    for name in REQUIRED:
        value = settings.get(name, "")
        if not value or not SAFE_VALUE.fullmatch(value):
            raise RuntimeError(f"{name} is missing or cannot be safely written as an env value")
        selected[name] = value
    source = urlsplit(selected["RESELLER_API_BASE_URL"])
    if source.scheme not in {"http", "https"} or source.hostname != EXPECTED_RESELLER_HOST:
        raise RuntimeError("Reseller API origin is not the verified IPTV provider")
    if source.username or source.password or not source.path or source.query or source.fragment:
        raise RuntimeError("Reseller API URL has an unexpected format")
    if source.scheme == "http":
        selected["RESELLER_API_BASE_URL"] = urlunsplit(
            ("https", f"{EXPECTED_RESELLER_HOST}:{HTTPS_RESELLER_PORT}", source.path, "", "")
        )
    return selected


def verify_provider(settings: dict[str, str]) -> None:
    """Confirm the exact HTTPS API and key with a read-only, one-item request."""
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            return None

    payload = urlencode({
        "api_key": settings["RESELLER_API_KEY"],
        "action": "get_lines",
        "start": "0",
        "limit": "1",
    }).encode("ascii")
    request = Request(
        settings["RESELLER_API_BASE_URL"],
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with build_opener(NoRedirect).open(request, timeout=15) as response:
            result = json.load(response)
        if result.get("status") != "STATUS_SUCCESS" or not isinstance(result.get("data"), list):
            raise ValueError("unexpected provider response")
    except Exception:
        raise RuntimeError("Verified HTTPS reseller preflight failed; details suppressed") from None


def existing_settings(contents: bytes) -> dict[str, str]:
    found: dict[str, str] = {}
    for line in contents.splitlines():
        match = ENV_KEY.match(line)
        if not match:
            continue
        name = match.group(1).decode("ascii")
        if name in REQUIRED:
            if name in found:
                raise RuntimeError(f"Duplicate {name} in target env file")
            found[name] = line[len(match.group(0)) :].decode("utf-8")
    return found


def verify_worker(compose_file: Path, settings: dict[str, str]) -> None:
    raw = run(
        "docker", "compose", "-f", str(compose_file), "config", "--format", "json",
        cwd=compose_file.parent,
    )
    config = json.loads(raw)
    worker = config.get("services", {}).get("worker", {})
    actual = worker.get("environment", {})
    if any(actual.get(name) != value for name, value in settings.items()):
        raise RuntimeError("Worker does not receive both reseller settings from Compose")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-dir", type=Path, required=True)
    parser.add_argument("--source-container", default="flixify-telegram-bot")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    service_dir: Path = args.service_dir.resolve()
    env_file = service_dir / ".env"
    compose_file = service_dir / "docker-compose.yml"
    if not env_file.is_file() or not compose_file.is_file():
        raise RuntimeError("Expected Coolify service env and Compose files are missing")
    settings = source_settings(args.source_container)
    verify_provider(settings)
    contents = env_file.read_bytes()
    existing = existing_settings(contents)
    if any(name in existing and existing[name] != value for name, value in settings.items()):
        raise RuntimeError("Target env has a different reseller setting; refusing to replace it")
    missing = [name for name in REQUIRED if name not in existing]
    if args.dry_run:
        print(f"Dry run passed; {len(missing)} settings would be added; no value displayed")
        return
    if not missing:
        verify_worker(compose_file, settings)
        print("Worker reseller settings already configured and verified")
        return

    backup = env_file.with_name(f".env.pre-auto-trial-{time.time_ns()}")
    shutil.copy2(env_file, backup)
    os.chmod(backup, 0o600)
    suffix = b"" if not contents or contents.endswith(b"\n") else b"\n"
    updated = contents + suffix + b"".join(
        f"{name}={settings[name]}\n".encode("utf-8") for name in missing
    )
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=service_dir, prefix=".env.auto-trial-", delete=False) as handle:
            temporary_name = handle.name
            os.fchmod(handle.fileno(), 0o600)
            handle.write(updated)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, env_file)
        temporary_name = None
        verify_worker(compose_file, settings)
    except Exception:
        os.replace(backup, env_file)
        raise
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)
    print(f"Worker reseller settings verified; backup: {backup}")


if __name__ == "__main__":
    main()
