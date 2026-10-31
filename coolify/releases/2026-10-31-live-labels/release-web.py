#!/usr/bin/env python3
"""Web-only provider-label presentation correction; rollback restores 6fae8e."""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("live_labels_reviewed_release", Path(__file__).parents[1] / "2026-10-31-search-activation" / "release-web.py")
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
SOURCE_TAG = "flixify-ops-web:turkey-lineup-cbc90d6f8461-20261031"
SOURCE_ID = "sha256:6fae8e37970359c91fbc3c9eb80739aa3c23212ad3e253676694565084b864c8"


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise reviewed.GateError("exact_app_revision_required")
    return "flixify-ops-web:live-labels-" + revision[:12] + "-20261031"


reviewed.SOURCE_TAG, reviewed.SOURCE_ID, reviewed.target = SOURCE_TAG, SOURCE_ID, target
guard, GateError = reviewed.guard, reviewed.GateError
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID
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
