#!/usr/bin/env python3
"""Release only the 2026 homepage; read-only preflight unless an action is explicit."""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "home_2026_reviewed_web_release",
    Path(__file__).parents[1] / "2026-10-31-search-activation" / "release-web.py",
)
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
guard, GateError = reviewed.guard, reviewed.GateError
SOURCE_TAG = "flixify-ops-web:search-activation-50e3bd7af5a4-20261031"
SOURCE_ID = "sha256:ddc80c1fac256161fbf6d61099021200e9271e1af37a6688fe614fd11f19150f"
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_app_revision_required")
    return "flixify-ops-web:home-2026-" + revision[:12] + "-20261031"


def configure(revision: str, candidate_id: str, api_tag: str, api_id: str) -> None:
    target(revision)
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    if (api_tag, api_id) != (API_TAG, API_ID):
        raise GateError("accepted_protected_api_pins_required")
    reviewed.SOURCE_TAG, reviewed.SOURCE_ID, reviewed.target = SOURCE_TAG, SOURCE_ID, target
    reviewed.configure(revision, candidate_id, api_tag, api_id)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--candidate-id", required=True)
    parser.add_argument("--protected-api-tag", required=True)
    parser.add_argument("--protected-api-id", required=True)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--apply", action="store_true")
    actions.add_argument("--recreate", action="store_true")
    actions.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    configure(args.revision, args.candidate_id, args.protected_api_tag, args.protected_api_id)
    if args.rollback:
        reviewed.quiet_rollback()
        return
    if args.recreate:
        _, compose_bytes, env_bytes, before, raw, rendered = guard.preflight("target")
        try:
            reviewed.quiet_recreate(before, compose_bytes, env_bytes, raw, rendered)
        except GateError as error:
            if str(error) in {"command_failed", "command_unavailable"} or str(error).startswith(("new_container_unhealthy:", "candidate_tag_drift:")):
                guard.verify_recovery_context(before, compose_bytes, env_bytes)
                try:
                    reviewed.quiet_rollback()
                except GateError as rollback_error:
                    raise GateError("deploy_failed_and_rollback_failed:" + str(rollback_error)) from error
                raise GateError("deploy_failed_but_source_restored") from error
            raise
        return
    record, compose_bytes, env_bytes, before, raw, rendered = guard.preflight("source")
    if args.apply:
        guard.sync_images(record, compose_bytes, env_bytes, before, raw, rendered, guard.SOURCE, guard.TARGET)
        print("home_web_image_synced; containers_not_restarted; all_environments_unchanged")
    else:
        print("dry_run_ok; only_web_image_would_change; no_mutation")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
