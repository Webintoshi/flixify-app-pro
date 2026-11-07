#!/usr/bin/env python3
"""Pinned actual-image API/WEB overlays for WhatsApp-only new registrations."""
from __future__ import annotations
import argparse,contextlib,hashlib,importlib.util,json,re,subprocess,sys,tempfile,stat
from pathlib import Path
HERE=Path(__file__).resolve().parent
PHONE_REV='88f27a175567e5be7295763f8a74044da55b2caa'
FOCUS_REV='673e760a3b768c0e369540f426eb1390b839ebec'
PHONE_PATH='coolify/releases/2026-11-07-phone-login/'
PINNED={'build-release.py':'bfa6b6422e14af464efa63f2f1cbfc3d8db294c0a6768dc68b7f06f1bc215e47','release.py':'a1db916baa770ee9c74214563f2580ce195b0bdb0d12eda0de80af2a50042940'}
FOCUS_BUILD='coolify/releases/2026-11-08-login-focus/build.py'
FOCUS_SHA='a30f25c413d6841e25b2e0d2a8c263b03af9103e195fd8a410939bf22e4ba9cf'
API=('flixify-api:phone-login-4e538f819b10-20261107','sha256:44ff3909282231848200aab83adad8ce8e9ad2da76ed28e16deb417efe609442')
WEB=('flixify-ops-web:phone-download-eb5166c3ee32-20261108','sha256:6e444af5198da9a8bba9d9925b3882d44d5510ba25de4ddefb7cd7d41b2be01f')
SOURCES={'api':API,'ops-web':WEB}
API_PATHS=frozenset('apps/api/src/'+n for n in ('server.ts','repository.ts','phone-auth-accounts.ts'))
WEB_PATHS=frozenset('apps/ops-web/app/giris-onizleme/'+n for n in ('phone-login-preview.tsx','account-code-client.ts'))
MIGRATION='supabase/migrations/202611080001_registration_provenance.sql'
MANIFEST_PATH='coolify/releases/2026-11-08-whatsapp-only/manifest.json'
BOT_SCRIPT=Path('/data/flixify/app/scripts/telegram-panel-bot.mjs')
BOT_SOURCE='8146bbfe48be7ac4c053d348d9963181a8715dd2164afb8caaf8e78f0a704a4d'
BOT_TARGET='7053b1c96b62417f8db532871bfca2d28630ec20c8850566d7d26f2649000d70'
BOT_FILE_KEY='/@flixify-telegram-bot-source'
class GateError(Exception):pass
def sha(data):return hashlib.sha256(data).hexdigest()
def bot_file_snapshot(path=BOT_SCRIPT):
 info=path.lstat()
 if not stat.S_ISREG(info.st_mode) or info.st_size>2*1024**2:raise GateError('regular_bounded_live_bot_script_required')
 data=path.read_bytes()
 if len(data)!=info.st_size:raise GateError('live_bot_changed_during_read')
 return {'sha256':sha(data),'inode':info.st_ino,'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid,'bytes':len(data)}
def protected_snapshot(b):
 value=b.outside_snapshot();value[BOT_FILE_KEY]=bot_file_snapshot();return value
def revision(value):
 if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{40}',value):raise GateError('exact_revision_required')
 return value
def target(service,ref):
 if service not in SOURCES:raise GateError('only_api_and_web_candidates_allowed')
 return ('flixify-api' if service=='api' else 'flixify-ops-web')+':whatsapp-only-'+revision(ref)[:12]+'-20261108'
def blob(repo,ref,path):
 revision(ref)
 try:return subprocess.run(['git','-C',str(repo),'show',ref+':'+path],capture_output=True,check=True).stdout
 except (OSError,subprocess.CalledProcessError):raise GateError('reviewed_git_blob_unavailable') from None
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module
def validate_manifest(value):
 if not isinstance(value,dict) or set(value)!={'schemaVersion','sourceImageIds','webFiles','migration'} or value['schemaVersion']!=1 or value['sourceImageIds']!={k:v[1] for k,v in SOURCES.items()}:raise GateError('whatsapp_manifest_identity')
 seen=set()
 for entry in value['webFiles']:
  if set(entry)!={'path','beforeSha256','sha256','bytes'} or entry['path'] not in WEB_PATHS or entry['path'] in seen or type(entry['bytes']) is not int or not 0<entry['bytes']<2*1024**2 or any(not re.fullmatch('[a-f0-9]{64}',str(entry[k])) for k in ('beforeSha256','sha256')):raise GateError('only_two_whatsapp_web_sources_allowed')
  seen.add(entry['path'])
 if seen!=WEB_PATHS or set(value['migration'])!={'path','sha256'} or value['migration']['path']!=MIGRATION or not re.fullmatch('[a-f0-9]{64}',str(value['migration']['sha256'])):raise GateError('reviewed_additive_migration_required')
 return value

@contextlib.contextmanager
def helpers(repo):
 with tempfile.TemporaryDirectory(prefix='flixify-whatsapp-only-helper-') as d:
  root=Path(d)
  for name,digest in PINNED.items():
   data=blob(repo,PHONE_REV,PHONE_PATH+name)
   if sha(data)!=digest:raise GateError('frozen_phone_helper_changed')
   (root/name).write_bytes(data)
  focus=blob(repo,FOCUS_REV,FOCUS_BUILD)
  if sha(focus)!=FOCUS_SHA:raise GateError('frozen_cache_helper_changed')
  (root/'focus-build.py').write_bytes(focus);cache=load('whatsapp_cache_helper',root/'focus-build.py').CACHE_CLEANUP
  r=load('whatsapp_frozen_reader',root/'release.py');b=r.b;b.SOURCES=SOURCES.copy();b.SETTINGS=frozenset();b.target=target;original=b.compiler_script
  def compiler(service,public):
   if service not in SOURCES:raise GateError('only_reviewed_compilers_allowed')
   code=original(service,public);anchor='cp.execFileSync("npm",["run","build","-w","@flixify/contracts"],{stdio:"inherit",env});'
   if code.count(anchor)!=1:raise GateError('frozen_contract_build_anchor_changed')
   return code.replace(anchor,'')+(cache if service=='ops-web' else '')
  def excluded(service,paths):
   allowed=API_PATHS if service=='api' else WEB_PATHS if service=='ops-web' else frozenset()
   if not paths or not set(paths)<=allowed:raise GateError('source_overlay_outside_whatsapp_scope')
   return sorted(set(paths)|{'apps/api/dist' if service=='api' else 'apps/ops-web/.next'})
  b.compiler_script=compiler;b.excluded_paths=excluded
  try:yield r
  except b.GateError as e:raise GateError(str(e)) from None

REGISTRATION_CHECK=r'''async function verifyRegistrationPolicy(base){const blocked=await fetch(base+'/auth/register-anon',{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(10000)});const result=await blocked.json();if(blocked.status!==410||result.reason!=='phone_verification_required'||!blocked.headers.get('cache-control')?.includes('no-store'))throw Error('legacy_signup_not_closed');const login=await fetch(base+'/auth/login-by-code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'TESTEXISTING1234',platform:'web',deviceName:'Offline smoke'}),redirect:'manual',signal:AbortSignal.timeout(10000)});if(login.status!==401)throw Error('existing_code_login_not_accessible');}'''
LIVE_POLICY_CHECK=r'''(async()=>{const base='http://127.0.0.1:4000';const blocked=await fetch(base+'/auth/register-anon',{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(10000)});const result=await blocked.json();if(blocked.status!==410||result.reason!=='phone_verification_required'||!blocked.headers.get('cache-control')?.includes('no-store'))throw Error('legacy_signup_not_closed');const login=await fetch(base+'/auth/login-by-code',{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'manual',signal:AbortSignal.timeout(10000)});if(login.status!==400)throw Error('code_login_validation_not_accessible');const status=await fetch(base+'/auth/phone/status',{redirect:'manual',signal:AbortSignal.timeout(10000)});const value=await status.json();if(status.status!==200||value.enabled!==true||value.nativePhoneLogin!==true)throw Error('phone_login_status');})().catch(()=>process.exit(1));'''
def policy_check(b,container):
 b.command('docker','exec',container,'node','-e',LIVE_POLICY_CHECK,timeout=45)
def smoke_api(b,proof):
 import uuid
 name='flixify-whatsapp-policy-smoke-'+uuid.uuid4().hex[:12];created=False
 try:
  args=['docker','create','--name',name,'--network','none','--memory','512m','--memory-swap','640m','--cpus','1','--pids-limit','128']
  for key,value in {'APP_DEMO_MODE':'true','APP_JWT_SECRET':'fixture-only-'+('a'*40),'REGISTRATION_GUARD_SECRET':'fixture-only-'+('b'*40),'DATABASE_URL':'postgresql://fixture:fixture@127.0.0.1:9/fixture','ADMIN_EMAILS':'fixture@example.invalid','SUPABASE_URL':'https://fixture.invalid','SUPABASE_JWKS_URL':'https://fixture.invalid/jwks','PHONE_AUTH_ENABLED':'false','PHONE_AUTH_LOCAL_ONLY':'false','PHONE_AUTH_ALLOWED_ORIGINS':'https://flixify.vip','STRIPE_BILLING_ENABLED':'false'}.items():args+=['-e',key+'='+value]
  b.command(*args,proof['candidateId']);created=True;b.command('docker','start',name)
  check=REGISTRATION_CHECK+'(async()=>{for(let i=0;i<30;i++){try{await verifyRegistrationPolicy("http://127.0.0.1:4000");return;}catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,250));}}})().catch(()=>process.exit(1));'
  b.command('docker','exec',name,'node','-e',check,timeout=90)
 finally:
  if created:b.command('docker','rm','--force',name)

def verify_web_before(b,entries):
 script=r'''const fs=require('node:fs'),c=require('node:crypto');for(const x of JSON.parse(process.argv[1])){const p='/app/'+x.path,s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==x.beforeSha256)throw Error('actual_web_source_changed');}'''
 b.command('docker','run','--rm','--network','none','--read-only','--memory','256m','--memory-swap','320m','--cpus','1','--pids-limit','128','--entrypoint','node',WEB[1],'-e',script,json.dumps(entries),timeout=90)
def verify_proof(b,proof):
 allowed=API_PATHS if proof.get('service')=='api' else WEB_PATHS if proof.get('service')=='ops-web' else frozenset()
 if not proof.get('sourceHashes') or set(proof['sourceHashes'])!=allowed:raise GateError('exact_api_or_web_patch_set_required')
 return b.verify_candidate(proof)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repo',type=Path);p.add_argument('--revision',required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--work-dir',type=Path,required=True);p.add_argument('--service',choices=('api','ops-web','both'),default='both');p.add_argument('--build',action='store_true');a=p.parse_args();ref=revision(a.revision)
 if a.manifest.read_bytes()!=blob(a.repo,ref,MANIFEST_PATH):raise GateError('manifest_not_exact_committed_bytes')
 manifest=validate_manifest(json.loads(a.manifest.read_text()));patcher=load('whatsapp_actual_api_patcher',HERE/'patch-api.py')
 with helpers(a.repo) as r:
  b=r.b;b.assert_source();outside=protected_snapshot(b)
  if outside[BOT_FILE_KEY]['sha256']!=BOT_SOURCE:raise GateError('exact_live_bot_source_required_before_policy_build')
  with tempfile.TemporaryDirectory(prefix='flixify-whatsapp-payload-') as d:
   payload=Path(d);b.git_payload(a.repo,ref,payload,[x['path'] for x in manifest['webFiles']]+list(patcher.PAYLOAD_PATHS)+[MIGRATION])
   if sha((payload/MIGRATION).read_bytes())!=manifest['migration']['sha256']:raise GateError('migration_digest_differs')
   web={}
   for x in manifest['webFiles']:
    data=b.regular(payload,x['path']).read_bytes()
    if len(data)!=x['bytes'] or sha(data)!=x['sha256']:raise GateError('frozen_web_source_differs')
    web[x['path']]=data
   verify_web_before(b,manifest['webFiles'])
   if not a.build:print(json.dumps({'state':'whatsapp_only_build_preflight_verified','noMutation':True}));return
   b.require_disk();a.work_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
   if a.work_dir.is_symlink() or any(a.work_dir.iterdir()):raise GateError('fresh_build_directory_required')
   stage=a.work_dir/'api-source';b.extract_sources(API[1],stage,sorted(API_PATHS));updates,patchproof=patcher.plan(payload,stage,source_image_id=API[1])
   if set(updates)!=API_PATHS:raise GateError('three_actual_api_edits_required')
   (a.work_dir/'api-overlay-proof.json').write_text(json.dumps(patchproof,indent=2));proofs={}
   if a.service in ('api','both'):proofs['api']=b.candidate('api',ref,updates,a.work_dir,{})
   if a.service in ('ops-web','both'):
    row=b.services()['ops-web'];public={k:v for k,v in (x.split('=',1) for x in row['Config'].get('Env',[])) if k.startswith('NEXT_PUBLIC_') or k in ('PUBLIC_API_BASE_URL','NODE_ENV')};proofs['ops-web']=b.candidate('ops-web',ref,web,a.work_dir,public)
   for name,proof in proofs.items():
    verify_proof(b,proof);b.smoke(proof)
    if name=='api':smoke_api(b,proof)
   if protected_snapshot(b)!=outside:raise GateError('worker_db_bot_or_other_project_changed')
   report={'revision':ref,'candidates':{k:v['candidateId'] for k,v in proofs.items()},'protected':outside};(a.work_dir/'build-proof.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='protected'}))
if __name__=='__main__':
 try:main()
 except Exception as e:print('whatsapp_only_build_stopped:'+str(e) if isinstance(e,GateError) else 'whatsapp_only_build_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
