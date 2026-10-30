#!/usr/bin/env python3
"""Website-only APK-theme rollout from the exact verified Flixify Pro website image."""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("apk_theme_scoped_web_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE_TAG = "flixify-ops-web:edge-recovery-6491e529c6d0-20261026"
SOURCE_ID = "sha256:84942fb59d00e681d4edef6258693da502dfc988ae9da4c25e50d011c9a2e4e5"
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
