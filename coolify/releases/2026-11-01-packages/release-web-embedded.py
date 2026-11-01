#!/usr/bin/env python3
"""Swap only the Stripe.js website image while retaining live API, worker and fence."""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
reviewed = load("embedded_web_backend_transaction", HERE / "release-backend.py")
build = load("embedded_web_release_profile", HERE / "build-web-embedded.py")
guard, GateError = reviewed.guard, reviewed.GateError
SOURCE_TAG, SOURCE_ID, target = build.SOURCE_TAG, build.SOURCE_ID, build.target
API_TAG, API_ID, WORKER_TAG, WORKER_ID = build.API_TAG, build.API_ID, build.WORKER_TAG, build.WORKER_ID


def healthy(name, expected_tag, expected_id=None):
    if name != "ops-web":
        return False
    try:
        item = guard.container_snapshot(allow_missing_changed=True)[name]
        if (item["tag"] != expected_tag or item["image_id"] != (expected_id or guard.image_id(expected_tag)) or
                not item["running"] or item["health"] == "unhealthy" or item["hash"] != guard.compose_hash(name)):
            return False
        script = 'if(process.env.REGISTRATION_GUARD_SECRET!=="")process.exit(1);fetch("http://127.0.0.1:3000/paketler",{redirect:"manual",signal:AbortSignal.timeout(8000)}).then(r=>{if(r.status!==200)process.exitCode=1}).catch(()=>{process.exitCode=1})'
        guard.command("docker", "exec", "ops-web-" + guard.UUID, "node", "-e", script, timeout=15)
        return True
    except Exception:
        return False


def configure(revision, candidate_id, api_tag, api_id):
    tag = target(revision)
    if not isinstance(candidate_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    if (api_tag, api_id) != (API_TAG, API_ID):
        raise GateError("embedded_web_current_api_pin_required")
    reviewed.SERVICE = "ops-web"
    guard.REVISION, guard.CANDIDATE_ID = revision, candidate_id
    guard.CHANGED, guard.PROTECTED = ("ops-web",), ("api", "worker", "db")
    guard.SOURCE, guard.SOURCE_IDS, guard.TARGET = {"ops-web": SOURCE_TAG}, {"ops-web": SOURCE_ID}, {"ops-web": tag}
    guard.PROTECTED_IMAGES = {"api": (API_TAG, API_ID), "worker": (WORKER_TAG, WORKER_ID)}
    guard.PHP_READ_APPLICATIONS = reviewed.READ_APPLICATIONS.replace("['worker']", "['ops-web']")
    def applications():
        script = reviewed.READ_APPLICATIONS.replace("['worker']", "['api', 'worker']")
        return json.loads(guard.command("docker", "exec", "coolify", "php", "-r", script))
    guard.protected_application_images = applications
    guard.validate_plan, guard.healthy = reviewed.validate_plan, healthy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("revision", "candidate-id", "protected-api-tag", "protected-api-id"):
        parser.add_argument("--" + key, required=True)
    actions = parser.add_mutually_exclusive_group()
    for key in ("apply", "recreate", "rollback"):
        actions.add_argument("--" + key, action="store_true")
    args = parser.parse_args()
    configure(args.revision, args.candidate_id, args.protected_api_tag, args.protected_api_id)
    action = "rollback" if args.rollback else "recreate" if args.recreate else "apply" if args.apply else None
    if action:
        with reviewed.release_lock():
            reviewed.invoke(action)
    else:
        reviewed.invoke(None)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
