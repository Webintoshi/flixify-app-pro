#!/usr/bin/env python3
"""Optional web-only candidate builder. Default preflight; never deploys.

Overlays session.tsx, onboarding.tsx and the live player from --revision on the current
immutable web image. Public build settings are read without printing values.
Webpack disk cache is disabled only while building; the original Next config
is restored byte for byte in that same Docker layer.
"""
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

spec = importlib.util.spec_from_file_location("edge_worker_build", Path(__file__).with_name("build-worker.py"))
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
GateError, command = core.GateError, core.command
UUID = core.UUID
SOURCE_TAG = "flixify-ops-web:personal-viewer-5002a7a-20261026"
SOURCE_ID = "sha256:93f913bc8f06137b83187d656d44c139b008df1ed92483f5ac82638e81db41f8"
BASE_REVISION = "5002a7a32d2a54c1b882f375c2bd43dc71d9c59c"
PATHS = (
    "apps/ops-web/app/platform/session.tsx",
    "apps/ops-web/app/platform/onboarding.tsx",
    "apps/ops-web/app/canli-tv/page.tsx",
)
CONFIG = "apps/ops-web/next.config.ts"
ANCHOR = "const nextConfig: NextConfig = {"
PUBLIC_WEB_KEYS = (
    "NEXT_PUBLIC_API_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_APP_DEMO_MODE", "NEXT_PUBLIC_SUPPORT_WHATSAPP", "NEXT_PUBLIC_SUPPORT_TELEGRAM",
)
MIN_FREE_BYTES = 8 * 1024**3
RUN_MEMORY_MIB = 1280
RUN_TOTAL_MEMORY_MIB = 1536


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return f"flixify-ops-web:edge-recovery-{revision[:12]}-20261026"


def image_file(image_id: str, path: str) -> bytes:
    return command("docker", "run", "--rm", "--network", "none", "--entrypoint", "cat", image_id, "/app/" + path)


def preflight(repo: Path, revision: str) -> tuple[dict, dict, dict, bytes]:
    target(revision)
    if command("git", "-C", str(repo), "rev-parse", f"{revision}^{{commit}}").decode().strip() != revision:
        raise GateError("revision_not_exact_commit")
    base = core.image(SOURCE_ID)
    if base["Id"] != SOURCE_ID or core.image(SOURCE_TAG)["Id"] != SOURCE_ID:
        raise GateError("web_base_image_drift")
    current = json.loads(command("docker", "inspect", f"ops-web-{UUID}"))[0]
    if current["Image"] != SOURCE_ID or current["Config"]["Image"] != SOURCE_TAG or not current["State"]["Running"]:
        raise GateError("web_running_image_drift")
    if (current["Config"].get("Labels") or {}).get("com.docker.compose.project") != UUID:
        raise GateError("web_project_drift")
    changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision,
                      "--", "apps/ops-web/app").decode().splitlines()
    if {path for path in changed if ".test." not in path} != set(PATHS):
        raise GateError("web_runtime_overlay_scope_differs")
    updated = {}
    for path in PATHS:
        original = core.git_file(repo, BASE_REVISION, path)
        if image_file(SOURCE_ID, path) != original:
            raise GateError("web_base_source_differs:" + path)
        updated[path] = core.git_file(repo, revision, path)
        if updated[path] == original:
            raise GateError("web_overlay_unchanged:" + path)
    config = image_file(SOURCE_ID, CONFIG)
    if config != core.git_file(repo, BASE_REVISION, CONFIG) or config.decode().count(ANCHOR) != 1 or "webpack" in config.decode() or "experimental" in config.decode():
        raise GateError("web_next_config_not_reviewed_pure_object")
    env = dict(entry.split("=", 1) for entry in current["Config"].get("Env", []) if "=" in entry)
    if any(key not in env for key in PUBLIC_WEB_KEYS):
        raise GateError("public_web_build_setting_missing")
    return base, updated, {key: env[key] for key in PUBLIC_WEB_KEYS}, config


def build_script() -> str:
    return (
        'const fs=require("node:fs"),cp=require("node:child_process");'
        # Resource flags are not sufficient: verify actual kernel cgroup limits
        # before compilation, including every child Next/webpack process.
        'function limit(p){let v;try{v=fs.readFileSync(p,"utf8").trim()}catch{throw Error("build_cgroup_unavailable")}'
        'if(!/^\\d+$/.test(v))throw Error("build_cgroup_unbounded");return BigInt(v)}'
        'let memory,swap;'
        'if(fs.existsSync("/sys/fs/cgroup/memory.max")){memory=limit("/sys/fs/cgroup/memory.max");swap=limit("/sys/fs/cgroup/memory.swap.max")}'
        'else if(fs.existsSync("/sys/fs/cgroup/memory/memory.limit_in_bytes")){memory=limit("/sys/fs/cgroup/memory/memory.limit_in_bytes");'
        'swap=limit("/sys/fs/cgroup/memory/memory.memsw.limit_in_bytes")-memory}'
        'else{throw Error("build_cgroup_unavailable")}'
        f'if(memory<=0n||swap<0n||memory>{RUN_MEMORY_MIB * 1024**2}n||memory+swap>{RUN_TOTAL_MEMORY_MIB * 1024**2}n)throw Error("build_cgroup_limit_exceeds_cap");'
        f'const p={json.dumps("/app/" + CONFIG)},anchor={json.dumps(ANCHOR)};'
        'const original=fs.readFileSync(p),source=original.toString("utf8");'
        'if(source.split(anchor).length!==2||source.includes("webpack")||source.includes("experimental"))throw Error("unreviewed_next_config");'
        'try{fs.writeFileSync(p,source.replace(anchor,anchor+"\\n  experimental: { cpus: 1, webpackBuildWorker: true, webpackMemoryOptimizations: true },\\n  webpack(config) { config.cache = false; return config; },"));'
        'fs.rmSync("/app/apps/ops-web/.next",{recursive:true,force:true});'
        'cp.execFileSync("npm",["run","build","-w","@flixify/ops-web"],{stdio:"inherit"});'
        '}finally{fs.writeFileSync(p,original);fs.rmSync("/app/apps/ops-web/.next/cache",{recursive:true,force:true});}'
        'if(!fs.readFileSync(p).equals(original))throw Error("next_config_restore_failed");'
    )


