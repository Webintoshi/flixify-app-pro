#!/usr/bin/env python3
"""Web-only live-registration release; exact API pins required, read-only by default.

Reuse the reviewed Coolify image transaction and its configuration/environment
guards. Apply synchronizes only the website image; recreate and rollback may
restart only ops-web. The current API, worker and database remain protected.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "live_registration_web_prior",
    Path(__file__).parents[1] / "2026-10-26-edge-recovery" / "release-web.py",
)
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)
guard, GateError = prior.guard, prior.GateError

SOURCE_TAG = "flixify-ops-web:edge-recovery-ed852d2a69d4-20261026"
SOURCE_ID = "sha256:d6abf84cc47f3395466bf637c3505489b91cc2e69ca2c8ce061e6c815b4354c0"
WORKER_TAG = "flixify-worker:edge-recovery-539e01cff3c3-20261026"
WORKER_ID = "sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee"


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_app_revision_required")
    return f"flixify-ops-web:live-registration-{revision[:12]}-20261031"


def container_snapshot(*, allow_missing_changed: bool = False) -> dict[str, dict]:
    """Guard restart counts and running state alongside the original identity."""
    result = {}
    for name in guard.SERVICES:
        try:
            data = json.loads(guard.command("docker", "inspect", f"{name}-{guard.UUID}"))
        except GateError:
            if allow_missing_changed and name in guard.CHANGED:
                result[name] = {
                    "id": None, "image_id": None, "tag": None, "hash": None,
                    "guard": None, "running": False, "health": None,
                    "restart_count": None,
                }
                continue
            raise
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise GateError("container_inspection_invalid:" + name)
        item = data[0]
        labels = item.get("Config", {}).get("Labels") or {}
        if labels.get("com.docker.compose.project") != guard.UUID:
            raise GateError("container_project_differs:" + name)
        restart_count = item.get("RestartCount")
        running = item.get("State", {}).get("Running")
        if type(restart_count) is not int or restart_count < 0 or type(running) is not bool:
            raise GateError("container_runtime_identity_invalid:" + name)
        result[name] = {
            "id": item["Id"], "image_id": item["Image"],
            "tag": item["Config"]["Image"],
            "hash": labels.get("com.docker.compose.config-hash"),
            "running": running,
            "health": (item["State"].get("Health") or {}).get("Status"),
            "restart_count": restart_count,
            "guard": guard.sha(json.dumps({
                "Config": item["Config"], "HostConfig": item["HostConfig"],
                "Mounts": item.get("Mounts"),
                "Networks": item.get("NetworkSettings", {}).get("Networks"),
                "StartedAt": item["State"].get("StartedAt"),
                "Running": running, "RestartCount": restart_count,
            }, sort_keys=True, separators=(",", ":"))),
        }
    return result


def configure(revision: str, candidate_id: str, api_tag: str, api_id: str) -> None:
    target(revision)
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    if not re.fullmatch(r"flixify-api:[A-Za-z0-9_.-]+", api_tag):
        raise GateError("exact_protected_api_image_tag_required")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", api_id):
        raise GateError("exact_protected_api_image_id_required")
    prior.SOURCE_TAG, prior.SOURCE_ID = SOURCE_TAG, SOURCE_ID
    prior.API_TAG, prior.API_ID = api_tag, api_id
    prior.target = target
    prior.configure(revision, candidate_id, WORKER_TAG, WORKER_ID)
    guard.container_snapshot = container_snapshot


healthy = prior.healthy
protected_application_images = prior.protected_application_images
quiet_recreate = prior.quiet_recreate
quiet_rollback = prior.quiet_rollback


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="full reviewed website commit")
    parser.add_argument("--candidate-id", required=True, help="immutable verified website image ID")
    parser.add_argument("--protected-api-tag", required=True, help="exact accepted running API tag")
    parser.add_argument("--protected-api-id", required=True, help="exact accepted running API image ID")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--apply", action="store_true", help="sync only website image; no restart")
    actions.add_argument("--recreate", action="store_true", help="recreate only synchronized website")
    actions.add_argument("--rollback", action="store_true", help="restore only pinned source website")
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
        print("coolify_web_image_synced; containers_not_restarted; env_unchanged")
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
