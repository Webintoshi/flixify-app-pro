#!/usr/bin/env python3
"""Web-only live reliability rollout over the exact verified website image."""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_reliability_scoped_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE_TAG = "flixify-ops-web:edge-recovery-66930da3835c-20261026"
SOURCE_ID = "sha256:f7f38e513b8cdf21b8a10983fc7c2ce12f792562dd7a0f87168ff486dca4ab38"
release.SOURCE_TAG, release.SOURCE_ID = SOURCE_TAG, SOURCE_ID

if __name__ == "__main__":
    try:
        release.main()
    except release.GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, release.guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
