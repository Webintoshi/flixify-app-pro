#!/usr/bin/env python3
"""Web-only live incident rollout over the exact currently verified website image."""
import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_incident_scoped_release", Path(__file__).with_name("release-web.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SOURCE_TAG = "flixify-ops-web:edge-recovery-5f8014386833-20261026"
SOURCE_ID = "sha256:58b46c80e4579be67f8adfe2666d835f533d616ab57f7ce3ed9ac98215992afd"
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
