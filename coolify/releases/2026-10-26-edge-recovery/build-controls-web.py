#!/usr/bin/env python3
"""Build fullscreen control auto-hide over the observed healthy quiet web.

Reuses the existing bounded builder and exact source/configuration checks.
Only the reviewed player chrome runtime files are overlaid. Default preflight;
the 8 GiB disk gate, actual cgroup checks and cache cleanup remain required.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("controls_web_builder", Path(__file__).with_name("build-web.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
GateError = builder.GateError
SOURCE_TAG = "flixify-ops-web:edge-recovery-f8737c27d1d1-20261026"
SOURCE_ID = "sha256:854cb6904c119522baa442b3083551e4976657659476f3994150b080ebaeab4c"
BASE_REVISION = "f8737c27d1d161d5268e8003bf53ef0a7a91147d"
PATHS = (
    "apps/ops-web/app/components/player-chrome.tsx",
    "apps/ops-web/app/components/player-chrome-policy.ts",
)

builder.SOURCE_TAG = SOURCE_TAG
builder.SOURCE_ID = SOURCE_ID
builder.BASE_REVISION = BASE_REVISION
builder.PATHS = PATHS


if __name__ == "__main__":
    try:
        builder.main()
    except GateError as error:
        print(f"build_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print(f"build_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
