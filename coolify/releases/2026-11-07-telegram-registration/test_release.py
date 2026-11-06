import contextlib
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('telegram_registration_release', Path(__file__).with_name('release.py'))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.script = self.root / 'scripts/bot.mjs'
        self.script.parent.mkdir()
        self.original = b'old-script\n'
        self.updated = b'new-script\n'
        self.script.write_bytes(self.original)
        self.script.chmod(0o640)
        self.data = self.root / 'data'
        self.data.mkdir()
        self.logs = self.root / 'logs'
        self.logs.mkdir()
        self.state = self.data / 'telegram-panel-bot-state.json'
        self.heartbeat = self.data / 'telegram-panel-bot-heartbeat.json'
        self.journal = Path(str(self.state) + '.registrations.json')
        self.state.write_text(json.dumps({'adminIds': ['synthetic-admin'], 'bootstrapped': True, 'knownPendingUserIds': ['old-id']}))
        self.heartbeat.write_text(json.dumps({'adminIds': ['synthetic-admin'], 'status': 'running', 'isPolling': True, 'lastSyncAt': '2000-01-01T00:00:00Z', 'lastHeartbeatAt': '2000-01-01T00:00:00Z'}))
        self.candidate = self.root / 'candidate.mjs'
        self.candidate.write_bytes(self.updated)
        self.probe = self.root / 'probe.mjs'
        self.probe.write_bytes(b'synthetic-probe')
        self.old_sha, self.new_sha = r.sha(self.original), r.sha(self.updated)
        self.probe_sha = r.sha(self.probe.read_bytes())
        self.bot = {'Id': 'bot-id', 'Name': '/' + r.BOT, 'Image': 'sha256:' + 'a' * 64,
                    'Config': {'Cmd': ['node', 'scripts/telegram-panel-bot.mjs'], 'WorkingDir': '/app', 'Env': ['PRIVATE_SETTING=not-for-output']},
                    'HostConfig': {'NetworkMode': 'bridge', 'RestartPolicy': {'Name': 'unless-stopped'}},
                    'Mounts': [{'Type': 'bind', 'Source': str(self.script), 'Destination': '/app/scripts/telegram-panel-bot.mjs', 'RW': True},
                               {'Type': 'bind', 'Source': str(self.data), 'Destination': '/app/data', 'RW': True},
                               {'Type': 'bind', 'Source': str(self.logs), 'Destination': '/app/logs', 'RW': True}],
                    'State': {'Running': True, 'StartedAt': 'old-start'}, 'RestartCount': 0}
        self.other = [{'Id': name + '-id', 'Name': '/' + name, 'Image': 'unchanged', 'Config': {'Env': ['PRIVATE=value']}, 'HostConfig': {}, 'Mounts': [], 'State': {'Running': True, 'StartedAt': 'stable'}, 'RestartCount': 0} for name in sorted(r.CORE)]
        self.other.append({'Id': 'other-project-id', 'Name': '/other-project', 'Image': 'other-image', 'Config': {'Env': []}, 'HostConfig': {}, 'Mounts': [], 'State': {'Running': True, 'StartedAt': 'stable'}, 'RestartCount': 0})
        self.calls = []
        self.restarts = 0
        self.health_outcomes = [True]
        self.stop_candidate = False
        self.protected_change = False
        self.syntax_failure = False
        self.after_probe = None
        self.journal_seed_seen = None
        self.live_node_version = b'v22.23.2\n'
        self.probe_node_version = b'v22.23.2\n'
        self.probe_image_missing = False
        for name, value in {'SCRIPT': self.script, 'DATA': self.data, 'LOGS': self.logs, 'SOURCE_SHA': self.old_sha, 'HEALTH_SECONDS': 0}.items():
            p = patch.object(r, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(r, 'run', side_effect=self.docker)
        p.start()
        self.addCleanup(p.stop)

    def docker(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        if args[:4] == ('docker', 'ps', '--all', '--quiet'):
            return '\n'.join(row['Id'] for row in [self.bot] + self.other).encode()
        if args[:2] == ('docker', 'inspect'):
            if args[2:] == (r.BOT,):
                return json.dumps([self.bot]).encode()
            known = {row['Id']: row for row in [self.bot] + self.other}
            return json.dumps([known[value] for value in args[2:]]).encode()
        if args[:3] == ('docker', 'image', 'inspect'):
            if self.probe_image_missing:
                raise r.GateError('synthetic-image-missing')
            return json.dumps([{'Id': args[3]}]).encode()
        if args[:3] == ('docker', 'exec', r.BOT) and args[3:] == ('node', '--version'):
            return self.live_node_version
        if args[:2] == ('docker', 'run'):
            if args[-1] == '--version':
                return self.probe_node_version
            if '--check' in args:
                if self.syntax_failure:
                    raise r.GateError('synthetic-syntax-failure')
                return b''
            if self.after_probe:
                self.after_probe()
            return json.dumps({'passed': True, 'checks': ['active-assigned-registration', 'durable-discovery', 'acknowledged-delivery', 'restart-no-duplicate', 'failed-delivery-retry']}).encode()
        if args[:3] == ('docker', 'rm', '--force'):
            return b''
        if args[:2] == ('docker', 'restart'):
            self.restarts += 1
            self.journal_seed_seen = self.journal_seed_seen or json.loads(self.journal.read_text())
            good = self.health_outcomes[min(self.restarts - 1, len(self.health_outcomes) - 1)]
            self.bot['State']['Running'] = not (self.stop_candidate and self.restarts == 1)
            self.bot['State']['StartedAt'] = 'new-start-' + str(self.restarts)
            now = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
            self.heartbeat.write_text(json.dumps({'adminIds': ['synthetic-admin'], 'status': 'running' if good else 'poll-failed', 'isPolling': good, 'lastSyncAt': now, 'lastHeartbeatAt': now}))
            if good:
                journal = json.loads(self.journal.read_text())
                journal['checkpointAt'] = now
                self.journal.write_text(json.dumps(journal))
            if self.protected_change and self.restarts == 1:
                self.other[-1]['Config']['Env'] = ['CHANGED=1']
            return r.BOT.encode()
        raise AssertionError('Unexpected Docker operation: ' + repr(args))

    def call(self, apply=False, probe_image=None):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            r.deploy(self.candidate, self.new_sha, self.probe, self.probe_sha, apply, self.old_sha,
                     probe_image_id=probe_image)
        return output.getvalue()

    def test_default_preflight_never_writes_script_or_journal_or_restarts(self):
        output = self.call()
        self.assertIn('preflight_passed', output)
        self.assertEqual(self.script.read_bytes(), self.original)
        self.assertFalse(self.journal.exists())
        self.assertEqual(self.restarts, 0)
        self.assertEqual(set(self.root.iterdir()), {self.script.parent, self.data, self.logs, self.candidate, self.probe})
        self.assertNotIn('PRIVATE', output)

    def test_cli_requires_explicit_apply(self):
        args = r.parse_arguments(['/tmp/candidate.mjs', '--candidate-sha256', '1'*64, '--probe-sha256', '2'*64])
        self.assertFalse(args.apply)

    def test_apply_preserves_same_inode_permissions_state_and_config(self):
        identity = r.file_identity(self.script.stat())
        state = self.state.read_bytes()
        output = self.call(apply=True)
        self.assertIn('release_passed', output)
        self.assertEqual(self.script.read_bytes(), self.updated)
        self.assertEqual(r.file_identity(self.script.stat()), identity)
        self.assertEqual(self.state.read_bytes(), state)
        self.assertEqual(self.restarts, 1)
        self.assertEqual(self.journal_seed_seen['entries'], [])
        self.assertEqual(self.journal.stat().st_mode & 0o777, 0o600)
        self.assertFalse(any('backup' in p.name for p in self.root.rglob('*')))
        self.assertNotIn('synthetic-admin', output)

    def test_existing_journal_is_not_reset_or_deleted(self):
        initial = {'version': 1, 'cutoffAt': '2026-01-01T00:00:00Z', 'checkpointAt': '2026-01-01T00:00:00Z', 'entries': [{'userId': 'queued-user', 'createdAt': '2026-01-01T00:00:00Z', 'adminIds': ['synthetic-admin'], 'acknowledgedAdminIds': []}]}
        self.journal.write_text(json.dumps(initial))
        self.call(apply=True)
        final = json.loads(self.journal.read_text())
        self.assertEqual(final['cutoffAt'], initial['cutoffAt'])
        self.assertEqual(final['entries'], initial['entries'])

    def test_bad_source_hash_fails_before_docker_or_mutation(self):
        self.script.write_bytes(b'drift')
        with self.assertRaisesRegex(r.GateError, 'hash_mismatch'):
            self.call(True)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.restarts, 0)

    def test_bad_candidate_hash_fails_before_docker(self):
        self.candidate.write_bytes(b'drift')
        with self.assertRaisesRegex(r.GateError, 'hash_mismatch'):
            self.call(True)
        self.assertEqual(self.calls, [])

    def test_bad_mount_fails_without_mutation(self):
        self.bot['Mounts'][0]['Source'] = '/unreviewed/script'
        with self.assertRaisesRegex(r.GateError, 'mount_changed'):
            self.call(True)
        self.assertEqual(self.restarts, 0)

    def test_duplicate_mount_cannot_hide_missing_mount(self):
        self.bot['Mounts'][0] = self.bot['Mounts'][1]
        with self.assertRaisesRegex(r.GateError, 'mount_set_changed'):
            self.call(True)

    def test_syntax_failure_keeps_live_bot_and_state_untouched(self):
        self.syntax_failure = True
        with self.assertRaisesRegex(r.GateError, 'syntax'):
            self.call(True)
        self.assertEqual(self.script.read_bytes(), self.original)
        self.assertFalse(self.journal.exists())
        self.assertEqual(self.restarts, 0)
        self.assertTrue(any(args[:3] == ('docker', 'rm', '--force') for args, _ in self.calls))

    def test_probe_runs_network_none_readonly_and_never_execs_live_bot(self):
        self.call()
        sandboxes = [args for args, _ in self.calls if args[:2] == ('docker', 'run')]
        self.assertEqual(len(sandboxes), 2)
        for args in sandboxes:
            self.assertEqual(args[args.index('--network')+1], 'none')
            self.assertIn('--read-only', args)
            self.assertEqual(args[args.index('--cap-drop')+1], 'ALL')
            self.assertTrue(all('readonly' in args[i+1] for i, value in enumerate(args) if value == '--mount'))
        self.assertFalse(any(args[:3] == ('docker', 'exec', r.BOT) for args, _ in self.calls))

    def test_provided_probe_image_is_immutable_version_matched_and_used_only_for_offline_checks(self):
        selected = 'sha256:' + 'b' * 64
        before = copy.deepcopy(self.other)
        self.call(probe_image=selected)
        sandboxes = [args for args, _ in self.calls if args[:2] == ('docker', 'run')]
        self.assertEqual(len(sandboxes), 3)
        self.assertTrue(all(selected in args and '--pull' in args and args[args.index('--pull')+1] == 'never' for args in sandboxes))
        self.assertEqual(self.other, before)
        self.assertEqual(self.bot['Image'], 'sha256:' + 'a' * 64)
        self.assertEqual(self.restarts, 0)
        self.assertEqual(self.script.read_bytes(), self.original)

    def test_missing_probe_image_is_rejected_before_script_mutation(self):
        self.probe_image_missing = True
        with self.assertRaisesRegex(r.GateError, 'image-missing'):
            self.call(True, probe_image='sha256:' + 'b' * 64)
        self.assertEqual(self.restarts, 0)
        self.assertEqual(self.script.read_bytes(), self.original)
        self.assertFalse(self.journal.exists())

    def test_node_version_mismatch_in_probe_image_is_rejected(self):
        self.probe_node_version = b'v22.23.1\n'
        with self.assertRaisesRegex(r.GateError, 'node_version'):
            self.call(True, probe_image='sha256:' + 'b' * 64)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(self.journal.exists())

    def test_probe_image_tag_is_not_an_immutable_id(self):
        with self.assertRaisesRegex(r.GateError, 'immutable_probe_image'):
            self.call(True, probe_image='node:22')
        self.assertEqual(self.restarts, 0)

    def test_candidate_changed_during_probe_prevents_apply(self):
        self.after_probe = lambda: self.candidate.write_bytes(b'changed')
        with self.assertRaisesRegex(r.GateError, 'candidate_changed'):
            self.call(True)
        self.assertEqual(self.restarts, 0)

    def test_admin_change_during_probe_prevents_apply(self):
        self.after_probe = lambda: self.state.write_text(json.dumps({'adminIds': ['new-admin']}))
        with self.assertRaisesRegex(r.GateError, 'baseline_changed'):
            self.call(True)
        self.assertEqual(self.restarts, 0)

    def test_failed_health_restores_original_and_preserves_journal(self):
        self.health_outcomes = [False, True]
        with self.assertRaisesRegex(r.GateError, 'original_bot_restored'):
            self.call(True)
        self.assertEqual(self.script.read_bytes(), self.original)
        self.assertEqual(self.restarts, 2)
        self.assertTrue(self.journal.exists())

    def test_partial_owned_write_failure_restores_exact_original(self):
        write = r.os.write
        writes = 0
        def partial_then_fail(descriptor, contents):
            nonlocal writes
            writes += 1
            if writes == 1:
                return write(descriptor, contents[:1])
            if writes == 2:
                raise OSError('synthetic-partial-write-failure')
            return write(descriptor, contents)
        identity = r.file_identity(self.script.stat())
        with patch.object(r.os, 'write', side_effect=partial_then_fail):
            with self.assertRaisesRegex(r.GateError, 'original_bot_restored'):
                self.call(True)
        self.assertEqual(self.script.read_bytes(), self.original)
        self.assertEqual(r.file_identity(self.script.stat()), identity)
        self.assertEqual(self.restarts, 1)
        self.assertTrue(self.journal.exists())

    def test_short_writes_advance_cursor_until_candidate_complete(self):
        write = r.os.write
        with patch.object(r.os, 'write', side_effect=lambda descriptor, contents: write(descriptor, contents[:1])):
            self.call(True)
        self.assertEqual(self.script.read_bytes(), self.updated)
        self.assertEqual(self.restarts, 1)

    def test_foreign_source_drift_after_partial_capture_is_not_overwritten(self):
        write = r.os.write
        write_script = r.write_script
        writes = 0
        def partial_then_fail(descriptor, contents):
            nonlocal writes
            writes += 1
            if writes == 1:
                return write(descriptor, contents[:1])
            raise OSError('synthetic-partial-write-failure')
        def foreign_change_after_capture(*args):
            try:
                return write_script(*args)
            except r.ScriptWriteError as error:
                self.assertEqual(error.observed_partial_sha, r.sha(b'nld-script\n'))
                self.script.write_bytes(b'foreign-edit\n')
                raise
        with patch.object(r.os, 'write', side_effect=partial_then_fail), patch.object(r, 'write_script', side_effect=foreign_change_after_capture):
            with self.assertRaisesRegex(r.GateError, 'rollback_not_verified'):
                self.call(True)
        self.assertEqual(self.script.read_bytes(), b'foreign-edit\n')
        self.assertEqual(self.restarts, 0)

    def test_stopped_candidate_still_allows_config_guarded_rollback(self):
        self.health_outcomes = [False, True]
        self.stop_candidate = True
        with self.assertRaisesRegex(r.GateError, 'original_bot_restored'):
            self.call(True)
        self.assertEqual(self.script.read_bytes(), self.original)
        self.assertEqual(self.restarts, 2)
        self.assertTrue(self.bot['State']['Running'])

    def test_protected_other_project_change_is_reported_and_source_restored(self):
        self.protected_change = True
        with self.assertRaisesRegex(r.GateError, 'rollback_not_verified'):
            self.call(True)
        self.assertEqual(self.script.read_bytes(), self.original)
        self.assertEqual(self.restarts, 2)

    def test_fresh_legacy_heartbeat_without_registration_journal_cannot_pass(self):
        now = datetime.now(timezone.utc)
        self.heartbeat.write_text(json.dumps({'adminIds': ['synthetic-admin'], 'status': 'running', 'isPolling': True, 'lastSyncAt': (now+timedelta(seconds=1)).isoformat(), 'lastHeartbeatAt': (now+timedelta(seconds=1)).isoformat()}))
        self.assertFalse(r.health(now, self.bot, (self.state, self.heartbeat, self.journal), {'synthetic-admin'}, {'synthetic-admin'}, True))

    def test_journal_freshness_and_acknowledgement_subset_are_checked(self):
        now = datetime.now(timezone.utc)
        journal = {'version': 1, 'cutoffAt': (now-timedelta(seconds=20)).isoformat(), 'checkpointAt': (now+timedelta(seconds=1)).isoformat(), 'entries': []}
        self.assertTrue(r.valid_journal(journal, now))
        journal['entries'] = [{'userId': 'user', 'createdAt': now.isoformat(), 'adminIds': ['a'], 'acknowledgedAdminIds': ['b']}]
        self.assertFalse(r.valid_journal(journal, now))

    def test_real_offline_probe_extracts_factory_and_never_bootstraps_whole_bot(self):
        core = Path(__file__).parents[2] / 'patches/telegram-registration-core.mjs'
        candidate = self.root / 'real-core-candidate.mjs'
        candidate.write_text(core.read_text() + '\nthrow new Error("WHOLE_BOT_MUST_NOT_EXECUTE");\n')
        result = subprocess.run(['node', str(Path(__file__).with_name('offline-probe.mjs')), str(candidate)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(json.loads(result.stdout)['passed'])
        self.assertNotIn('synthetic-', result.stdout)


if __name__ == '__main__':
    unittest.main()
