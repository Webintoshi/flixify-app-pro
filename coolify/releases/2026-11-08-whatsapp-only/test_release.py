import copy,importlib.util,json,subprocess,tempfile,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
c=load('whatsapp_test_build','build.py');r=load('whatsapp_test_release','release.py');bot=load('whatsapp_test_bot','bot-release.py')

class Payload(unittest.TestCase):
 def manifest(self):return json.loads((HERE/'manifest.json').read_text())
 def test_frozen_scope(self):self.assertEqual(len(c.validate_manifest(self.manifest())['webFiles']),2)
 def test_no_download_or_login_code_replacement(self):
  for path in ('apps/ops-web/app/indir/page.tsx','apps/ops-web/app/platform/tv-download.ts','apps/api/src/security.ts'):
   value=self.manifest();value['webFiles'][0]['path']=path
   with self.assertRaises(c.GateError):c.validate_manifest(value)
 def test_only_additive_provenance_migration(self):
  value=self.manifest();value['migration']['path']='scripts/sql/remembered-device-sessions-after-api-cutover.sql'
  with self.assertRaises(c.GateError):c.validate_manifest(value)
 def test_pinned_helpers_skip_contracts_and_keep_web_cache_cleanup(self):
  with c.helpers(HERE.parents[2]) as old:
   self.assertEqual(old.b.SOURCES,c.SOURCES);self.assertEqual(old.b.SETTINGS,frozenset())
   for name,paths in [('api',c.API_PATHS),('ops-web',c.WEB_PATHS)]:
    script=old.b.compiler_script(name,{});self.assertNotIn('@flixify/contracts',script)
    self.assertEqual(set(old.b.excluded_paths(name,paths)),set(paths)|{'apps/api/dist' if name=='api' else 'apps/ops-web/.next'})
    self.assertEqual('/app/apps/ops-web/.next/cache' in script,name=='ops-web')
 def test_raw_bot_hash_does_not_normalize_crlf(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'bot.mjs';data=b'line1\r\nline2\r\n';path.write_bytes(data);snap=c.bot_file_snapshot(path)
   self.assertEqual(snap['sha256'],c.sha(data));self.assertNotEqual(snap['sha256'],c.sha(data.replace(b'\r\n',b'\n')))
 def test_bot_source_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'real').write_text('x');(root/'link').symlink_to(root/'real')
   with self.assertRaises(c.GateError):c.bot_file_snapshot(root/'link')

class PolicyProbes(unittest.TestCase):
 def test_live_probe_has_only_empty_post_bodies_and_status_get(self):
  script=r'''const seen=[];global.fetch=async(url,options={})=>{seen.push([url,options]);if(url.endsWith('/auth/register-anon'))return {status:410,json:async()=>({reason:'phone_verification_required'}),headers:{get:()=> 'no-store'}};if(url.endsWith('/auth/login-by-code'))return{status:400};return{status:200,json:async()=>({enabled:true,nativePhoneLogin:true})};};'''+c.LIVE_POLICY_CHECK+r'''setImmediate(()=>{if(seen.length!==3||seen.slice(0,2).some(x=>x[1].body!=='{}')||seen[2][1].body!==undefined)process.exit(1);});'''
  result=subprocess.run(['node','-e',script],capture_output=True);self.assertEqual(result.returncode,0,result.stderr.decode());self.assertNotIn('TESTEXISTING',c.LIVE_POLICY_CHECK)
 def test_isolated_demo_keeps_valid_missing_code_401_check(self):
  script=r'''const seen=[];global.fetch=async(url,options)=>{seen.push([url,options]);return url.endsWith('register-anon')?{status:410,json:async()=>({reason:'phone_verification_required'}),headers:{get:()=> 'no-store'}}:{status:401};};'''+c.REGISTRATION_CHECK+r'''verifyRegistrationPolicy('http://fixture').then(()=>{if(JSON.parse(seen[1][1].body).code!=='TESTEXISTING1234')process.exit(1);}).catch(()=>process.exit(1));'''
  result=subprocess.run(['node','-e',script],capture_output=True);self.assertEqual(result.returncode,0,result.stderr.decode())
 def test_isolated_environment_has_all_required_fixture_settings(self):
  calls=[];fake=types.SimpleNamespace(command=lambda *args,**kw:calls.append(args));c.smoke_api(fake,{'candidateId':'sha256:fixture'})
  create=next(x for x in calls if x[:2]==('docker','create'));values=[create[i+1] for i,x in enumerate(create[:-1]) if x=='-e']
  for key in ('ADMIN_EMAILS','SUPABASE_URL','SUPABASE_JWKS_URL','APP_DEMO_MODE'):
   self.assertTrue(any(x.startswith(key+'=') for x in values))

