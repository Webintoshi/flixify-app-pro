import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
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
        self.build = load('mac_zip_test_build', 'build-web.py')
        self.c = self.build.c
        self.pin = {'path': 'apps/ops-web/public/downloads/Flixify-Pro-1.0.2-build4-macos-universal.zip',
                    'sha256': 'a' * 64, 'bytes': 2048}

    def test_pin_rejects_traversal_nonzip_false_sizes_and_unknown_fields(self):
        self.assertEqual(self.c.artifact_pin(self.pin), self.pin)
        for change in ({'path': 'apps/ops-web/public/downloads/../other.zip'}, {'path': 'apps/ops-web/public/downloads/old.dmg'},
                       {'bytes': True}, {'sha256': 'A' * 64}, {'notarized': True}):
            with self.subTest(change=change), self.assertRaises(self.c.GateError):
                self.c.artifact_pin(self.pin | change)

    def descriptor(self):
        return ('export const macDownload={href:"/downloads/' + Path(self.pin['path']).name + '",filename:"'
                + Path(self.pin['path']).name + '",sha256:"' + self.pin['sha256']
                + '",sizeBytes:2048,notarized:true} as const;').encode()

    def test_descriptor_requires_actual_root_pin_and_notarization(self):
        data = self.descriptor()
        self.c.descriptor_matches(data, self.pin)
        for bad in (data.replace(b'notarized:true', b'notarized:false'), data.replace(b'sizeBytes:2048', b'sizeBytes:2049'),
                    data.replace(b'a' * 64, b'b' * 64), data.replace(b'.zip', b'.dmg'), data.replace(b'href:', b'other:')):
            with self.assertRaises(self.c.GateError):
                self.c.descriptor_matches(bad, self.pin)

    def test_scope_refuses_extra_production_file_before_reading_images(self):
        revision = 'b' * 40
        expected = (*self.c.RUNTIME, self.pin['path'])
        def command(*args, **kwargs):
            if 'rev-parse' in args:
                return (args[-1].removesuffix('^{commit}') + '\n').encode()
            if 'diff' in args:
                return ('\n'.join((*expected, 'apps/ops-web/app/platform/session.tsx')) + '\n').encode()
            raise AssertionError('Unexpected source/image read')
        with patch.object(self.build, 'command', command), self.assertRaisesRegex(self.c.GateError, 'web_delta_outside'):
            self.build.sources(Path('/unused-fixture'), revision, self.pin)

    def test_public_tree_preserves_every_old_row_and_adds_only_zip(self):
        original = [['dir', 'downloads', 0o755], ['file', 'downloads/old.dmg', 0o644, 4096, 'b' * 64]]
        result = self.c.expected_public(json.dumps(original).encode(), self.pin)
        self.assertEqual(result, sorted(original + [['file', self.pin['path'].removeprefix('apps/ops-web/public/'), 0o644, 2048, 'a' * 64]], key=lambda row: row[1]))
        with self.assertRaises(self.c.GateError):
            self.c.expected_public(json.dumps(result).encode(), self.pin)

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

    def release(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            return load('mac_zip_test_release', 'release.py')

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
        events = []
        with patch.object(release.c, 'protected_host', return_value={}), \
             patch.object(release.guard, 'preflight', return_value=({}, b'compose', b'env', {}, {}, {})), \
             patch.object(release.guard, 'recreate', side_effect=RuntimeError('failure')), \
             patch.object(release.guard, 'verify_recovery_context', side_effect=lambda *args: events.append('verify')), \
             patch.object(release.guard, 'rollback', side_effect=lambda: events.append('rollback')):
            with self.assertRaisesRegex(release.c.GateError, 'web_cutover_failed_source_restored'):
                release.invoke('recreate')
        self.assertEqual(events, ['verify', 'rollback'])


if __name__ == '__main__':
    unittest.main()
