"""Switch only the existing Flixify API container to a verified VOD image."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path


SERVICE = "eupquokyj7qegufqvqkjmuyr"
COMPOSE_FILE = Path(f"/data/coolify/services/{SERVICE}/docker-compose.yml")
API = f"api-{SERVICE}"
BASE_IMAGE = "flixify-api:referral-stripe-20260925"
HEALTH_URL = "https://api.flixify.vip/health"
COMPOSE = ["docker", "compose", "-p", SERVICE, "-f", str(COMPOSE_FILE)]
PROTECTED = [
    f"ops-web-{SERVICE}",
    f"worker-{SERVICE}",
    f"db-{SERVICE}",
    "redis-dzaxcg8qzkth6xvwdhcicosh",
]


def run(*command: str) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f"{command[0]} failed: {result.stderr[-800:]}")
    return result.stdout.strip()


def inspect(name: str, field: str) -> str:
    return run("docker", "inspect", f"--format={field}", name)


def protected_snapshot() -> dict[str, str]:
    return {name: inspect(name, "{{.Id}} {{.State.StartedAt}}") for name in PROTECTED}


def assert_protected_unchanged(before: dict[str, str]) -> None:
    for name, state in before.items():
        if inspect(name, "{{.Id}} {{.State.StartedAt}}") != state:
            raise RuntimeError(f"Protected service changed: {name}")


def updated_compose(original: str, new_image: str) -> str:
    old_line = f"    image: '{BASE_IMAGE}'"
    if original.count(old_line) != 1:
        raise RuntimeError("Compose API image differs from the running baseline")
    api_match = re.search(r"^  api:\s*$", original, re.MULTILINE)
    if api_match is None:
        raise RuntimeError("API service is missing from compose")
    next_service = re.search(r"^  [A-Za-z0-9_-]+:\s*$", original[api_match.end():], re.MULTILINE)
    api_end = api_match.end() + next_service.start() if next_service else len(original)
    if old_line not in original[api_match.end():api_end]:
        raise RuntimeError("Baseline image does not belong to the API service")
    return original.replace(old_line, f"    image: '{new_image}'", 1)


def validate_compose(contents: str) -> None:
    with tempfile.NamedTemporaryFile(
        "w", dir=COMPOSE_FILE.parent, prefix="compose-api-check-", suffix=".yml", delete=False
    ) as file:
        temporary = Path(file.name)
        file.write(contents)
    try:
        run("docker", "compose", "-p", SERVICE, "-f", str(temporary), "config", "-q")
    finally:
        temporary.unlink(missing_ok=True)


def replace_compose(contents: str) -> None:
    with tempfile.NamedTemporaryFile(
        "w", dir=COMPOSE_FILE.parent, prefix="compose-api-", delete=False
    ) as file:
        temporary = Path(file.name)
        file.write(contents)
    try:
        os.chmod(temporary, COMPOSE_FILE.stat().st_mode & 0o777)
        os.replace(temporary, COMPOSE_FILE)
    finally:
        temporary.unlink(missing_ok=True)


def healthy(image: str) -> bool:
    try:
        if inspect(API, "{{.Config.Image}}") != image:
            return False
        state = json.loads(inspect(API, "{{json .State}}"))
        if state.get("Running") is not True:
            return False
        health = state.get("Health")
        if health is not None and health.get("Status") != "healthy":
            return False
        with urllib.request.urlopen(HEALTH_URL, timeout=6) as response:
            return response.status == 200 and json.load(response).get("ok") is True
    except Exception:
        return False


def wait_healthy(image: str) -> bool:
    for _ in range(40):
        if healthy(image):
            return True
        time.sleep(2)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("new_image", help="flixify-api:vod-latency-<commit prefix>")
    parser.add_argument("expected_commit", help="full 40-character source commit SHA")
    parser.add_argument("--dry-run", action="store_true", help="validate without changing the live service")
    args = parser.parse_args()

    commit = args.expected_commit
    tag = re.fullmatch(r"flixify-api:vod-latency-([0-9a-f]{7,40})", args.new_image)
    if not re.fullmatch(r"[0-9a-f]{40}", commit) or tag is None or not commit.startswith(tag.group(1)):
        raise RuntimeError("Unexpected image tag or source commit SHA")
    label = inspect(args.new_image, '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
    if label != commit:
        raise RuntimeError("Image does not match the expected source commit")
    current_image = inspect(API, "{{.Config.Image}}")
    if current_image != BASE_IMAGE:
        raise RuntimeError(f"Live API image changed: {current_image}")

    original = COMPOSE_FILE.read_text()
    proposed = updated_compose(original, args.new_image)
    validate_compose(proposed)
    protected_before = protected_snapshot()

    if args.dry_run:
        assert_protected_unchanged(protected_before)
        print(f"Dry run passed: {BASE_IMAGE} -> {args.new_image}; API was not restarted")
        return

    backup = COMPOSE_FILE.with_name(f"docker-compose.yml.pre-vod-latency-{time.time_ns()}")
    shutil.copy2(COMPOSE_FILE, backup)
    changed = False
    try:
        replace_compose(proposed)
        changed = True
        run(*COMPOSE, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "--pull", "never", "api")
        if not wait_healthy(args.new_image):
            raise RuntimeError("New API image did not become healthy")
        assert_protected_unchanged(protected_before)
        print(f"API-only deployment healthy: {args.new_image}")
        print(f"Rollback compose backup: {backup}")
    except Exception as error:
        if changed:
            try:
                replace_compose(original)
                run(*COMPOSE, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "--pull", "never", "api")
                if not wait_healthy(BASE_IMAGE):
                    raise RuntimeError("Original API image did not become healthy after rollback")
                assert_protected_unchanged(protected_before)
            except Exception as rollback_error:
                raise RuntimeError(f"Deployment failed; rollback also failed: {rollback_error}") from error
        raise


if __name__ == "__main__":
    main()
