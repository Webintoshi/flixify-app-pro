#!/usr/bin/env python3
"""Build catalog showcase over the observed healthy catalog web.

Reuses the existing bounded builder and exact source/configuration checks.
Only the reviewed catalog runtime files are overlaid. Default preflight;
the 8 GiB disk gate, actual cgroup checks and cache cleanup remain required.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("catalog_showcase_web_builder", Path(__file__).with_name("build-web.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
GateError = builder.GateError
SOURCE_TAG = "flixify-ops-web:edge-recovery-b859dd670ab3-20261026"
SOURCE_ID = "sha256:3690cd1ac6bb5bd7896b3f9a3ebceea172d2e1ad8a785c5374f95a22fee8ab8b"
BASE_REVISION = "b859dd670ab3583857d6efd8955d8f525017ce55"
PATHS = (
    "apps/ops-web/app/platform/catalog.tsx",
    "apps/ops-web/app/platform/catalog-showcase.ts",
)

NEW_PATHS = ("apps/ops-web/app/platform/catalog-showcase.ts",)

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
