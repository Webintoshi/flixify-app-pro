import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent
sys.path.insert(0,str(HERE))
import build


def git(repo,*args):
    return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL).decode().strip()


class ActualGitScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.repo=Path(self.temp.name)
        git(self.repo,'init','-q');git(self.repo,'config','user.email','fixture@example.test');git(self.repo,'config','user.name','Fixture')
        for path in set(build.p.WEB_PATHS)-set(build.p.WEB_NEW):self.write(path,'baseline')
        for path in ('apps/api/src/server.ts','apps/worker/src/index.ts','packages/shared/keep','apps/tv-android/keep','apps/macos-native/keep','apps/windows-native/keep'):self.write(path,'baseline')
        self.write(build.p.UPDATE,'old manifest');self.base=self.commit()
        for path in ('apps/tv-android/keep','apps/macos-native/keep','apps/windows-native/keep'):self.write(path,'accepted-native')
        self.native=self.commit()
        self.accepted={'native':{name:{'revision':self.native,'tree':git(self.repo,'rev-parse',self.native+':'+tree)} for name,tree in [('android','apps/tv-android'),('macos','apps/macos-native'),('windows','apps/windows-native')]}}
        for path in build.p.WEB_PATHS:self.write(path,'analytics')
        for path in build.p.ARTIFACT_PATHS.values():self.write(path,'accepted-public')
        self.write(build.p.UPDATE,'new manifest');self.write('apps/ops-web/app/platform/analytics.test.ts','test only')
        self.accepted['revision']=self.commit()

    def tearDown(self):self.temp.cleanup()
    def write(self,path,text):
        file=self.repo/path;file.parent.mkdir(parents=True,exist_ok=True);file.write_text(text)
    def commit(self):
        git(self.repo,'add','.');git(self.repo,'commit','-qm','fixture');return git(self.repo,'rev-parse','HEAD')
    def validate(self):
        with patch.object(build.p,'BASE',self.base):build.validate_scope(self.repo,self.accepted)

    def test_actual_git_exact_publication_and_native_freezes(self):self.validate()
    def test_actual_git_rejects_unrelated_canonical_server_change(self):
        self.write('apps/api/src/server.ts','unexpected');self.accepted['revision']=self.commit()
        with self.assertRaisesRegex(build.p.GateError,'protected_canonical'):self.validate()
    def test_actual_git_rejects_native_change_after_accepted_freeze(self):
        self.write('apps/tv-android/keep','after signing');self.accepted['revision']=self.commit()
        with self.assertRaisesRegex(build.p.GateError,'native_freeze'):self.validate()
    def test_actual_git_rejects_unreviewed_runtime_leaf(self):
        self.write('apps/ops-web/lib/api.ts','unexpected');self.accepted['revision']=self.commit()
        with self.assertRaisesRegex(build.p.GateError,'exact_web_runtime'):self.validate()

    def test_current_server_hash_and_unique_two_anchors_only(self):
        original=b'prefix\n'+b'\n'.join(row['old'].encode() for row in build.p.SERVER_REPLACEMENTS)+b'\nsuffix'
        description={'path':'apps/api/src/server.ts','sourceSha256':build.p.digest(original),'replacements':list(build.p.SERVER_REPLACEMENTS)}
        old=build.backend.SERVER_PATCH_COUNT;build.backend.SERVER_PATCH_COUNT=2
        try:
            changed=build.backend.patch_server(original,description)
            self.assertEqual(changed,b'prefix\n'+b'\n'.join(row['new'].encode() for row in build.p.SERVER_REPLACEMENTS)+b'\nsuffix')
            with self.assertRaises(build.backend.GateError):build.backend.patch_server(original+b'changed',description)
            duplicate=original+build.p.SERVER_REPLACEMENTS[0]['old'].encode()
            with self.assertRaises(build.backend.GateError):build.backend.patch_server(duplicate,description|{'sourceSha256':build.p.digest(duplicate)})
        finally:build.backend.SERVER_PATCH_COUNT=old

    def test_historical_helpers_are_frozen_before_import(self):
        root=HERE.parents[2];build.p.require_helper_pins(root)
        with tempfile.TemporaryDirectory() as directory:
            fake=Path(directory)
            for path in json.loads((HERE/'helper-pins.json').read_bytes()):
                target=fake/path;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(root/path,target)
            build.p.require_helper_pins(fake)
            (fake/'coolify/releases/2026-10-26-edge-recovery/release-worker.py').write_text('changed')
            with self.assertRaisesRegex(build.p.GateError,'helper_source_drift'):build.p.require_helper_pins(fake)


if __name__=='__main__':unittest.main()
