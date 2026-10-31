#!/usr/bin/env python3
"""Web-only image transaction over current artwork release; read-only by default."""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("curation_reviewed_web_release", Path(__file__).parents[1] / "2026-10-31-search-activation" / "release-web.py")
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
guard, GateError = reviewed.guard, reviewed.GateError
SOURCE_TAG = "flixify-ops-web:home-artwork-d127d5955a26-20261031"
SOURCE_ID = "sha256:943cae7289b064d791b782c0d884f31b3e36c61febc7ca1097cde04efbf777d6"
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_app_revision_required")
    return "flixify-ops-web:live-curation-" + revision[:12] + "-20261031"


def configure(revision, candidate_id, api_tag, api_id):
    target(revision)
    if not isinstance(candidate_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    if (api_tag, api_id) != (API_TAG, API_ID):
        raise GateError("accepted_protected_api_pins_required")
    reviewed.SOURCE_TAG, reviewed.SOURCE_ID, reviewed.target = SOURCE_TAG, SOURCE_ID, target
    reviewed.configure(revision, candidate_id, api_tag, api_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("revision", "candidate-id", "protected-api-tag", "protected-api-id"):
        parser.add_argument("--" + name, required=True)
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
        print("curation_web_image_synced; containers_not_restarted; all_environments_unchanged")
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
