import copy,hashlib,importlib.util,inspect,json,subprocess,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('phone_download_test_build',HERE/'build.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class Manifest(unittest.TestCase):
 def fixture(self):return json.loads((HERE/'manifest.json').read_text())
 def test_six_frozen_paths_and_exact_audited_apk(self):self.assertEqual(len(c.validate_manifest(self.fixture())),6)
 def test_cannot_touch_tv_windows_login_or_api(self):
  for path in ('apps/ops-web/app/platform/tv-download.ts','apps/ops-web/public/downloads/flixify-tv-update.json','apps/ops-web/app/platform/windows-download.ts','apps/ops-web/app/giris-onizleme/phone-login-preview.tsx','apps/api/src/server.ts'):
   x=self.fixture();x['files'][0]['path']=path
   with self.assertRaises(c.GateError):c.validate_manifest(x)
 def test_cannot_replace_preexisting_public_artifact(self):
  x=self.fixture();next(v for v in x['files'] if v['path']==c.APK)['beforeSha256']='a'*64
  with self.assertRaises(c.GateError):c.validate_manifest(x)
 def test_cannot_change_audited_apk_hash_or_size(self):
  for field,value in (('sha256','a'*64),('bytes',c.APK_BYTES+1)):
   x=self.fixture();next(v for v in x['files'] if v['path']==c.APK)[field]=value
   with self.assertRaises(c.GateError):c.validate_manifest(x)
 def test_existing_source_requires_before_hash(self):
  x=self.fixture();x['files'][0]['beforeSha256']=None
  with self.assertRaises(c.GateError):c.validate_manifest(x)
 def test_duplicate_or_missing_path_rejected(self):
  for files in (self.fixture()['files'][:-1],self.fixture()['files']+[self.fixture()['files'][0]]):
   x=self.fixture();x['files']=files
   with self.assertRaises(c.GateError):c.validate_manifest(x)
 def test_only_web_target(self):
  with self.assertRaises(c.GateError):c.target('api','a'*40)
  with self.assertRaises(c.GateError):c.target('ops-web','HEAD')

class FrozenGuards(unittest.TestCase):
 def test_source_scope_cache_and_separate_journal(self):
  with c.profile(HERE.parents[2]) as frozen:
   self.assertEqual(frozen.c.WEB,c.WEB);self.assertEqual(frozen.c.ALLOWED,c.ALLOWED)
   source=inspect.getsource(frozen.main);self.assertIn("r.JOURNAL=r.DIRECTORY/'.phone-download-release.json'",source);self.assertNotIn("r.JOURNAL=r.DIRECTORY/'.login-focus-release.json'",source)
   self.assertEqual(c.sha(c.blob(HERE.parents[2],'release.py')),c.PINNED['release.py'])
   with frozen.c.helpers(HERE.parents[2]) as reader:
    self.assertEqual(reader.b.SOURCES['ops-web'],c.WEB);self.assertEqual(reader.b.SOURCES['api'][1],'sha256:44ff3909282231848200aab83adad8ce8e9ad2da76ed28e16deb417efe609442');self.assertEqual(reader.b.SETTINGS,frozenset())
    self.assertEqual(set(reader.b.excluded_paths('ops-web',c.ALLOWED)),c.ALLOWED|{'apps/ops-web/.next'})
    compiler=reader.b.compiler_script('ops-web',{});self.assertIn('/app/apps/ops-web/.next/cache',compiler);self.assertNotIn('@flixify/contracts',compiler);self.assertIn('CIRCLE_NODE_TOTAL',compiler)

class HttpPublication(unittest.TestCase):
 def execute(self,mode):
  script=c.HTTP_CHECK+r'''const http=require('node:http'),crypto=require('node:crypto'),mode=process.argv[1],apk=Buffer.from('audited fixture bytes'),digest=crypto.createHash('sha256').update(apk).digest('hex');const server=http.createServer((req,res)=>{if(req.url==='/indir'){res.writeHead(mode==='bad-status'?404:200,{'content-type':'text/html'});res.end(mode==='bad-shell'?'<html>Flixify error page</html>':mode==='ready'?'<section id="android-telefon"></section>':'<html>Flixify hazırlanıyor</html>');}else{res.writeHead(200,{'content-length':apk.length,'content-type':'application/vnd.android.package-archive'});res.end(apk);}});server.listen(0,'127.0.0.1',async()=>{try{await verifyPhoneDownload('http://127.0.0.1:'+server.address().port,mode==='bad-digest'?'0'.repeat(64):digest,apk.length);}catch(e){process.exitCode=1;}finally{server.closeAllConnections();server.close();}});'''
  return subprocess.run(['node','-e',script,mode],capture_output=True,timeout=10).returncode
 def test_loading_ssr_without_links_and_exact_apk_stream_pass(self):self.assertEqual(self.execute('ok'),0);self.assertEqual(self.execute('ready'),0)
 def test_changed_apk_or_failed_page_rejected(self):
  for mode in ('bad-digest','bad-status','bad-shell'):
   with self.subTest(mode=mode):self.assertNotEqual(self.execute(mode),0)

if __name__=='__main__':unittest.main()
