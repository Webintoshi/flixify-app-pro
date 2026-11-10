#!/usr/bin/env python3
"""WEB-only OTP recovery overlay using pinned source/runtime and metadata guards."""
from __future__ import annotations
import contextlib,hashlib,importlib.util,json,re,stat,subprocess,sys,tempfile
from pathlib import Path

BASE='673e760a3b768c0e369540f426eb1390b839ebec'
BASE_PATH='coolify/releases/2026-11-08-login-focus/'
PINNED={'build.py':'a30f25c413d6841e25b2e0d2a8c263b03af9103e195fd8a410939bf22e4ba9cf','release.py':'be49327917dd832dc4dc4ff02a814fa066e49566b88205695162fdb5e739d068'}
API=('flixify-api:whatsapp-only-438ae41ef672-20261108','sha256:0258811e30bc371074fbe2c3bcd6edebc07109d8f0e950f2a5a118e505b7a38c')
WEB=('flixify-ops-web:whatsapp-only-438ae41ef672-20261108','sha256:6f50c7988e7a0179826915e658954018f66b4b0974571e872c4fd6aa8bb97db7')
MANIFEST_PATH='coolify/releases/2026-11-10-otp-recovery/manifest.json'
APK='apps/ops-web/public/downloads/flixify-pro-android-phone-1.0.1.apk'
APK_URL='/downloads/flixify-pro-android-phone-1.0.1.apk'
APK_SHA='44eab6ddf5d2e79e0f1aab29548bae9ba0ea60297db2a1973de494c50093d84c'
APK_BYTES=1345844
BEFORE={
 'apps/ops-web/lib/api.ts':'18e36dca08c57e3ee62ef4ed1d3c184a995683310d57f3802c0af1b3f4638e33',
 'apps/ops-web/app/giris-onizleme/phone-auth-client.ts':'0824bb3ff509c58559cb08fe835dc934dec006171b2cfed7f0802eafadd8fc6f',
 'apps/ops-web/app/giris-onizleme/phone-login-preview.tsx':'bca03ce931cae946c2db81a92fe208e892ec07255e67ac78993ce6ec8041e41d',
 'apps/ops-web/app/platform/phone-download.ts':'1f146131821f3646f0fa82c04c650b088cba463fb10c5d5718eb3dc237105caf',
 APK:None}
ALLOWED=frozenset(BEFORE)
BOT_SCRIPT=Path('/data/flixify/app/scripts/telegram-panel-bot.mjs')
BOT_SOURCE='7053b1c96b62417f8db532871bfca2d28630ec20c8850566d7d26f2649000d70'
BOT_FILE_KEY='/@flixify-telegram-bot-source'
class GateError(Exception):pass
def sha(data):return hashlib.sha256(data).hexdigest()
def target(service,ref):
 if service!='ops-web' or not isinstance(ref,str) or not re.fullmatch('[a-f0-9]{40}',ref):raise GateError('only_exact_web_revision_allowed')
 return 'flixify-ops-web:otp-recovery-'+ref[:12]+'-20261110'
def blob(repo,path):
 try:return subprocess.run(['git','-C',str(repo),'show',BASE+':'+BASE_PATH+path],check=True,capture_output=True).stdout
 except (OSError,subprocess.CalledProcessError):raise GateError('frozen_otp_helper_unavailable') from None
def validate_manifest(value):
 if not isinstance(value,dict) or set(value)!={'schemaVersion','sourceImageId','files'} or value['schemaVersion']!=1 or value['sourceImageId']!=WEB[1] or not isinstance(value['files'],list):raise GateError('otp_manifest_shape')
 seen=set()
 for item in value['files']:
  if not isinstance(item,dict) or set(item)!={'path','beforeSha256','sha256','bytes'} or item['path'] not in ALLOWED or item['path'] in seen or item['beforeSha256']!=BEFORE[item['path']] or type(item['bytes']) is not int or not 0<item['bytes']<=2*1024**2 or not re.fullmatch('[a-f0-9]{64}',str(item['sha256'])):raise GateError('otp_manifest_exact_scope_or_source')
  if item['path']==APK and (item['sha256']!=APK_SHA or item['bytes']!=APK_BYTES):raise GateError('only_audited_signed_phone_101_allowed')
  seen.add(item['path'])
 if seen!=ALLOWED:raise GateError('all_five_reviewed_otp_web_and_phone_paths_required')
 return value['files']
