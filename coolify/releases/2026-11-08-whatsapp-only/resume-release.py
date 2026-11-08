#!/usr/bin/env python3
"""Resume this exact release's WEB/bot steps, retaining its healthy closed API."""
import argparse,contextlib,fcntl,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path
REVISION='438ae41ef672df71da7327b821c0de7d896db271'
PREFIX='coolify/releases/2026-11-08-whatsapp-only/'
PINNED={'build.py':'8850cfe18f1cf5180142de1e04b1e44e57de6466c6c1a3e427280e4c064d787e','release.py':'215dff51b86a1f784214b7e071006474d84c9703d13fb878d6991df9e70e8f24','bot-release.py':'29f296a2c4b04a4f38464f5497352b558e74768dc31e0f8c9c3f586194bd85db'}
class GateError(Exception):pass
SAFE_POLICY=r'''(async()=>{const base='http://127.0.0.1:4000';const blocked=await fetch(base+'/auth/register-anon',{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(10000)});const reason=await blocked.json();if(blocked.status!==410||reason.reason!=='phone_verification_required'||!blocked.headers.get('cache-control')?.includes('no-store'))throw Error('legacy_signup_not_closed');const status=await fetch(base+'/auth/phone/status',{redirect:'manual',signal:AbortSignal.timeout(10000)});const value=await status.json();if(status.status!==200||value.enabled!==true||value.nativePhoneLogin!==true)throw Error('phone_status');})().catch(()=>process.exit(1));'''
def safe_policy(b,container):b.command('docker','exec',container,'node','-e',SAFE_POLICY,timeout=35)
def blob(repo,path):
 try:return subprocess.run(['git','-C',str(repo),'show',REVISION+':'+PREFIX+path],check=True,capture_output=True).stdout
 except (OSError,subprocess.CalledProcessError):raise GateError('exact_recovery_source_unavailable') from None
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
@contextlib.contextmanager
def frozen(repo):
 import hashlib
 with tempfile.TemporaryDirectory(prefix='flixify-whatsapp-resume-') as d:
  root=Path(d)
  for name,digest in PINNED.items():
   data=blob(repo,name)
   if hashlib.sha256(data).hexdigest()!=digest:raise GateError('frozen_recovery_helper_changed')
   (root/name).write_bytes(data)
  release=load('resume_frozen_release',root/'release.py');bot=load('resume_frozen_bot',root/'bot-release.py')
  release.c.policy_check=safe_policy;bot.c.policy_check=safe_policy;bot.release.c.policy_check=safe_policy
  yield release,bot

def verify_payload(release,proofs,repo):
 c=release.c;manifest=c.validate_manifest(json.loads(blob(repo,'manifest.json')));recipe=json.loads(blob(repo,'api-edits.json'))
 expected={'api':{p:x['after'] for p,x in recipe['existing'].items()},'ops-web':{x['path']:x['sha256'] for x in manifest['webFiles']}}
 for name,proof in proofs.items():
  if proof.get('service')!=name or proof.get('revision')!=REVISION or proof.get('sourceHashes')!=expected[name]:raise GateError('exact_frozen_policy_candidates_required')
 return manifest
def verify_running_api(release,r,proofs,journal):
 rows=r.b.services(allow_changed_stopped=True);api=rows['api'];proof=proofs['api']
 if (api['Config']['Image'],api['Image'])!=(proof['candidateTag'],proof['candidateId']) or not api['State']['Running'] or release.env_hash(r,api)!=journal['runtimeEnvs']['api']:raise GateError('healthy_exact_closed_api_required')
 r.healthy('api',True);safe_policy(r.b,'api-'+r.b.UUID)
 return rows
def resume_web(release,r,proofs,apply):
 journal=r.load_journal()
 if journal['revision']!=REVISION or journal['candidateIds']!={k:v['candidateId'] for k,v in proofs.items()} or journal['phase']!='metadata_applied' or journal.get('legacySignupRollbackAllowed') is not False:raise GateError('exact_interrupted_web_phase_required')
 if release.fingerprint(r,release.state(r))!=journal['targetState'] or release.c.protected_snapshot(r.b)!=journal['protected'] or not release.schema_ready(r):raise GateError('journal_metadata_schema_or_protected_state_drift')
 verify_running_api(release,r,proofs,journal)
 if apply:
  targets={k:(v['candidateTag'],v['candidateId']) for k,v in proofs.items()}
  release.guarded_recreate(r,'ops-web',proofs,journal,targets)
  journal['phase']='running';journal['recovery']={'case':'baseline_empty_login500_probe_assumption','apiRecreated':False,'productionCodeLoginPost':False};r.save_journal(journal)
 print(json.dumps({'state':'whatsapp_web_resume_verified' if apply else 'whatsapp_web_resume_preflight_verified','apiRecreated':False,'loginRequests':0,'changed':['ops-web'] if apply else []}))

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repo',type=Path);p.add_argument('--mode',choices=('web','bot'),required=True);p.add_argument('--api-proof',type=Path,required=True);p.add_argument('--web-proof',type=Path,required=True);p.add_argument('--candidate',type=Path);p.add_argument('--probe-image-id');p.add_argument('--apply',action='store_true');a=p.parse_args();proofs={'api':json.loads(a.api_proof.read_text()),'ops-web':json.loads(a.web_proof.read_text())}
 with frozen(a.repo) as (release,bot):
  verify_payload(release,proofs,a.repo)
  with release.c.helpers(a.repo) as r:
   r.JOURNAL=r.DIRECTORY/'.whatsapp-only-release.json';r.b.require_disk()
   for proof in proofs.values():release.c.verify_proof(r.b,proof)
   if a.mode=='web':
    with (r.DIRECTORY/'.phone-login-release.lock').open('a+') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);resume_web(release,r,proofs,a.apply)
    return
   journal=r.load_journal()
   if journal['revision']!=REVISION or journal['candidateIds']!={k:v['candidateId'] for k,v in proofs.items()} or journal['phase']!='running':raise GateError('completed_api_and_web_required_before_bot')
   verify_running_api(release,r,proofs,journal)
  if a.candidate is None:raise GateError('private_exact_bot_candidate_required')
  arguments=['bot-release.py',str(a.repo),'--revision',REVISION,'--candidate',str(a.candidate),'--api-proof',str(a.api_proof),'--web-proof',str(a.web_proof)]
  if a.probe_image_id:arguments+=['--probe-image-id',a.probe_image_id]
  if a.apply:arguments+=['--apply']
  original=sys.argv
  try:sys.argv=arguments;bot.main()
  finally:sys.argv=original
if __name__=='__main__':
 try:main()
 except Exception as e:print('whatsapp_resume_stopped:'+str(e) if isinstance(e,GateError) else 'whatsapp_resume_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
