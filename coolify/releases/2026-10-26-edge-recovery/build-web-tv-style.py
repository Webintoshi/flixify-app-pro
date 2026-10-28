#!/usr/bin/env python3
"""Pinned web-only TV-style/live-start candidate; default is read-only preflight."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location("tv_style_bounded_web", Path(__file__).with_name("build-web.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
core, GateError, command = builder.core, builder.GateError, builder.command
SOURCE_TAG = "flixify-ops-web:edge-recovery-d07eb17b22e3-20261026"
SOURCE_ID = "sha256:81cb96468427b1d2463c2b41c09b4339e9795befadff369827476580d2dca399"
BASE_REVISION = "120b35f77f2ea52c03a7179e1cbea556d477b65c"
PATHS = (
    "apps/ops-web/app/account/account.module.css",
    "apps/ops-web/app/canli-tv/live-tv-app.module.css",
    "apps/ops-web/app/canli-tv/page.tsx",
    "apps/ops-web/app/platform/catalog-dialog.ts",
    "apps/ops-web/app/platform/catalog-panels.module.css",
    "apps/ops-web/app/platform/catalog-search.tsx",
    "apps/ops-web/app/platform/catalog.tsx",
    "apps/ops-web/app/platform/categories.module.css",
    "apps/ops-web/app/platform/categories.tsx",
    "apps/ops-web/app/platform/landing.module.css",
    "apps/ops-web/app/platform/landing.tsx",
    "apps/ops-web/app/platform/personal-provider.ts",
    "apps/ops-web/app/platform/platform.module.css",
    "apps/ops-web/app/platform/series-detail.module.css",
    "apps/ops-web/app/platform/shell.tsx",
)
NEW_PATHS = (
    "apps/ops-web/app/platform/catalog-dialog.ts",
    "apps/ops-web/app/platform/catalog-panels.module.css",
    "apps/ops-web/app/platform/catalog-search.tsx",
)
TOOL_PATHS = tuple("coolify/releases/2026-10-26-edge-recovery/" + name for name in (
    "build-web-tv-style.py", "release-web-tv-style.py", "test-web-tv-style.py",
))
builder.SOURCE_TAG, builder.SOURCE_ID, builder.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
builder.PATHS, builder.NEW_PATHS = PATHS, NEW_PATHS


def validate_source_scope(repo: Path, revision: str) -> None:
    builder.target(revision)
    changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision).decode().splitlines()
    if set(changed) & set(PATHS) != set(PATHS):
        raise GateError("web_tv_runtime_manifest_differs")
    for path in changed:
        if path in PATHS or path in TOOL_PATHS or (path.startswith("docs/") and path.endswith(".md")):
            continue
        if path.startswith("apps/ops-web/app/") and re.fullmatch(r"[A-Za-z0-9_./-]+\.test\.(?:m?[jt]sx?)", path):
            continue
        raise GateError("web_tv_change_outside_allowlist:" + path)


def public_manifest_script() -> str:
    # Do not follow links: content, directory modes and link targets all form part
    # of the public tree contract. No values or private environment are printed.
    return (
        'const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");'
        'const root="/app/apps/ops-web/public",entries=[];'
        'function visit(relative){const p=path.join(root,relative),s=fs.lstatSync(p),mode=s.mode&4095;'
        'if(s.isSymbolicLink()){entries.push(["link",relative,mode,fs.readlinkSync(p)]);return}'
        'if(s.isDirectory()){entries.push(["dir",relative,mode]);for(const child of fs.readdirSync(p).sort())visit(path.join(relative,child));return}'
        'if(s.isFile()){entries.push(["file",relative,mode,s.size,crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")]);return}'
        'throw Error("unsupported_public_entry")}visit("");process.stdout.write(JSON.stringify(entries));'
    )


def public_manifest(image_id: str) -> bytes:
    return command("docker", "run", "--rm", "--network", "none", "--memory", "256m", "--memory-swap", "320m",
                   "--pids-limit", "128", "--entrypoint", "node", image_id, "-e", public_manifest_script())


def preflight(repo: Path, revision: str) -> tuple[dict, dict, dict, bytes, bytes]:
    validate_source_scope(repo, revision)
    base, updated, web_env, config = builder.preflight(repo, revision)
    return base, updated, web_env, config, public_manifest(SOURCE_ID)


def dockerfile(revision: str) -> str:
    return builder.dockerfile(revision)


def verify_candidate(base: dict, revision: str, updated: dict, web_env: dict,
                     config: bytes, original_public: bytes) -> str:
    candidate = builder.verify_candidate(base, revision, updated, web_env, config)
    if public_manifest(candidate) != original_public:
        raise GateError("web_candidate_public_tree_differs")
    print("candidate_public_tree_unchanged; no_apk_asset_changes")
    return candidate


def container_compile(revision: str, base: dict, updated: dict, web_env: dict) -> None:
    """Compile in an owned bounded overlay, avoiding a full base-image import."""
    config = base.get("Config") or {}
    if not config.get("Cmd") or config.get("Volumes"):
        raise GateError("container_compile_base_config_unsupported")
    name = "flixify-tv-style-web-build-" + uuid.uuid4().hex[:12]
    args = ["docker", "create", "--name", name, "--network", "none",
            "--memory", f"{builder.RUN_MEMORY_MIB}m", "--memory-swap", f"{builder.RUN_TOTAL_MEMORY_MIB}m",
            "--pids-limit", "256"]
    for key, value in web_env.items():
        args += ["--env", key + "=" + value]
    args += [SOURCE_ID, "node", "-e", builder.build_script()]
    created = False
    try:
        command(*args)
        created = True
        with tempfile.TemporaryDirectory(prefix="flixify-tv-style-overlay-") as directory:
            for index, (path, value) in enumerate(updated.items()):
                source = Path(directory) / str(index)
                source.write_bytes(value)
                command("docker", "cp", str(source), name + ":/app/" + path)
        command("docker", "start", "--attach", name, timeout=1200)
        status = command("docker", "inspect", "--format", "{{.State.ExitCode}}", name).decode().strip()
        if status != "0":
            raise GateError("container_web_compile_failed")
        command("docker", "commit", "--change", "CMD " + json.dumps(config["Cmd"]),
                "--change", "LABEL org.opencontainers.image.revision=" + revision,
                "--change", "LABEL vip.flixify.edge-recovery.base=" + SOURCE_ID,
                name, builder.target(revision), timeout=300)
    finally:
        if created:
            command("docker", "rm", "--force", name)
    print("container_compile_passed; actual_cgroup_bounded; network_disabled; own_container_removed")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--container-build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    base, updated, web_env, config, original_public = preflight(args.source_repo, args.revision)
    if not (args.build or args.container_build or args.verify_existing):
        print("tv_style_web_preflight_ok; no_live_mutation; public_tree_pinned")
        return
    if args.build or args.container_build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("insufficient_disk_web_build_requires_8GiB")
        tags = command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", builder.target(args.revision)).decode().splitlines()
        if builder.target(args.revision) in tags:
            raise GateError("candidate_tag_already_exists_use_verify_existing")
        if args.container_build:
            container_compile(args.revision, base, updated, web_env)
        else:
            with tempfile.TemporaryDirectory(prefix="flixify-tv-style-web-") as directory:
                root = Path(directory)
                for path, value in updated.items():
                    source = root / path
                    source.parent.mkdir(parents=True, exist_ok=True)
                    source.write_bytes(value)
                (root / "Dockerfile").write_text(dockerfile(args.revision))
                build_args = [argument for key, value in web_env.items() for argument in ("--build-arg", key + "=" + value)]
                command("docker", "build", "--load", "--no-cache", "--rm", "--force-rm", "--pull=false", "--network=none",
                        "--resource", f"memory={builder.RUN_MEMORY_MIB}m", "--resource", f"memory-swap={builder.RUN_TOTAL_MEMORY_MIB}m",
                        "-t", builder.target(args.revision), *build_args, str(root), timeout=1200)
    candidate = verify_candidate(base, args.revision, updated, web_env, config, original_public)
    print("web_candidate_verified:" + candidate)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
