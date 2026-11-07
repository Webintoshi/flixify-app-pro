#!/usr/bin/env python3
"""Current-image WEB-only login focus/OTP overlay; default is read-only."""
from __future__ import annotations
import argparse, contextlib, hashlib, importlib.util, json, re, subprocess, sys, tempfile
from pathlib import Path

BASE_REVISION='88f27a175567e5be7295763f8a74044da55b2caa'
BASE_PATH='coolify/releases/2026-11-07-phone-login/'
MANIFEST_PATH='coolify/releases/2026-11-08-login-focus/manifest.json'
BASE_HASHES={'build-release.py':'bfa6b6422e14af464efa63f2f1cbfc3d8db294c0a6768dc68b7f06f1bc215e47','release.py':'a1db916baa770ee9c74214563f2580ce195b0bdb0d12eda0de80af2a50042940'}
API=('flixify-api:phone-login-4e538f819b10-20261107','sha256:44ff3909282231848200aab83adad8ce8e9ad2da76ed28e16deb417efe609442')
WEB=('flixify-ops-web:phone-login-4e538f819b10-20261107','sha256:70af89614cf16ea1076fe0d8065f2f3e2947a0a8255d541719786737445080d9')
PREFIX='apps/ops-web/app/giris-onizleme/'
ALLOWED=frozenset(PREFIX+n for n in ('phone-login-preview.tsx','segmented-otp-input.tsx','segmented-otp-input.module.css','phone-login-cinematic.module.css','phone-country-select.module.css'))
class GateError(Exception):pass
def sha(data):return hashlib.sha256(data).hexdigest()
def revision(value):
 if not re.fullmatch('[a-f0-9]{40}',value):raise GateError('exact_revision_required')
 return value
def target(service,ref):
 if service!='ops-web':raise GateError('only_web_target_allowed')
 return 'flixify-ops-web:login-focus-'+revision(ref)[:12]+'-20261108'
def git_blob(repo,ref,path):
 revision(ref)
 try:return subprocess.run(['git','-C',str(repo),'show',ref+':'+path],check=True,capture_output=True).stdout
 except (OSError,subprocess.CalledProcessError):raise GateError('reviewed_committed_blob_unavailable') from None

