#!/usr/bin/env python3
"""Worker-only entitlement sync release; default guarded read-only preflight."""
from __future__ import annotations
import importlib.util
import sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("provider_sync_worker_release", Path(__file__).with_name("release-worker.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
release.SOURCE = {"worker": "flixify-worker:edge-recovery-7731936e27df-20261026"}
release.SOURCE_IDS = {"worker": "sha256:9b5d544dacd6da3eec903ceaef16302767cffff4b10e5d987e86494ce8ac23b3"}
release.PROTECTED_IMAGES["ops-web"] = ("flixify-ops-web:edge-recovery-5340ff942194-20261026", "sha256:9b9a3f9895351ee9860213403a005078ae41744b040462d35e67043ac2a118dc")
if __name__ == "__main__":
    try:
        release.main()
    except release.GateError as error:
        print(f"release_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, release.yaml.YAMLError) as error:
        print(f"release_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
