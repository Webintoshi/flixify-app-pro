#!/usr/bin/env python3
"""Build exact-commit API/web overlays from pinned running images, without deploy.

Requires a Git checkout containing the release commit. Reads only public web
build settings from the existing web container. Does not print those values,
Docker build logs, provider credentials, or any environment contents.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


UUID = "eupquokyj7qegufqvqkjmuyr"
REVISION = "9830208163582ac49af89b5f29b4993c42b1ea19"
BASE_REVISION = "51be56cfa2927c3f4a41a84e5a4f3acfaa4a0cea"
BASE = {
    "api": (
        "flixify-api:playback-fix-39300d0-20261023",
        "sha256:4ecc3ae69eb72318de48ee1a3c0d01877059fac53637967fbf7686c26da4674a",
    ),
    "ops-web": (
        "flixify-ops-web:playback-fix-39300d0-20261023",
        "sha256:d072c18562ca3892bd1ccb020306e033df88a802b650a68050b6a8a10f568319",
    ),
}
TARGET = {
    "api": "flixify-api:viewer-ip-9830208-20261026",
    "ops-web": "flixify-ops-web:viewer-ip-9830208-20261026",
}
PINNED_API_SOURCES = {
    "apps/api/src/server.ts": "79ca80dc7996fd532dbd89984c89b0f18ada63ff050337d7d274a51e84714283",
    "apps/api/src/repository.ts": "2b3cd5d2b9de0b3d340733b01af1a4b171c9c9ff88536f4120d69b78e3b760b9",
}
NEW_FILES = {"apps/api/src/client-playback-access.ts", "apps/ops-web/app/platform/direct-playback-deadline.ts", "apps/ops-web/app/platform/playback-transport.ts"}
OVERLAYS = {
    "api": (*PINNED_API_SOURCES, "apps/api/src/client-playback-access.ts"),
    "ops-web": ("apps/ops-web/app/platform/detail.tsx", "apps/ops-web/app/canli-tv/page.tsx", "apps/ops-web/app/platform/direct-playback-deadline.ts", "apps/ops-web/app/platform/playback-transport.ts"),
}
API_SERVER = "apps/api/src/server.ts"
CANDIDATE_API_TEST = "coolify/releases/2026-10-26-viewer-ip/candidate-viewer-playback.test.ts"
CANDIDATE_API_TEST_SHA256 = "73cd04f3e75d474d91ae30673643397c36d762c8a5725f8d86a626ac26e0433a"
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


def verify_pinned_api_source(source: bytes, path: str = API_SERVER) -> None:
    if hashlib.sha256(source).hexdigest() != PINNED_API_SOURCES[path]:
        raise GateError("api_source_hash_differs:" + path)


def api_patch(repo: Path, path: str = API_SERVER) -> bytes:
    patch = command("git", "-C", str(repo), "diff", "--no-ext-diff", "--no-textconv",
                    BASE_REVISION, REVISION, "--", path)
    if path not in PINNED_API_SOURCES or patch.count(b"diff --git ") != 1 or not patch.startswith(
        f"diff --git a/{path} b/{path}\n".encode()
    ):
        raise GateError("unexpected_api_patch_scope")
    return patch


def verify_api_patch(repo: Path, original: bytes, patched: bytes, path: str = API_SERVER) -> None:
    verify_pinned_api_source(original, path)
    with tempfile.TemporaryDirectory(prefix="flixify-api-patch-verify-") as directory:
        root = Path(directory)
        destination = root / path
        destination.parent.mkdir(parents=True)
        destination.write_bytes(original)
        patch_file = root / "api-viewer.patch"
        patch_file.write_bytes(api_patch(repo, path))
        command("git", "-C", str(root), "apply", "--check", str(patch_file))
        command("git", "-C", str(root), "apply", str(patch_file))
        if destination.read_bytes() != patched:
            raise GateError("api_patch_changed_existing_source")
    # Byte equality above preserves every live-only catalog/adult policy byte.


def apply_api_patch(repo: Path, root: Path, original: bytes, path: str = API_SERVER) -> bytes:
    verify_pinned_api_source(original, path)
    destination = root / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(original)
    patch_file = root / "api-viewer.patch"
    patch_file.write_bytes(api_patch(repo, path))
    command("git", "-C", str(root), "apply", "--check", str(patch_file))
    command("git", "-C", str(root), "apply", str(patch_file))
    patched = destination.read_bytes()
    verify_api_patch(repo, original, patched, path)
    return patched


def verify_candidate_api_source(repo: Path) -> None:
    base = inspect(BASE["api"][0])
    candidate = inspect(TARGET["api"])
    if base["Id"] != BASE["api"][1] or candidate["Id"] == base["Id"]:
        raise GateError("api_candidate_image_differs")
    labels = candidate.get("Config", {}).get("Labels") or {}
    if labels.get("org.opencontainers.image.revision") != REVISION:
        raise GateError("api_candidate_revision_differs")
    base_layers = base.get("RootFS", {}).get("Layers") or []
    candidate_layers = candidate.get("RootFS", {}).get("Layers") or []
    if not base_layers or candidate_layers[:len(base_layers)] != base_layers:
        raise GateError("api_candidate_base_differs")
    for path in OVERLAYS["api"]:
        patched = command("docker", "run", "--rm", "--network", "none", "--entrypoint", "cat", TARGET["api"], "/app/" + path)
        if path in PINNED_API_SOURCES:
            original = command("docker", "run", "--rm", "--network", "none", "--entrypoint", "cat", BASE["api"][0], "/app/" + path)
            verify_api_patch(repo, original, patched, path)
        elif patched != git_file(repo, REVISION, path):
            raise GateError("candidate_source_file_differs:api")


def test_candidate_api(repo: Path, scratch: Path) -> None:
    source = repo / CANDIDATE_API_TEST
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != CANDIDATE_API_TEST_SHA256:
        raise GateError("candidate_api_test_hash_differs")
    test = scratch / "candidate-viewer-playback.test.ts"
    test.write_bytes(source.read_bytes())
    command("docker", "run", "--rm", "--network", "none", "-v",
            f"{test}:/app/{CANDIDATE_API_TEST}:ro", "--entrypoint", "npx", TARGET["api"],
            "--no-install", "vitest", "run", "--root", "/app", CANDIDATE_API_TEST, timeout=180)
    print("candidate_viewer_playback_test_passed")


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
            if path in NEW_FILES:
                command("docker", "run", "--rm", "--network", "none", "--entrypoint", "sh", tag, "-c", 'test ! -e "$1"', "sh", "/app/" + path)
                continue
            previous = git_file(repo, BASE_REVISION, path)
            in_image = command("docker", "run", "--rm", "--network", "none",
                               "--entrypoint", "cat", tag, "/app/" + path)
            if path in PINNED_API_SOURCES:
                # The pinned live image also contains the 13 October catalog
                # guard. It must remain the base for this additive VOD patch.
                verify_pinned_api_source(in_image, path)
                if path == API_SERVER and b"shouldUseAccountMovieCatalog" not in in_image:
                    raise GateError("api_catalog_guard_missing")
                api_patch(repo, path)
            elif in_image != previous:
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
        if path in PINNED_API_SOURCES:
            in_image = command("docker", "run", "--rm", "--network", "none",
                               "--entrypoint", "cat", BASE[name][0], "/app/" + path)
            verify_pinned_api_source(in_image, path)
            apply_api_patch(repo, root, in_image, path)
        else:
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
        if path in PINNED_API_SOURCES:
            original = command("docker", "run", "--rm", "--network", "none",
                               "--entrypoint", "cat", BASE[name][0], "/app/" + path)
            verify_pinned_api_source(original, path)
            verify_api_patch(repo, original, in_image, path)
        elif in_image != git_file(repo, REVISION, path):
            raise GateError(f"candidate_source_file_differs:{name}")
    if name == "api":
        test_candidate_api(repo, root)
    print(f"candidate_built:{name}:{candidate['Id']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path,
                        help="Git checkout containing the pinned playback revision; it is never edited")
    parser.add_argument("--only", choices=("api", "ops-web"),
                        help="build only this image after an interrupted candidate build")
    parser.add_argument("--verify-existing-api", action="store_true",
                        help="verify and test the already built API candidate without rebuilding it")
    args = parser.parse_args()
    if args.verify_existing_api:
        if args.only:
            raise GateError("conflicting_build_options")
        verify_candidate_api_source(args.source_repo)
        with tempfile.TemporaryDirectory(prefix="flixify-playback-test-") as directory:
            test_candidate_api(args.source_repo, Path(directory))
        print("existing_api_candidate_verified; live_containers_unchanged")
        return
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
