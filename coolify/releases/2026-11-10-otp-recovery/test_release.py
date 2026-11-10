import importlib.util,json,tempfile,types,unittest,subprocess
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('otp_recovery_test',HERE/'build.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
REPO=HERE.parents[2]
class Scope(unittest.TestCase):
 def manifest(self):return {'schemaVersion':1,'sourceImageId':c.WEB[1],'files':[{'path':p,'beforeSha256':h,'sha256':c.APK_SHA if p==c.APK else 'a'*64,'bytes':c.APK_BYTES if p==c.APK else 120}for p,h in c.BEFORE.items()]}
 def test_phone_release_adds_only_version_101_and_keeps_100_untouched(self):
  new='apps/ops-web/public/downloads/flixify-pro-android-phone-1.0.1.apk'
  self.assertIn(new,c.ALLOWED);self.assertIsNone(c.BEFORE[new]);self.assertNotIn('apps/ops-web/public/downloads/flixify-pro-android-phone-1.0.0.apk',c.ALLOWED)
 def test_frozen_manifest_matches_all_actual_payload_files(self):
  entries=c.validate_manifest(json.loads((HERE/'manifest.json').read_text()))
  for item in entries:
   data=(REPO/item['path']).read_bytes();self.assertEqual(c.sha(data),item['sha256']);self.assertEqual(len(data),item['bytes'])
 def test_only_five_exact_web_and_phone_sources(self):self.assertEqual({x['path']for x in c.validate_manifest(self.manifest())},c.ALLOWED)
 def test_reject_any_other_apk_digest_or_size(self):
  for key,value in (('sha256','f'*64),('bytes',100)):
   m=self.manifest();next(x for x in m['files']if x['path']==c.APK)[key]=value
   with self.assertRaises(c.GateError):c.validate_manifest(m)
 def test_reject_wrong_source_pin_or_absent_file(self):
  for value in (None,'b'*64):
   m=self.manifest();m['files'][0]['beforeSha256']=value
   with self.assertRaises(c.GateError):c.validate_manifest(m)
 def test_reject_extra_missing_duplicate_or_api_download_paths(self):
  variants=[]
  m=self.manifest();m['files'].pop();variants.append(m)
  m=self.manifest();m['files'].append(m['files'][0]);variants.append(m)
  for path in ('apps/api/src/server.ts','apps/ops-web/public/downloads/update.json','apps/ops-web/app/platform/shell.tsx'):
   m=self.manifest();m['files'][0]['path']=path;variants.append(m)
  for m in variants:
   with self.assertRaises(c.GateError):c.validate_manifest(m)
 def test_only_exact_web_revision_target(self):
  for service,ref in (('api','a'*40),('ops-web','HEAD')):
   with self.assertRaises(c.GateError):c.target(service,ref)
  self.assertEqual(c.target('ops-web','a'*40),'flixify-ops-web:otp-recovery-'+12*'a'+'-20261110')
 def test_frozen_compiler_and_runtime_guards(self):
  with c.profile(REPO) as f, f.c.helpers(REPO) as r:
   self.assertEqual(f.c.API,c.API);self.assertEqual(r.b.SOURCES,{'api':c.API,'ops-web':c.WEB});self.assertEqual(r.b.SETTINGS,frozenset())
   self.assertEqual(set(r.b.excluded_paths('ops-web',list(c.ALLOWED))),c.ALLOWED|{'apps/ops-web/.next'})
   code=r.b.compiler_script('ops-web',{})
   self.assertNotIn('@flixify/contracts',code);self.assertIn('@flixify/ops-web',code);self.assertIn('CIRCLE_NODE_TOTAL',code);self.assertIn('--v8-pool-size=1',code);self.assertTrue(code.endswith(f.c.CACHE_CLEANUP))
   with self.assertRaises(f.c.GateError):r.b.compiler_script('api',{})
   with self.assertRaises(f.c.GateError):r.b.excluded_paths('ops-web',['apps/api/src/server.ts'])
   self.assertIn("r.JOURNAL=r.DIRECTORY/'.otp-recovery-release.json'",Path(f.__file__).read_text())
 def test_live_bot_source_inode_and_mode_are_protected(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'bot.mjs';p.write_bytes(b'fixture');p.chmod(0o600)
   with patch.object(c,'BOT_SOURCE',c.sha(b'fixture')):
    first=c.bot_snapshot(p);self.assertEqual(first['mode'],0o600);p.chmod(0o640);self.assertNotEqual(first,c.bot_snapshot(p));p.write_bytes(b'foreign')
    with self.assertRaises(c.GateError):c.bot_snapshot(p)
 def test_reject_symlink_bot_source(self):
  with tempfile.TemporaryDirectory()as d:
   p=Path(d)/'source';p.write_text('fixture');link=Path(d)/'link';link.symlink_to(p)
   with self.assertRaises(c.GateError):c.bot_snapshot(link)
 def test_runtime_snapshot_protects_api_and_bot(self):
  api={'Name':'/api-fixed','Id':'fixed','Image':c.API[1],'Config':{'Image':c.API[0],'Env':['A=fixed']},'HostConfig':{},'Mounts':[],'NetworkSettings':{'Networks':{}},'State':{'Running':True,'Paused':False,'StartedAt':'fixed'},'RestartCount':0}
  r=types.SimpleNamespace(b=types.SimpleNamespace(outside_snapshot=lambda:{'worker':'fixed'},services=lambda **kw:{'api':api}))
  with c.profile(REPO)as f,patch.object(c,'bot_snapshot',return_value={'sha256':c.BOT_SOURCE,'inode':10}):
   first=f.c.protected_snapshot(r);self.assertEqual(first[c.BOT_FILE_KEY]['sha256'],c.BOT_SOURCE);api['Config']['Env']=['A=changed'];self.assertNotEqual(first,f.c.protected_snapshot(r));api['State']['Running']=False
   with self.assertRaises(f.c.GateError):f.c.protected_snapshot(r)

class PhoneDownload(unittest.TestCase):
 def run_check(self,expected_hash,expected_bytes):
  setup=r'''global.fetch=async url=>url.endsWith('/indir')?{status:200,text:async()=>'<div id="android-telefon"></div>'}:{status:200,headers:{get:()=>"7"},body:(async function*(){yield Buffer.from('fixture');})()};'''
  return subprocess.run(['node','-e',setup+c.HTTP_CHECK+'verifyPhoneDownload("http://fixture.invalid",'+json.dumps(expected_hash)+','+str(expected_bytes)+').catch(()=>process.exit(1));'],capture_output=True)
 def test_fixed_download_stream_digest_and_size(self):self.assertEqual(self.run_check(c.sha(b'fixture'),7).returncode,0)
 def test_reject_wrong_download_digest_or_size(self):
  self.assertNotEqual(self.run_check('a'*64,7).returncode,0);self.assertNotEqual(self.run_check(c.sha(b'fixture'),8).returncode,0)
if __name__=='__main__':unittest.main()
