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
API_SERVER = "apps/api/src/server.ts"
PINNED_API_SERVER_SHA256 = "490ab6772938338c33b7c65d0556dd9b7d6dbcab1b2708919da9a5201a752f47"
CANDIDATE_API_TEST = "coolify/releases/2026-10-23-playback-fix/candidate-vod-direct.test.ts"
CANDIDATE_API_TEST_SHA256 = "8324db67abe5b38500f567e9ecbdca336ee4a48af58560a95464f0cb1b2b5f46"
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


def verify_pinned_api_source(source: bytes) -> None:
    if hashlib.sha256(source).hexdigest() != PINNED_API_SERVER_SHA256:
        raise GateError("api_source_hash_differs")


def api_insertions(repo: Path) -> tuple[bytes, bytes]:
    """Pin the two additive changes in the release commit before merging them."""
    previous = git_file(repo, REVISION + "^", API_SERVER)
    revised = git_file(repo, REVISION, API_SERVER)
    helper_start = b"function isHttpsVodSourceUrl("
    helper_end = b"function buildDirectVodPlaybackFallback("
    branch_start = b"      const directTransport = guessVodTransportFromPath(record.stream_path);"
    branch_end = b"      let resolved: Awaited<ReturnType<typeof resolveVodSourceUrl>>;"
    if revised.count(helper_start) != 1 or revised.count(helper_end) != 1 or \
       revised.count(branch_start) != 1 or revised.count(branch_end) != 1:
        raise GateError("unexpected_api_commit_shape")
    helper = revised[revised.index(helper_start):revised.index(helper_end)]
    branch_begin = revised.index(branch_start)
    branch = revised[branch_begin:revised.index(branch_end, branch_begin)]
    if not helper or not branch or previous != revised.replace(helper, b"", 1).replace(branch, b"", 1):
        raise GateError("api_commit_is_not_additive")
    return helper, branch


def verify_api_patch(repo: Path, original: bytes, patched: bytes) -> None:
    helper, branch = api_insertions(repo)
    if original.count(helper) or original.count(branch):
        raise GateError("api_patch_already_present")
    if patched.count(helper) != 1 or patched.count(branch) != 1 or \
       patched.replace(helper, b"", 1).replace(branch, b"", 1) != original:
        raise GateError("api_patch_changed_existing_source")
    route = b'app.get("/me/vod/:kind/:itemId/playback"'
    if patched.count(route) != 1 or not (
        patched.index(route) < patched.index(branch) < patched.index(b"      let resolved:", patched.index(route))
    ):
        raise GateError("api_patch_outside_playback_route")


def apply_api_patch(repo: Path, root: Path, original: bytes) -> bytes:
    api_insertions(repo)
    patch = command("git", "-C", str(repo), "diff", "--no-ext-diff", "--no-textconv",
                    REVISION + "^", REVISION, "--", API_SERVER)
    if patch.count(b"diff --git ") != 1 or not patch.startswith(
        b"diff --git a/apps/api/src/server.ts b/apps/api/src/server.ts\n"
    ):
        raise GateError("unexpected_api_patch_scope")
    destination = root / API_SERVER
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(original)
    patch_file = root / "api-playback.patch"
    patch_file.write_bytes(patch)
    command("git", "-C", str(root), "apply", "--check", str(patch_file))
    command("git", "-C", str(root), "apply", str(patch_file))
    patched = destination.read_bytes()
    verify_api_patch(repo, original, patched)
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
    original = command("docker", "run", "--rm", "--network", "none",
                       "--entrypoint", "cat", BASE["api"][0], "/app/" + API_SERVER)
    patched = command("docker", "run", "--rm", "--network", "none",
                      "--entrypoint", "cat", TARGET["api"], "/app/" + API_SERVER)
    verify_pinned_api_source(original)
    verify_api_patch(repo, original, patched)
    verify_candidate_api_bundle()


def verify_candidate_api_bundle() -> None:
    bundle = command("docker", "run", "--rm", "--network", "none",
                     "--entrypoint", "cat", TARGET["api"], "/app/apps/api/dist/server.js")
    if b"function isHttpsVodSourceUrl(" not in bundle or \
       b"const directTransport = guessVodTransportFromPath(record.stream_path);" not in bundle:
        raise GateError("api_candidate_bundle_missing_direct_branch")


def test_candidate_api(repo: Path, scratch: Path) -> None:
    source = repo / CANDIDATE_API_TEST
    if not source.is_file():
        raise GateError("candidate_api_test_missing")
    contents = source.read_bytes()
    if hashlib.sha256(contents).hexdigest() != CANDIDATE_API_TEST_SHA256:
        raise GateError("candidate_api_test_hash_differs")
    test = scratch / "candidate-vod-direct.test.ts"
    test.write_bytes(contents)
    command("docker", "run", "--rm", "--network", "none", "-v",
            f"{test}:/app/apps/api/src/candidate-vod-direct.test.ts:ro",
            "--entrypoint", "npm", TARGET["api"], "test", "-w", "@flixify/api",
            "--", "src/candidate-vod-direct.test.ts", timeout=180)
    print("candidate_api_trial_and_paid_episode_playback_test_passed")


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
            if name == "api" and path == API_SERVER:
                # The pinned live image also contains the 13 October catalog
                # guard. It must remain the base for this additive VOD patch.
                verify_pinned_api_source(in_image)
                if b"shouldUseAccountMovieCatalog" not in in_image or \
                   b"accountVodProxyConfigured" not in in_image:
                    raise GateError("api_catalog_guard_missing")
                api_insertions(repo)
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
        if name == "api" and path == API_SERVER:
            in_image = command("docker", "run", "--rm", "--network", "none",
                               "--entrypoint", "cat", BASE[name][0], "/app/" + path)
            verify_pinned_api_source(in_image)
            apply_api_patch(repo, root, in_image)
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
        if name == "api" and path == API_SERVER:
            original = command("docker", "run", "--rm", "--network", "none",
                               "--entrypoint", "cat", BASE[name][0], "/app/" + path)
            verify_pinned_api_source(original)
            verify_api_patch(repo, original, in_image)
        elif in_image != git_file(repo, REVISION, path):
            raise GateError(f"candidate_source_file_differs:{name}")
    if name == "api":
        verify_candidate_api_bundle()
        test_candidate_api(repo, root)
    print(f"candidate_built:{name}:{candidate['Id']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path,
                        help="Git checkout containing commit 661b498; it is never edited")
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
