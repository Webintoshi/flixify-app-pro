#!/usr/bin/env python3
"""Release only catalog showcase over the observed catalog web.

Inherits the reviewed Coolify transaction, service/configuration preservation
and rollback guard. Worker pin stays explicit. Default read-only preflight;
keep sibling modules together. Historical release baselines remain intact.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("catalog_showcase_web_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
GateError = release.GateError
SOURCE_TAG = "flixify-ops-web:edge-recovery-b859dd670ab3-20261026"
SOURCE_ID = "sha256:3690cd1ac6bb5bd7896b3f9a3ebceea172d2e1ad8a785c5374f95a22fee8ab8b"

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
