#!/usr/bin/env python3
"""Build only the 2026 homepage over the exact current website; preflight by default."""
from __future__ import annotations

import argparse
import importlib.util
import re
import shutil
import sys
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "home_2026_reviewed_web_build",
    Path(__file__).parents[1] / "2026-10-31-search-activation" / "build-web.py",
)
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command

SOURCE_TAG = "flixify-ops-web:search-activation-50e3bd7af5a4-20261031"
SOURCE_ID = "sha256:ddc80c1fac256161fbf6d61099021200e9271e1af37a6688fe614fd11f19150f"
BASE_REVISION = "50e3bd7af5a476e5e6ac5dd013be148e942c5c0b"
PATHS = tuple("apps/ops-web/app/platform/" + name for name in (
    "catalog.tsx", "types.ts", "personal-provider.ts", "catalog-release-year.ts",
    "homepage-showcase.ts", "homepage-hero.tsx", "homepage.module.css",
))
NEW_PATHS = PATHS[3:]
EXCLUDED = (*PATHS, "apps/ops-web/.next")
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID, DB_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID, reviewed.DB_ID
APK_SHA256 = "6b60219f5cc91d1d229998e3e42a1a8d5f77c0416768baef22018995ffedf5bb"
APK_BYTES = 1347386
UPDATE_MANIFEST = reviewed.UPDATE_MANIFEST


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:home-2026-" + revision[:12] + "-20261031"


for module in (reviewed, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS, module.target = PATHS, NEW_PATHS, target
reviewed.EXCLUDED = EXCLUDED

snapshot_script = reviewed.snapshot_script
untouched = reviewed.untouched
validate_source_fingerprint = reviewed.validate_source_fingerprint
require_untouched = reviewed.require_untouched
protected_snapshot = reviewed.protected_snapshot
public_manifest = reviewed.public_manifest
canonical_public_manifest = reviewed.canonical_public_manifest
container_compile = reviewed.container_compile
verify_download = reviewed.verify_download


def validate_source_scope(repo: Path, revision: str) -> None:
    for exact in (BASE_REVISION, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("home_web_revision_not_exact")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", BASE_REVISION, revision)
    changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision, "--", "apps/ops-web").decode().splitlines()
    runtime = set()
    for path in changed:
        if re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path):
            builder.require_regular_blob(repo, revision, path)
        else:
            runtime.add(path)
    if runtime != set(PATHS):
        raise GateError("home_web_runtime_scope_differs")
    if command("git", "-C", str(repo), "rev-parse", BASE_REVISION + ":apps/tv-android") != command("git", "-C", str(repo), "rev-parse", revision + ":apps/tv-android"):
        raise GateError("home_web_native_tree_changed")
    for path in PATHS:
        builder.require_regular_blob(repo, revision, path)


def preflight(repo: Path, revision: str, api_tag: str, api_id: str, source_sha256: str, source_files: int):
    source_pin = validate_source_fingerprint(source_sha256, source_files)
    validate_source_scope(repo, revision)
    protected = protected_snapshot(api_tag, api_id)
    base, updated, web_env, config = builder.preflight(repo, revision)
    before = untouched(SOURCE_ID)
    require_untouched(source_pin, before)
    original_public = public_manifest(SOURCE_ID)
    canonical_public_manifest(original_public)
    manifest = core.git_file(repo, BASE_REVISION, UPDATE_MANIFEST)
    reviewed.parse_manifest(manifest, APK_SHA256, APK_BYTES)
    if builder.image_file(SOURCE_ID, UPDATE_MANIFEST) != manifest:
        raise GateError("home_web_source_update_manifest_differs")
    if protected_snapshot(api_tag, api_id) != protected:
        raise GateError("home_web_preflight_protected_state_changed")
    return base, updated, web_env, config, original_public, before, protected, manifest


def verify_candidate(base, revision, updated, web_env, config, original_public, before, manifest):
    candidate = builder.verify_candidate(base, revision, updated, web_env, config)
    require_untouched(before, untouched(candidate))
    if canonical_public_manifest(public_manifest(candidate)) != canonical_public_manifest(original_public):
        raise GateError("home_web_public_tree_changed")
    verify_download(candidate, APK_SHA256, APK_BYTES, manifest)
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--protected-api-tag", required=True)
    parser.add_argument("--protected-api-id", required=True)
    parser.add_argument("--source-untouched-sha256", required=True)
    parser.add_argument("--source-untouched-files", required=True, type=int)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    base, updated, web_env, config, public, before, protected, manifest = preflight(
        args.source_repo, args.revision, args.protected_api_tag, args.protected_api_id,
        args.source_untouched_sha256, args.source_untouched_files,
    )
    if not (args.build or args.verify_existing):
        print("home_web_preflight_ok; no_mutation; independent_source_fingerprint_required")
        return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("home_web_build_requires_8GiB")
        if target(args.revision) in command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines():
            raise GateError("home_web_candidate_tag_exists_use_verify_existing")
        container_compile(args.revision, base, updated, web_env)
    candidate = verify_candidate(base, args.revision, updated, web_env, config, public, before, manifest)
    if protected_snapshot(args.protected_api_tag, args.protected_api_id) != protected:
        raise GateError("home_web_build_changed_protected_service_or_environment")
    print("home_web_candidate_verified:" + candidate)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
