#!/usr/bin/env python3
"""Build the package selector over the pinned website without replacing dependencies."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
import tempfile
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location("packages_reviewed_web_builder", Path(__file__).parents[1] / "2026-10-31-turkey-lineup" / "build-web.py")
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = "flixify-ops-web:tvplus-lineup-2f39237f8200-20261031"
SOURCE_ID = "sha256:94078bed2ba04e00ddef43a358b4c1526f4e5c58c636d0954f86f2e833de979a"
BASE_REVISION = "2f39237f8200d8258c9d662b2a45c0ff5a1e3a58"
APP_PATHS = (
    "apps/ops-web/app/paketler/page.tsx",
    "apps/ops-web/app/paketler/stripe-package-copy.ts",
    "apps/ops-web/app/admin/paketler/page.tsx",
    "apps/ops-web/app/paketler/packages-model.ts",
    "apps/ops-web/app/paketler/embedded-payment.ts",
    "apps/ops-web/app/odeme-sonucu/page.tsx",
)
APP_NEW_PATHS = ("apps/ops-web/app/paketler/packages-model.ts", "apps/ops-web/app/paketler/embedded-payment.ts")
COMPONENT_ROOT = "apps/ops-web/components"
COMPONENT_PATHS = tuple(COMPONENT_ROOT + "/ui/" + name for name in ("pricing.tsx", "pricing.module.css", "package-checkout.tsx", "package-checkout.module.css"))
PATHS = (*APP_PATHS, *COMPONENT_PATHS)
NEW_PATHS = (*APP_NEW_PATHS, *COMPONENT_PATHS)
EXCLUDED = (*APP_PATHS, COMPONENT_ROOT, "apps/ops-web/.next")
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID, DB_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID, reviewed.DB_ID
APK_SHA256, APK_BYTES = reviewed.APK_SHA256, reviewed.APK_BYTES
UPDATE_MANIFEST = reviewed.UPDATE_MANIFEST


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:packages-" + revision[:12] + "-20261101"


for module in (reviewed, reviewed.reviewed, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS, module.target = PATHS, NEW_PATHS, target
reviewed.EXCLUDED = reviewed.reviewed.EXCLUDED = EXCLUDED
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched
validate_source_fingerprint, require_untouched = reviewed.validate_source_fingerprint, reviewed.require_untouched
protected_snapshot = reviewed.protected_snapshot
public_manifest, canonical_public_manifest = reviewed.public_manifest, reviewed.canonical_public_manifest
verify_download = reviewed.verify_download
original_builder_preflight = builder.preflight
original_verify_candidate = reviewed.verify_candidate


def validate_source_scope(repo, revision):
    baseline = reviewed.BASE_REVISION
    for exact in (baseline, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("packages_web_revision_not_exact")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", baseline, revision)
    changed = command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", baseline, revision, "--", "apps/ops-web").decode().splitlines()
    runtime = set()
    for path in changed:
        if path in PATHS:
            runtime.add(path)
        elif re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path):
            builder.require_regular_blob(repo, revision, path)
        else:
            raise GateError("change_outside_packages_web_scope:" + path)
    if runtime != set(PATHS):
        raise GateError("packages_web_runtime_scope_differs")
    if command("git", "-C", str(repo), "rev-parse", baseline + ":apps/tv-android") != command("git", "-C", str(repo), "rev-parse", revision + ":apps/tv-android"):
        raise GateError("packages_web_native_tree_changed")
    for path in PATHS:
        builder.require_regular_blob(repo, revision, path)


def package_source_preflight(repo, revision):
    # The reviewed base builder owns all existing app/config/environment checks.
    builder.PATHS, builder.NEW_PATHS = APP_PATHS, APP_NEW_PATHS
    try:
        base, updated, web_env, config = original_builder_preflight(repo, revision)
    finally:
        builder.PATHS, builder.NEW_PATHS = PATHS, NEW_PATHS
    if builder.git_entry(repo, builder.BASE_REVISION, COMPONENT_ROOT):
        raise GateError("packages_components_root_exists_in_baseline")
    builder.require_image_absent(COMPONENT_ROOT)
    for path in COMPONENT_PATHS:
        builder.require_regular_blob(repo, revision, path)
        builder.require_image_absent(path)
        updated[path] = core.git_file(repo, revision, path)
    return base, updated, web_env, config


def expected_component_manifest(updated):
    entries = [["dir", "", 0o755], ["dir", "ui", 0o755]]
    for path in sorted(COMPONENT_PATHS):
        value = updated[path]
        entries.append(["file", path.removeprefix(COMPONENT_ROOT + "/"), 0o644, len(value), hashlib.sha256(value).hexdigest()])
    return entries


def component_manifest(image):
    script = r'''const fs=require('node:fs'),crypto=require('node:crypto'),root='/app/apps/ops-web/components',rows=[];function visit(relative){const path=relative?root+'/'+relative:root,s=fs.lstatSync(path),mode=s.mode&4095;if(s.isSymbolicLink())rows.push(['link',relative,mode,fs.readlinkSync(path)]);else if(s.isDirectory()){rows.push(['dir',relative,mode]);for(const name of fs.readdirSync(path).sort())visit(relative?relative+'/'+name:name)}else if(s.isFile()){const b=fs.readFileSync(path);rows.push(['file',relative,mode,b.length,crypto.createHash('sha256').update(b).digest('hex')])}else throw Error('unexpected_component_entry')}visit('');console.log(JSON.stringify(rows));'''
    return json.loads(reviewed.reviewed.command("docker", "run", "--rm", "--network", "none", "--memory", "256m", "--memory-swap", "320m", "--pids-limit", "128", "--read-only", "--entrypoint", "node", image, "-e", script, timeout=60))


def verify_components(candidate, updated):
    if component_manifest(candidate) != expected_component_manifest(updated):
        raise GateError("packages_component_manifest_differs")


def container_compile(revision, base, updated, web_env):
    config = base.get("Config") or {}
    if not config.get("Cmd") or config.get("Volumes") or set(updated) != set(PATHS):
        raise GateError("packages_compile_base_or_source_manifest_differs")
    name, created = "flixify-packages-web-build-" + uuid.uuid4().hex[:12], False
    run = reviewed.reviewed.command
    args = ["docker", "create", "--name", name, "--network", "none", "--memory", "1280m", "--memory-swap", "1536m", "--pids-limit", "256"]
    for key, value in web_env.items():
        args.extend(("--env", key + "=" + value))
    args.extend((SOURCE_ID, "node", "-e", builder.build_script()))
    try:
        run(*args)
        created = True
        with tempfile.TemporaryDirectory(prefix="flixify-packages-web-overlay-") as directory:
            root = Path(directory)
            for index, path in enumerate(APP_PATHS):
                file = root / str(index)
                file.write_bytes(updated[path])
                file.chmod(0o644)
                run("docker", "cp", str(file), name + ":/app/" + path)
            component_root = root / "components"
            (component_root / "ui").mkdir(parents=True)
            component_root.chmod(0o755)
            (component_root / "ui").chmod(0o755)
            for path in COMPONENT_PATHS:
                file = component_root / path.removeprefix(COMPONENT_ROOT + "/")
                file.write_bytes(updated[path])
                file.chmod(0o644)
            run("docker", "cp", str(component_root), name + ":/app/apps/ops-web/")
        run("docker", "start", "--attach", name, timeout=1200)
        if run("docker", "inspect", "--format", "{{.State.ExitCode}}", name).decode().strip() != "0":
            raise GateError("packages_bounded_compile_failed")
        run("docker", "commit", "--change", "CMD " + json.dumps(config["Cmd"]), "--change", "LABEL org.opencontainers.image.revision=" + revision, "--change", "LABEL vip.flixify.edge-recovery.base=" + SOURCE_ID, name, target(revision), timeout=300)
    finally:
        if created:
            run("docker", "rm", "--force", name)
    print("packages_web_compile_passed; network_none; owned_container_removed")


def verify_candidate(base, revision, updated, web_env, config, original_public, before, manifest):
    candidate = original_verify_candidate(base, revision, updated, web_env, config, original_public, before, manifest)
    verify_components(candidate, updated)
    return candidate


builder.preflight = package_source_preflight
reviewed.validate_source_scope = validate_source_scope
reviewed.container_compile = container_compile
reviewed.verify_candidate = verify_candidate
preflight, main = reviewed.preflight, reviewed.main


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
