import importlib.util,json,subprocess,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('whatsapp_resume_test',HERE/'resume-release.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Resume(unittest.TestCase):
 def test_safe_probe_never_calls_code_login(self):
  script=r'''const seen=[];global.fetch=async(url,o={})=>{seen.push([url,o]);return url.endsWith('register-anon')?{status:410,json:async()=>({reason:'phone_verification_required'}),headers:{get:()=> 'no-store'}}:{status:200,json:async()=>({enabled:true,nativePhoneLogin:true})};};'''+m.SAFE_POLICY+r'''setImmediate(()=>{if(seen.length!==2||seen.some(x=>x[0].includes('login-by-code'))||seen[0][1].body!=='{}')process.exit(1);});'''
  result=subprocess.run(['node','-e',script],capture_output=True);self.assertEqual(result.returncode,0,result.stderr.decode())
 def test_frozen_web_and_bot_use_only_safe_override(self):
  with m.frozen(HERE.parents[2]) as (release,bot):
   self.assertIs(release.c.policy_check,m.safe_policy);self.assertIs(bot.c.policy_check,m.safe_policy);self.assertIs(bot.release.c.policy_check,m.safe_policy)
 def test_resume_calls_only_existing_web_guard(self):
  proofs={n:{'candidateId':n+'-id','candidateTag':n+'-tag'} for n in ('api','ops-web')};journal={'revision':m.REVISION,'candidateIds':{k:v['candidateId'] for k,v in proofs.items()},'phase':'metadata_applied','legacySignupRollbackAllowed':False,'targetState':'target','protected':'protected'}
  reader=types.SimpleNamespace(load_journal=lambda:journal,save_journal=Mock(),b=object());release=types.SimpleNamespace(fingerprint=lambda *a:'target',state=lambda *a:{},schema_ready=lambda *a:True,c=types.SimpleNamespace(protected_snapshot=lambda *a:'protected'),guarded_recreate=Mock())
  with patch.object(m,'verify_running_api',return_value={}):m.resume_web(release,reader,proofs,True)
  self.assertEqual(release.guarded_recreate.call_count,1);self.assertEqual(release.guarded_recreate.call_args.args[1],'ops-web');self.assertEqual(journal['phase'],'running');self.assertFalse(journal['recovery']['apiRecreated'])
 def test_foreign_journal_rejected_before_recreate(self):
  reader=types.SimpleNamespace(load_journal=lambda:{'revision':'foreign'});release=types.SimpleNamespace(guarded_recreate=Mock())
  with self.assertRaises(m.GateError):m.resume_web(release,reader,{},True)
  release.guarded_recreate.assert_not_called()
if __name__=='__main__':unittest.main()
