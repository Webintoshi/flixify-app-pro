#!/usr/bin/env python3
"""Release search activation from the exact current website; read-only by default."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "search_web_reviewed_release",
    Path(__file__).parents[1] / "2026-10-31-live-registration" / "release-web.py",
)
reviewed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reviewed)
prior = reviewed.prior
guard, GateError = reviewed.guard, reviewed.GateError

SOURCE_TAG = "flixify-ops-web:live-registration-40882233677b-20261031"
SOURCE_ID = "sha256:0f3b05ed0f699f85afb305cdc5dc1870fba94fd856c1d4a29c4d0949d7eddee6"
API_TAG = "flixify-api:live-registration-8645860e0552-20261031"
API_ID = "sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6"
WORKER_TAG = "flixify-worker:edge-recovery-539e01cff3c3-20261026"
WORKER_ID = "sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee"
ISOLATED_SERVICES = reviewed.ISOLATED_SERVICES
ORIGINAL_VALIDATE_PLAN = reviewed.ORIGINAL_VALIDATE_PLAN
isolation_profile = reviewed.isolation_profile
healthy = reviewed.healthy


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_app_revision_required")
    return f"flixify-ops-web:search-activation-{revision[:12]}-20261031"


def require_existing_isolation(document: dict) -> None:
    if not isolation_profile(document):
        raise GateError("existing_registration_guard_isolation_required")


def expected_swapped(raw: dict, rendered: dict, new_images: dict) -> tuple[dict, dict]:
    if new_images not in (guard.SOURCE, guard.TARGET):
        raise GateError("web_image_direction_invalid")
    result = copy.deepcopy(raw), copy.deepcopy(rendered)
    for document in result:
        require_existing_isolation(document)
        document["services"]["ops-web"]["image"] = new_images["ops-web"]
    return result


def validate_plan(raw, rendered, generated, containers, applications, stage, *, recovering=False):
    ORIGINAL_VALIDATE_PLAN(raw, rendered, generated, containers, applications, stage, recovering=recovering)
    for document in (raw, rendered, generated):
        require_existing_isolation(document)


def configure(revision: str, candidate_id: str, api_tag: str, api_id: str) -> None:
    target(revision)
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    if (api_tag, api_id) != (API_TAG, API_ID):
        raise GateError("accepted_protected_api_pins_required")
    prior.SOURCE_TAG, prior.SOURCE_ID = SOURCE_TAG, SOURCE_ID
    prior.API_TAG, prior.API_ID = API_TAG, API_ID
    prior.target = target
    prior.configure(revision, candidate_id, WORKER_TAG, WORKER_ID)
    guard.container_snapshot = reviewed.container_snapshot
    guard.validate_plan = validate_plan
    guard.expected_swapped = expected_swapped
    guard.compose_hash = reviewed.ORIGINAL_COMPOSE_HASH
    guard.healthy = healthy


protected_application_images = prior.protected_application_images
quiet_recreate = prior.quiet_recreate
quiet_rollback = prior.quiet_rollback


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
        quiet_rollback()
        return
    if args.recreate:
        _, compose_bytes, env_bytes, before, raw, rendered = guard.preflight("target")
        try:
            quiet_recreate(before, compose_bytes, env_bytes, raw, rendered)
        except GateError as error:
            if str(error) in {"command_failed", "command_unavailable"} or str(error).startswith(("new_container_unhealthy:", "candidate_tag_drift:")):
                guard.verify_recovery_context(before, compose_bytes, env_bytes)
                try:
                    quiet_rollback()
                except GateError as rollback_error:
                    raise GateError(f"deploy_failed_and_rollback_failed:{rollback_error}") from error
                raise GateError("deploy_failed_but_source_restored") from error
            raise
        return
    record, compose_bytes, env_bytes, before, raw, rendered = guard.preflight("source")
    if args.apply:
        guard.sync_images(record, compose_bytes, env_bytes, before, raw, rendered, guard.SOURCE, guard.TARGET)
        print("coolify_web_image_synced; containers_not_restarted; all_environments_unchanged")
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