@contextlib.contextmanager
def helpers(repo):
 with tempfile.TemporaryDirectory(prefix='flixify-focus-helpers-') as d:
  root=Path(d)
  for name,digest in BASE_HASHES.items():
   data=git_blob(repo,BASE_REVISION,BASE_PATH+name)
   if sha(data)!=digest:raise GateError('frozen_helper_digest_differs')
   (root/name).write_bytes(data)
  spec=importlib.util.spec_from_file_location('focus_frozen_phone_reader',root/'release.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
  b=r.b;b.SOURCES={'api':API,'ops-web':WEB};b.SETTINGS=frozenset();b.target=target
  def excluded(service,paths):
   if service!='ops-web' or not set(paths)<=ALLOWED:raise GateError('web_overlay_outside_login_scope')
   return sorted(set(paths)|{'apps/ops-web/.next'})
  compiler=b.compiler_script
  def web_compiler(service,public):
   if service!='ops-web':raise GateError('only_web_compiler_allowed')
   code=compiler(service,public);contracts='cp.execFileSync("npm",["run","build","-w","@flixify/contracts"],{stdio:"inherit",env});'
   if code.count(contracts)!=1:raise GateError('frozen_contract_build_anchor_differs')
   return code.replace(contracts,'')
  b.excluded_paths=excluded;b.compiler_script=web_compiler
  try:yield r
  except b.GateError as e:raise GateError(str(e)) from None

def validate_manifest(value):
 if not isinstance(value,dict) or set(value)!={'schemaVersion','sourceImageId','files'} or value['schemaVersion']!=1 or value['sourceImageId']!=WEB[1] or not isinstance(value['files'],list) or not 1<=len(value['files'])<=len(ALLOWED):raise GateError('login_manifest_shape')
 seen=set()
 for item in value['files']:
  if not isinstance(item,dict) or set(item)!={'path','beforeSha256','sha256','bytes'} or item['path'] not in ALLOWED or item['path'] in seen or type(item['bytes']) is not int or not 0<item['bytes']<=2*1024**2 or not re.fullmatch('[a-f0-9]{64}',str(item['sha256'])):raise GateError('login_manifest_file_scope_or_shape')
  if item['beforeSha256'] is not None and not re.fullmatch('[a-f0-9]{64}',str(item['beforeSha256'])):raise GateError('login_manifest_source_hash')
  if item['beforeSha256'] is None and not item['path'].startswith(PREFIX+'segmented-otp-input.'):raise GateError('only_segmented_otp_files_may_be_new')
  seen.add(item['path'])
 return value['files']

def protected_snapshot(r):
 b=r.b;result=b.outside_snapshot();api=b.services(allow_changed_stopped=True)['api']
 if not api['State']['Running'] or (api['Config']['Image'],api['Image'])!=API:raise GateError('current_api_must_remain_running_and_unchanged')
 result[api['Name']]={'id':api['Id'],'image':api['Image'],'config':sha(json.dumps(api['Config'],sort_keys=True).encode()),'hostConfig':sha(json.dumps(api['HostConfig'],sort_keys=True).encode()),'mounts':sha(json.dumps(api['Mounts'],sort_keys=True).encode()),'networks':sha(json.dumps(api['NetworkSettings'].get('Networks',{}),sort_keys=True).encode()),'startedAt':api['State']['StartedAt'],'running':api['State']['Running'],'paused':api['State']['Paused'],'restartCount':api['RestartCount']}
 return result

def verify_source_files(b,entries):
 expected={x['path']:x['beforeSha256'] for x in entries}
 script=r'''const fs=require('node:fs'),c=require('node:crypto'),expected=JSON.parse(process.argv[1]);for(const[p,h]of Object.entries(expected)){try{const s=fs.lstatSync('/app/'+p);if(h===null||!s.isFile()||s.isSymbolicLink()||c.createHash('sha256').update(fs.readFileSync('/app/'+p)).digest('hex')!==h)throw Error('source')}catch(e){if(e.code!=='ENOENT'||h!==null)throw e;}}console.log(JSON.stringify({sourceFilesVerified:true}));'''
 result=json.loads(b.command('docker','run','--rm','--network','none','--read-only','--memory','256m','--memory-swap','320m','--cpus','1','--pids-limit','128','--entrypoint','node',WEB[1],'-e',script,json.dumps(expected),timeout=120))
 if result!={'sourceFilesVerified':True}:raise GateError('actual_login_source_files_differ')

def validate_proof(b,proof):
 if proof.get('service')!='ops-web' or not proof.get('sourceHashes') or set(proof.get('sourceHashes',{}))-ALLOWED:raise GateError('only_login_web_candidate_allowed')
 return b.verify_candidate(proof)

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('repo',type=Path);p.add_argument('--revision',required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--work-dir',type=Path,required=True);p.add_argument('--build',action='store_true');a=p.parse_args();ref=revision(a.revision)
 if a.manifest.read_bytes()!=git_blob(a.repo,ref,MANIFEST_PATH):raise GateError('manifest_must_match_exact_reviewed_commit')
 entries=validate_manifest(json.loads(a.manifest.read_text()))
 with helpers(a.repo) as r:
  b=r.b;b.assert_source();outside=protected_snapshot(r);updates={}
  with tempfile.TemporaryDirectory(prefix='flixify-focus-payload-') as d:
   payload=Path(d);b.git_payload(a.repo,ref,payload,[x['path'] for x in entries])
   for item in entries:
    data=b.regular(payload,item['path'],2*1024**2).read_bytes()
    if len(data)!=item['bytes'] or sha(data)!=item['sha256']:raise GateError('committed_login_payload_differs')
    updates[item['path']]=data
   verify_source_files(b,entries)
   if not a.build:print(json.dumps({'state':'login_focus_preflight_verified','files':len(updates),'noMutation':True}));return
   b.require_disk();a.work_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
   if a.work_dir.is_symlink() or any(a.work_dir.iterdir()):raise GateError('fresh_private_build_directory_required')
   current=b.services()['ops-web'];public={k:v for k,v in (x.split('=',1) for x in current['Config'].get('Env',[])) if k.startswith('NEXT_PUBLIC_') or k in ('PUBLIC_API_BASE_URL','NODE_ENV')}
   proof=b.candidate('ops-web',ref,updates,a.work_dir,public);validate_proof(b,proof);b.smoke(proof)
   if protected_snapshot(r)!=outside:raise GateError('api_or_other_protected_container_changed')
   report={'schemaVersion':1,'revision':ref,'candidateId':proof['candidateId'],'manifestSha256':sha(a.manifest.read_bytes()),'protected':outside,'changedServices':['ops-web']};(a.work_dir/'build-proof.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='protected'}))

if __name__=='__main__':
 try:main()
 except Exception as e:print('login_focus_build_stopped:'+str(e) if isinstance(e,GateError) else 'login_focus_build_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
