import importlib.util
from pathlib import Path
import unittest
import sys
import contextlib
import io
import json
import tempfile
from types import ModuleType
from types import SimpleNamespace
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class AdapterTests(unittest.TestCase):
    def test_low_disk_rollback_reaches_locked_retained_image_transaction(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            release=load('qr_test_low_disk_release','release.py')
        with tempfile.TemporaryDirectory() as directory:
            receipt=Path(directory)/'receipt.json';digest='e'*64
            receipt.write_text(json.dumps({'migrationSha256':digest,'applied':True,'postgresTestsPassed':True}))
            argv=['release.py','--revision','b'*40,'--api-candidate-id','sha256:'+'c'*64,
                  '--web-candidate-id','sha256:'+'d'*64,'--migration-receipt',str(receipt),
                  '--migration-sha256',digest]
            events=[]
            @contextlib.contextmanager
            def locked():
                events.append('lock')
                try:yield
                finally:events.append('unlock')
            with patch.object(sys,'argv',argv+['--rollback']), \
                 patch.object(release,'protected',side_effect=lambda:events.append('protected') or {}), \
                 patch.object(release.reviewed,'release_lock',locked), \
                 patch.object(release.guard,'rollback',side_effect=lambda:events.append('rollback')) as rollback, \
                 patch.object(release.guard,'command',side_effect=AssertionError('Unexpected build, pull or prune')) as command, \
                 patch.object(release.shutil,'disk_usage',return_value=SimpleNamespace(free=1024**3)), \
                 contextlib.redirect_stdout(io.StringIO()):
                release.main()
                rollback.assert_called_once_with()
                command.assert_not_called()
                self.assertEqual(events,['lock','protected','rollback','protected','unlock'])
                for action in ('--apply','--recreate'):
                    with self.subTest(action=action), patch.object(sys,'argv',argv+[action]):
                        with self.assertRaisesRegex(release.api.GateError,'requires_8GiB_no_pruning'):
                            release.main()
                self.assertEqual(events,['lock','protected','rollback','protected','unlock'])

    def test_api_compile_caps_and_new_package_directory(self):
        api=load('qr_test_api','build-api.py');calls=[]
        api.backend.command=lambda *a,**kw:calls.append((a,kw))
        api.configure('sha256:'+'a'*64,'flixify-api:test',('apps/api/src/server.ts',),())
        api.backend.command('docker','create','--name','flixify-packages-api-build-'+'a'*12,'--network','none')
        self.assertEqual(calls[0][0][2:4],('--cpus','1'))
        api.backend.command('docker','cp','/tmp/input','flixify-packages-api-build-'+'a'*12+':/app/node_modules/qrcode-generator/dist/index.js')
        self.assertEqual(calls[1][0][0:2],('docker','exec'))
        self.assertEqual(calls[1][0][-1],'/app/node_modules/qrcode-generator/dist')
        self.assertIn('node_modules/qrcode-generator',api.backend.snapshot_script('api'))
        with self.assertRaises(api.GateError):api.backend.command('docker','create','--network','host')

    def test_release_scope_and_no_environment_mutation_adapter(self):
        # Configuration is pure; YAML parsing remains an existing host-only guard dependency.
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            release=load('qr_test_release','release.py')
        original_php=release.guard.PHP_APPLY
        revision='b'*40
        release.configure(revision,{'api':'sha256:'+'c'*64,'ops-web':'sha256:'+'d'*64})
        self.assertEqual(release.guard.CHANGED,('api','ops-web'))
        self.assertEqual(release.guard.PROTECTED,('db','worker'))
        self.assertEqual(release.guard.PHP_APPLY,original_php)
        self.assertEqual(release.guard.PROTECTED_IMAGES,{'worker':release.WORKER})
        self.assertEqual(release.guard.PROTECTED_DB_IMAGE_ID,release.DB)
        self.assertEqual(release.guard.TARGET['api'],'flixify-api:qr-device-login-'+revision[:12]+'-20261103')

if __name__=='__main__':unittest.main()
