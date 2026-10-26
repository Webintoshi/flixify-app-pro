#!/usr/bin/env python3
"""Release only fullscreen control auto-hide over the observed quiet web.

Inherits the reviewed Coolify transaction, service/configuration preservation
and rollback guard. Worker pin stays explicit. Default read-only preflight;
keep sibling modules together. Historical release baselines remain intact.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("controls_web_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
GateError = release.GateError
SOURCE_TAG = "flixify-ops-web:edge-recovery-f8737c27d1d1-20261026"
SOURCE_ID = "sha256:854cb6904c119522baa442b3083551e4976657659476f3994150b080ebaeab4c"

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
