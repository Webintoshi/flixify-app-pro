#!/usr/bin/env python3
"""Build provider entitlement sync over the observed healthy catalog web.

Reuses the existing bounded builder and exact source/configuration checks.
Only the reviewed catalog runtime files are overlaid. Default preflight;
the 8 GiB disk gate, actual cgroup checks and cache cleanup remain required.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("provider_sync_web_builder", Path(__file__).with_name("build-web.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
GateError = builder.GateError
SOURCE_TAG = "flixify-ops-web:edge-recovery-5340ff942194-20261026"
SOURCE_ID = "sha256:9b9a3f9895351ee9860213403a005078ae41744b040462d35e67043ac2a118dc"
BASE_REVISION = "5340ff94219453507e426d2741605b47f18c612e"
PATHS = (
    "apps/ops-web/app/platform/session.tsx",
    "apps/ops-web/app/platform/personal-provider.ts",
    "apps/ops-web/app/platform/direct-playback-deadline.ts",
    "apps/ops-web/app/platform/catalog.tsx",
    "apps/ops-web/app/platform/detail.tsx",
    "apps/ops-web/app/canli-tv/page.tsx",
    "apps/ops-web/app/account/components.tsx",
)
NEW_PATHS = ()

builder.SOURCE_TAG = SOURCE_TAG
builder.SOURCE_ID = SOURCE_ID
builder.BASE_REVISION = BASE_REVISION
builder.PATHS = PATHS
builder.NEW_PATHS = NEW_PATHS


if __name__ == "__main__":
    try:
        builder.main()
    except GateError as error:
        print(f"build_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print(f"build_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
