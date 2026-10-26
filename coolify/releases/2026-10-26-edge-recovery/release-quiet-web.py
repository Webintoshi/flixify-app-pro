#!/usr/bin/env python3
"""Release only the quiet player web image over the observed recovery baseline.

Uses the existing preservation/transaction/rollback guard. The worker pin is
still required explicitly; default is read-only preflight. Keep all sibling
release modules together. No historical module or baseline is edited.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("quiet_web_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
GateError = release.GateError
SOURCE_TAG = "flixify-ops-web:edge-recovery-2a7c60e07826-20261026"
SOURCE_ID = "sha256:1a1e54ab741b5564462ed62645a7590617420ea5005b68595676f6e63df52552"

release.SOURCE_TAG = SOURCE_TAG
release.SOURCE_ID = SOURCE_ID


if __name__ == "__main__":
    try:
        release.main()
    except GateError as error:
        print(f"release_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, release.guard.yaml.YAMLError) as error:
        print(f"release_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
