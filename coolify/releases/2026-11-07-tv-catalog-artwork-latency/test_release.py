import contextlib
import copy
import importlib.util
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
        self.build = load('tv1414_test_build', 'build-web.py')
        self.c = self.build.c
        self.c.configure_builder()
        self.native = {'schemaVersion': 1, 'nativeRevision': 'b' * 40, 'nativeTree': 'c' * 40,
            'packageName': 'vip.flixify.tv', 'versionName': '1.4.14', 'versionCode': 22,
            'minSdk': 23, 'targetSdk': 35, 'apkSha256': 'd' * 64, 'apkBytes': 2 * 1024**2,
            'signerSha256': self.c.SIGNER,
            'checks': {key: True for key in ('releaseBuild', 'releaseLint', 'unitTests', 'instrumentationTests')}}

    def manifest(self, **changes):
        value = {'packageName': 'vip.flixify.tv', 'versionName': '1.4.14', 'versionCode': 22, 'minSdk': 23,
            'apkUrl': self.c.APK_URL, 'sha256': self.native['apkSha256'], 'sizeBytes': self.native['apkBytes'],
            'notes': 'Liste ve afiş yükleme düzeltmeleri.'}
        return json.dumps(value | changes).encode()

    def source_pin(self):
        return {'schemaVersion': 1, 'sourceTag': self.c.SOURCE_TAG, 'sourceId': self.c.SOURCE_ID,
            'excluded': [*self.c.OVERLAY, 'apps/ops-web/.next'],
            'measurement': {'sha256': 'e' * 64, 'files': 100}, 'publicSha256': 'f' * 64,
            'nextBytes': 10 * 1024**2,
            'publicBuildEnv': {key: 'retained-public-value' for key in self.c.builder.PUBLIC_WEB_KEYS}}

    def test_native_proof_rejects_stale_signer_false_checks_and_boolean_integer_aliases(self):
        self.assertEqual(self.c.proof(json.dumps(self.native).encode()), self.native)
        cases = [self.native | {'versionName': '1.4.13'}, self.native | {'signerSha256': 'a' * 64},
            self.native | {'versionCode': True}, self.native | {'apkBytes': True},
            self.native | {'nativeRevision': 'HEAD'}, self.native | {'unexpected': 'value'},
            self.native | {'checks': self.native['checks'] | {'releaseLint': False}},
            self.native | {'checks': self.native['checks'] | {'releaseLint': 1}}]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(self.c.GateError):
                self.c.proof(json.dumps(value).encode())

    def test_manifest_requires_exact_apk_url_size_hash_and_unique_json_keys(self):
        self.c.parse_manifest(self.manifest(), self.native)
        cases = [self.manifest(versionCode=21), self.manifest(apkUrl='https://elsewhere.invalid/app.apk'),
                 self.manifest(sizeBytes=True), self.manifest(sha256='a' * 64),
                 self.manifest(notes='bad\x01line'), self.manifest()[:-1] + b',"versionCode":22}']
        for data in cases:
            with self.subTest(data=data), self.assertRaises(self.c.GateError):
                self.c.parse_manifest(data, self.native)

    def test_public_manifest_preserves_every_existing_asset_and_rejects_mac_reintroduction(self):
        manifest = self.manifest()
        old = [['dir', 'downloads', 0o755],
            ['file', 'downloads/flixify-pro-1.4.13.apk', 0o644, 1234, 'a' * 64],
            ['file', 'downloads/windows.exe', 0o644, 5678, 'b' * 64],
            ['file', 'downloads/flixify-tv-update.json', 0o644, 100, 'c' * 64]]
        result = self.c.expected_public(json.dumps(old).encode(), self.native, manifest)
        self.assertTrue(all(row in result for row in old if not row[1].endswith('.json')))
        self.assertIn(['file', 'downloads/flixify-pro-1.4.14.apk', 0o644,
            self.native['apkBytes'], self.native['apkSha256']], result)
        for extra in (['file', 'downloads/flixify-pro-1.4.14.apk', 0o644, 12, 'a' * 64],
                      ['file', self.c.mac.REMOVED_PUBLIC[0].removeprefix('apps/ops-web/public/'), 0o644, 12, 'a' * 64]):
            with self.subTest(extra=extra), self.assertRaises(self.c.GateError):
                self.c.expected_public(json.dumps(old + [extra]).encode(), self.native, manifest)

    def test_source_pin_refuses_historical_source_exclusions_and_environment_drift(self):
        pin = self.source_pin()
        self.assertEqual(self.build.source_pin(json.dumps(pin).encode()), pin)
        for value in (pin | {'sourceId': 'sha256:' + 'a' * 64}, pin | {'excluded': ['apps/ops-web']},
                      pin | {'measurement': {'sha256': 'e' * 64}}, pin | {'publicBuildEnv': {}},
                      pin | {'nextBytes': 65 * 1024**2}):
            with self.subTest(value=value), self.assertRaises(self.c.GateError):
                self.build.source_pin(json.dumps(value).encode())

    def test_exact_three_file_scope_is_checked_before_image_or_binary_reads(self):
        expected = [('M', self.c.DESCRIPTOR), ('A', self.c.APK), ('M', self.c.UPDATE_MANIFEST)]
        for rows in (expected + [('M', 'apps/ops-web/app/platform/session.tsx')],
                     expected + [('D', 'apps/ops-web/public/downloads/old.apk')],
                     expected[:-1], expected[:-1] + [('A', self.c.UPDATE_MANIFEST)]):
            def command(*args, **kwargs):
                if 'rev-parse' in args:
                    suffix = args[-1]
                    return ((suffix.removesuffix('^{commit}') if suffix.endswith('^{commit}') else self.native['nativeTree']) + '\n').encode()
                if 'merge-base' in args:
                    return b''
                if 'diff' in args:
                    return ('\n'.join(status + '\t' + path for status, path in rows)).encode() if '--name-status' in args else b''
                raise AssertionError('Unreviewed image or binary read before scope gate')
            with self.subTest(rows=rows), patch.object(self.build, 'command', command), self.assertRaises(self.c.GateError):
                self.build.sources(Path('/fixture'), 'e' * 40, self.native)

    def test_publication_file_must_be_regular_0644_not_executable_or_symlink(self):
        for mode in ('100755 blob ', '120000 blob '):
            with self.subTest(mode=mode), patch.object(self.c.builder, 'require_regular_blob'), \
                    patch.object(self.c.builder, 'git_entry', return_value=(mode + 'a' * 40 + '\t' + self.c.APK + '\0').encode()), \
                    patch.object(self.build, 'command', side_effect=AssertionError('Must not read invalid file')), self.assertRaises(self.c.GateError):
                self.build.bounded_blob(Path('/fixture'), 'a' * 40, self.c.APK)

    def test_disk_floor_is_measured_bounded_and_keeps_one_gib_reserve(self):
        budget = self.c.disk_budget(10 * 1024**2, 2 * 1024**2)
        self.assertEqual(budget, {'hostReserveBytes': 1024**3, 'workspaceBytes': 256 * 1024**2,
            'requiredFreeBytes': 1280 * 1024**2})
        for next_bytes, overlay in ((0, 2048), (65 * 1024**2, 2048), (True, 2048), (1024, self.c.MAX_APK_BYTES + 128 * 1024 + 1)):
            with self.subTest(next_bytes=next_bytes), self.assertRaises(self.c.GateError):
                self.c.disk_budget(next_bytes, overlay)
        for free in (budget['requiredFreeBytes'] - 1, budget['requiredFreeBytes']):
            with patch.object(self.build.shutil, 'disk_usage', return_value=SimpleNamespace(free=free)):
                if free < budget['requiredFreeBytes']:
                    with self.assertRaises(self.c.GateError):
                        self.build.require_disk(budget, build=True)
                else:
                    self.build.require_disk(budget, build=True)

    def compiler_fixture(self, fail_start=False, rw=1024**2):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ('docker', 'create'):
                return ('a' * 64).encode()
            if args[:2] == ('docker', 'inspect'):
                return str(rw).encode() if '--size' in args else b'0'
            if fail_start and args[:2] == ('docker', 'start'):
                raise self.c.GateError('fixture_compile_failed')
            return b''
        return calls, command

    def test_compiler_keeps_existing_layers_caps_resources_and_never_exports_or_prunes(self):
        calls, command = self.compiler_fixture()
        updates = {path: b'fixture' for path in self.c.OVERLAY}
        budget = self.c.disk_budget(10 * 1024**2, 2 * 1024**2)
        with patch.object(self.build, 'command', command), patch.object(self.build, 'DiskWatch', lambda owned: contextlib.nullcontext()), \
                patch.object(self.build.shutil, 'disk_usage', return_value=SimpleNamespace(free=2 * 1024**3)):
            self.build.compile_candidate('b' * 40, {'Config': {'Cmd': ['node', 'server.js']}}, updates, {}, budget)
        create = calls[0]
        for flag, value in (('--network', 'none'), ('--cpus', '1'), ('--memory', '1280m'), ('--memory-swap', '1536m'), ('--pids-limit', '256')):
            self.assertEqual(create[create.index(flag) + 1], value)
        self.assertEqual(create[-4], self.c.SOURCE_ID)
        commit = next(row for row in calls if row[:2] == ('docker', 'commit'))
        self.assertIn('CMD ["node", "server.js"]', commit)
        self.assertEqual(calls[-1][:3], ('docker', 'rm', '--force'))
        self.assertFalse(any(word in row for row in calls for word in ('export', 'import', 'prune', 'buildx')))
        self.assertEqual(len([row for row in calls if row[:2] == ('docker', 'cp')]), 3)

    def test_failed_compile_and_excessive_writable_layer_remove_only_owned_compiler(self):
        budget = self.c.disk_budget(10 * 1024**2, 2 * 1024**2)
        for fail, rw in ((True, 1024), (False, budget['workspaceBytes'])):
            calls, command = self.compiler_fixture(fail_start=fail, rw=rw)
            with self.subTest(fail=fail), patch.object(self.build, 'command', command), \
                    patch.object(self.build, 'DiskWatch', lambda owned: contextlib.nullcontext()), \
                    patch.object(self.build.shutil, 'disk_usage', return_value=SimpleNamespace(free=2 * 1024**3)), self.assertRaises(self.c.GateError):
                self.build.compile_candidate('b' * 40, {'Config': {'Cmd': ['node', 'server.js']}}, {p: b'x' for p in self.c.OVERLAY}, {}, budget)
            self.assertEqual(calls[-1][:3], ('docker', 'rm', '--force'))
            self.assertTrue(calls[-1][-1].startswith('flixify-tv1414-web-build-'))
            self.assertFalse(any(row[:2] == ('docker', 'commit') for row in calls))

    def test_disk_watch_breach_kills_only_owned_build_and_records_failure(self):
        watch = self.build.DiskWatch('a' * 64)
        watch.stop = SimpleNamespace(wait=lambda timeout: False)
        with patch.object(self.build.shutil, 'disk_usage', return_value=SimpleNamespace(free=1024**3 - 1)), \
                patch.object(self.build, 'command') as command:
            watch.watch()
        command.assert_called_once_with('docker', 'kill', 'a' * 64, timeout=10)
        self.assertEqual(watch.failure, 'host_disk_reserve_breached')

    @unittest.skipUnless(shutil.which('node'), 'Node is unavailable')
    def test_real_download_and_compiler_scripts_have_valid_javascript_syntax(self):
        calls, command = self.compiler_fixture()
        budget = self.c.disk_budget(10 * 1024**2, 2 * 1024**2)
        with patch.object(self.build, 'command', command), patch.object(self.build, 'DiskWatch', lambda owned: contextlib.nullcontext()), \
                patch.object(self.build.shutil, 'disk_usage', return_value=SimpleNamespace(free=2 * 1024**3)):
            self.build.compile_candidate('b' * 40, {'Config': {'Cmd': ['node', 'server.js']}}, {p: b'x' for p in self.c.OVERLAY}, {}, budget)
        for script in (calls[0][-1], self.build.download_script(self.native, self.manifest())):
            subprocess.run(['node', '--check'], input=script.encode(), check=True, capture_output=True)

    def release(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            return load('tv1414_test_release', 'release.py')

    def test_cutover_is_web_only_and_compose_only_adapter_preserves_original_transaction(self):
        release = self.release()
        release.configure('b' * 40, 'sha256:' + 'c' * 64, self.native, self.manifest())
        self.assertEqual(release.guard.CHANGED, ('ops-web',))
        self.assertEqual(release.guard.PROTECTED, ('db', 'api', 'worker'))
        self.assertEqual(release.guard.PROTECTED_IMAGES, {'api': self.c.API, 'worker': self.c.WORKER})
        self.assertEqual(release.guard.PROTECTED_DB_IMAGE_ID, self.c.DB)
        self.assertEqual(release.guard.SOURCE_IDS, {'ops-web': self.c.SOURCE_ID})
        before, after = release.previous.ORIGINAL_PHP_APPLY.split('$service->saveComposeConfigs();')
        replacement = "instant_remote_write_file($service->server, $service->workdir().'/docker-compose.yml', $service->docker_compose);"
        self.assertEqual(release.guard.PHP_APPLY, before + replacement + after)
        self.assertIn('DB::transaction(function () use ($p, &$phase)', before)
        self.assertIn("$phase = 'transaction_commit';", after)
        self.assertNotIn('.env', replacement)

    def test_recreation_failure_verifies_recovery_context_before_source_rollback(self):
        release = self.release()
        release.configure('b' * 40, 'sha256:' + 'c' * 64, self.native, self.manifest())
        events = []
        with patch.object(release.c, 'protected_host', return_value={}), \
                patch.object(release.guard, 'preflight', return_value=({}, b'compose', b'env', {}, {}, {})), \
                patch.object(release.guard, 'recreate', side_effect=RuntimeError('fixture_failure')), \
                patch.object(release.guard, 'verify_recovery_context', side_effect=lambda *args: events.append('verify')), \
                patch.object(release.guard, 'rollback', side_effect=lambda: events.append('rollback')), \
                self.assertRaisesRegex(release.c.GateError, 'web_cutover_failed_source_restored'):
            release.invoke('recreate')
        self.assertEqual(events, ['verify', 'rollback'])

    def test_low_disk_rollback_never_needs_new_candidate_or_disk_gate(self):
        release = self.release()
        with tempfile.TemporaryDirectory(prefix='tv1414-release-test-') as directory:
            root = Path(directory)
            native, pin = root / 'native.json', root / 'source.json'
            native.write_text(json.dumps(self.native))
            pin.write_text(json.dumps(self.source_pin()))
            argv = ['release.py', str(root), '--revision', 'e' * 40, '--candidate-id', 'sha256:' + 'f' * 64,
                    '--native-proof', str(native), '--source-pin', str(pin), '--rollback']
            events = []
            @contextlib.contextmanager
            def locked():
                events.append('lock')
                yield
                events.append('unlock')
            with patch.object(sys, 'argv', argv), patch.object(release.reviewed, 'release_lock', locked), \
                    patch.object(release, 'verify_candidate', side_effect=AssertionError('Rollback cannot depend on candidate')), \
                    patch.object(release.build, 'require_disk', side_effect=AssertionError('Rollback cannot need free disk')), \
                    patch.object(release.build, 'bounded_blob', return_value=self.manifest()), \
                    patch.object(release, 'invoke', side_effect=lambda action: events.append(action)):
                release.main()
            self.assertEqual(events, ['lock', 'rollback', 'unlock'])

    def test_rollback_health_checks_source_pages_without_requiring_new_apk(self):
        release = self.release()
        release.configure('b' * 40, 'sha256:' + 'c' * 64, self.native, self.manifest())
        row = {'tag': self.c.SOURCE_TAG, 'image_id': self.c.SOURCE_ID, 'running': True, 'health': None, 'hash': 'kept'}
        with patch.object(release.guard, 'container_snapshot', return_value={'ops-web': row}), \
                patch.object(release.guard, 'compose_hash', return_value='kept'), patch.object(release.guard, 'command') as command:
            self.assertTrue(release.healthy('ops-web', self.c.SOURCE_TAG, self.c.SOURCE_ID))
        script = command.call_args.args[-1]
        self.assertNotIn('1.4.14', script)
        self.assertIn('/indir', script)


if __name__ == '__main__':
    unittest.main()
