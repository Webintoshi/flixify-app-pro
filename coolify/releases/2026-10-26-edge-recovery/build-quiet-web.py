#!/usr/bin/env python3
"""Build the quiet player badge change over the observed healthy recovery web.

Reuses the bounded builder, including the 8 GiB disk gate, actual cgroup check,
public setting preservation, exact source/config verification and cache cleanup.
Only the live page is overlaid. Default is preflight; --build never deploys.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("quiet_web_builder", Path(__file__).with_name("build-web.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
GateError = builder.GateError
SOURCE_TAG = "flixify-ops-web:edge-recovery-2a7c60e07826-20261026"
SOURCE_ID = "sha256:1a1e54ab741b5564462ed62645a7590617420ea5005b68595676f6e63df52552"
BASE_REVISION = "2a7c60e07826fc3dd81606f8eb5534641a931bb7"
PATHS = ("apps/ops-web/app/canli-tv/page.tsx",)

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
