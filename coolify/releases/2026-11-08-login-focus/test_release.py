import copy, importlib.util, json, types, unittest, subprocess, tempfile
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch, Mock

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('focus_build_test',HERE/'build.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
spec=importlib.util.spec_from_file_location('focus_release_test',HERE/'release.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class Scope(unittest.TestCase):
 def manifest(self):return {'schemaVersion':1,'sourceImageId':c.WEB[1],'files':[{'path':c.PREFIX+'phone-login-preview.tsx','beforeSha256':'a'*64,'sha256':'b'*64,'bytes':100}]}
 def test_manifest_accepts_only_five_reviewed_login_paths(self):self.assertEqual(len(c.validate_manifest(self.manifest())),1)
 def test_no_download_api_or_unrelated_source(self):
  for path in ('apps/api/src/server.ts','apps/ops-web/public/downloads/update.json','apps/ops-web/app/platform/shell.tsx'):
   x=self.manifest();x['files'][0]['path']=path
   with self.assertRaises(c.GateError):c.validate_manifest(x)
 def test_only_new_segmented_otp_paths_may_be_absent(self):
  x=self.manifest();x['files'][0]['beforeSha256']=None
  with self.assertRaises(c.GateError):c.validate_manifest(x)
  x['files'][0]['path']=c.PREFIX+'segmented-otp-input.tsx';c.validate_manifest(x)
 def test_reject_duplicate_paths(self):
  x=self.manifest();x['files']*=2
  with self.assertRaises(c.GateError):c.validate_manifest(x)
 def test_only_web_target_and_exact_revision(self):
  with self.assertRaises(c.GateError):c.target('api','a'*40)
  with self.assertRaises(c.GateError):c.target('ops-web','HEAD')
  self.assertIn('login-focus-',c.target('ops-web','a'*40))
 def test_frozen_helpers_ignore_mutable_future_release(self):
  with c.helpers(HERE.parents[2]) as old:
   self.assertEqual(old.b.SOURCES,{'api':c.API,'ops-web':c.WEB});self.assertEqual(old.b.SETTINGS,frozenset())
   excluded=old.b.excluded_paths('ops-web',list(c.ALLOWED))
   self.assertEqual(set(excluded),set(c.ALLOWED)|{'apps/ops-web/.next'})
   code=old.b.compiler_script('ops-web',{})
   self.assertNotIn('@flixify/contracts',code);self.assertIn('@flixify/ops-web',code);self.assertIn('CIRCLE_NODE_TOTAL',code);self.assertIn('--v8-pool-size=1',code)
   with self.assertRaises(c.GateError):old.b.compiler_script('api',{})
   with self.assertRaises(c.GateError):old.b.excluded_paths('ops-web',['packages/contracts/src/domain.ts'])
 def test_empty_candidate_source_proof_rejected(self):
  with self.assertRaises(c.GateError):c.validate_proof(None,{'service':'ops-web','sourceHashes':{}})

class RuntimeProtection(unittest.TestCase):
 def row(self):return {'Name':'/api-x','Id':'api-fixed','Image':c.API[1],'Config':{'Image':c.API[0],'Env':['JWT=unchanged']},'HostConfig':{},'Mounts':[],'NetworkSettings':{'Networks':{}},'State':{'Running':True,'Paused':False,'StartedAt':'fixed'},'RestartCount':0}
 def reader(self,row):return types.SimpleNamespace(b=types.SimpleNamespace(outside_snapshot=lambda:{'worker':'fixed'},services=lambda **kw:{'api':row}))
 def test_api_env_is_included_in_protected_snapshot(self):
  row=self.row();before=c.protected_snapshot(self.reader(row));row['Config']['Env']=['JWT=changed'];self.assertNotEqual(c.protected_snapshot(self.reader(row)),before)
 def test_api_cannot_be_stopped_or_changed(self):
  for field in ('stopped','image'):
   row=self.row()
   if field=='stopped':row['State']['Running']=False
   else:row['Image']='sha256:foreign'
   with self.assertRaises(c.GateError):c.protected_snapshot(self.reader(row))

class BuildCacheCleanup(unittest.TestCase):
 def execute(self,root):
  script=r'''const fs=require('node:fs'),vm=require('node:vm'),root=process.argv[1],code=JSON.parse(process.argv[2]);const map=p=>{if(!p.startsWith('/app'))throw Error('unexpected_path');return root+p;};const guarded={lstatSync:p=>fs.lstatSync(map(p)),rmSync:(p,o)=>{if(p!=='/app/apps/ops-web/.next/cache')throw Error('wrong_removal_target');fs.rmSync(map(p),o);}};vm.runInNewContext(code,{require:n=>{if(n!=='node:fs')throw Error('unexpected_module');return guarded;}});'''
  return subprocess.run(['node','-e',script,str(root),json.dumps(c.CACHE_CLEANUP)],capture_output=True)
 def fixture(self,root):
  app=root/'app/apps/ops-web';(app/'.next/static').mkdir(parents=True);(app/'public/downloads').mkdir(parents=True);(app/'.next/static/keep.js').write_text('runtime');(app/'public/downloads/keep.apk').write_text('published');return app
 def test_removes_only_cache_after_successful_compiler(self):
  with c.helpers(HERE.parents[2]) as old:
   code=old.b.compiler_script('ops-web',{});self.assertTrue(code.endswith(c.CACHE_CLEANUP));self.assertLess(code.index('"@flixify/ops-web"'),code.index(c.CACHE_CLEANUP))
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);app=self.fixture(root);(app/'.next/cache/webpack').mkdir(parents=True);(app/'.next/cache/webpack/disposable').write_bytes(b'x'*1024)
   result=self.execute(root);self.assertEqual(result.returncode,0,result.stderr.decode());self.assertFalse((app/'.next/cache').exists());self.assertEqual((app/'.next/static/keep.js').read_text(),'runtime');self.assertEqual((app/'public/downloads/keep.apk').read_text(),'published')
 def test_refuses_symlink_or_non_directory_cache(self):
  for kind in ('symlink','file'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as d:
    root=Path(d);app=self.fixture(root);outside=root/'outside';outside.mkdir();(outside/'keep').write_text('protected');cache=app/'.next/cache'
    if kind=='symlink':cache.symlink_to(outside,target_is_directory=True)
    else:cache.write_text('not a directory')
    self.assertNotEqual(self.execute(root).returncode,0);self.assertEqual((outside/'keep').read_text(),'protected');self.assertTrue(cache.exists())

class Metadata(unittest.TestCase):
 def setUp(self):
  self.proof={'candidateTag':'candidate-web','candidateId':'sha256:new-web'}
  self.b=types.SimpleNamespace(WORKER=('worker-tag','worker-id'),DB=('db-tag','db-id'))
  self.reader=types.SimpleNamespace(b=self.b)
  self.before={k:'unchanged-'+k for k in ('modelEnvSha','otherModelsSha','envSha','protectedAppsSha')}
  self.after={**self.before,'rawSha':'new-raw','renderedSha':'new-rendered','generatedSha':'new-rendered'}
  for doc in ('raw','rendered','generated'):self.after[doc]={'services':{name:{'image':tag} for name,tag in [('api',c.API[0]),('ops-web',self.proof['candidateTag']),('worker','worker-tag'),('db','db-tag')]}}
  self.after['applications']={'api':c.API[0],'ops-web':self.proof['candidateTag'],'worker':'worker-tag'}
 def apply(self):
  result={'rawSha':'new-raw','renderedSha':'new-rendered'}
  with patch.object(r,'mutate',side_effect=[result,result]),patch.object(r,'state',return_value=self.after):return r.apply(self.reader,self.before,c.WEB[0],self.proof['candidateTag'])
 def test_web_tag_metadata_change_preserves_every_env_row_and_byte(self):self.apply()
 def test_reject_env_or_api_model_change(self):
  for field in ('envSha','modelEnvSha','otherModelsSha','protectedAppsSha'):
   old=self.after[field];self.after[field]='changed'
   with self.assertRaises(r.GateError):self.apply()
   self.after[field]=old
 def test_reject_protected_api_compose_change(self):
  self.after['rendered']['services']['api']['image']='foreign'
  with self.assertRaises(r.GateError):self.apply()
 def test_retargeted_tag_rejected_before_any_compose_up(self):
  self.reader.state_fingerprint=lambda value:{k:value[k] for k in ('rawSha','renderedSha','modelEnvSha','otherModelsSha','generatedSha','envSha')}
  self.b.image_info=Mock(return_value={'Id':'sha256:foreign'});self.b.command=Mock()
  journal={'targetState':r.fingerprint(self.reader,self.after),'protected':{'api':'fixed'}}
  with patch.object(r,'state',return_value=self.after),patch.object(r.c,'protected_snapshot',return_value=journal['protected']),patch.object(r,'current_web'):
   with self.assertRaises(r.GateError):r.guarded_recreate(self.reader,self.proof,journal,self.proof['candidateTag'],self.proof['candidateId'])
  self.b.command.assert_not_called()

if __name__=='__main__':unittest.main()
