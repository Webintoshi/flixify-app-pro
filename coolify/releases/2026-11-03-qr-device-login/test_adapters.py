import importlib.util
from pathlib import Path
import unittest
import sys
from types import ModuleType
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class AdapterTests(unittest.TestCase):
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
