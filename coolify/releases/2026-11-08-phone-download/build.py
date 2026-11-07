#!/usr/bin/env python3
"""Publish only the audited Android phone APK and its website download links."""
from __future__ import annotations
import contextlib, hashlib, importlib.util, json, re, subprocess, sys, tempfile
from pathlib import Path

BASE='673e760a3b768c0e369540f426eb1390b839ebec'
BASE_PATH='coolify/releases/2026-11-08-login-focus/'
PINNED={'build.py':'a30f25c413d6841e25b2e0d2a8c263b03af9103e195fd8a410939bf22e4ba9cf','release.py':'be49327917dd832dc4dc4ff02a814fa066e49566b88205695162fdb5e739d068'}
WEB=('flixify-ops-web:login-focus-673e760a3b76-20261108','sha256:b9f0545c933733b1b13bd1a6f4656aa4981dc66de1e214669389d3523aa7bde9')
MANIFEST_PATH='coolify/releases/2026-11-08-phone-download/manifest.json'
APK='apps/ops-web/public/downloads/flixify-pro-android-phone-1.0.0.apk'
APK_URL='/downloads/flixify-pro-android-phone-1.0.0.apk'
APK_SHA='cef2e7a2a904e1182708680feabe44550dc14012bc854b033f82b2e9a2c73899'
APK_BYTES=1345139
DESCRIPTOR='apps/ops-web/app/platform/phone-download.ts'
NEW=frozenset((APK,DESCRIPTOR))
ALLOWED=NEW|frozenset(('apps/ops-web/app/indir/page.tsx','apps/ops-web/app/platform/analytics.ts','apps/ops-web/app/platform/analytics-policy.ts','apps/ops-web/app/platform/shell.tsx'))
class GateError(Exception):pass
def sha(value):return hashlib.sha256(value).hexdigest()
def target(service,ref):
 if service!='ops-web' or not re.fullmatch('[a-f0-9]{40}',ref):raise GateError('only_exact_web_revision_allowed')
 return 'flixify-ops-web:phone-download-'+ref[:12]+'-20261108'
def blob(repo,path):
 try:return subprocess.run(['git','-C',str(repo),'show',BASE+':'+BASE_PATH+path],check=True,capture_output=True).stdout
 except (OSError,subprocess.CalledProcessError):raise GateError('frozen_publication_helper_missing') from None
def validate_manifest(value):
 if not isinstance(value,dict) or set(value)!={'schemaVersion','sourceImageId','files'} or value['schemaVersion']!=1 or value['sourceImageId']!=WEB[1] or not isinstance(value['files'],list):raise GateError('phone_manifest_shape')
 seen=set()
 for item in value['files']:
  if not isinstance(item,dict) or set(item)!={'path','beforeSha256','sha256','bytes'} or item['path'] not in ALLOWED or item['path'] in seen or type(item['bytes']) is not int or not 0<item['bytes']<=2*1024**2 or not re.fullmatch('[a-f0-9]{64}',str(item['sha256'])):raise GateError('phone_manifest_scope')
  if item['path'] in NEW:
   if item['beforeSha256'] is not None:raise GateError('new_phone_download_paths_must_be_absent')
  elif not re.fullmatch('[a-f0-9]{64}',str(item['beforeSha256'])):raise GateError('existing_download_source_pin_required')
  if item['path']==APK and (item['bytes']!=APK_BYTES or item['sha256']!=APK_SHA):raise GateError('only_audited_phone_apk_allowed')
  seen.add(item['path'])
 if seen!=ALLOWED:raise GateError('all_six_reviewed_phone_paths_required')
 return value['files']

