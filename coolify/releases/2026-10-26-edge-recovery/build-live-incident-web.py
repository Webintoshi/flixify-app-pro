#!/usr/bin/env python3
"""Pinned web-only live incident candidate; public assets and native APK unchanged.

Default is read-only preflight. Reuses the reviewed bounded offline compiler,
immutable configuration/source checks and complete public-tree comparison.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_incident_reviewed_web", Path(__file__).with_name("build-web-tv-style.py"))
style = importlib.util.module_from_spec(spec)
spec.loader.exec_module(style)
SOURCE_TAG = "flixify-ops-web:edge-recovery-5f8014386833-20261026"
SOURCE_ID = "sha256:58b46c80e4579be67f8adfe2666d835f533d616ab57f7ce3ed9ac98215992afd"
BASE_REVISION = "9eea15954fc1749836fedad8a0a573dc84031c5c"
PATHS = (
    "apps/ops-web/app/canli-tv/page.tsx",
)
NEW_PATHS = ()
TEST_PATHS = (
    "apps/ops-web/app/canli-tv/live-stall-recovery.test.tsx",
)
TOOL_PATHS = tuple("coolify/releases/2026-10-26-edge-recovery/" + filename for filename in (
    "build-live-incident-web.py", "release-live-incident-web.py", "test-live-incident-web.py",
))
for module in (style, style.builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS = PATHS, NEW_PATHS
style.TOOL_PATHS = TOOL_PATHS
GateError = style.GateError


def validate_source_scope(repo: Path, revision: str) -> None:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", SOURCE_ID) or not re.fullmatch(r"[0-9a-f]{40}", BASE_REVISION):
        raise GateError("live_incident_source_pin_invalid")
    style.builder.target(revision)
    changed = style.command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision).decode().splitlines()
    if set(changed) & set(PATHS) != set(PATHS):
        raise GateError("live_incident_runtime_manifest_differs")
    allowed = {*PATHS, *TEST_PATHS, *TOOL_PATHS}
    for path in changed:
        if path in allowed or (path.startswith("docs/superpowers/") and path.endswith(".md")):
            continue
        raise GateError("live_incident_change_outside_allowlist:" + path)


style.validate_source_scope = validate_source_scope
style.__doc__ = __doc__
main = style.main

if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
