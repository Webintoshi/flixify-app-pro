#!/usr/bin/env python3
"""Build only the Turkey channel lineup over the current immutable website."""
from __future__ import annotations

import argparse
import importlib.util
import re
import shutil
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reviewed = load("lineup_reviewed_web_builder", Path(__file__).parents[1] / "2026-10-31-search-activation" / "build-web.py")
current_publication = load("lineup_current_apk_checks", Path(__file__).parents[1] / "2026-10-31-live-curation" / "build-web.py")
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = "flixify-ops-web:live-curation-dd8d7a16c200-20261031"
SOURCE_ID = "sha256:73a348089680a50ec4b341a6ea1586c2399565fe18ad659e158d3519e436ff9c"
BASE_REVISION = "dd8d7a16c2002c47dc80537cf777155ec7fc622c"
PATHS = (
    "apps/ops-web/app/canli-tv/live-channel-catalog.ts",
    "apps/ops-web/app/canli-tv/page.tsx",
    "apps/ops-web/app/platform/catalog.tsx",
    "apps/ops-web/app/platform/live-channel-lineup.ts",
)
NEW_PATHS = (PATHS[3],)
EXCLUDED = (*PATHS, "apps/ops-web/.next")
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID, DB_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID, reviewed.DB_ID
APK_SHA256 = "1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f"
APK_BYTES = 1355944
UPDATE_MANIFEST = reviewed.UPDATE_MANIFEST
TOOLS = frozenset("coolify/releases/2026-10-31-turkey-lineup/" + name for name in ("build-web.py", "release-web.py", "test-web.py", "README.md"))


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:turkey-lineup-" + revision[:12] + "-20261031"


for module in (reviewed, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS, module.target = PATHS, NEW_PATHS, target
reviewed.EXCLUDED = EXCLUDED
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched
validate_source_fingerprint, require_untouched = reviewed.validate_source_fingerprint, reviewed.require_untouched
protected_snapshot = reviewed.protected_snapshot
public_manifest, canonical_public_manifest = reviewed.public_manifest, reviewed.canonical_public_manifest
container_compile = reviewed.container_compile
verify_download = current_publication.verify_download


def validate_source_scope(repo, revision):
    for exact in (BASE_REVISION, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("lineup_web_revision_not_exact")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", BASE_REVISION, revision)
    changed = command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", BASE_REVISION, revision).decode().splitlines()
    runtime = set()
    for path in changed:
        if path in PATHS:
            runtime.add(path)
        elif (path in TOOLS or (path.startswith("docs/") and path.endswith(".md"))
                or re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path)):
            builder.require_regular_blob(repo, revision, path)
        else:
            raise GateError("change_outside_lineup_scope:" + path)
    if runtime != set(PATHS):
        raise GateError("lineup_web_runtime_scope_differs")
    if command("git", "-C", str(repo), "rev-parse", BASE_REVISION + ":apps/tv-android") != command("git", "-C", str(repo), "rev-parse", revision + ":apps/tv-android"):
        raise GateError("lineup_web_native_tree_changed")
    for path in PATHS:
        builder.require_regular_blob(repo, revision, path)


def preflight(repo, revision, api_tag, api_id, source_sha256, source_files):
    source_pin = validate_source_fingerprint(source_sha256, source_files)
    validate_source_scope(repo, revision)
    protected = protected_snapshot(api_tag, api_id)
    base, updated, web_env, config = builder.preflight(repo, revision)
    before = untouched(SOURCE_ID)
    require_untouched(source_pin, before)
    original_public = public_manifest(SOURCE_ID)
    canonical_public_manifest(original_public)
    manifest = core.git_file(repo, BASE_REVISION, UPDATE_MANIFEST)
    current_publication.parse_manifest(manifest, APK_SHA256, APK_BYTES)
    if builder.image_file(SOURCE_ID, UPDATE_MANIFEST) != manifest:
        raise GateError("lineup_source_update_manifest_differs")
    if protected_snapshot(api_tag, api_id) != protected:
        raise GateError("lineup_preflight_protected_state_changed")
    return base, updated, web_env, config, original_public, before, protected, manifest


def verify_candidate(base, revision, updated, web_env, config, original_public, before, manifest):
    candidate = builder.verify_candidate(base, revision, updated, web_env, config)
    require_untouched(before, untouched(candidate))
    if canonical_public_manifest(public_manifest(candidate)) != canonical_public_manifest(original_public):
        raise GateError("lineup_public_tree_changed")
    verify_download(candidate, APK_SHA256, APK_BYTES, manifest)
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    for name in ("revision", "protected-api-tag", "protected-api-id", "source-untouched-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--source-untouched-files", required=True, type=int)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    result = preflight(args.source_repo, args.revision, args.protected_api_tag, args.protected_api_id, args.source_untouched_sha256, args.source_untouched_files)
    base, updated, web_env, config, public, before, protected, manifest = result
    if not (args.build or args.verify_existing):
        print("lineup_web_preflight_ok; no_mutation; independent_source_fingerprint_required")
        return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("lineup_web_build_requires_8GiB")
        if target(args.revision) in command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines():
            raise GateError("lineup_candidate_tag_exists_use_verify_existing")
        container_compile(args.revision, base, updated, web_env)
    candidate = verify_candidate(base, args.revision, updated, web_env, config, public, before, manifest)
    if protected_snapshot(args.protected_api_tag, args.protected_api_id) != protected:
        raise GateError("lineup_build_changed_protected_service_or_environment")
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
