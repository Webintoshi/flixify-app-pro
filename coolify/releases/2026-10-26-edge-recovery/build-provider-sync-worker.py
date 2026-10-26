#!/usr/bin/env python3
"""Bounded worker entitlement candidate builder; default read-only preflight."""
from __future__ import annotations
import argparse
import importlib.util
import json
import re
import shlex
import shutil
import sys
import tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("provider_worker_bounded_helpers", Path(__file__).with_name("build-web.py"))
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
core = helpers.core
GateError, command = core.GateError, core.command
SOURCE_TAG = "flixify-worker:edge-recovery-7731936e27df-20261026"
SOURCE_ID = "sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3"
BASE_REVISION = "7731936e27df42925405f0686ccb8b625cb24abc"
PATHS = tuple("apps/worker/src/" + name for name in (
    "index.ts", "provider-entitlement.ts", "provider-entitlement-store.ts", "provider-entitlement-sync.ts"))
NEW_PATHS = PATHS[1:]
TEST_PATHS = tuple("apps/worker/src/" + name for name in (
    "provider-entitlement.test.ts", "provider-entitlement-store.test.ts", "provider-entitlement-sync.test.ts",
    "worker-scheduling.test.ts", "auto-trial.test.ts", "auto-trial-db.test.ts"))
FIXTURE_PATHS = ("supabase/migrations/202610260001_provider_entitlement_sync.sql",)
MIN_FREE_BYTES = helpers.MIN_FREE_BYTES
RUN_MEMORY_MIB = helpers.RUN_MEMORY_MIB
RUN_TOTAL_MEMORY_MIB = helpers.RUN_TOTAL_MEMORY_MIB
helpers.SOURCE_ID = SOURCE_ID


def target(revision):
    return core.target(revision)


def cgroup_script():
    # Reuse the exact v1/v2 actual-kernel gate, before any compile or tests.
    return helpers.build_script().split('const p=', 1)[0]


def require_regular(repo, revision, path):
    helpers.require_regular_blob(repo, revision, path)


def preflight(repo, revision):
    target(revision)
    for commit in (revision, BASE_REVISION):
        if command("git", "-C", str(repo), "rev-parse", f"{commit}^{{commit}}").decode().strip() != commit:
            raise GateError("revision_not_exact_commit")
    base = core.image(SOURCE_ID)
    if base["Id"] != SOURCE_ID or core.image(SOURCE_TAG)["Id"] != SOURCE_ID:
        raise GateError("worker_source_image_drift")
    current = json.loads(command("docker", "inspect", f"worker-{core.UUID}"))[0]
    if current["Image"] != SOURCE_ID or current["Config"]["Image"] != SOURCE_TAG or not current["State"]["Running"]:
        raise GateError("worker_running_image_drift")
    if (current["Config"].get("Labels") or {}).get("com.docker.compose.project") != core.UUID:
        raise GateError("worker_project_drift")
    changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision,
                      "--", "apps/worker/src").decode().splitlines()
    if {path for path in changed if ".test." not in path} != set(PATHS):
        raise GateError("worker_runtime_overlay_scope_differs")
    updated = {}
    for path in PATHS:
        require_regular(repo, revision, path)
        if path in NEW_PATHS:
            if helpers.git_entry(repo, BASE_REVISION, path):
                raise GateError("worker_new_path_exists_in_baseline")
            for ancestor in Path(path).parents:
                if str(ancestor) == ".":
                    continue
                entry = helpers.git_entry(repo, BASE_REVISION, str(ancestor))
                if entry and not entry.startswith(b"040000 tree "):
                    raise GateError("worker_new_path_baseline_ancestor_not_tree")
            helpers.require_image_absent(path)
        else:
            original = core.git_file(repo, BASE_REVISION, path)
            if helpers.image_file(SOURCE_ID, path) != original:
                raise GateError("worker_live_source_not_exact_git_baseline")
            if core.git_file(repo, revision, path) == original:
                raise GateError("worker_candidate_unchanged")
        updated[path] = core.git_file(repo, revision, path)
    for path in (*TEST_PATHS, *FIXTURE_PATHS):
        require_regular(repo, revision, path)
    return base, updated


