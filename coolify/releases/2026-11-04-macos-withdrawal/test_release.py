import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.build = load('mac_withdrawal_test_build', 'build-web.py')
        self.c = self.build.c
        self.expected = [('M', path) for path in self.c.RUNTIME] + [('D', path) for path in self.c.REMOVED]

    def source_command(self, changes):
        def command(*args, **kwargs):
            if 'rev-parse' in args:
                return (args[-1].removesuffix('^{commit}') + '\n').encode()
            if 'diff' in args:
                return ('\n'.join(status + '\t' + path for status, path in changes) + '\n').encode()
            raise AssertionError('Unexpected source/image read')
        return command

    def test_scope_refuses_extra_files_and_wrong_deletion_status_before_image_reads(self):
        revision = 'b' * 40
        cases = [self.expected + [('M', 'apps/ops-web/app/platform/session.tsx')],
                 self.expected + [('D', 'apps/ops-web/public/downloads/unrelated.apk')],
                 self.expected + [('A', 'apps/ops-web/public/downloads/not-a-real.test.ts')],
                 self.expected[:-1], self.expected[:-1] + [('M', self.c.REMOVED[-1])]]
        for changes in cases:
            with self.subTest(changes=changes), patch.object(self.build, 'command', self.source_command(changes)), \
                    self.assertRaisesRegex(self.c.GateError, 'web_delta_outside'):
                self.build.sources(Path('/unused-fixture'), revision, b'[]')

    def public(self):
        old = [['dir', 'downloads', 0o755], ['file', 'downloads/unrelated.apk', 0o644, 4096, 'b' * 64]]
        removed = [['file', path.removeprefix('apps/ops-web/public/'), 0o644, 2048, 'a' * 64]
                   for path in self.c.REMOVED_PUBLIC]
        return old, removed

    def test_public_tree_removes_exactly_three_macs_preserving_all_other_bytes(self):
        old, removed = self.public()
        self.assertEqual(self.c.expected_public(json.dumps(old + removed).encode()), sorted(old, key=lambda row: row[1]))
        for invalid in (old + removed[:-1], old + [row if i else ['symlink', row[1], '/target'] for i, row in enumerate(removed)]):
            with self.assertRaises(self.c.GateError):
                self.c.expected_public(json.dumps(invalid).encode())

    def test_removal_scope_is_hardcoded_and_checks_every_file_type(self):
        script = self.c.removal_script()
        self.assertEqual(script.count('fs.unlinkSync(p)'), 1)
        self.assertIn('fs.lstatSync(p).isFile()', script)
        self.assertNotIn('rmSync', script)
        for path in self.c.REMOVED:
            self.assertIn('/app/' + path, script)
        self.assertNotIn('unrelated.apk', script)

    def source_fixture(self):
        revision = 'b' * 40
        original = {path: b'before\n' for path in self.c.RUNTIME}
        original |= {path: ('exact original ' + path).encode() for path in self.c.REMOVED}
        rows = [['file', path.removeprefix('apps/ops-web/public/'), 0o644,
                 len(original[path]), self.c.sha(original[path])] for path in self.c.REMOVED_PUBLIC]
        def blob(repo, ref, path):
            return b'after\n' if ref == revision and path in self.c.RUNTIME else original[path]
        return revision, original, rows, blob

    def test_sources_merge_only_four_ui_files_and_accept_only_exact_original_deletions(self):
        revision, original, rows, blob = self.source_fixture()
        with patch.object(self.build, 'command', self.source_command(self.expected)), \
                patch.object(self.build, 'deleted_public_identity', side_effect=lambda repo, path: (len(original[path]), self.c.sha(original[path]))), \
                patch.object(self.c.builder, 'require_regular_blob'), \
                patch.object(self.c.builder, 'git_entry', return_value=b''), \
                patch.object(self.c.builder, 'image_file', side_effect=lambda image, path: original[path]), \
                patch.object(self.c.qr.merge, 'blob', side_effect=blob):
            updates = self.build.sources(Path('/unused-fixture'), revision, json.dumps(rows).encode())
        self.assertEqual(updates, {path: b'after\n' for path in self.c.RUNTIME})

    def test_sources_refuse_deleted_public_drift_descriptor_drift_and_paths_still_present(self):
        revision, original, rows, blob = self.source_fixture()
        cases = [('public', 'withdrawn_public_baseline_drift'),
                 ('descriptor', 'withdrawn_source_baseline_drift'),
                 ('present', 'withdrawn_path_still_in_source')]
        for case, error in cases:
            damaged_rows = copy.deepcopy(rows)
            if case == 'public':
                damaged_rows[0][-1] = 'c' * 64
            def image_file(image, path):
                return b'unreviewed descriptor' if case == 'descriptor' and path in self.c.REMOVED_SOURCE else original[path]
            with self.subTest(case=case), patch.object(self.build, 'command', self.source_command(self.expected)), \
                    patch.object(self.build, 'deleted_public_identity', side_effect=lambda repo, path: (len(original[path]), self.c.sha(original[path]))), \
                    patch.object(self.c.builder, 'require_regular_blob'), \
                    patch.object(self.c.builder, 'git_entry', return_value=b'present' if case == 'present' else b''), \
                    patch.object(self.c.builder, 'image_file', side_effect=image_file), \
                    patch.object(self.c.qr.merge, 'blob', side_effect=blob), \
                    self.assertRaisesRegex(self.c.GateError, error):
                self.build.sources(Path('/unused-fixture'), revision, json.dumps(damaged_rows).encode())

    def test_deleted_binary_larger_than_source_limit_uses_real_bounded_git_reader(self):
        path = self.c.REMOVED_PUBLIC[0]
        data = b'dmg-fixture-' * (4 * 1024**2 // 12 + 1)
        self.assertGreater(len(data), 4 * 1024**2)
        with tempfile.TemporaryDirectory(prefix='mac-withdrawal-binary-test-') as directory:
            repo = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.PIPE)
            git('init', '-q')
            file = repo / path
            file.parent.mkdir(parents=True)
            file.write_bytes(data)
            git('add', '--', path)
            git('-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid',
                '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Binary baseline fixture')
            revision = git('rev-parse', 'HEAD').decode().strip()
            with self.assertRaisesRegex(self.c.qr.merge.GateError, 'source_blob_too_large'):
                self.c.qr.merge.blob(repo, revision, path)
            with patch.object(self.c, 'BASE', revision):
                self.assertEqual(self.build.deleted_public_identity(repo, path), (len(data), self.c.sha(data)))

    def test_deleted_binary_size_bound_is_enforced_before_read_and_length_must_match(self):
        path = self.c.REMOVED_PUBLIC[0]
        for size in ('0', '-1', 'invalid', str(self.build.MAX_REMOVED_PUBLIC_BYTES + 1)):
            with self.subTest(size=size), patch.object(self.c.builder, 'require_regular_blob'), \
                    patch.object(self.build, 'command', return_value=size.encode()) as command, \
                    self.assertRaisesRegex(self.c.GateError, 'size_outside_bound'):
                self.build.deleted_public_identity(Path('/unused-fixture'), path)
            self.assertEqual(command.call_count, 1)
        with patch.object(self.c.builder, 'require_regular_blob'), \
                patch.object(self.build, 'command', side_effect=[b'1024', b'short']), \
                self.assertRaisesRegex(self.c.GateError, 'length_differs'):
            self.build.deleted_public_identity(Path('/unused-fixture'), path)

    def test_final_image_negative_verification_checks_all_paths_and_only_accepts_enoent(self):
        with patch.object(self.c, 'command') as command:
            self.c.verify_removed('sha256:' + 'c' * 64)
        args = command.call_args.args
        self.assertEqual(args[:5], ('docker', 'run', '--rm', '--network', 'none'))
        script = args[-1]
        for path in self.c.REMOVED:
            self.assertIn('/app/' + path, script)
        self.assertIn('e.code==="ENOENT"', script)
        self.assertIn('throw Error("withdrawn_mac_file_still_present")', script)

    def test_runtime_config_is_exact_except_public_env_labels_and_commit_bookkeeping(self):
        revision = 'b' * 40
        config = {'Cmd': ['node', 'server.js'], 'Entrypoint': None, 'Hostname': 'old-compiler', 'Image': 'old-base',
                  'Env': ['PUBLIC=old', 'PRIVATE=preserved'], 'Labels': {'existing': 'kept'},
                  'Healthcheck': {'Test': ['CMD', 'true']}, 'FutureRuntimeKey': {'must': 'remain'}}
        candidate = copy.deepcopy(config)
        candidate.update(Hostname='new-compiler', Image=self.c.SOURCE_ID,
                         Env=['PUBLIC=current', 'PRIVATE=preserved'],
                         Labels={'existing': 'kept', 'org.opencontainers.image.revision': revision,
                                 'vip.flixify.edge-recovery.base': self.c.SOURCE_ID})
        self.build.verify_full_runtime_config({'Config': config}, {'Config': candidate}, revision, {'PUBLIC': 'current'})
        for key, value in (('Cmd', ['other']), ('FutureRuntimeKey', {}), ('Healthcheck', None), ('Env', ['PUBLIC=current'])):
            with self.subTest(key=key), self.assertRaises(self.c.GateError):
                self.build.verify_full_runtime_config({'Config': config}, {'Config': candidate | {key: value}}, revision, {'PUBLIC': 'current'})

    def test_compiler_is_bounded_offline_and_preserves_command_and_always_cleans_up(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return b'0' if args[:2] == ('docker', 'inspect') else b''
        base = {'Config': {'Cmd': ['node', 'server.js']}}
        with patch.object(self.build, 'command', command):
            self.build.compile_candidate('b' * 40, base, {}, {'PUBLIC': 'value'})
        create = calls[0]
        for flag, value in (('--network', 'none'), ('--cpus', '1'), ('--memory', '1280m'), ('--memory-swap', '1536m'), ('--pids-limit', '256')):
            self.assertEqual(create[create.index(flag) + 1], value)
        commit = next(row for row in calls if row[:2] == ('docker', 'commit'))
        self.assertIn('CMD ["node", "server.js"]', commit)
        self.assertLess(create[-1].index('fs.unlinkSync(p)'), create[-1].index('cp.execFileSync("npm"'))
        self.assertEqual(calls[-1][:3], ('docker', 'rm', '--force'))
        calls = []
        def failing(*args, **kwargs):
            calls.append(args)
            if args[:2] == ('docker', 'start'):
                raise self.c.GateError('build_failed')
            return b''
        with patch.object(self.build, 'command', failing), self.assertRaises(self.c.GateError):
            self.build.compile_candidate('b' * 40, base, {}, {})
        self.assertEqual(calls[-1][:3], ('docker', 'rm', '--force'))

    @unittest.skipUnless(shutil.which('node'), 'Node is unavailable for compiler syntax validation')
    def test_actual_combined_compiler_script_has_valid_javascript_syntax(self):
        script = '(()=>{' + self.c.removal_script() + '})();' + self.c.builder.build_script()
        subprocess.run(['node', '--check'], input=script.encode(), check=True, capture_output=True)

    def release(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            return load('mac_withdrawal_test_release', 'release.py')

    def test_release_scope_keeps_api_worker_database_pinned(self):
        release = self.release()
        release.configure('b' * 40, 'sha256:' + 'c' * 64)
        self.assertEqual(release.guard.CHANGED, ('ops-web',))
        self.assertEqual(release.guard.PROTECTED, ('db', 'api', 'worker'))
        self.assertEqual(release.guard.PROTECTED_IMAGES, {'api': self.c.API, 'worker': self.c.WORKER})
        self.assertEqual(release.guard.PROTECTED_DB_IMAGE_ID, self.c.DB)
        self.assertEqual(release.guard.SOURCE_IDS, {'ops-web': self.c.SOURCE_ID})

    def test_cutover_boundaries_locking_and_low_disk_rollback(self):
        release = self.release()
        argv = ['release.py', '--revision', 'b' * 40, '--candidate-id', 'sha256:' + 'c' * 64]
        for action in ('--apply', '--recreate', '--rollback'):
            for free in (1, self.c.MIN_CUTOVER_BYTES - 1, self.c.MIN_CUTOVER_BYTES):
                events = []
                @contextlib.contextmanager
                def locked():
                    events.append('lock')
                    yield
                    events.append('unlock')
                with self.subTest(action=action, free=free), patch.object(sys, 'argv', argv + [action]), \
                        patch.object(release.shutil, 'disk_usage', return_value=SimpleNamespace(free=free)), \
                        patch.object(release.reviewed, 'release_lock', locked), \
                        patch.object(release, 'invoke', side_effect=lambda value: events.append(value)):
                    if action != '--rollback' and free < self.c.MIN_CUTOVER_BYTES:
                        with self.assertRaisesRegex(release.c.GateError, 'cutover_requires_4GiB'):
                            release.main()
                        self.assertEqual(events, [])
                    else:
                        release.main()
                        self.assertEqual(events, ['lock', action[2:], 'unlock'])

    def test_failed_recreation_runs_only_verified_web_rollback_and_keeps_failure_visible(self):
        release = self.release()
        release.configure('b' * 40, 'sha256:' + 'c' * 64)
        events = []
        with patch.object(release.c, 'verify_removed') as removed, \
             patch.object(release.c, 'protected_host', return_value={}), \
             patch.object(release.guard, 'preflight', return_value=({}, b'compose', b'env', {}, {}, {})), \
             patch.object(release.guard, 'recreate', side_effect=RuntimeError('failure')), \
             patch.object(release.guard, 'verify_recovery_context', side_effect=lambda *args: events.append('verify')), \
             patch.object(release.guard, 'rollback', side_effect=lambda: events.append('rollback')):
            with self.assertRaisesRegex(release.c.GateError, 'web_cutover_failed_source_restored'):
                release.invoke('recreate')
        self.assertEqual(events, ['verify', 'rollback'])
        removed.assert_called_once_with('sha256:' + 'c' * 64)

    def test_rollback_does_not_require_withdrawal_in_old_rollback_image(self):
        release = self.release()
        with patch.object(release.c, 'verify_removed') as removed, \
                patch.object(release.c, 'protected_host', return_value={}), \
                patch.object(release.guard, 'rollback') as rollback:
            release.invoke('rollback')
        removed.assert_not_called()
        rollback.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
