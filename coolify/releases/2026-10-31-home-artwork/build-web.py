#!/usr/bin/env python3
"""Bounded three-file artwork patch over the accepted 2026 homepage."""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "home_artwork_reviewed_builder",
    Path(__file__).parents[1] / "2026-10-31-home-2026" / "build-web.py",
)
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
SOURCE_TAG = "flixify-ops-web:home-2026-cca30ce96a91-20261031"
SOURCE_ID = "sha256:4f0fb47292ddac6232bb302d7b82f1b26820d02c62e84ddc0fea152b7fe4e7bb"
BASE_REVISION = "cca30ce96a9137b85c40e32aed9cbce7d12c3e72"
PATHS = tuple("apps/ops-web/app/platform/" + name for name in (
    "catalog.tsx", "homepage-showcase.ts", "homepage-hero.tsx",
))
NEW_PATHS = ()
EXCLUDED = (*PATHS, "apps/ops-web/.next")

def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise reviewed.GateError("exact_revision_required")
    return "flixify-ops-web:home-artwork-" + revision[:12] + "-20261031"

for module in (reviewed, reviewed.reviewed, reviewed.builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS, module.target = PATHS, NEW_PATHS, target
reviewed.EXCLUDED = reviewed.reviewed.EXCLUDED = EXCLUDED

builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID, DB_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID, reviewed.DB_ID
APK_SHA256, APK_BYTES, UPDATE_MANIFEST = reviewed.APK_SHA256, reviewed.APK_BYTES, reviewed.UPDATE_MANIFEST
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched
protected_snapshot = reviewed.protected_snapshot
validate_source_fingerprint, require_untouched = reviewed.validate_source_fingerprint, reviewed.require_untouched
public_manifest, canonical_public_manifest = reviewed.public_manifest, reviewed.canonical_public_manifest
container_compile, verify_download = reviewed.container_compile, reviewed.verify_download
validate_source_scope, preflight = reviewed.validate_source_scope, reviewed.preflight
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