HTTP_CHECK=r'''async function verifyPhoneDownload(base,digest,bytes){const crypto=require('node:crypto');const page=await fetch(base+'/indir',{redirect:'manual',signal:AbortSignal.timeout(10000)});if(page.status!==200)throw Error('download_page');const text=await page.text();if(text.length>4*1024*1024||!(text.includes('Flixify hazırlanıyor')||text.includes('id="android-telefon"')))throw Error('download_app_shell');const response=await fetch(base+'/downloads/flixify-pro-android-phone-1.0.0.apk',{redirect:'manual',signal:AbortSignal.timeout(30000)});if(response.status!==200||response.headers.get('content-length')!==String(bytes))throw Error('phone_download_response');const hash=crypto.createHash('sha256');let count=0;for await(const chunk of response.body){count+=chunk.length;if(count>bytes)throw Error('phone_download_budget');hash.update(chunk);}if(count!==bytes||hash.digest('hex')!==digest)throw Error('phone_download_digest');}'''
def http_check(b,container):
 script=HTTP_CHECK+'verifyPhoneDownload("http://127.0.0.1:3000",'+json.dumps(APK_SHA)+','+str(APK_BYTES)+').catch(()=>process.exit(1));'
 b.command('docker','exec',container,'node','-e',script,timeout=60)
def smoke_apk(b,proof):
 import uuid
 name='flixify-phone-download-smoke-'+uuid.uuid4().hex[:12];created=False
 try:
  b.command('docker','create','--name',name,'--network','none','--memory','512m','--memory-swap','640m','--cpus','1','--pids-limit','128',proof['candidateId']);created=True;b.command('docker','start',name)
  script=HTTP_CHECK+'(async()=>{for(let attempt=0;attempt<30;attempt++){try{await verifyPhoneDownload("http://127.0.0.1:3000",'+json.dumps(APK_SHA)+','+str(APK_BYTES)+');return;}catch(e){if(attempt===29)throw e;await new Promise(r=>setTimeout(r,250));}}})().catch(()=>process.exit(1));'
  b.command('docker','exec',name,'node','-e',script,timeout=90)
 finally:
  if created:b.command('docker','rm','--force',name)

@contextlib.contextmanager
def profile(repo):
 with tempfile.TemporaryDirectory(prefix='flixify-phone-download-helpers-') as d:
  root=Path(d)
  for name,digest in PINNED.items():
   data=blob(repo,name)
   if sha(data)!=digest:raise GateError('frozen_focus_helper_digest_differs')
   if name=='release.py':
    old=b"r.JOURNAL=r.DIRECTORY/'.login-focus-release.json'";new=b"r.JOURNAL=r.DIRECTORY/'.phone-download-release.json'"
    if data.count(old)!=1:raise GateError('exact_focus_journal_anchor_required')
    data=data.replace(old,new)
   (root/name).write_bytes(data)
  spec=importlib.util.spec_from_file_location('phone_download_frozen_focus',root/'release.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
  f.c.WEB=WEB;f.c.ALLOWED=ALLOWED;f.c.MANIFEST_PATH=MANIFEST_PATH;f.c.target=target;f.c.validate_manifest=validate_manifest
  original_helpers=f.c.helpers
  @contextlib.contextmanager
  def current_helpers(repo):
   with original_helpers(repo) as r:
    original_smoke=r.b.smoke
    def smoke(proof):original_smoke(proof);smoke_apk(r.b,proof)
    r.b.smoke=smoke;yield r
  f.c.helpers=current_helpers
  original_recreate=f.guarded_recreate
  def recreate(r,proof,journal,tag,identity):
   original_recreate(r,proof,journal,tag,identity)
   if identity!=WEB[1]:http_check(r.b,'ops-web-'+r.b.UUID)
  f.guarded_recreate=recreate
  try:yield f
  except f.c.GateError as e:raise GateError(str(e)) from None

def main():
 if len(sys.argv)<2:raise GateError('server_checkout_argument_required')
 with profile(Path(sys.argv[1])) as f:f.c.main()
if __name__=='__main__':
 try:main()
 except Exception as e:print('phone_download_build_stopped:'+str(e) if isinstance(e,GateError) else 'phone_download_build_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
