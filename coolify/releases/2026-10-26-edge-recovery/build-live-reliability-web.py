#!/usr/bin/env python3
"""Pinned live-reliability website build; public assets and native APK unchanged.

Default is read-only preflight. The reviewed compiler retains its offline,
cgroup, source/configuration, disk-floor and complete public-tree checks.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_reliability_reviewed_incident", Path(__file__).with_name("build-live-incident-web.py"))
incident = importlib.util.module_from_spec(spec)
spec.loader.exec_module(incident)
SOURCE_TAG = "flixify-ops-web:edge-recovery-66930da3835c-20261026"
SOURCE_ID = "sha256:f7f38e513b8cdf21b8a10983fc7c2ce12f792562dd7a0f87168ff486dca4ab38"
BASE_REVISION = "e0c0855b7f2194180d92bd0f61a6d34c7cfac14d"
PATHS = (
    "apps/ops-web/app/canli-tv/page.tsx",
    "apps/ops-web/app/platform/personal-provider.ts",
)
NEW_PATHS = ()
TEST_PATHS = (
    "apps/ops-web/app/canli-tv/live-stall-recovery.test.tsx",
    "apps/ops-web/app/platform/personal-provider.test.mts",
)
TOOL_PATHS = tuple("coolify/releases/2026-10-26-edge-recovery/" + filename for filename in (
    "build-live-reliability-web.py", "release-live-reliability-web.py", "test-live-reliability-web.py",
))
for module in (incident, incident.style, incident.style.builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS = PATHS, NEW_PATHS
incident.TEST_PATHS, incident.TOOL_PATHS = TEST_PATHS, TOOL_PATHS
incident.style.TOOL_PATHS = TOOL_PATHS
incident.style.__doc__ = __doc__
GateError = incident.GateError
validate_source_scope = incident.validate_source_scope
main = incident.main

if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
