"""Switch only the existing Flixify web container to a verified UI overlay image."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


SERVICE = "eupquokyj7qegufqvqkjmuyr"
COMPOSE_FILE = Path(f"/data/coolify/services/{SERVICE}/docker-compose.yml")
WEB = f"ops-web-{SERVICE}"
BASE_IMAGE = "flixify-ops-web:montana-front-b14aefc"
COMPOSE = ["docker", "compose", "-p", SERVICE, "-f", str(COMPOSE_FILE)]
PROTECTED = [f"api-{SERVICE}", f"worker-{SERVICE}", f"db-{SERVICE}", "redis-dzaxcg8qzkth6xvwdhcicosh"]


def run(*command: str) -> str:
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f"{command[0]} failed: {result.stderr[-800:]}")
    return result.stdout.strip()


def inspect(name: str, field: str) -> str:
    return run("docker", "inspect", f"--format={field}", name)


def replace_compose(contents: str) -> None:
    with tempfile.NamedTemporaryFile("w", dir=COMPOSE_FILE.parent, prefix="compose-ui-", delete=False) as file:
        temporary = Path(file.name)
        file.write(contents)
    try:
        os.chmod(temporary, COMPOSE_FILE.stat().st_mode & 0o777)
        os.replace(temporary, COMPOSE_FILE)
    finally:
        temporary.unlink(missing_ok=True)


def healthy(new_image: str) -> bool:
    if inspect(WEB, "{{.Config.Image}}") != new_image or inspect(WEB, "{{.State.Running}}") != "true":
        return False
    for route in ("/", "/filmler", "/diziler", "/canli-tv", "/ayarlar"):
        try:
            with urllib.request.urlopen(f"https://flixify.vip{route}", timeout=6) as response:
                if response.status != 200:
                    return False
        except Exception:
            return False
    return True


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: deploy-ops-web-ui.py NEW_IMAGE EXPECTED_COMMIT_SHA")
    new_image, expected_commit = sys.argv[1:]
    if not new_image.startswith("flixify-ops-web:montana-front-") or len(expected_commit) != 40:
        raise RuntimeError("Unexpected image tag or commit SHA")
    label = inspect(new_image, '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
    if label != expected_commit:
        raise RuntimeError("Image does not match the expected source commit")
    current_image = inspect(WEB, "{{.Config.Image}}")
    if current_image != BASE_IMAGE:
        raise RuntimeError(f"Live web image changed: {current_image}")
    original = COMPOSE_FILE.read_text()
    old_line = f"    image: '{BASE_IMAGE}'"
    if original.count(old_line) != 1:
        raise RuntimeError("Compose web image differs from the running baseline")
    protected_before = {name: inspect(name, "{{.Id}} {{.State.StartedAt}}") for name in PROTECTED}
    backup = COMPOSE_FILE.with_name(f"docker-compose.yml.pre-montana-front-{int(time.time())}")
    shutil.copy2(COMPOSE_FILE, backup)
    changed = False
    try:
        replace_compose(original.replace(old_line, f"    image: '{new_image}'", 1))
        changed = True
        run(*COMPOSE, "config", "-q")
        run(*COMPOSE, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "--pull", "never", "ops-web")
        for _ in range(40):
            if healthy(new_image):
                break
            time.sleep(2)
        else:
            raise RuntimeError("New web image did not become healthy")
        for name, before in protected_before.items():
            if inspect(name, "{{.Id}} {{.State.StartedAt}}") != before:
                raise RuntimeError(f"Protected service changed: {name}")
        print(f"Web-only deployment healthy: {new_image}")
        print(f"Rollback compose backup: {backup}")
    except Exception:
        if changed:
            replace_compose(original)
            subprocess.run([*COMPOSE, "up", "-d", "--no-deps", "--no-build", "--force-recreate", "--pull", "never", "ops-web"], capture_output=True, timeout=180)
        raise


if __name__ == "__main__":
    main()