def dockerfile(revision: str) -> str:
    target(revision)
    lines = [f"FROM {SOURCE_TAG}", f"LABEL org.opencontainers.image.revision={revision}",
             f"LABEL vip.flixify.edge-recovery.base={SOURCE_ID}"]
    for key in PUBLIC_WEB_KEYS:
        lines.extend((f"ARG {key}", f"ENV {key}=${{{key}}}"))
    lines.extend(f"COPY {path} /app/{path}" for path in PATHS)
    lines.append("RUN node -e " + shlex.quote(build_script()))
    return "\n".join(lines) + "\n"


def verify_candidate(base: dict, revision: str, updated: dict, web_env: dict, config: bytes) -> str:
    candidate = core.image(target(revision))
    labels = candidate.get("Config", {}).get("Labels") or {}
    if candidate["Id"] == SOURCE_ID or labels.get("org.opencontainers.image.revision") != revision or labels.get("vip.flixify.edge-recovery.base") != SOURCE_ID:
        raise GateError("web_candidate_identity_invalid")
    base_layers = base.get("RootFS", {}).get("Layers") or []
    if not base_layers or candidate.get("RootFS", {}).get("Layers", [])[:len(base_layers)] != base_layers:
        raise GateError("web_candidate_not_from_pinned_base")
    for path, contents in updated.items():
        if image_file(candidate["Id"], path) != contents:
            raise GateError("web_candidate_source_differs:" + path)
    if image_file(candidate["Id"], CONFIG) != config:
        raise GateError("web_next_config_not_restored_exactly")
    for key in ("Cmd", "Entrypoint", "WorkingDir", "User", "Healthcheck", "Volumes", "ExposedPorts", "StopSignal", "Shell"):
        if candidate["Config"].get(key) != base["Config"].get(key):
            raise GateError("web_candidate_runtime_config_differs")
    expected_labels = dict(base["Config"].get("Labels") or {}) | {
        "org.opencontainers.image.revision": revision, "vip.flixify.edge-recovery.base": SOURCE_ID,
    }
    if labels != expected_labels:
        raise GateError("web_candidate_labels_differ")
    expected_env = dict(entry.split("=", 1) for entry in base["Config"].get("Env", []) if "=" in entry) | web_env
    actual_env = dict(entry.split("=", 1) for entry in candidate["Config"].get("Env", []) if "=" in entry)
    if actual_env != expected_env:
        raise GateError("web_candidate_environment_differs")
    command("docker", "run", "--rm", "--network", "none", "--entrypoint", "sh", candidate["Id"],
            "-c", 'test -s /app/apps/ops-web/.next/BUILD_ID && test ! -d /app/apps/ops-web/.next/cache')
    return candidate["Id"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    base, updated, web_env, config = preflight(args.source_repo, args.revision)
    if args.verify_existing:
        print("web_candidate_verified:" + verify_candidate(base, args.revision, updated, web_env, config))
        return
    if not args.build:
        print("web_build_preflight_ok; no_live_mutation")
        return
    if shutil.disk_usage("/var/lib/docker").free < MIN_FREE_BYTES:
        raise GateError("insufficient_disk_web_build_requires_8GiB")
    existing = command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines()
    if target(args.revision) in existing:
        raise GateError("candidate_tag_already_exists_use_verify_existing")
    with tempfile.TemporaryDirectory(prefix="flixify-web-edge-") as directory:
        context = Path(directory)
        for path, contents in updated.items():
            destination = context / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(contents)
        (context / "Dockerfile").write_text(dockerfile(args.revision))
        build_args = [value for key in PUBLIC_WEB_KEYS for value in ("--build-arg", f"{key}={web_env[key]}")]
        command("docker", "build", "--load", "--no-cache", "--rm", "--force-rm", "--pull=false", "--network=none",
                "--resource", f"memory={RUN_MEMORY_MIB}m", "--resource", f"memory-swap={RUN_TOTAL_MEMORY_MIB}m",
                "-t", target(args.revision), *build_args, str(context), timeout=1200)
    print("web_candidate_built:" + verify_candidate(base, args.revision, updated, web_env, config))
    print("live_containers_unchanged; temporary_context_removed; next_cache_removed")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print(f"build_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print(f"build_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
