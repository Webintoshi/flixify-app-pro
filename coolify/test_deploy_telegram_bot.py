import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("deploy_telegram_bot", Path(__file__).with_name("deploy-telegram-bot.py"))
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class BotDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.script = self.root / "app/scripts/telegram-panel-bot.mjs"
        self.script.parent.mkdir(parents=True)
        self.script.write_bytes(b"old-script\n")
        self.data = self.root / "app/data"
        self.data.mkdir()
        self.logs = self.root / "app/logs"
        self.logs.mkdir()
        self.state = self.data / "telegram-panel-bot-state.json"
        self.heartbeat = self.data / "telegram-panel-bot-heartbeat.json"
        self.state.write_text(json.dumps({"adminIds": ["private-admin"], "bootstrapped": True}))
        self.heartbeat.write_text(json.dumps({"adminIds": ["private-admin"], "lastHeartbeatAt": "2000-01-01T00:00:00Z", "lastSyncAt": "2000-01-01T00:00:00Z", "status": "running", "isPolling": True}))
        self.new_script = self.root / "new.mjs"
        self.new_script.write_bytes(b"new-script\n")
        self.old_sha = hashlib.sha256(b"old-script\n").hexdigest()
        self.new_sha = hashlib.sha256(b"new-script\n").hexdigest()
        self.backups = self.root / "backups"
        self.mounts = [
            {"Type": "bind", "Source": str(self.script), "Destination": "/app/scripts/telegram-panel-bot.mjs", "RW": True},
            {"Type": "bind", "Source": str(self.data), "Destination": "/app/data", "RW": True},
            {"Type": "bind", "Source": str(self.logs), "Destination": "/app/logs", "RW": True},
        ]
        self.restarts = 0
        self.syntax_ok = True
        self.health_results = [True]
        self.protected_changed = False
        self.commands = []
        for name, value in {"SCRIPT_HOST": self.script, "DATA_HOST": self.data, "LOG_HOST": self.logs, "BACKUP_ROOT": self.backups}.items():
            patcher = patch.object(deploy, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        run_patch = patch.object(deploy, "run", side_effect=self.docker)
        run_patch.start()
        self.addCleanup(run_patch.stop)

    def docker(self, *command):
        self.commands.append(command)
        if command[:2] == ("docker", "inspect"):
            field = command[2].removeprefix("--format=")
            name = command[3]
            if name != deploy.BOT:
                return f"{name}-id {'changed' if self.protected_changed and self.restarts else 'unchanged'}"
            values = {"{{.Name}}": "/flixify-telegram-bot", "{{.Id}}": "same-bot-id", "{{.State.Running}}": "true", "{{json .Mounts}}": json.dumps(self.mounts), "{{json .Config.Cmd}}": '["node","scripts/telegram-panel-bot.mjs"]', "{{.Config.WorkingDir}}": "/app", "{{.HostConfig.RestartPolicy.Name}}": "unless-stopped", "{{.HostConfig.NetworkMode}}": "bridge"}
            return values[field]
        if command[:2] == ("docker", "restart"):
            self.restarts += 1
            good = self.health_results[min(self.restarts - 1, len(self.health_results) - 1)]
            now = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
            self.heartbeat.write_text(json.dumps({"adminIds": ["private-admin"], "lastHeartbeatAt": now, "lastSyncAt": now, "status": "running" if good else "poll-failed", "isPolling": good}))
            return deploy.BOT
        if command[:3] == ("docker", "exec", deploy.BOT) and command[3:5] == ("node", "--check"):
            if not self.syntax_ok:
                raise RuntimeError("Syntax validation failed")
            return ""
        if command[:2] == ("docker", "cp") or command[:4] == ("docker", "exec", deploy.BOT, "rm"):
            return ""
        raise AssertionError(f"Unexpected command: {command}")

    def call(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            deploy.deploy(self.new_script, self.old_sha, self.new_sha, **kwargs)
        return output.getvalue()

    def test_deploy_preserves_inode_state_admins_and_bot_container(self):
        inode = self.script.stat().st_ino
        state = self.state.read_bytes()
        output = self.call()
        self.assertEqual(self.script.read_bytes(), b"new-script\n")
        self.assertEqual(self.script.stat().st_ino, inode)
        self.assertEqual(self.state.read_bytes(), state)
        self.assertEqual(self.restarts, 1)
        backups = list(self.backups.glob("*.mjs"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), b"old-script\n")
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
        self.assertNotIn("private-admin", output)

    def test_dry_run_validates_without_restarting_or_writing_live_script(self):
        self.call(dry_run=True)
        self.assertEqual(self.script.read_bytes(), b"old-script\n")
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.backups.exists())
        self.assertTrue(any(c[:2] == ("docker", "cp") for c in self.commands))

    def test_changed_source_sha_is_rejected_before_mutation(self):
        self.script.write_bytes(b"changed\n")
        with self.assertRaisesRegex(RuntimeError, "current.*SHA"):
            self.call()
        self.assertEqual(self.restarts, 0)

    def test_unexpected_mount_is_rejected_before_mutation(self):
        self.mounts[0]["Source"] = "/untrusted/script.mjs"
        with self.assertRaisesRegex(RuntimeError, "mount"):
            self.call()
        self.assertEqual(self.restarts, 0)

    def test_duplicate_mount_cannot_hide_missing_persistent_data_mount(self):
        self.mounts[1] = self.mounts[2].copy()
        with self.assertRaisesRegex(RuntimeError, "mount"):
            self.call()
        self.assertEqual(self.restarts, 0)

    def test_new_script_changed_during_syntax_validation_is_rejected(self):
        docker = self.docker
        def change_after_check(*command):
            result = docker(*command)
            if command[:3] == ("docker", "exec", deploy.BOT) and command[3:5] == ("node", "--check"):
                self.new_script.write_bytes(b"changed-after-check\n")
            return result
        with patch.object(deploy, "run", side_effect=change_after_check):
            with self.assertRaisesRegex(RuntimeError, "new script changed"):
                self.call()
        self.assertEqual(self.script.read_bytes(), b"old-script\n")
        self.assertEqual(self.restarts, 0)

    def test_admin_ids_missing_after_restart_triggers_rollback(self):
        docker = self.docker
        def lose_admin_after_restart(*command):
            result = docker(*command)
            if command[:2] == ("docker", "restart") and self.restarts == 1:
                heartbeat = json.loads(self.heartbeat.read_text())
                heartbeat["adminIds"] = []
                self.heartbeat.write_text(json.dumps(heartbeat))
            return result
        with patch.object(deploy, "run", side_effect=lose_admin_after_restart), patch.object(deploy, "HEALTH_TIMEOUT_SECONDS", 0):
            with self.assertRaisesRegex(RuntimeError, "rollback.*healthy"):
                self.call()
        self.assertEqual(self.script.read_bytes(), b"old-script\n")
        self.assertEqual(self.restarts, 2)

    def test_invalid_new_sha_is_rejected_before_mutation(self):
        self.new_script.write_bytes(b"unexpected\n")
        with self.assertRaisesRegex(RuntimeError, "new.*SHA"):
            self.call()
        self.assertEqual(self.restarts, 0)

    def test_syntax_failure_does_not_modify_or_restart_live_bot(self):
        self.syntax_ok = False
        with self.assertRaisesRegex(RuntimeError, "Syntax"):
            self.call()
        self.assertEqual(self.script.read_bytes(), b"old-script\n")
        self.assertEqual(self.restarts, 0)

    def test_failed_health_restores_contents_and_restarts_original_bot(self):
        self.health_results = [False, True]
        with patch.object(deploy, "HEALTH_TIMEOUT_SECONDS", 0):
            with self.assertRaisesRegex(RuntimeError, "rollback.*healthy"):
                self.call()
        self.assertEqual(self.script.read_bytes(), b"old-script\n")
        self.assertEqual(self.restarts, 2)

    def test_failed_rollback_is_reported_as_failure(self):
        self.health_results = [False, False]
        with patch.object(deploy, "HEALTH_TIMEOUT_SECONDS", 0):
            with self.assertRaisesRegex(RuntimeError, "rollback.*failed"):
                self.call()
        self.assertEqual(self.script.read_bytes(), b"old-script\n")

    def test_protected_service_change_rejects_deployment(self):
        self.protected_changed = True
        with self.assertRaisesRegex(RuntimeError, "Protected service"):
            self.call()
        self.assertEqual(self.script.read_bytes(), b"old-script\n")

    def test_stale_heartbeat_cannot_pass_health(self):
        before = datetime.now(timezone.utc)
        self.assertFalse(deploy.healthy(before, "same-bot-id", {"private-admin"}, {"private-admin"}))


if __name__ == "__main__":
    unittest.main()
