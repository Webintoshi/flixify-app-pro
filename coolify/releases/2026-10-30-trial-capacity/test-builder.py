"""Offline real-Git, executed filesystem and bounded API-build contracts."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('trial_builder_contract',Path(__file__).with_name('build-api.py'));web=importlib.util.module_from_spec(spec);spec.loader.exec_module(web)

class Fixture:
    def __init__(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='flixify-trial-builder-test-');self.repo=Path(self.tmp.name)
        self.git('init','-q');self.git('config','user.name','Trial guard');self.git('config','user.email','guard@example.invalid')
        self.original=b'// stable intro\nexport const before=1;\n'+b'// stable tail\n'*8
        for path in (*web.PATHS[:-1],*web.TEST_PATHS):self.put(path,self.original)
        self.base=self.commit()
        for path in web.PATHS:self.put(path,self.original.replace(b'before=1',b'before=2'))
        self.revision=self.commit();self.actual=self.original+b'// Existing production hotfix remains.\n';self.hashes={p:hashlib.sha256(self.actual).hexdigest() for p in web.PATHS[:-1]}
    def git(self,*args):return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.PIPE).decode().strip()
    def put(self,path,value):p=self.repo/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(value)
    def commit(self):self.git('add','.');self.git('commit','-qm','owned fixture');return self.git('rev-parse','HEAD')
    def pins(self):return patch.multiple(web,BASE_REVISION=self.base,SOURCE_HASHES=self.hashes)
    def close(self):self.tmp.cleanup()

class SourceTests(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.addCleanup(self.f.close)
    def test_exact_api_tag_and_revision_are_required(self):
        self.assertEqual(web.target('a'*40),'flixify-api:trial-capacity-'+('a'*12)+'-20261030')
        for ref in ('HEAD','main','a'*39):
            with self.subTest(ref=ref),self.assertRaises(web.GateError):web.target(ref)
    def test_committed_scope_is_only_three_patches_and_new_helper(self):
        with self.f.pins():web.validate_scope(self.f.repo,self.f.revision)
    def test_dependency_package_or_other_api_runtime_changes_are_rejected(self):
        for path in ('apps/api/package.json','apps/api/src/iptv.ts','apps/api/tsconfig.json'):
            f=Fixture()
            try:
                f.put(path,b'outside scope\n');rev=f.commit()
                with f.pins(),self.subTest(path=path),self.assertRaises(web.GateError):web.validate_scope(f.repo,rev)
            finally:f.close()
    def test_surgical_committed_patch_preserves_actual_production_deviations(self):
        with self.f.pins():result=web.patched_source(self.f.repo,self.f.revision,web.PATHS[0],self.f.actual)
        self.assertEqual(result,self.f.actual.replace(b'before=1',b'before=2'))
    def test_wrong_source_hash_and_nonapplicable_patch_stop(self):
        with self.f.pins(),self.assertRaises(web.GateError):web.patched_source(self.f.repo,self.f.revision,web.PATHS[0],self.f.actual+b'drift')
        f=self.f;f.actual=b'different production body\n';f.hashes={p:hashlib.sha256(f.actual).hexdigest() for p in web.PATHS[:-1]}
        with f.pins(),self.assertRaises(web.GateError):web.patched_source(f.repo,f.revision,web.PATHS[0],f.actual)
    def test_symlinked_runtime_or_new_helper_in_baseline_is_rejected(self):
        f=self.f;(f.repo/web.PATHS[-1]).unlink();(f.repo/web.PATHS[-1]).symlink_to('other');rev=f.commit()
        with f.pins(),self.assertRaises(web.GateError):web.validate_scope(f.repo,rev)
        with f.pins(),patch.object(web.helpers,'git_entry',return_value=b'100644 blob existing\0'),self.assertRaises(web.GateError):web.validate_scope(f.repo,f.revision)

class PreflightTests(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.addCleanup(self.f.close)
    def invoke(self,before):
        original=web.command;current={'Image':web.SOURCE_ID,'Config':{'Image':web.SOURCE_TAG,'Labels':{'com.docker.compose.project':web.core.UUID}},'State':{'Running':True}}
        def command(*args,**kwargs):
            if args[:2]==('docker','inspect'):return json.dumps([current]).encode()
            return original(*args,**kwargs)
        with self.f.pins(),patch.object(web.core,'image',return_value={'Id':web.SOURCE_ID}),patch.object(web,'command',side_effect=command),patch.object(web.helpers,'require_image_absent'),patch.object(web.helpers,'image_file',return_value=self.f.actual),patch.object(web,'snapshot',return_value=before):
            return web.preflight(self.f.repo,self.f.revision)
    def before(self):return {'fastify':'5.12.5','distEntries':web.SOURCE_DIST,'untouched':{'sha256':web.SOURCE_UNTOUCHED_SHA256},'dist':{'sha256':web.SOURCE_DIST_TREE_SHA256}}
    def test_preflight_patches_actual_source_and_accepts_only_actual_dependency_tree(self):
        _,updated,_=self.invoke(self.before());self.assertEqual(updated[web.PATHS[0]],self.f.actual.replace(b'before=1',b'before=2'))
    def test_version_source_tree_or_compiled_artifact_drift_is_rejected(self):
        for field,value in (('fastify','5.8.2'),('untouched',{'sha256':'drift'}),('dist',{'sha256':'drift'}),('distEntries',{})):
            before=self.before();before[field]=value
            with self.subTest(field=field),self.assertRaises(web.GateError):self.invoke(before)

class FilesystemAndBaselineTests(unittest.TestCase):
    def node(self,script):return subprocess.run(['node','-e',script],capture_output=True,text=True,timeout=20)
    def snapshot(self,root,skip):
        script="const fs=require('node:fs');"+web.snapshot_function()+'console.log(JSON.stringify(snapshot('+json.dumps(str(root))+','+json.dumps(skip)+')));'
        result=self.node(script);self.assertEqual(result.returncode,0,result.stderr);return json.loads(result.stdout)
    def test_untouched_manifest_ignores_only_allowlisted_files_and_detects_other_dependencies(self):
        with tempfile.TemporaryDirectory(prefix='flixify-api-fs-contract-') as directory:
            root=Path(directory);(root/'included.js').write_text('immutable dependency');(root/'edited.ts').write_text('old');(root/'link').symlink_to('included.js')
            first=self.snapshot(root,['edited.ts']);(root/'edited.ts').write_text('new');self.assertEqual(first,self.snapshot(root,['edited.ts']))
            (root/'included.js').write_text('unexpected replacement');self.assertNotEqual(first,self.snapshot(root,['edited.ts']))
    def test_actual_baseline_compile_mismatch_is_detected_before_overlay(self):
        with tempfile.TemporaryDirectory(prefix='flixify-api-baseline-contract-') as directory:
            root=Path(directory);(root/'server.js').write_text('production artifact');expected=self.snapshot(root,[])
            for changed in (False,True):
                (root/'server.js').write_text('production artifact')
                prelude="const originalFs=require('node:fs'),oldRead=originalFs.readFileSync.bind(originalFs),oldExists=originalFs.existsSync.bind(originalFs);originalFs.existsSync=p=>String(p).startsWith('/sys/fs/cgroup')?true:oldExists(p);originalFs.readFileSync=(p,...a)=>String(p).startsWith('/sys/fs/cgroup')?(String(p).endsWith('swap.max')?'268435456':'1342177280'):oldRead(p,...a);require('node:child_process').execFileSync=()=>{"+("originalFs.writeFileSync("+json.dumps(str(root/'server.js'))+",'changed compiled artifact');" if changed else '')+"};"
                script=web.compile_script(expected).replace('/app/apps/api/dist',str(root));result=self.node(prelude+script)
                if changed:self.assertNotEqual(result.returncode,0);self.assertIn('baseline_source_dist_mismatch',result.stderr)
                else:self.assertEqual(result.returncode,0,result.stderr)

class CompileTests(unittest.TestCase):
    def setUp(self):
        self.before={'untouched':{'sha256':'a','files':3},'dist':{'sha256':'b','files':1},'fastify':'5.12.5','distFiles':['server.js']};self.expected=dict(self.before,dist={'sha256':'c','files':1});self.calls=[]
        def command(*args,**kwargs):
            self.calls.append(args)
            return json.dumps(self.expected).encode() if args[:2]==('docker','exec') else b''
        self.command=patch.object(web,'command',side_effect=command).start();self.compile=patch.object(web,'compile_checked').start();self.addCleanup(patch.stopall)
    def test_compiler_checks_baseline_first_then_only_pinned_sources_with_actual_limits(self):
        updated={p:b'patched source' for p in web.PATHS};result=web.compile_overlay({'Config':{'Cmd':['node','server.js']}},'a'*40,updated,self.before)
        self.assertEqual(result,self.expected);self.assertEqual(self.compile.call_args_list[0].args[1],self.before['dist']);self.assertEqual(len(self.compile.call_args_list[1].args),1)
        create=self.calls[0]
        for flag,value in (('--network','none'),('--memory','1280m'),('--memory-swap','1536m'),('--pids-limit','256')):self.assertEqual(create[create.index(flag)+1],value)
        self.assertEqual(sum(a[:2]==('docker','cp') for a in self.calls),4);self.assertEqual(self.calls[-1][:3],('docker','rm','--force'))
        self.assertTrue(any(a[:2]==('docker','commit') for a in self.calls));self.assertFalse(any('install' in a for row in self.calls for a in row))
    def test_baseline_mismatch_removes_only_owned_container_before_any_source_copy(self):
        self.compile.side_effect=web.GateError('baseline_source_dist_mismatch')
        with self.assertRaisesRegex(web.GateError,'baseline_source_dist_mismatch'):web.compile_overlay({'Config':{'Cmd':['node']}},'a'*40,{},self.before)
        self.assertFalse(any(a[:2] in (('docker','cp'),('docker','commit')) for a in self.calls));self.assertEqual(self.calls[-1][:3],('docker','rm','--force'))
    def test_verify_existing_recompiles_without_publishing_and_runtime_drift_never_commits(self):
        web.compile_overlay({'Config':{'Cmd':['node']}},'a'*40,{},self.before,publish=False);self.assertFalse(any(a[:2]==('docker','commit') for a in self.calls))
        self.expected['untouched']={'sha256':'drift','files':3};self.calls.clear()
        with self.assertRaises(web.GateError):web.compile_overlay({'Config':{'Cmd':['node']}},'a'*40,{},self.before)
        self.assertFalse(any(a[:2]==('docker','commit') for a in self.calls))

class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.base={'Id':web.SOURCE_ID,'Config':{'Cmd':['node','server.js'],'Env':['NODE_ENV=production'],'Labels':{'old':'same'}},'RootFS':{'Layers':['base']}}
        self.candidate=copy.deepcopy(self.base);self.candidate['Id']='sha256:'+'b'*64;self.candidate['RootFS']['Layers'].append('candidate');self.candidate['Config']['Labels']|={'org.opencontainers.image.revision':'a'*40,'vip.flixify.edge-recovery.base':web.SOURCE_ID}
        self.before={'untouched':'same','fastify':'5.12.5','distFiles':['server.js'],'dist':'old'};self.expected=dict(self.before,dist='new');self.updated={p:b'patch' for p in web.PATHS}
    def verify(self):
        with patch.object(web.core,'image',return_value=self.candidate),patch.object(web.helpers,'image_file',return_value=b'patch'),patch.object(web,'snapshot',return_value=self.expected),patch.object(web,'command'):
            return web.verify_candidate(self.base,'a'*40,self.updated,self.before,self.expected)
    def test_exact_parent_labels_config_sources_and_compiled_fingerprint_are_required(self):self.assertEqual(self.verify(),self.candidate['Id'])
    def test_candidate_config_or_parent_drift_is_rejected(self):
        self.candidate['Config']['Env']=['NODE_ENV=changed']
        with self.assertRaises(web.GateError):self.verify()
        self.candidate=copy.deepcopy(self.base);self.candidate['RootFS']['Layers']=['wrong']
        with self.assertRaises(web.GateError):self.verify()
    def test_wrong_artifact_or_source_bytes_cannot_pass_verification(self):
        with patch.object(web.core,'image',return_value=self.candidate),patch.object(web.helpers,'image_file',return_value=b'wrong'),self.assertRaises(web.GateError):web.verify_candidate(self.base,'a'*40,self.updated,self.before,self.expected)
        with patch.object(web.core,'image',return_value=self.candidate),patch.object(web.helpers,'image_file',return_value=b'patch'),patch.object(web,'snapshot',return_value=dict(self.expected,dist='unreviewed')),self.assertRaises(web.GateError):web.verify_candidate(self.base,'a'*40,self.updated,self.before,self.expected)
    def test_actual_candidate_tests_use_no_network_no_installs_and_dummy_environment(self):
        with patch.object(web.core,'git_file',return_value=b'fixture'),patch.object(web,'command') as command,contextlib.redirect_stdout(io.StringIO()):web.test_candidate(Path('/repo'),'a'*40,'sha256:'+'b'*64)
        args=command.call_args.args;self.assertEqual(args[args.index('--network')+1],'none');self.assertEqual(args[args.index('--memory')+1],'1280m');self.assertEqual(sum(a.endswith(':ro') for a in args),5);self.assertIn('--no-install',args[-1]);self.assertNotIn('npm ci',args[-1]);self.assertIn('postgresql://127.0.0.1:9/unused',' '.join(args))

class ActionTests(unittest.TestCase):
    def setUp(self):
        self.pre=patch.object(web,'preflight',return_value=({}, {}, {})).start();self.compile=patch.object(web,'compile_overlay',return_value={}).start();self.verify=patch.object(web,'verify_candidate',return_value='candidate').start();self.test=patch.object(web,'test_candidate').start();self.disk=patch.object(web.shutil,'disk_usage',return_value=types.SimpleNamespace(free=8*1024**3)).start();self.command=patch.object(web,'command',return_value=b'').start();self.addCleanup(patch.stopall)
    def invoke(self,action=None):
        with patch.object(sys,'argv',['build-api.py','/repo','--revision','a'*40]+([action] if action else [])),contextlib.redirect_stdout(io.StringIO()):web.main()
    def test_default_is_readonly_and_never_compiles(self):self.invoke();self.compile.assert_not_called();self.disk.assert_not_called();self.command.assert_not_called();self.verify.assert_not_called()
    def test_both_compile_modes_keep_eight_gib_floor(self):
        self.disk.return_value.free=8*1024**3-1
        for action in ('--build','--verify-existing'):
            with self.subTest(action=action),self.assertRaisesRegex(web.GateError,'requires_8GiB'):self.invoke(action)
        self.compile.assert_not_called()
    def test_existing_tag_is_not_overwritten(self):
        self.command.return_value=(web.target('a'*40)+'\n').encode()
        with self.assertRaisesRegex(web.GateError,'tag_exists'):self.invoke('--build')
        self.compile.assert_not_called()
    def test_existing_verification_uses_nonpublishing_compile_and_tests(self):self.invoke('--verify-existing');self.assertFalse(self.compile.call_args.kwargs['publish']);self.verify.assert_called_once();self.test.assert_called_once()

if __name__=='__main__':unittest.main()
