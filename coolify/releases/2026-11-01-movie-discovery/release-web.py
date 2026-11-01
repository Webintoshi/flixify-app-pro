#!/usr/bin/env python3
"""Publish only movie discovery; retain the current embedded payment services."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
reviewed = load("discovery_reviewed_web_transaction", HERE.parent / "2026-11-01-packages" / "release-web-embedded.py")
build = load("discovery_web_release_profile", HERE / "build-web.py")
guard, GateError = reviewed.guard, reviewed.GateError
SOURCE_TAG, SOURCE_ID, target = build.SOURCE_TAG, build.SOURCE_ID, build.target
API_TAG, API_ID, WORKER_TAG, WORKER_ID = build.API_TAG, build.API_ID, build.WORKER_TAG, build.WORKER_ID
reviewed.SOURCE_TAG, reviewed.SOURCE_ID, reviewed.target = SOURCE_TAG, SOURCE_ID, target
reviewed.API_TAG, reviewed.API_ID = API_TAG, API_ID
reviewed.WORKER_TAG, reviewed.WORKER_ID = WORKER_TAG, WORKER_ID
configure, main = reviewed.configure, reviewed.main


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
