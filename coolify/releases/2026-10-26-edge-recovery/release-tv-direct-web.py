#!/usr/bin/env python3
"""Web-only combined TV-style/direct-play APK rollout from the pinned current web."""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("direct_tv_web_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE_TAG = "flixify-ops-web:edge-recovery-d07eb17b22e3-20261026"
SOURCE_ID = "sha256:81cb96468427b1d2463c2b41c09b4339e9795befadff369827476580d2dca399"
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
