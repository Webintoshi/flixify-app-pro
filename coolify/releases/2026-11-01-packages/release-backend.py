#!/usr/bin/env python3
"""Swap exactly one backend image while retaining registration and all environments."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import importlib.util
import io
import json
import os
import re
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
builder = load("packages_release_backend_builder", HERE / "build-backend.py")
guard = load("packages_backend_image_transaction", HERE.parent / "2026-10-26-edge-recovery" / "release-worker.py")
GateError = guard.GateError
READ_APPLICATIONS = guard.PHP_READ_APPLICATIONS
ORIGINAL_VALIDATE_PLAN = guard.validate_plan
FENCE = guard.DIRECTORY / ".live-registration-rollout.json"
LOCK = guard.DIRECTORY / ".packages-release.lock"
SERVICE = None


def target(service, revision):
    if service not in {"api", "worker"} or not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_backend_service_and_revision_required")
    return "flixify-" + service + ":packages-" + revision[:12] + "-20261101"


def protected_pin(name, tag, image_id):
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise GateError("exact_protected_image_id_required")
    source = {"api": (builder.API_TAG, builder.API_ID), "ops-web": (builder.WEB_TAG, builder.WEB_ID)}
    if name not in source:
        raise GateError("protected_pin_service_invalid")
    base_tag, base_id = source[name]
    image = guard.image(image_id)
    if image["Id"] != image_id or guard.image_id(tag) != image_id:
        raise GateError("protected_image_tag_id_drift:" + name)
    if (tag, image_id) == (base_tag, base_id):
        return tag, image_id
    prefix = "flixify-api" if name == "api" else "flixify-ops-web"
    match = re.fullmatch(re.escape(prefix) + r":packages-([0-9a-f]{12})-20261101", str(tag))
    labels = image.get("Config", {}).get("Labels") or {}
    revision = labels.get("org.opencontainers.image.revision")
    layers = guard.image(base_id).get("RootFS", {}).get("Layers") or []
    if not match or not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision) or revision[:12] != match[1] or labels.get("vip.flixify.edge-recovery.base") != base_id or not layers or image.get("RootFS", {}).get("Layers", [])[:len(layers)] != layers:
        raise GateError("protected_image_not_accepted_package_ancestry:" + name)
    return tag, image_id


def environment(document, name):
    values = document["services"][name].get("environment")
    if isinstance(values, dict):
        return values
    if not isinstance(values, list):
        raise GateError("backend_environment_shape_invalid")
    result = {}
    for row in values:
        if not isinstance(row, str):
            raise GateError("backend_environment_entry_invalid")
        key, _, value = row.partition("=")
        if key in result:
            raise GateError("backend_environment_duplicate")
        result[key] = value
    return result


def require_registration_profile(document):
    for name in ("ops-web", "worker", "db"):
        if environment(document, name).get("REGISTRATION_GUARD_SECRET", None) != "":
            raise GateError("existing_registration_isolation_required:" + name)
    api = environment(document, "api")
    if api.get("TRUSTED_PROXY_CIDRS") != "10.0.2.4/32,127.0.0.1/32,::1/128" or str(api.get("AUTO_TRIAL_DAILY_IP_LIMIT")) != "2" or api.get("REGISTRATION_GUARD_SECRET") != "${REGISTRATION_GUARD_SECRET}":
        raise GateError("existing_permanent_registration_profile_required")


def validate_plan(raw, rendered, generated, containers, applications, stage, *, recovering=False):
    ORIGINAL_VALIDATE_PLAN(raw, rendered, generated, containers, applications, stage, recovering=recovering)
    for document in (raw, rendered, generated):
        require_registration_profile(document)


def fence_snapshot():
    if not FENCE.is_file() or FENCE.is_symlink() or FENCE.stat().st_size > 65536:
        raise GateError("completed_registration_fence_required")
    data = FENCE.read_bytes()
    value = json.loads(data)
    if value.get("version") != 1 or value.get("phase") != "complete" or value.get("candidate_id") != builder.API_ID:
        raise GateError("registration_fence_incomplete_or_legacy")
    return guard.sha(data)


def protected_host_snapshot():
    try:
        snapshot = builder.host_snapshot()
    except builder.GateError as error:
        raise GateError("protected_host_snapshot_unavailable") from error
    return {key: value for key, value in snapshot.items() if not isinstance(value, dict) or value.get("name") != "/" + SERVICE + "-" + guard.UUID}


def healthy(name, expected_tag, expected_id=None):
    try:
        item = guard.container_snapshot(allow_missing_changed=True)[name]
        if item["tag"] != expected_tag or item["image_id"] != (expected_id or guard.image_id(expected_tag)) or not item["running"] or item["health"] == "unhealthy" or item["hash"] != guard.compose_hash(name):
            return False
        if name == "api":
            script = 'if(typeof process.env.REGISTRATION_GUARD_SECRET!=="string"||process.env.REGISTRATION_GUARD_SECRET.length<32||process.env.AUTO_TRIAL_DAILY_IP_LIMIT!=="2")process.exit(1);fetch("http://127.0.0.1:4000/health",{redirect:"manual",signal:AbortSignal.timeout(8000)}).then(async r=>{if(r.status!==200||(await r.json()).ok!==true)process.exitCode=1}).catch(()=>{process.exitCode=1})'
            guard.command("docker", "exec", "api-" + guard.UUID, "node", "-e", script, timeout=15)
        else:
            guard.command("docker", "exec", "worker-" + guard.UUID, "node", "--check", "/app/apps/worker/dist/index.js", timeout=15)
            guard.command("docker", "exec", "worker-" + guard.UUID, "node", "-e", 'if(process.env.REGISTRATION_GUARD_SECRET!=="")process.exitCode=1', timeout=15)
        return True
    except Exception:
        return False


def configure(service, revision, candidate_id, web_tag, web_id, api_tag=None, api_id=None):
    global SERVICE
    tag = target(service, revision)
    if not isinstance(candidate_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", candidate_id):
        raise GateError("exact_candidate_image_id_required")
    web_pin = protected_pin("ops-web", web_tag, web_id)
    c = builder.configuration(service)
    protected = {"ops-web": web_pin}
    if service == "api":
        if api_tag is not None or api_id is not None:
            raise GateError("api_release_does_not_accept_protected_api_argument")
        protected["worker"] = (builder.WORKER_TAG, builder.WORKER_ID)
    else:
        protected["api"] = protected_pin("api", api_tag, api_id)
    SERVICE = service
    guard.REVISION, guard.CANDIDATE_ID = revision, candidate_id
    guard.CHANGED = (service,)
    guard.PROTECTED = tuple(name for name in guard.SERVICES if name != service)
    guard.SOURCE, guard.SOURCE_IDS = {service: c["tag"]}, {service: c["id"]}
    guard.TARGET, guard.PROTECTED_IMAGES = {service: tag}, protected
    guard.PHP_READ_APPLICATIONS = READ_APPLICATIONS.replace("['worker']", "['" + service + "']")
    names = ", ".join("'" + name + "'" for name in sorted(protected))
    def applications():
        script = READ_APPLICATIONS.replace("['worker']", "[" + names + "]")
        return json.loads(guard.command("docker", "exec", "coolify", "php", "-r", script))
    guard.protected_application_images = applications
    guard.validate_plan, guard.healthy = validate_plan, healthy


@contextlib.contextmanager
def release_lock():
    try:
        fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    except OSError as error:
        raise GateError("backend_release_lock_unavailable") from error
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise GateError("another_package_release_running") from error
        yield
    finally:
        os.close(fd)


def invoke(action):
    before_fence, before_host = fence_snapshot(), protected_host_snapshot()
    if action == "rollback":
        with contextlib.redirect_stdout(io.StringIO()):
            guard.rollback()
    elif action == "recreate":
        _, compose, env, before, raw, rendered = guard.preflight("target")
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                guard.recreate(before, compose, env, raw, rendered)
        except GateError as error:
            if str(error) in {"command_failed", "command_unavailable"} or str(error).startswith(("new_container_unhealthy:", "candidate_tag_drift:")):
                guard.verify_recovery_context(before, compose, env)
                with contextlib.redirect_stdout(io.StringIO()):
                    guard.rollback()
                raise GateError("backend_deploy_failed_current_compatible_source_restored") from error
            raise
    else:
        record, compose, env, before, raw, rendered = guard.preflight("source")
        if action == "apply":
            guard.sync_images(record, compose, env, before, raw, rendered, guard.SOURCE, guard.TARGET)
    if fence_snapshot() != before_fence or protected_host_snapshot() != before_host:
        raise GateError("backend_release_changed_registration_fence_or_other_service")
    builder.emit_runtime_observations()
    print("backend_" + (action or "dry_run") + "_verified; service=" + SERVICE + "; environment_registration_fence_and_other_services_unchanged")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service", choices=("api", "worker"), required=True)
    for key in ("revision", "candidate-id", "protected-web-tag", "protected-web-id"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--protected-api-tag")
    parser.add_argument("--protected-api-id")
    actions = parser.add_mutually_exclusive_group()
    for key in ("apply", "recreate", "rollback"):
        actions.add_argument("--" + key, action="store_true")
    args = parser.parse_args()
    configure(args.service, args.revision, args.candidate_id, args.protected_web_tag, args.protected_web_id, args.protected_api_tag, args.protected_api_id)
    action = "rollback" if args.rollback else "recreate" if args.recreate else "apply" if args.apply else None
    if action:
        with release_lock():
            invoke(action)
    else:
        invoke(None)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("release_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError, guard.yaml.YAMLError) as error:
        print("release_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
