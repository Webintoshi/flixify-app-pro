#!/usr/bin/env python3
"""Swap only the accepted TV 1.4.11 website image; read-only preflight by default."""
from __future__ import annotations

import argparse
import importlib.util
from pathlib import Path
import sys
import shutil


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
build = load('renewal_release_build_profile', HERE / 'build-web.py')
if __name__ == '__main__':
    try:
        build.require_accepted()
    except build.GateError as error:
        print('release_stopped:' + str(error), file=sys.stderr)
        sys.exit(1)
reviewed = load('renewal_web_only_transaction', HERE.parent / '2026-11-01-packages/release-web-embedded.py')
guard, GateError = reviewed.guard, reviewed.GateError
for name in ('SOURCE_TAG', 'SOURCE_ID', 'target', 'API_TAG', 'API_ID', 'WORKER_TAG', 'WORKER_ID'):
    setattr(reviewed, name, getattr(build, name))


def host_snapshot():
    try:
        result = build.backend.host_snapshot()
    except build.backend.GateError as error:
        raise GateError(str(error)) from None
    if result.get('environment') != build.ENV_SHA256 or result.get('registrationFence') != build.FENCE_SHA256:
        raise GateError('renewal_environment_or_registration_fence_drift')
    return result


reviewed.reviewed.builder.host_snapshot = host_snapshot


def configure(revision, candidate_id, accepted=None, apk_proof=None, runtime_proof=None):
    try:
        accepted = build.require_accepted(accepted)
        build.require_helpers()
        build.verify_evidence(accepted, apk_proof, runtime_proof)
        build.validate_source_scope(build.ROOT, revision, accepted)
    except build.GateError as error:
        raise GateError(str(error)) from None
    reviewed.configure(revision, candidate_id, build.API_TAG, build.API_ID)


def require_disk_floor():
    if shutil.disk_usage("/var/lib/docker").free < 8 * 1024**3:
        raise GateError("renewal_release_requires_8GiB")


def main(argv=None):
    try:
        accepted = build.require_accepted()
    except build.GateError as error:
        raise GateError(str(error)) from None
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--candidate-id', required=True)
    parser.add_argument('--apk-proof-file', required=True, type=Path)
    parser.add_argument('--runtime-proof-file', required=True, type=Path)
    actions = parser.add_mutually_exclusive_group()
    for name in ('apply', 'recreate', 'rollback'):
        actions.add_argument('--' + name, action='store_true')
    args = parser.parse_args(argv)
    configure(args.revision, args.candidate_id, accepted, args.apk_proof_file, args.runtime_proof_file)
    require_disk_floor()
    action = 'rollback' if args.rollback else 'recreate' if args.recreate else 'apply' if args.apply else None
    if action:
        with reviewed.reviewed.release_lock():
            reviewed.reviewed.invoke(action)
    else:
        reviewed.reviewed.invoke(None)


if __name__ == '__main__':
    try:
        main()
    except GateError as error:
        print('release_stopped:' + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, guard.yaml.YAMLError) as error:
        print('release_stopped:' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
