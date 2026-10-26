#!/usr/bin/env python3
"""Guarded, backup-free release of the existing Flixify API and web images.

Run only on the active Coolify host. The default action is a read-only dry run.
--apply synchronizes Coolify's raw/rendered/generated Compose and application
images without restarting containers. --recreate subsequently recreates only
api and ops-web, in that order. A health failure automatically restores both
source images. --rollback does so explicitly after an interrupted rollout.
No mode creates a backup or prints YAML, environment values, provider
credentials, or command stderr.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.request import Request, urlopen

import yaml


UUID = "eupquokyj7qegufqvqkjmuyr"
SERVICE_ID = 1
DIRECTORY = Path("/data/coolify/services") / UUID
COMPOSE = DIRECTORY / "docker-compose.yml"
ENV = DIRECTORY / ".env"
REVISION = "464e34863834d87fc90cebe360eeb784119eda56"
SERVICES = ("db", "api", "worker", "ops-web")
CHANGED = ("api", "ops-web")
SOURCE = {
    "api": "flixify-api:playback-fix-39300d0-20261023",
    "ops-web": "flixify-ops-web:playback-fix-39300d0-20261023",
}
TARGET = {
    "api": "flixify-api:personal-viewer-464e348-20261026",
    "ops-web": "flixify-ops-web:personal-viewer-464e348-20261026",
}

SOURCE_IDS = {
    "api": "sha256:4ecc3ae69eb72318de48ee1a3c0d01877059fac53637967fbf7686c26da4674a",
    "ops-web": "sha256:d072c18562ca3892bd1ccb020306e033df88a802b650a68050b6a8a10f568319",
}


def verify_source_images() -> None:
    for name in CHANGED:
        if image_id(SOURCE[name]) != SOURCE_IDS[name]:
            raise GateError("source_image_drift:" + name)


class GateError(Exception):
    """A fixed-label precondition or postcondition failure."""


SYNC_PHASES = frozenset({
    "bootstrap_autoload", "bootstrap_app", "bootstrap_kernel",
    "payload_decode", "transaction_begin", "service_lookup",
    "service_precondition", "compose_parse", "service_set",
    "compose_image_drift", "source_image_drift", "compose_dump",
    "save_compose_models", "application_set", "rendered_diff",
    "application_diff", "save_compose_files", "transaction_commit",
})


def command(*args: str, input_data: bytes | None = None, timeout: int = 45,
            capture_sync_phase: bool = False) -> bytes:
    try:
        result = subprocess.run(
            args, input=input_data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GateError("command_unavailable") from exc
    if result.returncode:
        # Both Docker and PHP may echo secret-bearing environment material.
        if capture_sync_phase:
            match = re.fullmatch(
                rb"coolify_api_web_source_sync_failed:([a-z_]+)\n?", result.stderr,
            )
            if match:
                phase = match.group(1).decode("ascii")
                if phase in SYNC_PHASES:
                    raise GateError(f"coolify_sync_failed:{phase}")
        raise GateError("command_failed")
    return result.stdout


def sha(value: bytes | str) -> str:
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def image(tag: str) -> dict:
    data = json.loads(command("docker", "image", "inspect", tag))
    if len(data) != 1 or not data[0].get("Id", "").startswith("sha256:"):
        raise GateError("image_inspection_invalid")
    return data[0]


def image_id(tag: str) -> str:
    return image(tag)["Id"]


def candidate_images() -> dict[str, str]:
    accepted = {}
    for name in CHANGED:
        candidate = image(TARGET[name])
        if candidate["Id"] == image_id(SOURCE[name]):
            raise GateError(f"candidate_equals_source:{name}")
        labels = candidate.get("Config", {}).get("Labels") or {}
        if labels.get("org.opencontainers.image.revision") != REVISION:
            raise GateError(f"candidate_revision_differs:{name}")
        accepted[name] = candidate["Id"]
    return accepted


def verify_candidate_ids(accepted: dict[str, str]) -> None:
    for name in CHANGED:
        if image_id(TARGET[name]) != accepted[name]:
            raise GateError("candidate_tag_drift:" + name)


def service_record() -> dict:
    query = (
        "SELECT row_to_json(s) FROM (SELECT id, uuid, docker_compose_raw, "
        "docker_compose FROM services WHERE uuid='" + UUID + "') s"
    )
    record = json.loads(command(
        "docker", "exec", "coolify-db", "psql", "-U", "coolify", "-d", "coolify",
        "-X", "-A", "-t", "-c", query,
    ).decode().strip())
    if record.get("id") != SERVICE_ID or record.get("uuid") != UUID:
        raise GateError("unexpected_service_identity")
    if not record.get("docker_compose_raw") or not record.get("docker_compose"):
        raise GateError("missing_compose_source")
    return record


PHP_READ_APPLICATIONS = r'''
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
try {
    $service = App\Models\Service::where('uuid', 'eupquokyj7qegufqvqkjmuyr')->firstOrFail();
    if ($service->id !== 1) { throw new RuntimeException('identity'); }
    $images = [];
    foreach (['api', 'ops-web'] as $name) {
        $images[$name] = $service->applications()->where('name', $name)->firstOrFail()->image;
    }
    echo json_encode($images, JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    fwrite(STDERR, "application_read_failed\n");
    exit(1);
}
'''


def application_images() -> dict[str, str]:
    return json.loads(command("docker", "exec", "coolify", "php", "-r", PHP_READ_APPLICATIONS))


def parsed(contents: str | bytes) -> dict:
    result = yaml.safe_load(contents)
    if not isinstance(result, dict) or not isinstance(result.get("services"), dict):
        raise GateError("invalid_compose")
    if set(result["services"]) != set(SERVICES):
        raise GateError("unexpected_service_set")
    return result


def container_snapshot(*, allow_missing_changed: bool = False) -> dict[str, dict]:
    result = {}
    for name in SERVICES:
        try:
            item = json.loads(command("docker", "inspect", f"{name}-{UUID}"))[0]
        except (GateError, ValueError, IndexError):
            if allow_missing_changed and name in CHANGED:
                result[name] = {"id": None, "image_id": None, "tag": None,
                                "hash": None, "running": False, "health": None}
                continue
            raise
        labels = item.get("Config", {}).get("Labels") or {}
        if labels.get("com.docker.compose.project") != UUID:
            raise GateError(f"container_project_differs:{name}")
        result[name] = {
            "id": item["Id"],
            "image_id": item["Image"],
            "tag": item["Config"]["Image"],
            "hash": labels.get("com.docker.compose.config-hash"),
            "running": item["State"]["Running"],
            "health": (item["State"].get("Health") or {}).get("Status"),
        }
    return result


def container_identity(snapshot: dict[str, dict]) -> dict[str, tuple]:
    """Ignore changing health state while guarding container IDs and config."""
    return {name: (item["id"], item["image_id"], item["tag"], item["hash"])
            for name, item in snapshot.items()}


def expected_images(stage: str) -> dict[str, str]:
    if stage not in {"source", "target"}:
        raise GateError("invalid_stage")
    return SOURCE if stage == "source" else TARGET


def validate_plan(raw: dict, rendered: dict, generated: dict,
                  containers: dict[str, dict], applications: dict[str, str],
                  stage: str, *, recovering: bool = False) -> None:
    if rendered != generated:
        raise GateError("generated_compose_differs_from_database")
    images = expected_images(stage)
    for name in SERVICES:
        tag = generated["services"][name].get("image")
        if not isinstance(tag, str) or raw["services"][name].get("image") != tag:
            raise GateError(f"raw_rendered_image_differs:{name}")
        if name in CHANGED and (tag != images[name] or applications.get(name) != tag):
            raise GateError(f"unexpected_application_or_compose_image:{name}")
        if stage == "source" or name not in CHANGED:
            if containers[name]["tag"] != tag or containers[name]["image_id"] != image_id(tag):
                raise GateError(f"running_image_differs:{name}")
    if stage == "target":
        for name in CHANGED:
            if containers[name]["tag"] is None:
                continue
            if containers[name]["tag"] not in {SOURCE[name], TARGET[name]}:
                raise GateError(f"unexpected_running_image:{name}")
            if not (recovering and containers[name]["tag"] == TARGET[name]) and containers[name]["image_id"] != image_id(containers[name]["tag"]):
                raise GateError(f"running_image_id_differs:{name}")


def compose_hash(name: str) -> str:
    output = command(
        "docker", "compose", "-p", UUID, "--project-directory", str(DIRECTORY),
        "-f", str(COMPOSE), "config", "--hash", name,
    ).decode().strip().split()
    if not output:
        raise GateError("missing_compose_hash")
    return output[-1]


def preflight(stage: str, *, recovering: bool = False) -> tuple[dict, bytes, bytes, dict, dict, dict]:
    verify_source_images()
    if not COMPOSE.is_file() or not ENV.is_file():
        raise GateError("coolify_service_files_missing")
    compose_bytes, env_bytes = COMPOSE.read_bytes(), ENV.read_bytes()
    record, containers = service_record(), container_snapshot(allow_missing_changed=stage == "target")
    raw, rendered, generated = (
        parsed(record["docker_compose_raw"]),
        parsed(record["docker_compose"]),
        parsed(compose_bytes),
    )
    if stage == "source":
        candidate_images()
    validate_plan(raw, rendered, generated, containers, application_images(), stage, recovering=recovering)
    for name in SERVICES:
        if name in CHANGED and (stage == "source" or containers[name]["tag"] == TARGET[name]):
            if containers[name]["hash"] != compose_hash(name):
                raise GateError(f"container_config_differs:{name}")
        if not containers[name]["running"] and (stage == "source" or name not in CHANGED):
            raise GateError(f"container_not_running:{name}")
    command("docker", "compose", "-p", UUID, "--project-directory", str(DIRECTORY),
            "-f", str(COMPOSE), "config", "-q")
    return record, compose_bytes, env_bytes, containers, raw, rendered


PHP_APPLY = r'''
use App\Models\Service;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Yaml\Yaml;
function canonical($x) {
    if (is_array($x)) {
        if (!array_is_list($x)) { ksort($x); }
        foreach ($x as $k => $v) { $x[$k] = canonical($v); }
    }
    return $x;
}
$phase = 'bootstrap_autoload';
try {
    require "/var/www/html/vendor/autoload.php";
    $phase = 'bootstrap_app';
    $app = require "/var/www/html/bootstrap/app.php";
    $phase = 'bootstrap_kernel';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $phase = 'payload_decode';
    $p = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
    $phase = 'transaction_begin';
    DB::transaction(function () use ($p, &$phase) {
        $phase = 'service_lookup';
        $service = Service::where('uuid', $p['uuid'])->lockForUpdate()->firstOrFail();
        $phase = 'service_precondition';
        if ($service->id !== 1 ||
            hash('sha256', $service->docker_compose_raw) !== $p['raw_sha'] ||
            hash('sha256', $service->docker_compose) !== $p['rendered_sha']) {
            throw new RuntimeException('precondition');
        }
        $phase = 'compose_parse';
        $raw = Yaml::parse($service->docker_compose_raw);
        $expected = Yaml::parse($service->docker_compose);
        $phase = 'service_set';
        $rawNames = array_keys($raw['services']);
        $renderedNames = array_keys($expected['services']);
        sort($rawNames);
        sort($renderedNames);
        if ($rawNames !== ['api', 'db', 'ops-web', 'worker'] ||
            $renderedNames !== $rawNames) {
            throw new RuntimeException('service set');
        }
        foreach ($expected['services'] as $name => $details) {
            $phase = 'compose_image_drift';
            if ($raw['services'][$name]['image'] !== $details['image']) {
                throw new RuntimeException('image drift');
            }
            if (array_key_exists($name, $p['old'])) {
                $phase = 'source_image_drift';
                if ($raw['services'][$name]['image'] !== $p['old'][$name] ||
                    $service->applications()->where('name', $name)->firstOrFail()->image !== $p['old'][$name]) {
                    throw new RuntimeException('source drift');
                }
                $raw['services'][$name]['image'] = $p['new'][$name];
                $expected['services'][$name]['image'] = $p['new'][$name];
            }
        }
        $phase = 'compose_dump';
        $service->docker_compose_raw = Yaml::dump($raw, 10, 2);
        $service->docker_compose = Yaml::dump($expected, 10, 2);
        $phase = 'save_compose_models';
        $service->save();
        foreach ($p['new'] as $name => $tag) {
            $phase = 'application_set';
            $application = $service->applications()->where('name', $name)->firstOrFail();
            if ($application->image !== $p['old'][$name]) {
                throw new RuntimeException('application drift');
            }
            $application->image = $tag;
            $application->save();
        }
        $phase = 'rendered_diff';
        if (canonical(Yaml::parse($service->docker_compose)) !== canonical($expected) ||
            canonical(Yaml::parse($service->docker_compose_raw)) !== canonical($raw)) {
            throw new RuntimeException('rendered diff');
        }
        foreach ($p['new'] as $name => $tag) {
            $phase = 'application_diff';
            if ($service->applications()->where('name', $name)->firstOrFail()->image !== $tag) {
                throw new RuntimeException('application diff');
            }
        }
        $phase = 'save_compose_files';
        $service->saveComposeConfigs();
        $phase = 'transaction_commit';
    }, 1);
    echo "coolify_api_web_source_synced\n";
} catch (Throwable $e) {
    fwrite(STDERR, "coolify_api_web_source_sync_failed:$phase\n");
    exit(1);
}
'''


def restore_bytes(path: Path, contents: bytes, previous: os.stat_result) -> None:
    """Repair an interrupted Coolify write using only the in-memory prior bytes."""
    fd, temporary = tempfile.mkstemp(prefix=".coolify-repair-", dir=path.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(previous.st_mode))
        os.fchown(fd, previous.st_uid, previous.st_gid)
        with os.fdopen(fd, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def locked_image_swap(record: dict, old_images: dict[str, str],
                      new_images: dict[str, str]) -> None:
    payload = {
        "uuid": UUID, "old": old_images, "new": new_images,
        "raw_sha": sha(record["docker_compose_raw"]),
        "rendered_sha": sha(record["docker_compose"]),
    }
    command("docker", "exec", "-i", "coolify", "php", "-r", PHP_APPLY,
            input_data=json.dumps(payload, separators=(",", ":")).encode(), timeout=180,
            capture_sync_phase=True)


def expected_swapped(raw: dict, rendered: dict,
                     new_images: dict[str, str]) -> tuple[dict, dict]:
    expected_raw, expected_rendered = copy.deepcopy(raw), copy.deepcopy(rendered)
    for name in CHANGED:
        expected_raw["services"][name]["image"] = new_images[name]
        expected_rendered["services"][name]["image"] = new_images[name]
    return expected_raw, expected_rendered


def restore_prior_images_after_postcheck(compose_bytes: bytes, env_bytes: bytes,
                                         compose_stat: os.stat_result,
                                         env_stat: os.stat_result, containers: dict,
                                         raw: dict, rendered: dict,
                                         old_images: dict[str, str],
                                         new_images: dict[str, str]) -> None:
    """Reverse this swap only if the exact target structure still owns the service."""
    target_raw, target_rendered = expected_swapped(raw, rendered, new_images)
    current = service_record()
    if parsed(current["docker_compose_raw"]) != target_raw or \
       parsed(current["docker_compose"]) != target_rendered or \
       application_images() != new_images:
        raise GateError("source_restore_target_metadata_differs")
    if container_identity(container_snapshot(allow_missing_changed=old_images == TARGET)) != \
       container_identity(containers):
        raise GateError("source_restore_containers_changed")
    current_compose = COMPOSE.read_bytes()
    if current_compose != compose_bytes and parsed(current_compose) not in (rendered, target_rendered):
        raise GateError("source_restore_generated_compose_differs")
    reverse_compose_stat, reverse_env_stat = COMPOSE.stat(), ENV.stat()
    reverse_env_bytes = ENV.read_bytes()
    try:
        locked_image_swap(current, new_images, old_images)
    except GateError:
        after_failure = service_record()
        if sha(after_failure["docker_compose_raw"]) == sha(current["docker_compose_raw"]) and \
           sha(after_failure["docker_compose"]) == sha(current["docker_compose"]):
            if COMPOSE.read_bytes() != current_compose:
                restore_bytes(COMPOSE, current_compose, reverse_compose_stat)
            if ENV.read_bytes() != reverse_env_bytes:
                restore_bytes(ENV, reverse_env_bytes, reverse_env_stat)
        raise
    restored = service_record()
    if parsed(restored["docker_compose_raw"]) != raw or \
       parsed(restored["docker_compose"]) != rendered or \
       application_images() != old_images or \
       parsed(COMPOSE.read_bytes()) != rendered:
        raise GateError("source_restore_postcondition_failed")
    if container_identity(container_snapshot(allow_missing_changed=old_images == TARGET)) != \
       container_identity(containers):
        raise GateError("source_restore_containers_changed_after_swap")
    if COMPOSE.read_bytes() != compose_bytes:
        restore_bytes(COMPOSE, compose_bytes, compose_stat)
    if ENV.read_bytes() != env_bytes:
        restore_bytes(ENV, env_bytes, env_stat)
    command("docker", "compose", "-p", UUID, "--project-directory", str(DIRECTORY),
            "-f", str(COMPOSE), "config", "-q")


def sync_images(record: dict, compose_bytes: bytes, env_bytes: bytes,
                containers: dict, raw: dict, rendered: dict,
                old_images: dict[str, str], new_images: dict[str, str]) -> None:
    compose_stat, env_stat = COMPOSE.stat(), ENV.stat()
    if COMPOSE.read_bytes() != compose_bytes or ENV.read_bytes() != env_bytes:
        raise GateError("service_files_changed_during_preflight")
    fresh = service_record()
    if sha(fresh["docker_compose_raw"]) != sha(record["docker_compose_raw"]) or \
       sha(fresh["docker_compose"]) != sha(record["docker_compose"]):
        raise GateError("database_changed_during_preflight")
    allow_missing = old_images == TARGET
    if container_identity(container_snapshot(allow_missing_changed=allow_missing)) != container_identity(containers) or \
       application_images() != old_images:
        raise GateError("containers_or_application_changed_during_preflight")
    try:
        locked_image_swap(record, old_images, new_images)
    except GateError:
        current = service_record()
        if sha(current["docker_compose_raw"]) == sha(record["docker_compose_raw"]) and \
           sha(current["docker_compose"]) == sha(record["docker_compose"]):
            if COMPOSE.read_bytes() != compose_bytes:
                restore_bytes(COMPOSE, compose_bytes, compose_stat)
            if ENV.read_bytes() != env_bytes:
                restore_bytes(ENV, env_bytes, env_stat)
        raise
    expected_raw, expected_rendered = expected_swapped(raw, rendered, new_images)
    try:
        updated = service_record()
        if parsed(updated["docker_compose_raw"]) != expected_raw or \
           parsed(updated["docker_compose"]) != expected_rendered or \
           parsed(COMPOSE.read_bytes()) != expected_rendered:
            raise GateError("coolify_source_differs_after_sync")
        if application_images() != new_images:
            raise GateError("application_image_differs_after_sync")
        if container_identity(container_snapshot(allow_missing_changed=allow_missing)) != \
           container_identity(containers):
            raise GateError("containers_changed_during_sync")
        if ENV.read_bytes() != env_bytes:
            raise GateError("env_changed_after_sync")
        command("docker", "compose", "-p", UUID, "--project-directory", str(DIRECTORY),
                "-f", str(COMPOSE), "config", "-q")
    except Exception as postcheck_error:
        try:
            restore_prior_images_after_postcheck(
                compose_bytes, env_bytes, compose_stat, env_stat,
                containers, raw, rendered, old_images, new_images,
            )
        except Exception as restore_error:
            label = str(restore_error) if isinstance(restore_error, GateError) else type(restore_error).__name__
            raise GateError(f"postcheck_failed_source_restore_failed:{label}") from postcheck_error
        label = str(postcheck_error) if isinstance(postcheck_error, GateError) else type(postcheck_error).__name__
        raise GateError(f"postcheck_failed_source_restored:{label}") from postcheck_error


def healthy(name: str, expected_tag: str, expected_id: str | None = None) -> bool:
    try:
        item = container_snapshot(allow_missing_changed=True)[name]
        if (item["tag"] != expected_tag or item["image_id"] != (expected_id or image_id(expected_tag)) or
            not item["running"] or item["health"] == "unhealthy" or
            item["hash"] != compose_hash(name)):
            return False
        route = "https://api.flixify.vip/health" if name == "api" else "https://flixify.vip/"
        request = Request(route, headers={"User-Agent": "Flixify-release-check/1"})
        with urlopen(request, timeout=8) as response:
            if response.status != 200:
                return False
            if name == "api":
                return json.load(response).get("ok") is True
            return True
    except Exception:
        return False


def recreate(before: dict[str, dict], env_bytes: bytes) -> None:
    accepted = candidate_images()
    verify_candidate_ids(accepted)
    protected = container_identity({name: before[name] for name in ("db", "worker")})
    for name in CHANGED:
        current = container_snapshot(allow_missing_changed=True)[name]
        verify_candidate_ids(accepted)
        if current["tag"] != TARGET[name] or current["image_id"] != accepted[name]:
            command(
                "docker", "compose", "-p", UUID, "--project-directory", str(DIRECTORY),
                "-f", str(COMPOSE), "up", "-d", "--no-deps", "--no-build",
                "--pull", "never", "--force-recreate", name, timeout=180,
            )
        for _ in range(30):
            verify_candidate_ids(accepted)
            if healthy(name, TARGET[name], accepted[name]):
                break
            time.sleep(2)
        else:
            raise GateError(f"new_container_unhealthy:{name}")
        snapshot = container_snapshot(allow_missing_changed=True)
        current_protected = container_identity({name: snapshot[name] for name in protected})
        for protected_name, expected in protected.items():
            if current_protected[protected_name] != expected:
                raise GateError(f"protected_container_changed:{protected_name}")
        if ENV.read_bytes() != env_bytes:
            raise GateError("env_changed_during_recreate")
    verify_candidate_ids(accepted)
    for name in CHANGED:
        if not healthy(name, TARGET[name], accepted[name]):
            raise GateError("new_container_unhealthy:" + name)
    print("api_and_web_recreated_healthy; db_and_worker_unchanged")


def verify_recovery_context(before: dict, compose_bytes: bytes, env_bytes: bytes) -> None:
    current = container_snapshot(allow_missing_changed=True)
    for name in ("db", "worker"):
        if container_identity({name: current[name]}) != container_identity({name: before[name]}):
            raise GateError("protected_container_changed:" + name)
    if COMPOSE.read_bytes() != compose_bytes:
        raise GateError("config_changed_during_recreate")
    if ENV.read_bytes() != env_bytes:
        raise GateError("env_changed_during_recreate")


def rollback() -> None:
    record, compose_bytes, env_bytes, before, raw, rendered = preflight("target", recovering=True)
    # The source images must still be present before changing Coolify metadata.
    for name in CHANGED:
        image_id(SOURCE[name])
    sync_images(record, compose_bytes, env_bytes, before, raw, rendered, TARGET, SOURCE)
    protected = container_identity({name: before[name] for name in ("db", "worker")})
    for name in CHANGED:
        current = container_snapshot(allow_missing_changed=True)[name]
        if current["tag"] != SOURCE[name] or not healthy(name, SOURCE[name]):
            command(
                "docker", "compose", "-p", UUID, "--project-directory", str(DIRECTORY),
                "-f", str(COMPOSE), "up", "-d", "--no-deps", "--no-build",
                "--pull", "never", "--force-recreate", name, timeout=180,
            )
        for _ in range(30):
            if healthy(name, SOURCE[name]):
                break
            time.sleep(2)
        else:
            raise GateError(f"rollback_container_unhealthy:{name}")
        snapshot = container_snapshot(allow_missing_changed=True)
        current_protected = container_identity({name: snapshot[name] for name in protected})
        for protected_name, expected in protected.items():
            if current_protected[protected_name] != expected:
                raise GateError(f"protected_container_changed:{protected_name}")
        if ENV.read_bytes() != env_bytes:
            raise GateError("env_changed_during_rollback")
    print("api_and_web_rolled_back_healthy; db_and_worker_unchanged")


def require_final_pin() -> None:
    import re
    if not re.fullmatch(r"[0-9a-f]{40}", REVISION):
        raise GateError("final_app_revision_pending")
    for name, tag in TARGET.items():
        if tag != f"flixify-{name}:personal-viewer-{REVISION[:7]}-20261026":
            raise GateError("target_revision_tag_differs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--apply", action="store_true", help="sync Coolify images, no restart")
    actions.add_argument("--recreate", action="store_true", help="restart only API and web after sync")
    actions.add_argument("--rollback", action="store_true", help="restore source images after a failed release")
    args = parser.parse_args()
    require_final_pin()
    if args.rollback:
        rollback()
        return
    if args.recreate:
        _, compose_bytes, env_bytes, containers, _, _ = preflight("target")
        try:
            recreate(containers, env_bytes)
        except GateError as error:
            if str(error) in {"command_failed", "command_unavailable"} or str(error).startswith(("new_container_unhealthy:", "candidate_tag_drift:")):
                verify_recovery_context(containers, compose_bytes, env_bytes)
                try:
                    rollback()
                except GateError as rollback_error:
                    raise GateError(f"deploy_failed_and_rollback_failed:{rollback_error}") from error
                raise GateError("deploy_failed_but_source_restored") from error
            raise
        return
    record, compose_bytes, env_bytes, containers, raw, rendered = preflight("source")
    if args.apply:
        sync_images(record, compose_bytes, env_bytes, containers, raw, rendered, SOURCE, TARGET)
        print("coolify_api_web_images_synced; containers_not_restarted; env_unchanged")
    else:
        print("dry_run_ok; only_api_and_web_images_would_change; no_mutation")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print(f"release_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, yaml.YAMLError) as error:
        print(f"release_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
