#!/usr/bin/env python3
"""Persist one locally built Flixify API image in the active Coolify service.

Default mode is read-only. --apply changes only the API image in Coolify's raw
Compose source, lets Coolify regenerate its rendered Compose and service file,
and does not restart any container. No backup file is created. Existing file
bytes are held in memory only for an atomic repair if Coolify fails mid-write.
Never print YAML, environment values, or exception text: they may hold secrets.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml


SERVICE_UUID = "eupquokyj7qegufqvqkjmuyr"
SERVICE_ID = 1
SERVICE_DIR = Path("/data/coolify/services") / SERVICE_UUID
SOURCE_IMAGE = "flixify-api:trial-20261013"
TARGET_IMAGE = "flixify-api:proxy-free-movies-20261013"
SERVICE_NAMES = {"db", "api", "worker", "ops-web"}


class GateError(Exception):
    pass


def command(*args: str, input_data: bytes | None = None, timeout: int = 45) -> bytes:
    try:
        result = subprocess.run(
            args, input=input_data, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GateError("command_unavailable") from exc
    if result.returncode:
        # stderr can contain interpolated secrets; never include it in errors.
        raise GateError("command_failed")
    return result.stdout


def sha(contents: str | bytes) -> str:
    if isinstance(contents, str):
        contents = contents.encode()
    return hashlib.sha256(contents).hexdigest()


def image_id(tag: str) -> str:
    value = command("docker", "image", "inspect", "--format={{.Id}}", tag).decode().strip()
    if not value.startswith("sha256:"):
        raise GateError("unexpected_image_id")
    return value


def service_record() -> dict:
    query = (
        "SELECT row_to_json(s) FROM (SELECT id, uuid, docker_compose_raw, "
        "docker_compose FROM services WHERE uuid='" + SERVICE_UUID + "') s"
    )
    record = json.loads(command(
        "docker", "exec", "coolify-db", "psql", "-U", "coolify", "-d", "coolify",
        "-X", "-A", "-t", "-c", query,
    ).decode().strip())
    if record.get("id") != SERVICE_ID or record.get("uuid") != SERVICE_UUID:
        raise GateError("unexpected_service_identity")
    if not record.get("docker_compose_raw") or not record.get("docker_compose"):
        raise GateError("missing_compose_source")
    return record


PHP_READ_APPLICATION = r'''
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
try {
    $service = App\Models\Service::where('uuid', 'eupquokyj7qegufqvqkjmuyr')->firstOrFail();
    if ($service->id !== 1) { throw new RuntimeException('identity'); }
    echo $service->applications()->where('name', 'api')->firstOrFail()->image;
} catch (Throwable $e) {
    fwrite(STDERR, "application_read_failed\n");
    exit(1);
}
'''


def application_image() -> str:
    return command("docker", "exec", "coolify", "php", "-r", PHP_READ_APPLICATION).decode().strip()


def parsed_compose(contents: str | bytes) -> dict:
    parsed = yaml.safe_load(contents)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("services"), dict):
        raise GateError("invalid_compose")
    if set(parsed["services"]) != SERVICE_NAMES:
        raise GateError("unexpected_service_set")
    return parsed


def container_snapshot() -> dict[str, dict]:
    snapshot: dict[str, dict] = {}
    for name in SERVICE_NAMES:
        item = json.loads(command("docker", "inspect", f"{name}-{SERVICE_UUID}"))[0]
        labels = item["Config"].get("Labels") or {}
        if labels.get("com.docker.compose.project") != SERVICE_UUID:
            raise GateError("container_project_differs")
        snapshot[name] = {
            "id": item["Id"],
            "image_id": item["Image"],
            "image_tag": item["Config"]["Image"],
            "config_hash": labels.get("com.docker.compose.config-hash"),
        }
    return snapshot


def preflight(record: dict, compose_file: bytes, containers: dict[str, dict]) -> tuple[dict, dict]:
    raw = parsed_compose(record["docker_compose_raw"])
    rendered = parsed_compose(record["docker_compose"])
    generated = parsed_compose(compose_file)
    if generated != rendered:
        raise GateError("generated_compose_differs_from_database")
    if raw["services"]["api"].get("image") != SOURCE_IMAGE:
        raise GateError("unexpected_raw_api_image")
    if application_image() != SOURCE_IMAGE:
        raise GateError("unexpected_application_api_image")
    for name in SERVICE_NAMES:
        expected_tag = generated["services"][name].get("image")
        if not isinstance(expected_tag, str):
            raise GateError("missing_service_image")
        if raw["services"][name].get("image") != expected_tag:
            raise GateError("raw_rendered_image_differs")
        if containers[name]["image_tag"] != expected_tag:
            raise GateError("running_image_differs")
        if containers[name]["image_id"] != image_id(expected_tag):
            raise GateError("running_image_id_differs")
    if generated["services"]["api"]["image"] != SOURCE_IMAGE:
        raise GateError("unexpected_generated_api_image")
    api_hash = command(
        "docker", "compose", "-f", str(SERVICE_DIR / "docker-compose.yml"),
        "config", "--hash", "api",
    ).decode().strip().split()[-1]
    if containers["api"]["config_hash"] != api_hash:
        raise GateError("running_api_config_differs")
    if image_id(SOURCE_IMAGE) == image_id(TARGET_IMAGE):
        raise GateError("candidate_image_is_source_image")
    return raw, rendered


PHP_APPLY = r'''
require "/var/www/html/vendor/autoload.php";
$app = require "/var/www/html/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
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
try {
    $p = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
    DB::transaction(function () use ($p) {
        $service = Service::where('uuid', $p['uuid'])->lockForUpdate()->firstOrFail();
        if ($service->id !== 1 ||
            hash('sha256', $service->docker_compose_raw) !== $p['raw_sha'] ||
            hash('sha256', $service->docker_compose) !== $p['rendered_sha']) {
            throw new RuntimeException('precondition');
        }
        $raw = Yaml::parse($service->docker_compose_raw);
        $expected = Yaml::parse($service->docker_compose);
        if (array_keys($raw['services']) !== array_keys($expected['services']) ||
            $raw['services']['api']['image'] !== $p['old_image'] ||
            $expected['services']['api']['image'] !== $p['old_image'] ||
            $service->applications()->where('name', 'api')->firstOrFail()->image !== $p['old_image']) {
            throw new RuntimeException('unexpected source');
        }
        foreach ($expected['services'] as $name => $details) {
            if ($raw['services'][$name]['image'] !== $details['image']) {
                throw new RuntimeException('image drift');
            }
        }
        $raw['services']['api']['image'] = $p['new_image'];
        $expected['services']['api']['image'] = $p['new_image'];
        $service->docker_compose_raw = Yaml::dump($raw, 10, 2);
        $service->save();
        $service->parse();
        if (canonical(Yaml::parse($service->docker_compose)) !== canonical($expected) ||
            canonical(Yaml::parse($service->docker_compose_raw)) !== canonical($raw) ||
            $service->applications()->where('name', 'api')->firstOrFail()->image !== $p['new_image']) {
            throw new RuntimeException('rendered diff');
        }
        $service->saveComposeConfigs();
    }, 1);
    echo "coolify_api_source_synced\n";
} catch (Throwable $e) {
    fwrite(STDERR, "coolify_api_source_sync_failed\n");
    exit(1);
}
'''


def restore_bytes(path: Path, contents: bytes, previous_stat: os.stat_result) -> None:
    # Temporary replacement is removed automatically; this is not a backup file.
    fd, temporary = tempfile.mkstemp(prefix=".coolify-repair-", dir=path.parent)
    try:
        os.fchmod(fd, stat.S_IMODE(previous_stat.st_mode))
        os.fchown(fd, previous_stat.st_uid, previous_stat.st_gid)
        with os.fdopen(fd, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply(record: dict, old_compose: bytes, old_env: bytes,
          compose_stat: os.stat_result, env_stat: os.stat_result,
          containers: dict[str, dict], old_raw: dict, old_rendered: dict) -> None:
    compose_path = SERVICE_DIR / "docker-compose.yml"
    env_path = SERVICE_DIR / ".env"
    if compose_path.read_bytes() != old_compose or env_path.read_bytes() != old_env:
        raise GateError("service_files_changed_during_preflight")
    fresh = service_record()
    if (sha(fresh["docker_compose_raw"]) != sha(record["docker_compose_raw"]) or
        sha(fresh["docker_compose"]) != sha(record["docker_compose"])):
        raise GateError("database_changed_during_preflight")
    if application_image() != SOURCE_IMAGE or container_snapshot() != containers:
        raise GateError("containers_or_application_changed_during_preflight")
    payload = {
        "uuid": SERVICE_UUID,
        "old_image": SOURCE_IMAGE,
        "new_image": TARGET_IMAGE,
        "raw_sha": sha(record["docker_compose_raw"]),
        "rendered_sha": sha(record["docker_compose"]),
    }
    try:
        command(
            "docker", "exec", "-i", "coolify", "php", "-r", PHP_APPLY,
            input_data=json.dumps(payload, separators=(",", ":")).encode(), timeout=180,
        )
    except GateError:
        # A failed DB transaction can leave generated files partially written.
        # Restore them only when the DB still matches the old source.
        current = service_record()
        if (sha(current["docker_compose_raw"]) == payload["raw_sha"] and
            sha(current["docker_compose"]) == payload["rendered_sha"]):
            if compose_path.read_bytes() != old_compose:
                restore_bytes(compose_path, old_compose, compose_stat)
            if env_path.read_bytes() != old_env:
                restore_bytes(env_path, old_env, env_stat)
        raise

    expected_raw = copy.deepcopy(old_raw)
    expected_rendered = copy.deepcopy(old_rendered)
    expected_raw["services"]["api"]["image"] = TARGET_IMAGE
    expected_rendered["services"]["api"]["image"] = TARGET_IMAGE
    updated = service_record()
    if parsed_compose(updated["docker_compose_raw"]) != expected_raw or \
       parsed_compose(updated["docker_compose"]) != expected_rendered:
        raise GateError("database_differs_after_commit")
    if parsed_compose(compose_path.read_bytes()) != expected_rendered:
        raise GateError("generated_compose_differs_after_commit")
    if application_image() != TARGET_IMAGE:
        raise GateError("application_image_differs_after_commit")
    if container_snapshot() != containers:
        raise GateError("containers_changed_during_sync")
    if sha(env_path.read_bytes()) != sha(old_env):
        restore_bytes(env_path, old_env, env_stat)
        raise GateError("env_changed_after_commit_restored")
    config = json.loads(command(
        "docker", "compose", "--project-directory", str(SERVICE_DIR),
        "-f", str(compose_path), "config", "--format", "json",
    ))
    for name in SERVICE_NAMES:
        if config["services"][name]["image"] != expected_rendered["services"][name]["image"]:
            raise GateError("docker_compose_effective_image_differs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Persist one API image; no restart")
    args = parser.parse_args()
    compose_path = SERVICE_DIR / "docker-compose.yml"
    env_path = SERVICE_DIR / ".env"
    if not compose_path.is_file() or not env_path.is_file():
        raise GateError("coolify_service_files_missing")
    compose_stat, env_stat = compose_path.stat(), env_path.stat()
    old_compose, old_env = compose_path.read_bytes(), env_path.read_bytes()
    record = service_record()
    containers = container_snapshot()
    old_raw, old_rendered = preflight(record, old_compose, containers)
    if args.apply:
        apply(record, old_compose, old_env, compose_stat, env_stat,
              containers, old_raw, old_rendered)
        print("coolify_api_image_synced; containers_not_restarted; env_hash_unchanged")
    else:
        print("dry_run_ok; only_api_image_would_change; no_files_or_database_changed")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        # Gate labels are fixed text and contain no YAML or environment values.
        print(f"api_image_sync_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, yaml.YAMLError) as error:
        # YAML/JSON parser exception messages may include source lines and secrets.
        print(f"api_image_sync_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
