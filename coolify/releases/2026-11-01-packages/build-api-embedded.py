#!/usr/bin/env python3
"""Two-file embedded_page API correction over the already published packages API."""
from __future__ import annotations
import copy
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("embedded_page_reviewed_backend_builder", Path(__file__).with_name("build-backend.py"))
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
GateError, core, command = reviewed.GateError, reviewed.core, reviewed.command
SOURCE_TAG = "flixify-api:packages-8fa66d103053-20261101"
SOURCE_ID = "sha256:4771d67755e1e5aef3e55eb53e27574ca70fdbab777ac8703a0543c224bb026b"
BASE_REVISION = "8fa66d103053cd92dc36212bfaeac2d0a008a5c4"
PATHS = ("apps/api/src/stripe-billing-routes.ts", "apps/api/src/stripe-billing-api.ts")
NEW_PATHS = ()
SOURCE_HASHES = dict(zip(PATHS, ("d3fae1f4aa978a080a48f400792d6015f668a3bf96418b1997d3e9f3081c9040", "2e5ca009da7001135ad369c374a5b6b5305fb59a720ec4a445f2f7c0685c1e63")))
SOURCE_UNTOUCHED = {"sha256": "51c9dc1aa6723479c103f9b0b410c58bc0797918c6ee4ba7b434366c4788cdf6", "files": 25590}


def configuration(service):
    if service != "api":
        raise GateError("embedded_page_hotfix_is_api_only")
    return {"tag": SOURCE_TAG, "id": SOURCE_ID, "paths": PATHS, "new": (), "dist": "apps/api/dist", "entry": "server.js"}


def target(service, revision):
    configuration(service)
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-api:embedded-page-" + revision[:12] + "-20261101"


def corrected_source(path, original):
    expected = {PATHS[0]: 3, PATHS[1]: 1}
    if path not in expected or original.count(b"'embedded'") != expected[path]:
        raise GateError("embedded_page_original_mode_anchors_differ")
    return original.replace(b"'embedded'", b"'embedded_page'")


def updated_sources(repo, revision, service, pin):
    configuration(service)
    target(service, revision)
    for ref in (BASE_REVISION, revision):
        if command("git", "-C", str(repo), "rev-parse", ref + "^{commit}").decode().strip() != ref:
            raise GateError("embedded_page_revision_not_exact")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", BASE_REVISION, revision)
    source_paths = {reviewed.API_SOURCE_ROOT + Path(path).name for path in PATHS}
    changed = set(command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision, "--", reviewed.API_SOURCE_ROOT).decode().splitlines())
    if changed != source_paths:
        raise GateError("embedded_page_source_scope_differs")
    changed_application = set(command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", BASE_REVISION, revision, "--", "apps", "packages").decode().splitlines())
    companion = "apps/ops-web/components/ui/package-checkout.tsx"
    for path in changed_application:
        if path != companion and not re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path):
            raise GateError("embedded_page_unrelated_application_tree_changed")
        reviewed.helpers.require_regular_blob(repo, revision, path)
    if pin["sourceHashes"] != SOURCE_HASHES or pin["untouched"] != SOURCE_UNTOUCHED:
        raise GateError("embedded_page_independent_source_scope_pin_differs")
    updated = {}
    baseline = json.loads(core.git_file(repo, BASE_REVISION, reviewed.API_SOURCE_MANIFEST))
    expected = copy.deepcopy(baseline)
    for path in PATHS:
        original = reviewed.helpers.image_file(SOURCE_ID, path)
        if hashlib.sha256(original).hexdigest() != SOURCE_HASHES[path]:
            raise GateError("embedded_page_actual_source_differs")
        source = reviewed.API_SOURCE_ROOT + Path(path).name
        reviewed.helpers.require_regular_blob(repo, revision, source)
        value = core.git_file(repo, revision, source)
        if value != corrected_source(path, original):
            raise GateError("embedded_page_overlay_outside_exact_mode_replacement")
        updated[path] = value
        entries = [entry for entry in expected["runtimeSources"] if entry["path"] == path]
        if len(entries) != 1 or entries[0]["source"] != source or entries[0]["new"] is not False:
            raise GateError("embedded_page_baseline_manifest_scope_differs")
        entries[0]["sha256"] = hashlib.sha256(value).hexdigest()
    reviewed.helpers.require_regular_blob(repo, revision, reviewed.API_SOURCE_MANIFEST)
    if json.loads(core.git_file(repo, revision, reviewed.API_SOURCE_MANIFEST)) != expected:
        raise GateError("embedded_page_manifest_outside_two_digests")
    if core.git_file(repo, BASE_REVISION, reviewed.API_PATCHES) != core.git_file(repo, revision, reviewed.API_PATCHES):
        raise GateError("embedded_page_server_patch_changed")
    return updated


reviewed.configuration, reviewed.target, reviewed.updated_sources = configuration, target, updated_sources
snapshot_script, main = reviewed.snapshot_script, reviewed.main


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
