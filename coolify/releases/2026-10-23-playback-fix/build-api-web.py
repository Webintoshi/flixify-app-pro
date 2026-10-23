#!/usr/bin/env python3
"""Build exact-commit API/web overlays from pinned running images, without deploy.

Requires a Git checkout containing the release commit. Reads only public web
build settings from the existing web container. Does not print those values,
Docker build logs, provider credentials, or any environment contents.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


UUID = "eupquokyj7qegufqvqkjmuyr"
REVISION = "661b498e515eccf470a208a78a2db9654ecef3cf"
BASE = {
    "api": (
        "flixify-api:proxy-free-movies-v2-20261013",
        "sha256:c98c538c8862e33e0186ea33bdf61d627a27aa7704a41d9167dc5071ccfe51b4",
    ),
    "ops-web": (
        "flixify-ops-web:trial-20261013",
        "sha256:aba6768b9622ae8b8684d8727264d45d4d6845cbc3989c1d0f0026b319d96bff",
    ),
}
TARGET = {
    "api": "flixify-api:playback-fix-661b498-20261023",
    "ops-web": "flixify-ops-web:playback-fix-661b498-20261023",
}
OVERLAYS = {
    "api": ("apps/api/src/server.ts",),
    "ops-web": (
        "apps/ops-web/app/platform/catalog-empty.ts",
        "apps/ops-web/app/platform/catalog.tsx",
    ),
}
PUBLIC_WEB_KEYS = (
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_APP_DEMO_MODE",
    "NEXT_PUBLIC_SUPPORT_WHATSAPP",
    "NEXT_PUBLIC_SUPPORT_TELEGRAM",
)


class GateError(Exception):
    pass


def command(*args: str, timeout: int = 60) -> bytes:
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GateError("command_unavailable") from exc
    if result.returncode:
        raise GateError("command_failed")
    return result.stdout


def inspect(tag: str) -> dict:
    values = json.loads(command("docker", "image", "inspect", tag))
    if len(values) != 1:
        raise GateError("image_inspection_invalid")
    return values[0]


def running(name: str) -> dict:
    values = json.loads(command("docker", "inspect", f"{name}-{UUID}"))
    if len(values) != 1:
        raise GateError("container_inspection_invalid")
    return values[0]


def git_file(repo: Path, revision: str, path: str) -> bytes:
    return command("git", "-C", str(repo), "show", f"{revision}:{path}")


def public_web_environment() -> dict[str, str]:
    entries = running("ops-web")["Config"].get("Env") or []
    env = dict(item.split("=", 1) for item in entries if "=" in item)
    missing = [key for key in PUBLIC_WEB_KEYS if key not in env]
    if missing:
        raise GateError("missing_public_web_build_settings")
    return {key: env[key] for key in PUBLIC_WEB_KEYS}


def check_source(repo: Path, names: tuple[str, ...]) -> None:
    if not repo.is_dir():
        raise GateError("source_checkout_missing")
    commit = command("git", "-C", str(repo), "rev-parse", f"{REVISION}^{{commit}}")
    if commit.decode().strip() != REVISION:
        raise GateError("source_revision_differs")
    for name in names:
        tag, expected_id = BASE[name]
        source = inspect(tag)
        current = running(name)
        if source["Id"] != expected_id or current["Image"] != expected_id or \
           current["Config"]["Image"] != tag or not current["State"]["Running"]:
            raise GateError(f"base_image_or_running_container_drift:{name}")
        labels = current["Config"].get("Labels") or {}
        if labels.get("com.docker.compose.project") != UUID:
            raise GateError(f"unexpected_compose_project:{name}")
        for path in OVERLAYS[name]:
            previous = git_file(repo, REVISION + "^", path)
            in_image = command("docker", "run", "--rm", "--network", "none",
                               "--entrypoint", "cat", tag, "/app/" + path)
            if in_image != previous:
                raise GateError(f"base_source_file_drift:{name}")
        try:
            inspect(TARGET[name])
        except GateError:
            pass
        else:
            raise GateError(f"candidate_tag_already_exists:{name}")


def build_one(repo: Path, name: str, web_env: dict[str, str], scratch: Path) -> None:
    root = scratch / name
    root.mkdir()
    for path in OVERLAYS[name]:
        destination = root / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(git_file(repo, REVISION, path))
    tag = BASE[name][0]
    lines = [f"FROM {tag}", f"LABEL org.opencontainers.image.revision={REVISION}"]
    build_args: list[str] = []
    if name == "ops-web":
        for key in PUBLIC_WEB_KEYS:
            lines.append(f"ARG {key}")
            lines.append(f"ENV {key}=${{{key}}}")
            build_args.extend(("--build-arg", f"{key}={web_env[key]}"))
    for path in OVERLAYS[name]:
        lines.append(f"COPY {path} /app/{path}")
    lines.append("RUN npm run build -w @flixify/api" if name == "api"
                 else "RUN npm run build -w @flixify/ops-web")
    (root / "Dockerfile").write_text("\n".join(lines) + "\n", encoding="utf-8")
    command("docker", "build", "--no-cache", "--pull=false", "--network=none",
            "-t", TARGET[name], "-f", str(root / "Dockerfile"),
            *build_args, str(root), timeout=1200)
    candidate = inspect(TARGET[name])
    if candidate["Id"] == BASE[name][1] or \
       (candidate.get("Config", {}).get("Labels") or {}).get(
           "org.opencontainers.image.revision") != REVISION:
        raise GateError(f"candidate_image_invalid:{name}")
    for path in OVERLAYS[name]:
        in_image = command("docker", "run", "--rm", "--network", "none",
                           "--entrypoint", "cat", TARGET[name], "/app/" + path)
        if in_image != git_file(repo, REVISION, path):
            raise GateError(f"candidate_source_file_differs:{name}")
    print(f"candidate_built:{name}:{candidate['Id']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path,
                        help="Git checkout containing commit 661b498; it is never edited")
    parser.add_argument("--only", choices=("api", "ops-web"),
                        help="build only this image after an interrupted candidate build")
    args = parser.parse_args()
    names = (args.only,) if args.only else ("api", "ops-web")
    check_source(args.source_repo, names)
    web_env = public_web_environment() if "ops-web" in names else {}
    with tempfile.TemporaryDirectory(prefix="flixify-playback-build-") as directory:
        scratch = Path(directory)
        for name in names:
            build_one(args.source_repo, name, web_env, scratch)
    print("candidate_builds_complete; live_containers_unchanged")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print(f"build_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError) as error:
        print(f"build_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