def dockerfile(revision):
    target(revision)
    script = cgroup_script() + 'cp.execFileSync("npm",["run","build","-w","@flixify/worker"],{stdio:"inherit"});'
    return "\n".join([f"FROM {SOURCE_TAG}", f"LABEL org.opencontainers.image.revision={revision}",
        f"LABEL vip.flixify.edge-recovery.base={SOURCE_ID}",
        *(f"COPY {path} /app/{path}" for path in PATHS), "RUN node -e " + shlex.quote(script), ""])


def verify_candidate(base, revision, updated):
    candidate = core.image(target(revision))
    labels = candidate.get("Config", {}).get("Labels") or {}
    if candidate["Id"] == SOURCE_ID or labels.get("org.opencontainers.image.revision") != revision or labels.get("vip.flixify.edge-recovery.base") != SOURCE_ID:
        raise GateError("worker_candidate_identity_invalid")
    layers = base.get("RootFS", {}).get("Layers") or []
    if not layers or candidate.get("RootFS", {}).get("Layers", [])[:len(layers)] != layers:
        raise GateError("worker_candidate_not_from_pinned_base")
    for path, contents in updated.items():
        if helpers.image_file(candidate["Id"], path) != contents:
            raise GateError("worker_candidate_source_differs")
    expected = dict(base["Config"])
    expected["Labels"] = dict(expected.get("Labels") or {}) | {
        "org.opencontainers.image.revision": revision, "vip.flixify.edge-recovery.base": SOURCE_ID}
    for key in ("Env", "Cmd", "Entrypoint", "WorkingDir", "User", "Healthcheck", "Volumes", "ExposedPorts", "StopSignal", "Shell", "Labels"):
        if candidate["Config"].get(key) != expected.get(key):
            raise GateError("worker_candidate_runtime_config_differs")
    command("docker", "run", "--rm", "--network", "none", "--entrypoint", "node", candidate["Id"], "--check", "/app/apps/worker/dist/index.js")
    return candidate["Id"]


def test_candidate(repo, revision, candidate_id):
    with tempfile.TemporaryDirectory(prefix="flixify-provider-worker-test-") as directory:
        mounts = []
        for path in (*TEST_PATHS, *FIXTURE_PATHS):
            require_regular(repo, revision, path)
            test = Path(directory) / Path(path).name
            test.write_bytes(core.git_file(repo, revision, path))
            mounts.extend(("-v", f"{test}:/app/{path}:ro"))
        script = cgroup_script() + 'cp.execFileSync("npx",'+json.dumps(["--no-install", "vitest", "run", "--root", "/app", *TEST_PATHS])+',{stdio:"inherit"});'
        command("docker", "run", "--rm", "--network", "none", "--memory", f"{RUN_MEMORY_MIB}m",
                "--memory-swap", f"{RUN_TOTAL_MEMORY_MIB}m", *mounts,
                "--entrypoint", "node", candidate_id, "-e", script, timeout=240)
    print("candidate_worker_regressions_passed; network_disabled; actual_cgroup_bounded")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    base, updated = preflight(args.source_repo, args.revision)
    if not (args.build or args.verify_existing):
        print("worker_build_preflight_ok; no_mutation")
        return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free < MIN_FREE_BYTES:
            raise GateError("insufficient_disk_worker_build_requires_8GiB")
        existing = command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines()
        if target(args.revision) in existing:
            raise GateError("candidate_tag_already_exists_use_verify_existing")
        with tempfile.TemporaryDirectory(prefix="flixify-provider-worker-") as directory:
            context = Path(directory)
            for path, contents in updated.items():
                destination = context / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(contents)
            (context / "Dockerfile").write_text(dockerfile(args.revision))
            command("docker", "build", "--load", "--no-cache", "--rm", "--force-rm", "--pull=false", "--network=none",
                    "--resource", f"memory={RUN_MEMORY_MIB}m", "--resource", f"memory-swap={RUN_TOTAL_MEMORY_MIB}m",
                    "-t", target(args.revision), str(context), timeout=600)
    candidate_id = verify_candidate(base, args.revision, updated)
    test_candidate(args.source_repo, args.revision, candidate_id)
    print("candidate_verified:" + candidate_id)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print(f"build_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print(f"build_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
