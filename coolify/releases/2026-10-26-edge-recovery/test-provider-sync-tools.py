"""Offline exact-manifest and fail-closed provider-sync adapter tests."""
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))

def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
w = load('build-provider-sync-worker.py')
v = load('build-provider-sync-web.py')
r = load('release-provider-sync-worker.py').release
web_release = load('release-provider-sync-web.py').release
REV = 'a' * 40

class ProviderToolsTests(unittest.TestCase):
    def preflight(self, *, baseline_entry=b'', candidate_mode=b'100644 blob ', extra=False, git_fail=False, absent_fail=False, image_source=b'old'):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if 'rev-parse' in args:
                return (w.BASE_REVISION if w.BASE_REVISION in args[-1] else REV).encode()
            if 'diff' in args:
                return '\n'.join((*w.PATHS, *(('apps/worker/src/extra.ts',) if extra else ()))).encode()
            if 'inspect' in args:
                return json.dumps([{'Image':w.SOURCE_ID,'State':{'Running':True},'Config':{'Image':w.SOURCE_TAG,'Labels':{'com.docker.compose.project':w.core.UUID}}}]).encode()
            if 'ls-tree' in args:
                if git_fail:
                    raise w.GateError('git_failed')
                if w.BASE_REVISION in args:
                    return baseline_entry
                return candidate_mode + b'b'*40 + b'\t' + args[-1].encode() + b'\0' if candidate_mode else b''
            if absent_fail:
                raise w.GateError('absence_failed')
            return b''
        with patch.object(w,'command',side_effect=command), patch.object(w.helpers,'command',side_effect=command), patch.object(w.core,'image',return_value={'Id':w.SOURCE_ID}), patch.object(w.core,'git_file',side_effect=lambda repo,rev,path:b'old' if rev==w.BASE_REVISION else b'new'), patch.object(w.helpers,'image_file',return_value=image_source):
            result = w.preflight(Path('/fixture'), REV)
        return result, calls

    def test_exact_manifests_and_pins(self):
        result,calls = self.preflight()
        self.assertEqual(set(result[1]),set(w.PATHS))
        self.assertEqual(len(w.PATHS),4)
        self.assertEqual(len(v.PATHS),7)
        self.assertEqual(len(w.TEST_PATHS),6)
        self.assertEqual(r.SOURCE['worker'],w.SOURCE_TAG)
        self.assertEqual(r.SOURCE_IDS['worker'],w.SOURCE_ID)
        self.assertEqual(r.PROTECTED_IMAGES['ops-web'],(v.SOURCE_TAG,v.SOURCE_ID))
        self.assertEqual(web_release.SOURCE_ID,v.SOURCE_ID)
        self.assertTrue(r.PROTECTED_DB_IMAGE_ID.startswith('sha256:721873'))
        self.assertTrue(r.PROTECTED_IMAGES['api'][1].startswith('sha256:8cdbf9'))
        self.assertEqual(sum('ls-tree' in c and c[-1] in (*w.TEST_PATHS, *w.FIXTURE_PATHS) for c in calls),len(w.TEST_PATHS)+len(w.FIXTURE_PATHS))
        self.assertEqual(sum('--entrypoint' in c and 'sh' in c for c in calls),len(w.NEW_PATHS))

    def test_baseline_present_failure_and_candidate_nonregular_rejected(self):
        with self.assertRaisesRegex(w.GateError,'exists_in_baseline'):
            self.preflight(baseline_entry=b'100644 blob present')
        for mode in (b'',b'120000 blob ',b'040000 tree '):
            with self.subTest(mode=mode),self.assertRaisesRegex(w.GateError,'not_regular_blob'):
                self.preflight(candidate_mode=mode)
        for kwargs in ({'git_fail':True},{'absent_fail':True},{'extra':True},{'image_source':b'drift'}):
            with self.subTest(kwargs=kwargs),self.assertRaises(w.GateError):
                self.preflight(**kwargs)

    def test_baseline_symlink_ancestor_rejected(self):
        original=w.helpers.git_entry
        def entry(repo,rev,path):
            if rev==w.BASE_REVISION and path=='apps/worker/src':
                return b'120000 blob symlink'
            return original(repo,rev,path)
        with patch.object(w.helpers,'git_entry',side_effect=entry),self.assertRaisesRegex(w.GateError,'ancestor_not_tree'):
            self.preflight()

    def test_build_gate_before_compile_and_exact_copies(self):
        dockerfile=w.dockerfile(REV)
        self.assertEqual([line for line in dockerfile.splitlines() if line.startswith('COPY')],[f'COPY {p} /app/{p}' for p in w.PATHS])
        self.assertLess(dockerfile.index('build_cgroup_unavailable'),dockerfile.index('execFileSync'))
        self.assertIn('/sys/fs/cgroup/memory.max',dockerfile)
        self.assertIn('/sys/fs/cgroup/memory/memory.limit_in_bytes',dockerfile)
        self.assertEqual(w.MIN_FREE_BYTES,8*1024**3)

    def test_tests_are_bounded_offline_and_exact(self):
        calls=[]
        with patch.object(w,'command',side_effect=lambda *a,**kw:calls.append(a) or b''),patch.object(w,'require_regular'),patch.object(w.core,'git_file',return_value=b'test'):
            w.test_candidate(Path('/fixture'),REV,'sha256:'+'b'*64)
        call=calls[0]
        self.assertIn('--memory',call)
        self.assertIn('--memory-swap',call)
        self.assertEqual(call[call.index('--network')+1],'none')
        script=call[-1]
        self.assertLess(script.index('build_cgroup_unavailable'),script.index('execFileSync'))
        for path in w.TEST_PATHS:
            self.assertIn(path,script)
            self.assertTrue(any(str(arg).endswith(':/app/'+path+':ro') for arg in call))

    def test_candidate_config_source_and_ancestry_drift_rejected(self):
        base={'Id':w.SOURCE_ID,'RootFS':{'Layers':['base']},'Config':{'Env':['UNCHANGED=value'],'Labels':{}}}
        candidate={'Id':'sha256:'+'b'*64,'RootFS':{'Layers':['base','new']},'Config':{'Env':['UNCHANGED=value'],'Labels':{'org.opencontainers.image.revision':REV,'vip.flixify.edge-recovery.base':w.SOURCE_ID}}}
        import copy
        for kind in ('valid','ancestry','config','source','identity'):
            value=copy.deepcopy(candidate)
            if kind=='ancestry': value['RootFS']['Layers']=['foreign']
            if kind=='config': value['Config']['Env']=[]
            if kind=='identity': value['Config']['Labels']['org.opencontainers.image.revision']='wrong'
            with patch.object(w.core,'image',return_value=value),patch.object(w.helpers,'image_file',return_value=b'drift' if kind=='source' else b'new'),patch.object(w,'command',return_value=b''):
                if kind=='valid':
                    self.assertEqual(w.verify_candidate(base,REV,{w.PATHS[0]:b'new'}),candidate['Id'])
                else:
                    with self.assertRaises(w.GateError):
                        w.verify_candidate(base,REV,{w.PATHS[0]:b'new'})

    def test_exact_committed_migration_fixture_is_mounted(self):
        calls=[]
        with patch.object(w,'command',side_effect=lambda *a,**kw:calls.append(a) or b''),patch.object(w,'require_regular'),patch.object(w.core,'git_file',return_value=b'fixture') as read:
            w.test_candidate(Path('/fixture'),REV,'sha256:'+'b'*64)
        for path in w.FIXTURE_PATHS:
            read.assert_any_call(Path('/fixture'),REV,path)
            self.assertTrue(any(str(arg).endswith(':/app/'+path+':ro') for arg in calls[0]))

    def test_web_requires_explicit_new_worker_pin(self):
        with self.assertRaises(web_release.GateError):
            web_release.configure(REV,'sha256:'+'b'*64,'','')

if __name__=='__main__':
    unittest.main()
