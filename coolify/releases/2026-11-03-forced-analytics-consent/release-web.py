#!/usr/bin/env python3
"""Apply the verified forced-consent candidate as an ops-web-only transaction."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import re
import sys


HERE = Path(__file__).resolve().parent


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("forced_consent_release_build", HERE / "build-web.py")
transaction = load("forced_consent_web_transaction", HERE.parent / "2026-11-01-packages" / "release-web-embedded.py")
GateError = transaction.GateError
for name in ("SOURCE_TAG", "SOURCE_ID", "target", "API_TAG", "API_ID", "WORKER_TAG", "WORKER_ID"):
    setattr(transaction, name, getattr(build, name))


def configure(source_repo: Path, revision: str, candidate_id: str) -> None:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    try:
        before = build.protected_snapshot()
        base, updated, web_env, config, expected_public = build.source_preflight(source_repo, revision)
        actual = build.verify_candidate(base, revision, updated, web_env, config, expected_public)
        if actual != candidate_id:
            raise GateError("candidate_image_id_differs")
        if build.protected_snapshot() != before:
            raise GateError("release_preflight_changed_protected_runtime")
    except build.GateError as error:
        raise GateError(str(error)) from None
    transaction.configure(revision, candidate_id, build.API_TAG, build.API_ID)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--candidate-id", required=True)
    actions = parser.add_mutually_exclusive_group()
    for name in ("apply", "recreate", "rollback"):
        actions.add_argument("--" + name, action="store_true")
    args = parser.parse_args(argv)
    configure(args.source_repo, args.revision, args.candidate_id)
    action = "rollback" if args.rollback else "recreate" if args.recreate else "apply" if args.apply else None
    if action:
        with transaction.reviewed.release_lock():
            transaction.reviewed.invoke(action)
    else:
        transaction.reviewed.invoke(None)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, transaction.guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
