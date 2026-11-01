#!/usr/bin/env python3
"""Bounded five-leaf movie discovery and automatic pagination website overlay."""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
reviewed = load("discovery_reviewed_app_builder", HERE.parent / "2026-10-31-turkey-lineup" / "build-web.py")
backend = load("discovery_reviewed_host_proof", HERE.parent / "2026-11-01-packages" / "build-backend.py")
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = "flixify-ops-web:embedded-page-b0def990e266-20261101"
SOURCE_ID = "sha256:3f123ce5af46e71106221917cd4eeb175d60e3ba8a3218834629bf316c814bf6"
BASE_REVISION = "b0def990e266c133acabd859e3de6e3638ee9751"
PATHS = (
    "apps/ops-web/app/platform/catalog.tsx",
    "apps/ops-web/app/canli-tv/page.tsx",
    "apps/ops-web/app/platform/movie-showcase.ts",
    "apps/ops-web/app/platform/movie-showcase-source.ts",
    "apps/ops-web/app/platform/use-infinite-scroll.ts",
)
NEW_PATHS = PATHS[2:]
EXCLUDED = (*PATHS, "apps/ops-web/.next")
API_TAG = "flixify-api:embedded-page-b0def990e266-20261101"
API_ID = "sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1"
WORKER_TAG = "flixify-worker:packages-8fa66d103053-20261101"
WORKER_ID = "sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57"
DB_ID = reviewed.DB_ID
APK_SHA256, APK_BYTES, UPDATE_MANIFEST = reviewed.APK_SHA256, reviewed.APK_BYTES, reviewed.UPDATE_MANIFEST
TOOLS = frozenset("coolify/releases/2026-11-01-movie-discovery/" + name for name in ("build-web.py", "release-web.py", "test-web.py", "README.md"))


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:movie-discovery-" + revision[:12] + "-20261101"


for module in (reviewed, reviewed.reviewed, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS, module.target = PATHS, NEW_PATHS, target
for module in (reviewed, reviewed.reviewed):
    module.API_TAG, module.API_ID = API_TAG, API_ID
    module.WORKER_TAG, module.WORKER_ID, module.EXCLUDED = WORKER_TAG, WORKER_ID, EXCLUDED
original_protected_snapshot, original_compile = reviewed.protected_snapshot, reviewed.container_compile
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched


def validate_source_scope(repo, revision):
    for exact in (BASE_REVISION, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("discovery_web_revision_not_exact")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", BASE_REVISION, revision)
    changed = command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", BASE_REVISION, revision).decode().splitlines()
    runtime = set()
    for path in changed:
        if path in PATHS:
            runtime.add(path)
        elif not (path in TOOLS or re.fullmatch(r"docs/[A-Za-z0-9_./-]+\.md", path) or re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path)):
            raise GateError("change_outside_discovery_web_scope:" + path)
        builder.require_regular_blob(repo, revision, path)
    if runtime != set(PATHS):
        raise GateError("discovery_web_runtime_scope_differs")


def protected_snapshot(api_tag, api_id):
    return {"services": original_protected_snapshot(api_tag, api_id), "host": backend.host_snapshot()}


def container_compile(revision, base, updated, web_env):
    if set(updated) != set(PATHS):
        raise GateError("discovery_web_exact_five_leaves_required")
    return original_compile(revision, base, updated, web_env)


reviewed.validate_source_scope, reviewed.protected_snapshot = validate_source_scope, protected_snapshot
reviewed.container_compile = container_compile
preflight, verify_candidate, main = reviewed.preflight, reviewed.verify_candidate, reviewed.main


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