def bot_snapshot(path=BOT_SCRIPT):
 info=path.lstat()
 if not stat.S_ISREG(info.st_mode) or info.st_size>2*1024**2:raise GateError('regular_bounded_live_bot_required')
 data=path.read_bytes()
 if len(data)!=info.st_size or sha(data)!=BOT_SOURCE:raise GateError('live_bot_source_changed')
 return {'sha256':sha(data),'inode':info.st_ino,'mode':stat.S_IMODE(info.st_mode),'uid':info.st_uid,'gid':info.st_gid,'bytes':len(data)}

HTTP_CHECK=r'''async function verifyPhoneDownload(base,digest,bytes){const crypto=require('node:crypto');const page=await fetch(base+'/indir',{redirect:'manual',signal:AbortSignal.timeout(10000)});if(page.status!==200)throw Error('download_page');const text=await page.text();if(text.length>4*1024*1024||!(text.includes('Flixify hazırlanıyor')||text.includes('id="android-telefon"')))throw Error('download_app_shell');const response=await fetch(base+'/downloads/flixify-pro-android-phone-1.0.1.apk',{redirect:'manual',signal:AbortSignal.timeout(30000)});if(response.status!==200||response.headers.get('content-length')!==String(bytes))throw Error('phone_download_response');const hash=crypto.createHash('sha256');let count=0;for await(const chunk of response.body){count+=chunk.length;if(count>bytes)throw Error('phone_download_budget');hash.update(chunk);}if(count!==bytes||hash.digest('hex')!==digest)throw Error('phone_download_digest');}'''
def http_check(b,container):
 script=HTTP_CHECK+'verifyPhoneDownload("http://127.0.0.1:3000",'+json.dumps(APK_SHA)+','+str(APK_BYTES)+').catch(()=>process.exit(1));'
 b.command('docker','exec',container,'node','-e',script,timeout=60)
def smoke_phone(b,proof):
 import uuid
 name='flixify-otp-phone-smoke-'+uuid.uuid4().hex[:12];created=False
 try:
  b.command('docker','create','--name',name,'--network','none','--memory','512m','--memory-swap','640m','--cpus','1','--pids-limit','128',proof['candidateId']);created=True;b.command('docker','start',name)
  script=HTTP_CHECK+'(async()=>{for(let i=0;i<30;i++){try{await verifyPhoneDownload("http://127.0.0.1:3000",'+json.dumps(APK_SHA)+','+str(APK_BYTES)+');return;}catch(e){if(i===29)throw e;await new Promise(r=>setTimeout(r,250));}}})().catch(()=>process.exit(1));'
  b.command('docker','exec',name,'node','-e',script,timeout=90)
 finally:
  if created:b.command('docker','rm','--force',name)

@contextlib.contextmanager
def profile(repo):
 with tempfile.TemporaryDirectory(prefix='flixify-otp-recovery-helpers-') as d:
  root=Path(d)
  for name,digest in PINNED.items():
   data=blob(repo,name)
   if sha(data)!=digest:raise GateError('frozen_focus_helper_changed')
   if name=='release.py':
    old=b"r.JOURNAL=r.DIRECTORY/'.login-focus-release.json'";new=b"r.JOURNAL=r.DIRECTORY/'.otp-recovery-release.json'"
    if data.count(old)!=1:raise GateError('exact_frozen_journal_anchor_required')
    data=data.replace(old,new)
   (root/name).write_bytes(data)
  spec=importlib.util.spec_from_file_location('otp_recovery_frozen_focus',root/'release.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
  f.c.API=API;f.c.WEB=WEB;f.c.ALLOWED=ALLOWED;f.c.MANIFEST_PATH=MANIFEST_PATH;f.c.target=target;f.c.validate_manifest=validate_manifest
  original_snapshot=f.c.protected_snapshot
  def protected_snapshot(r):
   result=original_snapshot(r);result[BOT_FILE_KEY]=bot_snapshot();return result
  f.c.protected_snapshot=protected_snapshot
  original_helpers=f.c.helpers
  @contextlib.contextmanager
  def current_helpers(repo):
   with original_helpers(repo) as r:
    original_smoke=r.b.smoke
    def smoke(proof):original_smoke(proof);smoke_phone(r.b,proof)
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
 except Exception as e:print('otp_recovery_build_stopped:'+str(e) if isinstance(e,GateError) else 'otp_recovery_build_stopped:'+type(e).__name__,file=sys.stderr);sys.exit(1)
