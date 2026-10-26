#!/usr/bin/env python3
"""Release only ops-web with the reviewed worker image protected explicitly.

Default is read-only preflight. Uses the already reviewed worker release guard
for Coolify transactions, byte-preserving config checks and scoped recreation.
All image pins below belong to this web release; no application revision is HEAD.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("edge_web_guard", Path(__file__).with_name("release-worker.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
GateError = guard.GateError

SOURCE_TAG = "flixify-ops-web:personal-viewer-5002a7a-20261026"
SOURCE_ID = "sha256:93f913bc8f06137b83187d656d44c139b008df1ed92483f5ac82638e81db41f8"
API_TAG = "flixify-api:personal-viewer-5002a7a-20261026"
API_ID = "sha256:8cdbf9dba8b15e78a74299a3f612c44b3bed51ee342dd3631cc5b811bdd41e53"
READ_APPLICATIONS_TEMPLATE = guard.PHP_READ_APPLICATIONS


def target(revision: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_app_revision_required")
    return f"flixify-ops-web:edge-recovery-{revision[:12]}-20261026"


def protected_application_images() -> dict[str, str]:
    script = READ_APPLICATIONS_TEMPLATE.replace("['worker']", "['api', 'worker']")
    return json.loads(guard.command("docker", "exec", "coolify", "php", "-r", script))


def healthy(name: str, expected_tag: str, expected_id: str | None = None) -> bool:
    try:
        item = guard.container_snapshot(allow_missing_changed=True)[name]
        if (item["tag"] != expected_tag or item["image_id"] != (expected_id or guard.image_id(expected_tag)) or
            not item["running"] or item["health"] == "unhealthy" or item["hash"] != guard.compose_hash(name)):
            return False
        # Check this exact container, avoiding a cached response from the proxy.
        guard.command("docker", "exec", f"ops-web-{guard.UUID}", "node", "-e",
                      'fetch("http://127.0.0.1:3000/",{redirect:"manual",signal:AbortSignal.timeout(8000)})'
                      '.then(r=>{if(r.status!==200)process.exitCode=1})'
                      '.catch(()=>{process.exitCode=1})', timeout=15)
        return True
    except Exception:
        return False


def configure(revision: str, candidate_id: str, worker_tag: str, worker_id: str) -> None:
    target_tag = target(revision)
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", worker_id):
        raise GateError("exact_protected_worker_image_id_required")
    if not re.fullmatch(r"flixify-worker:[A-Za-z0-9_.-]+", worker_tag):
        raise GateError("exact_protected_worker_image_tag_required")
    guard.REVISION, guard.CANDIDATE_ID = revision, candidate_id
    guard.CHANGED = ("ops-web",)
    guard.PROTECTED = ("db", "api", "worker")
    guard.SOURCE = {"ops-web": SOURCE_TAG}
    guard.SOURCE_IDS = {"ops-web": SOURCE_ID}
    guard.TARGET = {"ops-web": target_tag}
    guard.PROTECTED_IMAGES = {"api": (API_TAG, API_ID), "worker": (worker_tag, worker_id)}
    guard.PHP_READ_APPLICATIONS = READ_APPLICATIONS_TEMPLATE.replace("['worker']", "['ops-web']")
    guard.protected_application_images = protected_application_images
    guard.healthy = healthy


def quiet_recreate(*args) -> None:
    # The shared guard's only stdout is its worker-specific success label.
    # Emit the accurate web label after all shared postconditions have passed.
    with contextlib.redirect_stdout(io.StringIO()):
        guard.recreate(*args)
    print("web_recreated_healthy; api_worker_db_unchanged")


def quiet_rollback() -> None:
    with contextlib.redirect_stdout(io.StringIO()):
        guard.rollback()
    print("web_rolled_back_healthy; api_worker_db_unchanged")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True, help="full reviewed web application commit")
    parser.add_argument("--candidate-id", required=True, help="immutable verified web image ID")
    parser.add_argument("--protected-worker-tag", required=True, help="exact observed running worker tag")
    parser.add_argument("--protected-worker-id", required=True, help="exact observed running worker image ID")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--apply", action="store_true", help="sync only web image in Coolify; no restart")
    actions.add_argument("--recreate", action="store_true", help="recreate only already synchronized web")
    actions.add_argument("--rollback", action="store_true", help="restore only the pinned source web")
    args = parser.parse_args()
    configure(args.revision, args.candidate_id, args.protected_worker_tag, args.protected_worker_id)
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
        print(f"release_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, guard.yaml.YAMLError) as error:
        print(f"release_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
