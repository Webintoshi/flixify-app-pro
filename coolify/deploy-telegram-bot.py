"""Update only the bind-mounted Telegram bot script and restart its container."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_HOST = Path("/data/flixify/app/scripts/telegram-panel-bot.mjs")
DATA_HOST = Path("/data/flixify/app/data")
LOG_HOST = Path("/data/flixify/app/logs")
BACKUP_ROOT = Path("/data/flixify/telegram-bot-backups")
BOT = "flixify-telegram-bot"
HEALTH_TIMEOUT_SECONDS = 60
SERVICE = "eupquokyj7qegufqvqkjmuyr"
PROTECTED = [
    f"api-{SERVICE}",
    f"ops-web-{SERVICE}",
    f"worker-{SERVICE}",
    f"db-{SERVICE}",
    "redis-dzaxcg8qzkth6xvwdhcicosh",
]


def run(*command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=90)
    if result.returncode:
        # Docker/node stderr can contain script lines or configuration secrets.
        raise RuntimeError(f"{command[0]} command failed (exit {result.returncode})")
    return result.stdout.strip()


def inspect(name, field):
    return run("docker", "inspect", f"--format={field}", name)


def protected_snapshot():
    return {name: inspect(name, "{{.Id}} {{.State.StartedAt}}") for name in PROTECTED}


def assert_protected_unchanged(before):
    for name, value in before.items():
        if inspect(name, "{{.Id}} {{.State.StartedAt}}") != value:
            raise RuntimeError(f"Protected service changed: {name}")


def guard_bot():
    if inspect(BOT, "{{.Name}}") != f"/{BOT}":
        raise RuntimeError("Unexpected Telegram bot container name")
    expected_mounts = {
        "/app/scripts/telegram-panel-bot.mjs": str(SCRIPT_HOST),
        "/app/data": str(DATA_HOST),
        "/app/logs": str(LOG_HOST),
    }
    mounts = json.loads(inspect(BOT, "{{json .Mounts}}"))
    if len(mounts) != len(expected_mounts) or {mount.get("Destination") for mount in mounts} != set(expected_mounts):
        raise RuntimeError("Unexpected Telegram bot mount count")
    for mount in mounts:
        if (
            mount.get("Type") != "bind"
            or mount.get("Source") != expected_mounts.get(mount.get("Destination"))
            or mount.get("RW") is not True
        ):
            raise RuntimeError("Unexpected Telegram bot bind mount")
    if json.loads(inspect(BOT, "{{json .Config.Cmd}}")) != ["node", "scripts/telegram-panel-bot.mjs"]:
        raise RuntimeError("Unexpected Telegram bot command")
    if inspect(BOT, "{{.Config.WorkingDir}}") != "/app":
        raise RuntimeError("Unexpected Telegram bot working directory")
    if inspect(BOT, "{{.HostConfig.RestartPolicy.Name}}") != "unless-stopped":
        raise RuntimeError("Unexpected Telegram bot restart policy")
    if inspect(BOT, "{{.HostConfig.NetworkMode}}") != "bridge":
        raise RuntimeError("Unexpected Telegram bot network mode")
    if inspect(BOT, "{{.State.Running}}") != "true":
        raise RuntimeError("Telegram bot container is not running")
    return inspect(BOT, "{{.Id}}")


def read_json(path):
    return json.loads(path.read_text())


def admin_ids(value):
    ids = value.get("adminIds")
    if not isinstance(ids, list) or any(not isinstance(item, (str, int)) or isinstance(item, bool) for item in ids):
        raise RuntimeError("Invalid persisted Telegram admin state")
    return {str(item) for item in ids}


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Timestamp lacks timezone")
    return parsed


def healthy(after, bot_id, state_admins, heartbeat_admins):
    try:
        if inspect(BOT, "{{.Id}}") != bot_id or inspect(BOT, "{{.State.Running}}") != "true":
            return False
        heartbeat = read_json(DATA_HOST / "telegram-panel-bot-heartbeat.json")
        if heartbeat.get("status") != "running" or heartbeat.get("isPolling") is not True:
            return False
        now = datetime.now(timezone.utc)
        for key in ("lastHeartbeatAt", "lastSyncAt"):
            observed = timestamp(heartbeat[key])
            if observed <= after or (observed - now).total_seconds() > 5:
                return False
        if (now - timestamp(heartbeat["lastHeartbeatAt"])).total_seconds() > 35:
            return False
        return (
            admin_ids(heartbeat) == heartbeat_admins
            and admin_ids(read_json(DATA_HOST / "telegram-panel-bot-state.json")) == state_admins
        )
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        return False


def wait_healthy(after, bot_id, state_admins, heartbeat_admins):
    deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
    while True:
        if healthy(after, bot_id, state_admins, heartbeat_admins):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(1.5)


def validate_syntax(new_script):
    temporary = f"/tmp/flixify-telegram-check-{uuid.uuid4().hex}.mjs"
    try:
        run("docker", "cp", str(new_script), f"{BOT}:{temporary}")
        run("docker", "exec", BOT, "node", "--check", temporary)
    finally:
        run("docker", "exec", BOT, "rm", "-f", temporary)


def write_existing_inode(contents, expected_inode):
    # os.replace would change the host inode while Docker retained the old bind.
    with SCRIPT_HOST.open("r+b") as file:
        stat = os.fstat(file.fileno())
        if (stat.st_dev, stat.st_ino) != expected_inode:
            raise RuntimeError("Telegram bot script inode changed")
        file.seek(0)
        file.write(contents)
        file.truncate()
        file.flush()
        os.fsync(file.fileno())


def deploy(new_script, expected_current_sha, expected_new_sha, dry_run=False):
    for value in (expected_current_sha, expected_new_sha):
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise RuntimeError("Expected SHA must be 64 lowercase hexadecimal characters")
    new_script = Path(new_script)
    if SCRIPT_HOST.is_symlink() or not SCRIPT_HOST.is_file():
        raise RuntimeError("Telegram bot script must be an existing regular file")
    new_contents = new_script.read_bytes()
    if hashlib.sha256(new_contents).hexdigest() != expected_new_sha:
        raise RuntimeError("The new script SHA does not match")
    original = SCRIPT_HOST.read_bytes()
    if hashlib.sha256(original).hexdigest() != expected_current_sha:
        raise RuntimeError("The current script SHA does not match")
    if expected_current_sha == expected_new_sha:
        raise RuntimeError("The new script must differ from the current script")
    bot_id = guard_bot()
    protected_before = protected_snapshot()
    state_admins = admin_ids(read_json(DATA_HOST / "telegram-panel-bot-state.json"))
    heartbeat_admins = admin_ids(read_json(DATA_HOST / "telegram-panel-bot-heartbeat.json"))
    stat = SCRIPT_HOST.stat()
    inode = (stat.st_dev, stat.st_ino)
    validate_syntax(new_script)
    if new_script.read_bytes() != new_contents:
        raise RuntimeError("The new script changed during syntax validation")
    assert_protected_unchanged(protected_before)
    current_stat = SCRIPT_HOST.stat()
    if guard_bot() != bot_id or SCRIPT_HOST.read_bytes() != original or (current_stat.st_dev, current_stat.st_ino) != inode:
        raise RuntimeError("Telegram bot baseline changed during validation")
    if dry_run:
        print("Dry run passed; script, state and bot process were not changed")
        return

    # Backups are private and outside all three mounted trees.
    backup_root = BACKUP_ROOT.resolve()
    if any(backup_root == host.resolve() or host.resolve() in backup_root.parents for host in (SCRIPT_HOST.parent, DATA_HOST, LOG_HOST)):
        raise RuntimeError("Backup directory must be outside the bot's mounted trees")
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(BACKUP_ROOT, 0o700)
    backup = BACKUP_ROOT / f"telegram-panel-bot-{time.time_ns()}.mjs"
    with backup.open("xb") as file:
        os.chmod(backup, 0o600)
        file.write(original)
        file.flush()
        os.fsync(file.fileno())
    try:
        write_existing_inode(new_contents, inode)
        run("docker", "restart", "--time", "20", BOT)
        # Require a tick after Docker confirms the new process is running.
        restarted_after = datetime.now(timezone.utc)
        if not wait_healthy(restarted_after, bot_id, state_admins, heartbeat_admins):
            raise RuntimeError("Updated Telegram bot did not produce healthy fresh polling and sync state")
        if guard_bot() != bot_id or hashlib.sha256(SCRIPT_HOST.read_bytes()).hexdigest() != expected_new_sha:
            raise RuntimeError("Telegram bot baseline changed after restart")
        assert_protected_unchanged(protected_before)
        print("Telegram bot deployment healthy; same container and admin state preserved")
        print(f"Rollback script backup: {backup}")
    except Exception as error:
        try:
            write_existing_inode(backup.read_bytes(), inode)
            run("docker", "restart", "--time", "20", BOT)
            restarted_after = datetime.now(timezone.utc)
            if not wait_healthy(restarted_after, bot_id, state_admins, heartbeat_admins):
                raise RuntimeError("Original Telegram bot did not recover healthy polling and sync state")
            if guard_bot() != bot_id or hashlib.sha256(SCRIPT_HOST.read_bytes()).hexdigest() != expected_current_sha:
                raise RuntimeError("Original Telegram bot baseline was not restored")
            assert_protected_unchanged(protected_before)
        except Exception as rollback_error:
            raise RuntimeError(f"Telegram bot deployment failed; rollback also failed: {rollback_error}") from error
        raise RuntimeError(f"Telegram bot deployment failed; rollback is healthy: {error}") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("new_script", type=Path, help="Host path to the new bot script")
    parser.add_argument("expected_current_sha", help="SHA-256 of the currently mounted script")
    parser.add_argument("expected_new_sha", help="SHA-256 of the new script")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    deploy(args.new_script, args.expected_current_sha, args.expected_new_sha, args.dry_run)


if __name__ == "__main__":
    main()
