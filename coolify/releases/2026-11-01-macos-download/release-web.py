#!/usr/bin/env python3
"""Website-only Mac test download cutover; read-only unless an action is explicit."""
import importlib.util
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
reviewed = load("mac_download_reviewed_transaction", HERE.parent / "2026-11-01-packages" / "release-web-embedded.py")
build = load("mac_download_build_profile", HERE / "build-web.py")
guard, GateError = reviewed.guard, reviewed.GateError
for name in ("SOURCE_TAG", "SOURCE_ID", "target", "API_TAG", "API_ID", "WORKER_TAG", "WORKER_ID"):
    setattr(reviewed, name, getattr(build, name))


def host_snapshot():
    try:
        return build.backend.host_snapshot()
    except build.backend.GateError as error:
        raise GateError(str(error)) from None


reviewed.reviewed.builder.host_snapshot = host_snapshot
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
