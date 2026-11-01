#!/usr/bin/env python3
"""One existing Stripe.js component overlay over the published package website."""
from __future__ import annotations

import hashlib
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
reviewed = load("embedded_stripe_web_build", HERE.parent / "2026-10-31-turkey-lineup" / "build-web.py")
backend = load("embedded_stripe_host_proof", HERE / "build-backend.py")
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = "flixify-ops-web:packages-8fa66d103053-20261101"
SOURCE_ID = "sha256:7e38728d71f62bc1fe63fa17cab209743f2618ad26e6ba4f6aaa6f301639a41c"
BASE_REVISION = "8fa66d103053cd92dc36212bfaeac2d0a008a5c4"
PATHS = ("apps/ops-web/components/ui/package-checkout.tsx",)
NEW_PATHS = ()
EXCLUDED = (*PATHS, "apps/ops-web/.next")
SOURCE_HASH = "23c861ddab34a1d537ede347f493cf55493faf89f2a4ed081622d64095a9d1a6"
SOURCE_UNTOUCHED = {"sha256": "6608d5e01ad2f1015681cb5444cb7ed083619832698917e6af9dcaa9a9ad853c", "files": 18259}
API_TAG = "flixify-api:packages-8fa66d103053-20261101"
API_ID = "sha256:4771d67755e1e5aef3e55eb53e27574ca70fdbab777ac8703a0543c224bb026b"
WORKER_TAG = "flixify-worker:packages-8fa66d103053-20261101"
WORKER_ID = "sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57"
APK_SHA256, APK_BYTES = reviewed.APK_SHA256, reviewed.APK_BYTES
UPDATE_MANIFEST = reviewed.UPDATE_MANIFEST


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:embedded-page-" + revision[:12] + "-20261101"


for module in (reviewed, reviewed.reviewed, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS, module.target = PATHS, NEW_PATHS, target
for module in (reviewed, reviewed.reviewed):
    module.API_TAG, module.API_ID = API_TAG, API_ID
    module.WORKER_TAG, module.WORKER_ID, module.EXCLUDED = WORKER_TAG, WORKER_ID, EXCLUDED
original_preflight = builder.preflight
original_protected_snapshot = reviewed.protected_snapshot
original_compile = reviewed.container_compile
original_reviewed_preflight = reviewed.preflight
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched


def validate_source_scope(repo, revision):
    for exact in (BASE_REVISION, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("embedded_web_revision_not_exact")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", BASE_REVISION, revision)
    changed = command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", BASE_REVISION, revision, "--", "apps", "packages").decode().splitlines()
    runtime = set()
    for path in changed:
        if path in PATHS:
            runtime.add(path)
        elif not re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path):
            raise GateError("change_outside_embedded_web_scope:" + path)
        builder.require_regular_blob(repo, revision, path)
    if runtime != set(PATHS):
        raise GateError("embedded_web_runtime_scope_differs")


def source_preflight(repo, revision):
    # Retain the app/config/environment preflight with no app-directory overlays.
    builder.PATHS = ()
    try:
        base, updates, env, config = original_preflight(repo, revision)
    finally:
        builder.PATHS = PATHS
    for path in PATHS:
        builder.require_regular_blob(repo, BASE_REVISION, path)
        builder.require_regular_blob(repo, revision, path)
        original = core.git_file(repo, BASE_REVISION, path)
        if hashlib.sha256(original).hexdigest() != SOURCE_HASH or builder.image_file(SOURCE_ID, path) != original:
            raise GateError("embedded_web_actual_source_differs")
        value = core.git_file(repo, revision, path)
        if value != corrected_source(original):
            raise GateError("embedded_web_overlay_outside_exact_sdk_replacement")
        updates[path] = value
    return base, updates, env, config


def corrected_source(original):
    if original.count(b"initEmbeddedCheckout") != 2 or original.count(b"https://js.stripe.com/v3/") != 1:
        raise GateError("embedded_web_original_sdk_anchors_differ")
    return original.replace(b"initEmbeddedCheckout", b"createEmbeddedCheckoutPage").replace(b"https://js.stripe.com/v3/", b"https://js.stripe.com/endive/stripe.js")


def protected_snapshot(api_tag, api_id):
    return {"services": original_protected_snapshot(api_tag, api_id), "host": backend.host_snapshot()}


def preflight(repo, revision, api_tag, api_id, source_sha256, source_files):
    if {"sha256": source_sha256, "files": source_files} != SOURCE_UNTOUCHED:
        raise GateError("embedded_web_independent_source_scope_pin_differs")
    return original_reviewed_preflight(repo, revision, api_tag, api_id, source_sha256, source_files)


def container_compile(revision, base, updated, web_env):
    if set(updated) != set(PATHS):
        raise GateError("embedded_web_exact_one_leaf_required")
    return original_compile(revision, base, updated, web_env)


builder.preflight = source_preflight
reviewed.validate_source_scope, reviewed.protected_snapshot = validate_source_scope, protected_snapshot
reviewed.preflight, reviewed.container_compile = preflight, container_compile
verify_candidate, main = reviewed.verify_candidate, reviewed.main


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
