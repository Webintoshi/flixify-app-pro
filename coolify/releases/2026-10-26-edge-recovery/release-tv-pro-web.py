#!/usr/bin/env python3
"""Web-only Flixify Pro APK release from the exact verified 1.3.1 website image."""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("pro_tv_scoped_web_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE_TAG = "flixify-ops-web:edge-recovery-4d7cb2940197-20261026"
SOURCE_ID = "sha256:883c2103c3cb8d21b36cf148eaca873c41c21d81caa044944691cf527a0cc21"
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
