#!/usr/bin/env python3
"""Synchronize the existing Coolify Flixify service with trial images and worker keys.

Run on the active Flixify host. Default mode is read-only. --apply updates Coolify's
encrypted environment records, raw/rendered Compose source, and generated files.
It deliberately does not restart containers or create a backup. Provider credentials
move only through process memory and stdin, never command arguments or stdout.
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
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import yaml


SERVICE_UUID = "eupquokyj7qegufqvqkjmuyr"
SERVICE_DIR = Path("/data/coolify/services") / SERVICE_UUID
RELEASE_DIR = Path("/data/flixify/releases/three-hour-trial-20261013")
BOT_CONTAINER = "flixify-telegram-bot"
IMAGE_TARGETS = {
    "api": "flixify-api:trial-20261013",
    "worker": "flixify-worker:trial-20261013",
    "ops-web": "flixify-ops-web:trial-20261013",
}
LIVE_IMAGE_ALLOWED = {
    "api": {"flixify-api:vod-latency-57ed0e4", IMAGE_TARGETS["api"]},
    "worker": {"flixify-worker:latest", IMAGE_TARGETS["worker"]},
    "ops-web": {"flixify-ops-web:montana-front-76a741b", IMAGE_TARGETS["ops-web"]},
}
RAW_IMAGE_ALLOWED = {
    "api": {"flixify-api:stripe-test-status-20260924", IMAGE_TARGETS["api"]},
    "worker": {"flixify-worker:latest", IMAGE_TARGETS["worker"]},
    "ops-web": {"flixify-ops-web:stripe-disabled-20260924", IMAGE_TARGETS["ops-web"]},
}
REQUIRED_KEYS = ("RESELLER_API_BASE_URL", "RESELLER_API_KEY")
SAFE_VALUE = re.compile(r"^[A-Za-z0-9:/?&=._%+@-]+$")


class GateError(Exception):
    pass


def command(*args: str, input_data: bytes | None = None, timeout: int = 45) -> bytes:
    try:
        result = subprocess.run(
            args,
            input=input_data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GateError(f"command_unavailable:{args[0]}") from exc
    if result.returncode:
        # stderr can contain interpolated environment values, so suppress it.
        raise GateError(f"command_failed:{args[0]}")
    return result.stdout


def sha(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def service_record() -> dict:
    query = (
        "SELECT row_to_json(s) FROM (SELECT id, uuid, docker_compose_raw, "
        "docker_compose FROM services WHERE uuid='" + SERVICE_UUID + "') s"
    )
    raw = command(
        "docker", "exec", "coolify-db", "psql", "-U", "coolify", "-d", "coolify",
        "-X", "-A", "-t", "-c", query,
    ).decode().strip()
    record = json.loads(raw)
    if record.get("id") != 1 or record.get("uuid") != SERVICE_UUID:
        raise GateError("unexpected_service_identity")
    if not record.get("docker_compose_raw") or not record.get("docker_compose"):
        raise GateError("missing_compose_source")
    return record


def coolify_env_keys() -> set[str]:
    query = (
        "SELECT key FROM environment_variables WHERE resourceable_id=1 "
        "AND resourceable_type='App\\Models\\Service' ORDER BY key"
    )
    output = command(
        "docker", "exec", "coolify-db", "psql", "-U", "coolify", "-d", "coolify",
        "-X", "-A", "-t", "-c", query,
    ).decode()
    return set(output.splitlines())


def env_keys(contents: bytes) -> set[str]:
    keys: set[str] = set()
    for raw_line in contents.splitlines():
        if raw_line.startswith(b"#") or b"=" not in raw_line:
            continue
        key = raw_line.split(b"=", 1)[0].decode("ascii")
        if key in keys:
            raise GateError("duplicate_env_key")
        keys.add(key)
    return keys


def bot_settings() -> dict[str, str]:
    entries = json.loads(command(
        "docker", "inspect", "--format={{json .Config.Env}}", BOT_CONTAINER,
    ))
    settings = dict(entry.split("=", 1) for entry in entries if "=" in entry)
    selected: dict[str, str] = {}
    for name in REQUIRED_KEYS:
        value = settings.get(name, "")
        if not value or not SAFE_VALUE.fullmatch(value):
            raise GateError(f"invalid_bot_setting:{name}")
        selected[name] = value
    parsed = urlsplit(selected["RESELLER_API_BASE_URL"])
    if parsed.hostname != "sifiriptvdns.com" or parsed.scheme not in {"http", "https"}:
        raise GateError("unexpected_provider_origin")
    if parsed.username or parsed.password or not parsed.path or parsed.query or parsed.fragment:
        raise GateError("unexpected_provider_url_shape")
    selected["RESELLER_API_BASE_URL"] = urlunsplit(
        ("https", "sifiriptvdns.com:2087", parsed.path, "", "")
    )
    return selected


def verify_provider(settings: dict[str, str]) -> None:
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            return None

    body = urlencode({
        "api_key": settings["RESELLER_API_KEY"],
        "action": "get_lines", "start": "0", "limit": "1",
    }).encode("ascii")
    request = Request(
        settings["RESELLER_API_BASE_URL"], data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST",
    )
    try:
        with build_opener(NoRedirect).open(request, timeout=15) as response:
            payload = json.load(response)
    except Exception as exc:
        raise GateError("provider_read_only_preflight_failed") from exc
    if payload.get("status") != "STATUS_SUCCESS" or not isinstance(payload.get("data"), list):
        raise GateError("provider_read_only_preflight_failed")


def inspect_container(name: str) -> dict:
    return json.loads(command("docker", "inspect", name))[0]


def validate_baseline(record: dict, compose_text: str, env_contents: bytes) -> dict:
    raw = yaml.safe_load(record["docker_compose_raw"])
    rendered = yaml.safe_load(record["docker_compose"])
    live = yaml.safe_load(compose_text)
    if set(live.get("services", {})) != {"db", "api", "worker", "ops-web"}:
        raise GateError("unexpected_service_set")
    if set(raw.get("services", {})) != set(live["services"]):
        raise GateError("raw_service_set_differs")
    expected = copy.deepcopy(rendered)
    for name, allowed in LIVE_IMAGE_ALLOWED.items():
        live_tag = live["services"][name].get("image")
        if live_tag not in allowed:
            raise GateError(f"unrecognized_live_image:{name}")
        if raw["services"][name].get("image") not in RAW_IMAGE_ALLOWED[name]:
            raise GateError(f"unrecognized_coolify_image:{name}")
        expected["services"][name]["image"] = live_tag
        container = inspect_container(f"{name}-{SERVICE_UUID}")
        if container["Config"]["Image"] != live_tag:
            raise GateError(f"container_image_differs:{name}")
        labels = container["Config"].get("Labels") or {}
        if labels.get("com.docker.compose.project") != SERVICE_UUID:
            raise GateError(f"container_project_differs:{name}")
        if name in {"api", "ops-web"}:
            digest = command(
                "docker", "compose", "-f", str(SERVICE_DIR / "docker-compose.yml"),
                "config", "--hash", name,
            ).decode().strip().split()[-1]
            if labels.get("com.docker.compose.config-hash") != digest:
                raise GateError(f"container_config_differs:{name}")
    if expected != live:
        raise GateError("live_compose_differs_from_coolify_render")
    names = env_keys(env_contents)
    service_names = {f"SERVICE_NAME_{name.upper().replace('-', '_')}" for name in live["services"]}
    if names != coolify_env_keys() | service_names:
        raise GateError("env_file_has_untracked_keys")
    return live


def candidate_compose(live: dict, provider_key: str) -> str:
    candidate = copy.deepcopy(live)
    for name, image in IMAGE_TARGETS.items():
        candidate["services"][name]["image"] = image
    worker_env = candidate["services"]["worker"].get("environment")
    if not isinstance(worker_env, dict):
        raise GateError("worker_environment_not_a_mapping")
    for name in REQUIRED_KEYS:
        placeholder = "${" + name + "}"
        if name in worker_env and worker_env[name] != placeholder:
            raise GateError(f"worker_forwarding_conflict:{name}")
        worker_env[name] = placeholder
    rendered = yaml.safe_dump(candidate, sort_keys=False, allow_unicode=True)
    if provider_key in rendered:
        raise GateError("candidate_contains_provider_key")
    if yaml.safe_load(rendered) != candidate:
        raise GateError("candidate_yaml_roundtrip_failed")
    return rendered


def atomic_write(
    path: Path, contents: bytes, mode: int = 0o600,
    owner: tuple[int, int] | None = None,
) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".trial-sync-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        if owner is not None:
            os.fchown(fd, owner[0], owner[1])
        with os.fdopen(fd, "wb") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


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
        if ($service->id !== 1 || hash('sha256', $service->docker_compose_raw) !== $p['raw_sha'] ||
            hash('sha256', $service->docker_compose) !== $p['rendered_sha']) {
            throw new RuntimeException('precondition');
        }
        $raw = Yaml::parse($service->docker_compose_raw);
        foreach ($p['images'] as $name => $target) {
            if (!in_array($raw['services'][$name]['image'], $p['raw_allowed'][$name], true)) {
                throw new RuntimeException('unrecognized image');
            }
            $raw['services'][$name]['image'] = $target;
        }
        $workerEnv = $raw['services']['worker']['environment'];
        if (!is_array($workerEnv) || !array_is_list($workerEnv)) {
            throw new RuntimeException('unexpected raw worker environment');
        }
        foreach (['RESELLER_API_BASE_URL', 'RESELLER_API_KEY'] as $name) {
            $entry = $name.'=${'.$name.'}';
            $matching = array_values(array_filter($workerEnv, fn ($x) => is_string($x) && str_starts_with($x, $name.'=')));
            if (count($matching) > 1 || (count($matching) === 1 && $matching[0] !== $entry)) {
                throw new RuntimeException('worker forwarding conflict');
            }
            if (!$matching) { $workerEnv[] = $entry; }
            $found = $service->environment_variables()->where('key', $name)->first();
            if ($found) {
                if ($found->value !== $p['settings'][$name]) {
                    throw new RuntimeException('environment value conflict');
                }
            } else {
                $service->environment_variables()->create([
                    'key' => $name,
                    'value' => $p['settings'][$name],
                    'is_literal' => false,
                    'is_runtime' => true,
                    'is_buildtime' => false,
                ]);
            }
        }
        $raw['services']['worker']['environment'] = $workerEnv;
        $service->docker_compose_raw = Yaml::dump($raw, 10, 2);
        $service->save();
        $service->parse();
        $generated = Yaml::parse($service->docker_compose);
        $candidate = Yaml::parse($p['candidate']);
        if (canonical($generated) !== canonical($candidate)) {
            throw new RuntimeException('rendered compose structural diff');
        }
        foreach ($p['images'] as $name => $target) {
            if ($service->applications()->where('name', $name)->firstOrFail()->image !== $target) {
                throw new RuntimeException('application image not synchronized');
            }
        }
        $service->saveComposeConfigs();
    }, 1);
    echo "coolify_source_synced\n";
} catch (Throwable $e) {
    fwrite(STDERR, "coolify_source_sync_failed\n");
    exit(1);
}
'''


def apply(
    record: dict, candidate: str, settings: dict[str, str],
    old_compose: bytes, old_env: bytes,
    old_compose_stat: os.stat_result, old_env_stat: os.stat_result,
) -> None:
    release_compose = RELEASE_DIR / "compose.yml"
    if release_compose.exists() and release_compose.read_bytes() != candidate.encode():
        raise GateError("release_candidate_conflict")
    atomic_write(release_compose, candidate.encode())
    if (SERVICE_DIR / "docker-compose.yml").read_bytes() != old_compose:
        raise GateError("compose_changed_during_preflight")
    if (SERVICE_DIR / ".env").read_bytes() != old_env:
        raise GateError("env_changed_during_preflight")
    payload = {
        "uuid": SERVICE_UUID,
        "raw_sha": sha(record["docker_compose_raw"]),
        "rendered_sha": sha(record["docker_compose"]),
        "images": IMAGE_TARGETS,
        "raw_allowed": {k: sorted(v) for k, v in RAW_IMAGE_ALLOWED.items()},
        "candidate": candidate,
        "settings": settings,
    }
    try:
        command(
            "docker", "exec", "-i", "coolify", "php", "-r", PHP_APPLY,
            input_data=json.dumps(payload, separators=(",", ":")).encode(), timeout=180,
        )
    except GateError:
        # A failed DB transaction may have written part of the generated files.
        # Restore only if the DB raw source is still unchanged. The original bytes
        # live in memory; no backup file is created.
        if sha(service_record()["docker_compose_raw"]) == payload["raw_sha"]:
            if (SERVICE_DIR / "docker-compose.yml").read_bytes() != old_compose:
                atomic_write(
                    SERVICE_DIR / "docker-compose.yml", old_compose,
                    stat.S_IMODE(old_compose_stat.st_mode),
                    (old_compose_stat.st_uid, old_compose_stat.st_gid),
                )
            if (SERVICE_DIR / ".env").read_bytes() != old_env:
                atomic_write(
                    SERVICE_DIR / ".env", old_env,
                    stat.S_IMODE(old_env_stat.st_mode),
                    (old_env_stat.st_uid, old_env_stat.st_gid),
                )
        raise
    current = yaml.safe_load((SERVICE_DIR / "docker-compose.yml").read_text())
    if current != yaml.safe_load(candidate):
        raise GateError("generated_compose_differs_after_commit")
    config = json.loads(command(
        "docker", "compose", "--project-directory", str(SERVICE_DIR),
        "-f", str(SERVICE_DIR / "docker-compose.yml"), "config", "--format", "json",
    ))
    worker_env = config["services"]["worker"].get("environment", {})
    if any(worker_env.get(k) != settings[k] for k in REQUIRED_KEYS):
        raise GateError("worker_provider_environment_not_forwarded")
    if not set(REQUIRED_KEYS).issubset(env_keys((SERVICE_DIR / ".env").read_bytes())):
        raise GateError("generated_env_missing_provider_keys")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Synchronize Coolify source; no container restart")
    args = parser.parse_args()
    compose_file = SERVICE_DIR / "docker-compose.yml"
    env_file = SERVICE_DIR / ".env"
    if not compose_file.is_file() or not env_file.is_file():
        raise GateError("coolify_service_files_missing")
    old_compose_stat = compose_file.stat()
    old_env_stat = env_file.stat()
    old_compose = compose_file.read_bytes()
    old_env = env_file.read_bytes()
    record = service_record()
    live = validate_baseline(record, old_compose.decode(), old_env)
    settings = bot_settings()
    verify_provider(settings)
    candidate = candidate_compose(live, settings["RESELLER_API_KEY"])
    if args.apply:
        apply(
            record, candidate, settings, old_compose, old_env,
            old_compose_stat, old_env_stat,
        )
        print("coolify_source_synced; containers_not_restarted")
    else:
        print("dry_run_ok; no_files_or_database_changed")


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        # GateError messages are fixed labels, never interpolated provider values.
        print(f"trial_sync_stopped:{error}", file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, yaml.YAMLError) as error:
        # Parser exceptions can include source lines and therefore secrets.
        print(f"trial_sync_stopped:{type(error).__name__}", file=sys.stderr)
        sys.exit(1)
