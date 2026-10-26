#!/usr/bin/env python3
"""Build only reseller.ts and worker dist over the immutable running worker.

Default is read-only preflight. --build creates a candidate but never deploys.
Source is extracted from the explicit immutable revision, never working files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

UUID = "eupquokyj7qegufqvqkjmuyr"
SOURCE_TAG = "flixify-worker:trial-20261013"
SOURCE_ID = "sha256:be19dd2e8d8cf67dcb9a2b9804eb9f7263ea04a9f486b385affc513effe4b924"
BASE_REVISION = "3a45597d196da68ecf68a0a02b5aa34fb24edea7"
PATH = "apps/worker/src/reseller.ts"
TEST_PATH = "apps/worker/src/auto-trial.test.ts"
SOURCE_SHA = "bfbbf361d3d95cd6cd7d01452c80618d2c62c191b0193936db878a8c9d0264a5"
MIN_FREE_BYTES = 3 * 1024**3


class GateError(Exception):
    pass


def command(*args: str, timeout: int = 90) -> bytes:
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GateError("command_unavailable") from error
    if result.returncode:
        raise GateError("command_failed")
    return result.stdout


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return f"flixify-worker:edge-recovery-{revision[:12]}-20261026"


def image(ref: str) -> dict:
    values = json.loads(command("docker", "image", "inspect", ref))
    if len(values) != 1:
        raise GateError("image_inspection_invalid")
    return values[0]


def read_source(ref: str) -> bytes:
    return command("docker", "run", "--rm", "--network", "none", "--entrypoint", "cat", ref, "/app/" + PATH)


def git_file(repo: Path, revision: str, path: str = PATH) -> bytes:
    return command("git", "-C", str(repo), "show", f"{revision}:{path}")


def preflight(repo: Path, revision: str) -> tuple[dict, bytes]:
    target(revision)
    if command("git", "-C", str(repo), "rev-parse", f"{revision}^{{commit}}").decode().strip() != revision:
        raise GateError("revision_not_exact_commit")
    base = image(SOURCE_ID)
    if base["Id"] != SOURCE_ID or image(SOURCE_TAG)["Id"] != SOURCE_ID:
        raise GateError("worker_source_image_drift")
    current = json.loads(command("docker", "inspect", f"worker-{UUID}"))[0]
    if current["Image"] != SOURCE_ID or current["Config"]["Image"] != SOURCE_TAG or not current["State"]["Running"]:
        raise GateError("worker_running_image_drift")
    if (current["Config"].get("Labels") or {}).get("com.docker.compose.project") != UUID:
        raise GateError("worker_project_drift")
    original = read_source(SOURCE_ID)
    if hashlib.sha256(original).hexdigest() != SOURCE_SHA or original != git_file(repo, BASE_REVISION):
        raise GateError("worker_live_source_not_exact_git_baseline")
    updated = git_file(repo, revision)
    if updated == original:
        raise GateError("worker_candidate_unchanged")
    changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision,
                      "--", "apps/worker/src").decode().splitlines()
    if {path for path in changed if ".test." not in path} != {PATH}:
        raise GateError("worker_runtime_overlay_scope_differs")
    return base, updated


def dockerfile(revision: str) -> str:
    target(revision)
    return "\n".join((
        f"FROM {SOURCE_ID}",
        f"LABEL org.opencontainers.image.revision={revision}",
        f"LABEL vip.flixify.edge-recovery.base={SOURCE_ID}",
        f"COPY {PATH} /app/{PATH}",
        "RUN npm run build -w @flixify/worker",
        "",
    ))


def verify_candidate(base: dict, revision: str, updated: bytes) -> str:
    candidate = image(target(revision))
    labels = candidate.get("Config", {}).get("Labels") or {}
    if candidate["Id"] == SOURCE_ID or labels.get("org.opencontainers.image.revision") != revision or labels.get("vip.flixify.edge-recovery.base") != SOURCE_ID:
        raise GateError("worker_candidate_identity_invalid")
    base_layers = base.get("RootFS", {}).get("Layers") or []
    if not base_layers or candidate.get("RootFS", {}).get("Layers", [])[:len(base_layers)] != base_layers:
        raise GateError("worker_candidate_not_from_pinned_base")
    if read_source(candidate["Id"]) != updated:
        raise GateError("worker_candidate_source_differs")
    # Build inherits command, env, dependencies, and every other file from base.
    expected_config = dict(base["Config"])
    expected_config["Labels"] = dict(expected_config.get("Labels") or {}) | {
        "org.opencontainers.image.revision": revision,
        "vip.flixify.edge-recovery.base": SOURCE_ID,
    }
    runtime_keys = ("Env", "Cmd", "Entrypoint", "WorkingDir", "User", "Healthcheck", "Volumes", "ExposedPorts", "StopSignal", "Shell", "Labels")
    if any(candidate["Config"].get(key) != expected_config.get(key) for key in runtime_keys):
        raise GateError("worker_candidate_runtime_config_differs")
    command("docker", "run", "--rm", "--network", "none", "--entrypoint", "node", candidate["Id"], "--check", "/app/apps/worker/dist/index.js")
    return candidate["Id"]


def test_candidate(repo: Path, revision: str, candidate_id: str) -> None:
    # Tests are mounted from the same reviewed commit without adding them or
    # development package changes to the image. Network is disabled entirely.
    contents = git_file(repo, revision, TEST_PATH)
    with tempfile.TemporaryDirectory(prefix="flixify-worker-edge-test-") as directory:
        test = Path(directory) / "auto-trial.test.ts"
        test.write_bytes(contents)
        command("docker", "run", "--rm", "--network", "none", "-v",
                f"{test}:/app/{TEST_PATH}:ro", "--entrypoint", "npx", candidate_id,
                "--no-install", "vitest", "run", "--root", "/app", TEST_PATH,
                timeout=180)
    print("candidate_worker_regressions_passed; network_disabled")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True, help="full reviewed application commit")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    base, updated = preflight(args.source_repo, args.revision)
    if args.verify_existing:
        candidate_id = verify_candidate(base, args.revision, updated)
        test_candidate(args.source_repo, args.revision, candidate_id)
        print("candidate_verified:" + candidate_id)
        return
    if not args.build:
        print("worker_build_preflight_ok; no_mutation")
        return
    if shutil.disk_usage("/var/lib/docker").free < MIN_FREE_BYTES:
        raise GateError("insufficient_disk_worker_build_requires_3GiB")
    existing = command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines()
    if target(args.revision) in existing:
        raise GateError("candidate_tag_already_exists_use_verify_existing")
    with tempfile.TemporaryDirectory(prefix="flixify-worker-edge-") as directory:
        context = Path(directory)
        destination = context / PATH
        destination.parent.mkdir(parents=True)
        destination.write_bytes(updated)
        (context / "Dockerfile").write_text(dockerfile(args.revision))
        command("docker", "build", "--no-cache", "--rm", "--force-rm", "--pull=false", "--network=none",
                "-t", target(args.revision), str(context), timeout=600)
    candidate_id = verify_candidate(base, args.revision, updated)
    test_candidate(args.source_repo, args.revision, candidate_id)
    print("candidate_built:" + candidate_id)
    print("live_containers_unchanged; temporary_context_removed")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print(f"build_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print(f"build_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
