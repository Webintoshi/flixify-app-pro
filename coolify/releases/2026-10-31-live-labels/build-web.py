#!/usr/bin/env python3
"""Bounded three-file web presentation patch over the accepted Turkey lineup."""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_labels_reviewed_builder", Path(__file__).parents[1] / "2026-10-31-turkey-lineup" / "build-web.py")
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
SOURCE_TAG = "flixify-ops-web:turkey-lineup-cbc90d6f8461-20261031"
SOURCE_ID = "sha256:6fae8e37970359c91fbc3c9eb80739aa3c23212ad3e253676694565084b864c8"
BASE_REVISION = "cbc90d6f846197122494afcb895fab55be522873"
PATHS = (
    "apps/ops-web/app/canli-tv/page.tsx",
    "apps/ops-web/app/platform/catalog.tsx",
    "apps/ops-web/app/platform/catalog-search.tsx",
)
NEW_PATHS = ()
EXCLUDED = (*PATHS, "apps/ops-web/.next")
TOOLS = frozenset("coolify/releases/2026-10-31-live-labels/" + name for name in ("build-web.py", "release-web.py", "test-web.py", "README.md"))


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise reviewed.GateError("exact_revision_required")
    return "flixify-ops-web:live-labels-" + revision[:12] + "-20261031"


for module in (reviewed, reviewed.reviewed, reviewed.builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS, module.target = PATHS, NEW_PATHS, target
reviewed.EXCLUDED = reviewed.reviewed.EXCLUDED = EXCLUDED
reviewed.TOOLS = TOOLS
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID, DB_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID, reviewed.DB_ID
APK_SHA256, APK_BYTES, UPDATE_MANIFEST = reviewed.APK_SHA256, reviewed.APK_BYTES, reviewed.UPDATE_MANIFEST
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched
validate_source_fingerprint, require_untouched = reviewed.validate_source_fingerprint, reviewed.require_untouched
protected_snapshot = reviewed.protected_snapshot
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
