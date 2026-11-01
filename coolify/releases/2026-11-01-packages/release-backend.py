#!/usr/bin/env python3
"""Swap exactly one backend image while retaining registration and all environments."""
from __future__ import annotations

import argparse
import contextlib
import copy
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
ORIGINAL_COMPOSE_HASH = guard.compose_hash
FENCE = guard.DIRECTORY / ".live-registration-rollout.json"
LOCK = guard.DIRECTORY / ".packages-release.lock"
SERVICE = None
LEGACY_WORKER_ID = "9cc6ccf596af18687de07fb41ebc874fbd547cd0f6b2d3042b7e0fa3f720c5c4"
LEGACY_WORKER_STARTED = "2026-10-26T20:54:01.529909006Z"
LEGACY_WORKER_HASH = "6f1ba7f0b14a8b42d7d8ab31c4cba0223108b6a57ea85151904ded6fd8ab5204"
DESIRED_WORKER_HASH = "21884008deece45c4a776c98fb8ed8e22de1a7cbd16a5ab76aa910b7cc41ebe8"
LEGACY_WORKER_OBSERVATIONS = []


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


def runtime_environment(entries):
    if not isinstance(entries, list):
        raise GateError("legacy_worker_environment_shape")
    result = {}
    for entry in entries:
        if not isinstance(entry, str) or "=" not in entry:
            raise GateError("legacy_worker_environment_entry")
        key, value = entry.split("=", 1)
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) or key in result:
            raise GateError("legacy_worker_environment_duplicate_or_invalid_key")
        result[key] = value
    return result


def normalized_worker_hash(document):
    value = guard.command("docker", "compose", "-p", guard.UUID, "--project-directory", str(guard.DIRECTORY), "-f", "-", "config", "--hash", "worker", input_data=json.dumps(document, separators=(",", ":")).encode()).decode().strip().split()
    if not value or not re.fullmatch(r"[0-9a-f]{64}", value[-1]):
        raise GateError("legacy_worker_normalized_hash_missing")
    return value[-1]


def legacy_worker_source_compatible(item, document, computed):
    config, state = item.get("Config") or {}, item.get("State") or {}
    labels = config.get("Labels") or {}
    if (item.get("Id") != LEGACY_WORKER_ID or item.get("Name") != "/worker-" + guard.UUID or item.get("Image") != builder.WORKER_ID or config.get("Image") != builder.WORKER_TAG or
            labels.get("com.docker.compose.project") != guard.UUID or labels.get("com.docker.compose.config-hash") != LEGACY_WORKER_HASH or computed != DESIRED_WORKER_HASH or
            state.get("StartedAt") != LEGACY_WORKER_STARTED or state.get("Running") is not True or item.get("RestartCount") != 0 or item.get("Mounts") != []):
        return False
    if document.get("services", {}).get("worker", {}).get("image") != builder.WORKER_TAG:
        return False
    planned = environment(document, "worker")
    if planned.get("REGISTRATION_GUARD_SECRET") != "":
        return False
    actual = runtime_environment(config.get("Env"))
    if "REGISTRATION_GUARD_SECRET" in actual:
        return False
    expected = runtime_environment(guard.image(builder.WORKER_ID).get("Config", {}).get("Env"))
    for key, value in planned.items():
        if value is None:
            expected.pop(key, None)
        elif isinstance(value, str):
            expected[key] = value
        else:
            return False
    if actual | {"REGISTRATION_GUARD_SECRET": ""} != expected or normalized_worker_hash(document) != computed:
        return False
    original = copy.deepcopy(document)
    values = original["services"]["worker"]["environment"]
    if isinstance(values, dict):
        del values["REGISTRATION_GUARD_SECRET"]
    else:
        values[:] = [entry for entry in values if entry.split("=", 1)[0] != "REGISTRATION_GUARD_SECRET"]
    if normalized_worker_hash(original) != LEGACY_WORKER_HASH:
        return False
    observation = {"containerId": LEGACY_WORKER_ID, "sourceImage": builder.WORKER_ID, "sourceComposeHash": LEGACY_WORKER_HASH, "desiredComposeHash": computed, "onlyMissingRuntimeKey": "REGISTRATION_GUARD_SECRET", "plannedValue": ""}
    if observation not in LEGACY_WORKER_OBSERVATIONS:
        LEGACY_WORKER_OBSERVATIONS.append(observation)
    return True


def compose_hash(name):
    computed = ORIGINAL_COMPOSE_HASH(name)
    if SERVICE != "worker" or name != "worker":
        return computed
    rows = json.loads(guard.command("docker", "inspect", "worker-" + guard.UUID))
    if not isinstance(rows, list) or len(rows) != 1:
        raise GateError("legacy_worker_inspection_shape")
    item = rows[0]
    if (item.get("Config", {}).get("Labels") or {}).get("com.docker.compose.config-hash") == computed or item.get("Id") != LEGACY_WORKER_ID:
        return computed
    document = json.loads(guard.command("docker", "compose", "-p", guard.UUID, "--project-directory", str(guard.DIRECTORY), "-f", str(guard.COMPOSE), "config", "--format", "json"))
    return LEGACY_WORKER_HASH if legacy_worker_source_compatible(item, document, computed) else computed


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
    guard.validate_plan, guard.healthy, guard.compose_hash = validate_plan, healthy, compose_hash


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
    if LEGACY_WORKER_OBSERVATIONS:
        print("legacy_worker_exact_source_compatibility:" + json.dumps(LEGACY_WORKER_OBSERVATIONS, sort_keys=True, separators=(",", ":")))
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