class Metadata(unittest.TestCase):
 def setUp(self):
  self.b=types.SimpleNamespace(WORKER=('worker','worker-id'),DB=('db','db-id'));self.reader=types.SimpleNamespace(b=self.b)
  self.before={k:'same-'+k for k in ('modelEnvSha','envSha','otherModelsSha','protectedAppsSha')};self.after={**self.before,'rawSha':'raw-new','renderedSha':'rendered-new','generatedSha':'rendered-new'};self.new={'api':'closed-api','ops-web':'new-web'}
  images={**self.new,'worker':'worker','db':'db'}
  for doc in ('raw','rendered','generated'):self.after[doc]={'services':{name:{'image':tag} for name,tag in images.items()}}
  self.after['applications']={k:v for k,v in images.items() if k!='db'}
 def invoke(self):
  result={'rawSha':'raw-new','renderedSha':'rendered-new'}
  with patch.object(r,'mutate',side_effect=[result,result]),patch.object(r,'state',return_value=self.after):return r.apply(self.reader,self.before,{},self.new)
 def test_only_two_image_tags_change(self):self.invoke()
 def test_every_environment_and_protected_model_remains_exact(self):
  for key in self.before:
   old=self.after[key];self.after[key]='changed'
   with self.assertRaises(r.c.GateError):self.invoke()
   self.after[key]=old
 def test_worker_or_database_tag_change_rejected(self):
  for key in ('worker','db'):
   old=self.after['raw']['services'][key]['image'];self.after['raw']['services'][key]['image']='foreign'
   with self.assertRaises(r.c.GateError):self.invoke()
   self.after['raw']['services'][key]['image']=old
 def test_schema_probe_is_valid_node_syntax_without_execution(self):
  scripts=[];fake=types.SimpleNamespace(node_json=lambda script:(scripts.append(script) or {'ready':True}),b=types.SimpleNamespace(GateError=Exception));self.assertTrue(r.schema_ready(fake))
  result=subprocess.run(['node','--check'],input=scripts[0].encode(),capture_output=True);self.assertEqual(result.returncode,0,result.stderr.decode())

class BotCheckpoint(unittest.TestCase):
 def test_only_authorized_bot_lifecycle_and_raw_source_can_change(self):
  journal={};saved=[];reader=types.SimpleNamespace(save_journal=lambda x:saved.append(copy.deepcopy(x)));before={'/api':'fixed','/flixify-telegram-bot':'old',c.BOT_FILE_KEY:{'sha256':c.BOT_SOURCE}};after={**before,'/flixify-telegram-bot':'new',c.BOT_FILE_KEY:{'sha256':c.BOT_TARGET}};helper=types.SimpleNamespace(bot_snapshot=lambda:{'config':'fixed'},stable_identity=lambda x:x)
  bot.update_bot_checkpoint(reader,journal,before,after,helper,{'config':'fixed'},c.BOT_TARGET,True);self.assertTrue(saved[0]['bot']['candidateApplied']);self.assertEqual(saved[0]['protected'],after)
  after['/api']='changed'
  with self.assertRaises(bot.c.GateError):bot.update_bot_checkpoint(reader,journal,before,after,helper,{'config':'fixed'},c.BOT_TARGET,True)
 def test_frozen_bot_helper_uses_raw_pin_and_proven_offline_probe(self):
  with bot.bot_helpers(HERE.parents[2]) as (old,probe):
   self.assertEqual(old.SOURCE_SHA,c.BOT_SOURCE);self.assertEqual(c.sha(probe.read_bytes()),bot.PROBE_SHA)

if __name__=='__main__':unittest.main()
