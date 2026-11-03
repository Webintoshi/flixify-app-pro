#!/usr/bin/env python3
"""Build and verify the forced-consent web/APK image without touching live services."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load(
    "forced_consent_base_builder",
    HERE.parent / "2026-10-26-edge-recovery" / "build-web.py",
)
GateError, command = builder.GateError, builder.command
SOURCE_TAG = "flixify-ops-web:tv-first-content-publication-4d6cb8548e1c-20261103"
SOURCE_ID = "sha256:8cae91c65a3fd53762ed13d6b6d27cd3893f58965b4c3766bed35711e48aa873"
BASE_REVISION = "4d6cb8548e1c17047b78d516599f6d7ba86bbe40"
API_TAG = "flixify-api:analytics-07fbf0bf4b29-20261102"
API_ID = "sha256:b7ef006b1733516a73f5ef1e5388b2cc7e746f738d0e4ebd80c164ad34067eb0"
WORKER_TAG = "flixify-worker:packages-8fa66d103053-20261101"
WORKER_ID = "sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57"
DB_ID = "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
RUNTIME_PATHS = (
    "apps/ops-web/app/ayarlar/page.tsx",
    "apps/ops-web/app/components/home/HomeFooter.tsx",
    "apps/ops-web/app/components/install/InstallProvider.tsx",
    "apps/ops-web/app/platform/analytics-policy.ts",
    "apps/ops-web/app/platform/analytics-provider.tsx",
    "apps/ops-web/app/platform/analytics.ts",
    "apps/ops-web/app/platform/landing.tsx",
    "apps/ops-web/app/platform/tv-download.ts",
    "apps/ops-web/app/site-shell.tsx",
)
DELETED_PATH = "apps/ops-web/app/platform/analytics.module.css"
APK_PATH = "apps/ops-web/public/downloads/flixify-pro-1.4.12.apk"
UPDATE_PATH = "apps/ops-web/public/downloads/flixify-tv-update.json"
PUBLIC_PATHS = (APK_PATH, UPDATE_PATH)
APK_SHA256 = "e4547bb775779e1f9c63842df5af12eccdfe863de6ccba732fca8a86e03beef0"
APK_BYTES = 2157091
UUID = builder.UUID


def target(revision: str) -> str:
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return f"flixify-ops-web:forced-consent-{revision[:12]}-20261103"


def git_file(repo: Path, revision: str, path: str) -> bytes:
    return command("git", "-C", str(repo), "show", f"{revision}:{path}")


def image_absent(image: str, path: str) -> None:
    script = 'test ! -e "$1" && test ! -L "$1"'
    command("docker", "run", "--rm", "--network", "none", "--entrypoint", "sh", image,
            "-c", script, "sh", "/app/" + path)


def public_manifest(image: str) -> dict:
    script = r'''const fs=require("node:fs"),crypto=require("node:crypto"),root="/app/apps/ops-web/public";
const out={};function walk(dir){for(const name of fs.readdirSync(dir).sort()){const p=dir+"/"+name,s=fs.lstatSync(p);
if(s.isSymbolicLink())process.exit(2);if(s.isDirectory())walk(p);else if(s.isFile()){const b=fs.readFileSync(p);
out[p.slice(root.length+1)]={bytes:b.length,sha256:crypto.createHash("sha256").update(b).digest("hex")};}else process.exit(3)}}
walk(root);process.stdout.write(JSON.stringify(out));'''
    return json.loads(command("docker", "run", "--rm", "--network", "none", "--entrypoint", "node", image, "-e", script))


def protected_snapshot() -> dict:
    names = ("api", "worker", "db")
    expected = {"api": (API_TAG, API_ID), "worker": (WORKER_TAG, WORKER_ID), "db": ("postgres:16-alpine", DB_ID)}
    result = {}
    for name in names:
        rows = json.loads(command("docker", "inspect", f"{name}-{UUID}"))
        if not isinstance(rows, list) or len(rows) != 1:
            raise GateError("protected_container_missing:" + name)
        row = rows[0]
        tag, image = expected[name]
        if (row.get("Image") != image or row.get("Config", {}).get("Image") != tag
                or row.get("State", {}).get("Running") is not True
                or row.get("State", {}).get("Health", {}).get("Status") == "unhealthy"):
            raise GateError("protected_container_drift:" + name)
        result[name] = {
            "id": row.get("Id"), "image": row.get("Image"),
            "started": row.get("State", {}).get("StartedAt"), "restarts": row.get("RestartCount"),
        }
    directory = Path("/data/coolify/services") / UUID
    for name in (".env", ".live-registration-rollout.json", "docker-compose.yml"):
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise GateError("protected_host_file_missing:" + name)
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def source_preflight(repo: Path, revision: str):
    if command("git", "-C", str(repo), "rev-parse", f"{revision}^{{commit}}").decode().strip() != revision:
        raise GateError("revision_not_exact_commit")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", BASE_REVISION, revision)
    base = builder.core.image(SOURCE_ID)
    if base["Id"] != SOURCE_ID or builder.core.image(SOURCE_TAG)["Id"] != SOURCE_ID:
        raise GateError("web_base_image_drift")
    current = json.loads(command("docker", "inspect", f"ops-web-{UUID}"))[0]
    if (current.get("Image") != SOURCE_ID or current.get("Config", {}).get("Image") != SOURCE_TAG
            or current.get("State", {}).get("Running") is not True or current.get("RestartCount") != 0):
        raise GateError("running_web_drift")
    rows = command("git", "-C", str(repo), "diff", "--name-status", BASE_REVISION, revision,
                   "--", "apps/ops-web").decode().splitlines()
    actual = {}
    for row in rows:
        status, path = row.split("\t", 1)
        if ".test." not in path:
            actual[path] = status
    expected = {path: "M" for path in RUNTIME_PATHS} | {DELETED_PATH: "D", APK_PATH: "A", UPDATE_PATH: "M"}
    if actual != expected:
        raise GateError("web_publication_scope_differs")
    updated = {}
    for path in (*RUNTIME_PATHS, UPDATE_PATH):
        original = git_file(repo, BASE_REVISION, path)
        if builder.image_file(SOURCE_ID, path) != original:
            raise GateError("web_base_source_differs:" + path)
        updated[path] = git_file(repo, revision, path)
        if updated[path] == original:
            raise GateError("web_overlay_unchanged:" + path)
    if builder.image_file(SOURCE_ID, DELETED_PATH) != git_file(repo, BASE_REVISION, DELETED_PATH):
        raise GateError("deleted_file_base_differs")
    if command("git", "-C", str(repo), "ls-tree", revision, "--", DELETED_PATH):
        raise GateError("deleted_file_still_tracked")
    if command("git", "-C", str(repo), "ls-tree", BASE_REVISION, "--", APK_PATH):
        raise GateError("new_apk_exists_in_baseline")
    image_absent(SOURCE_ID, APK_PATH)
    updated[APK_PATH] = git_file(repo, revision, APK_PATH)
    if len(updated[APK_PATH]) != APK_BYTES or hashlib.sha256(updated[APK_PATH]).hexdigest() != APK_SHA256:
        raise GateError("apk_identity_differs")
    update = json.loads(updated[UPDATE_PATH])
    if (update.get("versionName"), update.get("versionCode"), update.get("sha256"), update.get("sizeBytes")) != ("1.4.12", 20, APK_SHA256, APK_BYTES):
        raise GateError("update_manifest_identity_differs")
    config = builder.image_file(SOURCE_ID, builder.CONFIG)
    if config != git_file(repo, BASE_REVISION, builder.CONFIG):
        raise GateError("web_next_config_base_differs")
    env = dict(entry.split("=", 1) for entry in current.get("Config", {}).get("Env", []) if "=" in entry)
    if any(key not in env for key in builder.PUBLIC_WEB_KEYS):
        raise GateError("public_web_build_setting_missing")
    before_public = public_manifest(SOURCE_ID)
    expected_public = dict(before_public)
    for path in PUBLIC_PATHS:
        relative = path.removeprefix("apps/ops-web/public/")
        expected_public[relative] = {"bytes": len(updated[path]), "sha256": hashlib.sha256(updated[path]).hexdigest()}
    return base, updated, {key: env[key] for key in builder.PUBLIC_WEB_KEYS}, config, expected_public


def dockerfile(revision: str) -> str:
    builder.SOURCE_TAG, builder.SOURCE_ID = SOURCE_TAG, SOURCE_ID
    builder.PATHS = RUNTIME_PATHS
    builder.target = target
    value = builder.dockerfile(revision)
    marker = "RUN node -e "
    if value.count(marker) != 1:
        raise GateError("reviewed_build_dockerfile_shape_changed")
    additions = "".join(f"COPY {path} /app/{path}\n" for path in PUBLIC_PATHS)
    additions += f"RUN rm -f /app/{DELETED_PATH}\n"
    return value.replace(marker, additions + marker)


def docker_build_command(context: Path, image: str, build_args: list[str]) -> tuple[str, ...]:
    # BuildKit retains large snapshot caches for this overlay build. The daemon's
    # legacy builder creates the same pinned layers without exhausting the live
    # host, and remains constrained by the reviewed network and memory flags.
    return (
        "env", "DOCKER_BUILDKIT=0", "docker", "build", "--no-cache",
        "--rm", "--force-rm", "--pull=false", "--network=none",
        "--resource", f"memory={builder.RUN_MEMORY_MIB}m",
        "--resource", f"memory-swap={builder.RUN_TOTAL_MEMORY_MIB}m",
        "-t", image, *build_args, str(context),
    )


def verify_candidate(base, revision, updated, web_env, config, expected_public):
    builder.SOURCE_TAG, builder.SOURCE_ID = SOURCE_TAG, SOURCE_ID
    builder.PATHS, builder.target = RUNTIME_PATHS, target
    candidate = builder.verify_candidate(base, revision, {path: updated[path] for path in RUNTIME_PATHS}, web_env, config)
    image_absent(candidate, DELETED_PATH)
    for path in PUBLIC_PATHS:
        if builder.image_file(candidate, path) != updated[path]:
            raise GateError("candidate_public_file_differs:" + path)
    if public_manifest(candidate) != expected_public:
        raise GateError("candidate_public_tree_differs")
    command("docker", "run", "--rm", "--network", "none", "--entrypoint", "node", candidate, "-e",
            'const fs=require("node:fs"),p="/app/apps/ops-web/public/downloads/flixify-tv-update.json",j=JSON.parse(fs.readFileSync(p));if(j.versionName!=="1.4.12"||j.versionCode!==20)process.exit(1)')
    return candidate


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args(argv)
    before_protected = protected_snapshot()
    base, updated, web_env, config, expected_public = source_preflight(args.source_repo, args.revision)
    if not (args.build or args.verify_existing):
        print("forced_consent_web_preflight_ok; no_live_mutation")
        return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("forced_consent_build_requires_8GiB")
        if target(args.revision) in command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}").decode().splitlines():
            raise GateError("candidate_tag_exists_use_verify_existing")
        with tempfile.TemporaryDirectory(prefix="flixify-forced-consent-") as directory:
            context = Path(directory)
            for path, contents in updated.items():
                destination = context / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(contents)
            (context / "Dockerfile").write_text(dockerfile(args.revision))
            build_args = [value for key in builder.PUBLIC_WEB_KEYS for value in ("--build-arg", f"{key}={web_env[key]}")]
            command(*docker_build_command(context, target(args.revision), build_args), timeout=1200)
    candidate = verify_candidate(base, args.revision, updated, web_env, config, expected_public)
    if protected_snapshot() != before_protected:
        raise GateError("candidate_build_changed_protected_runtime")
    print("forced_consent_web_candidate_verified:" + candidate)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, json.JSONDecodeError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
