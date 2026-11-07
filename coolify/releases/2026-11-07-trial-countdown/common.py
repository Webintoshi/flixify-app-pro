"""Fixed runtime pins for the additive trial countdown release."""
from __future__ import annotations
import hashlib
import importlib.util
import json
from pathlib import Path
import re

HERE=Path(__file__).resolve().parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
prior=load('trial_previous_web',HERE.parent/'2026-11-07-tv-box-login/build-web.py')
previous=prior.c
builder,backend,command,GateError=prior.builder,previous.backend,previous.command,previous.GateError
BASE='1a673bc4808ebb50596b4482afb6cb848b8edad7'
SOURCES={
 'api':('flixify-api:qr-device-login-20cad131f98f-20261103','sha256:bdf418ab2906fa1f177511d2e4a483e11fed6cbdba0e1452991512adffd013b1'),
 'ops-web':('flixify-ops-web:tv-box-login-1a673bc4808e-20261107','sha256:2d465dff5b0290ebb6ee0d95016f70515df1c40cf7641a232c4009efb13cbeae')}
API_SERVER_SHA='a827ea38dabf26d41ad153225273bab63acae5017b06ffd2a0d8a4d5de38f401'
SERVER='apps/api/src/server.ts'; HELPER='apps/api/src/trial-countdown.ts'
API_PATHS=(SERVER,HELPER)
TOOLS='coolify/releases/2026-11-07-trial-countdown/'
PATCHES=TOOLS+'api-patches.json'
WEB_MODIFIED=tuple('apps/ops-web/'+p for p in ('app/platform/session.tsx','app/platform/catalog.tsx','app/platform/shell.tsx','app/platform/platform.module.css','app/account/components.tsx','app/ayarlar/page.tsx'))
WEB_NEW=tuple('apps/ops-web/app/platform/'+p for p in ('account-resource.ts','trial-countdown-model.ts','trial-countdown.tsx','trial-countdown.module.css'))
DESCRIPTOR='apps/ops-web/app/platform/tv-download.ts'
WINDOWS_DESCRIPTOR='apps/ops-web/app/platform/windows-download.ts'
APK='apps/ops-web/public/downloads/flixify-pro-1.4.16.apk'
UPDATE='apps/ops-web/public/downloads/flixify-tv-update.json'
WINDOWS_EXE='apps/ops-web/public/downloads/flixify-pro-windows-1.0.4-x64-test-setup.exe'
WINDOWS_BYTES=70367451
WINDOWS_SHA='ccd82397fc41ed54903cca0fe2febc51f5ab775cd1fff110dd5d91883914d0a0'
WINDOWS_REVISION='e9e67d34bc577adb6f4fbc234513b4ff04b37650'
WINDOWS_TREE='2ed6ef1aabe042b0c7c98b72b5f8c4522cdadbdf'
WINDOWS_ZIP_SHA='52937fae9032b99ad02cee3a7a840c2f64801531917a039043b56d462b072b41'
WINDOWS_ZIP_BYTES=187961560
GIT_WEB_PATHS=(*WEB_MODIFIED,*WEB_NEW,DESCRIPTOR,APK,UPDATE,WINDOWS_DESCRIPTOR)
WEB_PATHS=(*GIT_WEB_PATHS,WINDOWS_EXE)
WORKER,DB=previous.WORKER,previous.DB
ENV_SHA,FENCE_SHA=previous.ENV_SHA,previous.FENCE_SHA
RESERVE=1024**3
def sha(value):return hashlib.sha256(value).hexdigest()
def revision(value):
    if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{40}',value):raise GateError('exact_revision_required')
    return value
def target(service,ref):
    if service not in SOURCES:raise GateError('only_api_and_web_allowed')
    return ('flixify-api' if service=='api' else 'flixify-ops-web')+':trial-countdown-'+revision(ref)[:12]+'-20261107'
def blob(repo,ref,path,maximum=4*1024**2):return prior.bounded_blob(repo,ref,path,maximum)
def patch_server(original,recipe):
    if (not isinstance(recipe,dict) or set(recipe)!={'path','sourceSha256','replacements'}
        or recipe['path']!=SERVER or recipe['sourceSha256']!=API_SERVER_SHA or sha(original)!=API_SERVER_SHA):
        raise GateError('actual_runtime_api_source_pin_differs')
    edits=recipe['replacements']; first='import path from "node:path";'
    imported='import { withTrialCountdown } from "./trial-countdown.js";\n'+first
    if not isinstance(edits,list) or len(edits)!=2 or edits[0]!={'old':first,'new':imported}:
        raise GateError('only_reviewed_import_and_me_edits_allowed')
    anchor=b'  app.get("/me", async (request, reply) => {'
    if original.count(anchor)!=1:raise GateError('unique_me_route_required')
    start=original.index(anchor);end=original.find(b'\n\n  app.',start)
    if end<0 or not original[end:].startswith(b"\n\n  app.get('/me/referrals'"):
        raise GateError('existing_referrals_boundary_changed')
    spans=[]
    for index,row in enumerate(edits):
        if not isinstance(row,dict) or set(row)!={'old','new'} or not all(isinstance(row[k],str) and 1<=len(row[k].encode())<=65536 and '\x00' not in row[k] for k in row):raise GateError('reviewed_edit_shape_invalid')
        old,new=row['old'].encode(),row['new'].encode()
        if old==new or original.count(old)!=1:raise GateError('patch_anchor_not_unique')
        offset=original.index(old)
        if index==1 and (offset!=start or offset+len(old)!=end or b'withTrialCountdown(' not in new
          or new.count(b'getAccessHistory(auth.userId)')!=old.count(b'getAccessHistory(auth.userId)')):
            raise GateError('patch_outside_complete_existing_me_route')
        spans.append((offset,offset+len(old),new))
    spans.sort()
    if spans[0][1]>spans[1][0]:raise GateError('patch_anchors_overlap')
    updated=original
    for a,b,new in reversed(spans):updated=updated[:a]+new+updated[b:]
    return updated

def current_source(service):
    tag,identity=SOURCES[service]
    base=backend.core.image(identity)
    if base['Id']!=identity or backend.core.image(tag)['Id']!=identity:raise GateError('source_tag_or_image_drift')
    row=json.loads(command('docker','inspect',service+'-'+builder.UUID))[0]
    if (row['Image']!=identity or row['Config']['Image']!=tag or not row['State']['Running']
      or (row['Config'].get('Labels') or {}).get('com.docker.compose.project')!=builder.UUID):raise GateError('running_source_drift')
    return base,row

def protected(changed=()):
    state=previous.current_host_snapshot()
    if state['environment']!=ENV_SHA or state['registrationFence']!=FENCE_SHA:raise GateError('environment_or_registration_fence_drift')
    for name,(tag,identity) in {'worker':WORKER,'db':('postgres:16-alpine',DB)}.items():
        rows=json.loads(command('docker','inspect',name+'-'+builder.UUID));row=rows[0]
        if len(rows)!=1 or row['Image']!=identity or row['Config']['Image']!=tag or not row['State']['Running'] or (row['State'].get('Health') or {}).get('Status')=='unhealthy':raise GateError('worker_or_database_drift')
    excluded={'/'+name+'-'+builder.UUID for name in changed}
    return {key:value for key,value in state.items() if not isinstance(value,dict) or value.get('name') not in excluded}

def require_disk(workspace=256*1024**2):
    import shutil
    if shutil.disk_usage('/var/lib/docker').free<RESERVE+workspace:raise GateError('requires_host_reserve_and_bounded_workspace_no_pruning')

def native_proof(data):
    value=previous.unique_json(data)
    fixed={'schemaVersion':1,'packageName':'vip.flixify.tv','versionName':'1.4.16','versionCode':24,'minSdk':23,'targetSdk':35,'signerSha256':previous.SIGNER}
    if (not isinstance(value,dict) or set(value)!=set(fixed)|{'nativeRevision','nativeTree','apkSha256','apkBytes','checks'}
      or any(type(value.get(k)) is not type(v) or value[k]!=v for k,v in fixed.items())):raise GateError('verified_1416_native_proof_required')
    for field in ('nativeRevision','nativeTree'):revision(value[field])
    if not isinstance(value['apkSha256'],str) or not re.fullmatch('[a-f0-9]{64}',value['apkSha256']) or type(value['apkBytes']) is not int or not 1024<=value['apkBytes']<=32*1024**2:raise GateError('native_binary_pin_invalid')
    checks=value['checks']
    if not isinstance(checks,dict) or set(checks)!={'releaseBuild','releaseLint','unitTests','instrumentationTests'} or any(type(v) is not bool or v is not True for v in checks.values()):raise GateError('native_checks_not_verified')
    return value

def manifest(data,native):
    value=previous.unique_json(data)
    expected={'packageName':'vip.flixify.tv','versionName':'1.4.16','versionCode':24,'minSdk':23,'apkUrl':'https://flixify.vip/downloads/flixify-pro-1.4.16.apk','sha256':native['apkSha256'],'sizeBytes':native['apkBytes']}
    if not isinstance(value,dict) or set(value)!=set(expected)|{'notes'} or any(type(value.get(k)) is not type(v) or value[k]!=v for k,v in expected.items()):raise GateError('native_updater_manifest_differs')
    if not isinstance(value['notes'],str) or len(value['notes'])>2048 or re.search(r'[\x00-\x09\x0b-\x1f\x7f-\x9f]',value['notes']):raise GateError('native_updater_notes_invalid')
    return value

def windows_proof(data):
    value=previous.unique_json(data)
    fixed={'schemaVersion':1,'versionName':'1.0.4','architecture':'x64','distribution':'unsigned TEST',
      'nativeRevision':WINDOWS_REVISION,'nativeTree':WINDOWS_TREE,'ciRunId':42371335948,'artifactId':13573554970,
      'artifactZipSha256':WINDOWS_ZIP_SHA,'artifactZipBytes':WINDOWS_ZIP_BYTES,'installerSha256':WINDOWS_SHA,'installerBytes':WINDOWS_BYTES,
      'checks':{'ciBuild':True,'installSmoke':True,'privacyScan':True}}
    if (not isinstance(value,dict) or set(value)!=set(fixed) or any(type(value.get(k)) is not type(v) or value[k]!=v for k,v in fixed.items())
      or any(type(v) is not bool or v is not True for v in value['checks'].values())):raise GateError('accepted_windows_ci_artifact_proof_required')
    return value

def windows_installer(path,proof):
    import stat
    if proof['installerSha256']!=WINDOWS_SHA or proof['installerBytes']!=WINDOWS_BYTES:raise GateError('accepted_windows_artifact_pin_required')
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size!=WINDOWS_BYTES:raise GateError('exact_external_windows_installer_required')
    digest=hashlib.sha256();chunks=[]
    with path.open('rb') as source:
        while True:
            chunk=source.read(1024**2)
            if not chunk:break
            digest.update(chunk);chunks.append(chunk)
    if digest.hexdigest()!=proof['installerSha256']:raise GateError('accepted_windows_installer_hash_differs')
    data=b''.join(chunks)
    if len(data)!=WINDOWS_BYTES:raise GateError('windows_installer_size_differs')
    windows_pe(data[:65536],len(data))
    return data

def windows_pe(header,size):
    if len(header)<64 or not header.startswith(b'MZ'):raise GateError('windows_installer_magic_differs')
    offset=int.from_bytes(header[60:64],'little')
    if not 64<=offset<=min(size-4,len(header)-4) or header[offset:offset+4]!=b'PE\x00\x00':raise GateError('windows_installer_pe_header_invalid')

def web_budget(next_bytes,overlay_bytes,native):
    binary=WINDOWS_BYTES+native['apkBytes']
    if type(next_bytes) is not int or not 1<=next_bytes<=64*1024**2 or type(overlay_bytes) is not int or not binary<=overlay_bytes<=binary+2*1024**2:raise GateError('fixed_windows_apk_and_ui_overlay_budget_differs')
    workspace=max(256*1024**2,4*(next_bytes+overlay_bytes))
    return {'hostReserveBytes':RESERVE,'workspaceBytes':workspace,'requiredFreeBytes':RESERVE+workspace}

_expected_public=previous.expected_public
def expected_public(original,native,update):
    rows=_expected_public(original,native,update)
    name=WINDOWS_EXE.removeprefix('apps/ops-web/public/')
    if any(row[1]==name for row in rows):raise GateError('new_windows_installer_already_exists')
    return previous.public_rows(json.dumps([*rows,['file',name,0o644,WINDOWS_BYTES,WINDOWS_SHA]]).encode())

_client_check=prior.client_download_verification
_download_script=prior.download_script
def client_download_verification():
    script=_client_check().replace('1.4.15','1.4.16')
    windows=r'''
function currentWindowsDescriptor(source) {
  for (const object of source.matchAll(/\{[^{}]{1,2048}\}/g)) {
    const fields = new Map(); let duplicate = false;
    for (const field of object[0].matchAll(/[,{]\s*["']?(href|filename|version|sha256)["']?\s*:\s*["']([^"'\\]*)["']\s*(?=,|})/g)) {
      if (fields.has(field[1])) duplicate = true;
      fields.set(field[1], field[2]);
    }
    if (!duplicate && fields.get("href") === "/downloads/flixify-pro-windows-1.0.4-x64-test-setup.exe"
      && fields.get("filename") === "flixify-pro-windows-1.0.4-x64-test-setup.exe" && fields.get("version") === "1.0.4"
      && fields.get("sha256") === "ccd82397fc41ed54903cca0fe2febc51f5ab775cd1fff110dd5d91883914d0a0") return true;
  }
  return false;
}
'''
    for old,new in (
      ('let total = 0, matched = false;','let total = 0, matched = false, matchedWindows = false;'),
      ('if (currentDownloadDescriptor(source)) matched = true;','if (currentDownloadDescriptor(source)) matched = true; if (currentWindowsDescriptor(source)) matchedWindows = true;'),
      ('if (!matched) throw Error("download_page_version");','if (!matched || !matchedWindows) throw Error("download_page_version");')):
        if script.count(old)!=1:raise GateError('client_verifier_anchor_changed')
        script=script.replace(old,new)
    return windows+script

def download_script(native,manifest):
    script=_download_script(native,manifest)
    anchor='for(const p of ["/","/indir","/paketler","/cihaz","/giris-yap"])'
    if script.count(anchor)!=1:raise GateError('download_verifier_anchor_changed')
    windows=r'''
const wp="/downloads/flixify-pro-windows-1.0.4-x64-test-setup.exe", wn=70367451;
const wh=await fetch(root+wp,{method:"HEAD",redirect:"manual",signal:AbortSignal.timeout(10000)});
const wm=wh.headers.get("content-type")?.split(";")[0].trim();
if(wh.status!==200||Number(wh.headers.get("content-length"))!==wn||!["application/vnd.microsoft.portable-executable","application/x-msdownload","application/x-msdos-program","application/x-dosexec","application/octet-stream"].includes(wm))throw Error("windows_head");
const wr=await fetch(root+wp,{headers:{Range:"bytes=0-31"},redirect:"manual",signal:AbortSignal.timeout(10000)});
if(wr.status!==206||wr.headers.get("content-range")!=="bytes 0-31/"+wn)throw Error("windows_range");await bytes(wr,32);
const wf=await fetch(root+wp,{redirect:"manual",signal:AbortSignal.timeout(30000)});
if(wf.status!==200||Number(wf.headers.get("content-length"))!==wn)throw Error("windows_get");
const wd=crypto.createHash("sha256");let ws=0,wb=Buffer.alloc(0);
for await(const chunk of wf.body){ws+=chunk.length;if(ws>wn)throw Error("windows_oversize");wd.update(chunk);if(wb.length<65536)wb=Buffer.concat([wb,chunk.subarray(0,65536-wb.length)])}
if(ws!==wn||wd.digest("hex")!=="ccd82397fc41ed54903cca0fe2febc51f5ab775cd1fff110dd5d91883914d0a0"||wb.length<64||wb.toString("ascii",0,2)!=="MZ")throw Error("windows_digest_or_magic");
const pe=wb.readUInt32LE(60);if(pe<64||pe>wb.length-4||!wb.subarray(pe,pe+4).equals(Buffer.from([80,69,0,0])))throw Error("windows_pe");
'''
    return script.replace(anchor,windows+anchor)
_base_command=command
_api_owned=set();_api_watches={}
def bounded_command(*args,**kwargs):
    args=list(args)
    owned_create=None
    if args[:2]==['docker','create']:
        if '--network' not in args or args[args.index('--network')+1]!='none':raise GateError('offline_compiler_required')
        if '--cpus' not in args:args[2:2]=['--cpus','1']
        if '--pids-limit' in args:args[args.index('--pids-limit')+1]='128'
        if args[-2]=='-e':args[-1]=args[-1].replace('BigInt(pids)>256n','BigInt(pids)>128n')
        if '--name' in args:
            name=args[args.index('--name')+1]
            if re.fullmatch('flixify-packages-api-build-[a-f0-9]{12}',name):owned_create=name
    removing=args[:2]==['docker','rm'] and args[-1] in _api_owned
    try:
        result=_base_command(*args,**kwargs)
        if owned_create:_api_owned.add(owned_create)
        if args[:2]==['docker','start'] and args[-1] in _api_owned:
            watch=prior.DiskWatch(args[-1]);watch.__enter__();_api_watches[args[-1]]=watch
        return result
    finally:
        if removing:
            watch=_api_watches.pop(args[-1],None);_api_owned.discard(args[-1])
            if watch:watch.__exit__(None,None,None)

def configure_api():
    backend.configuration=lambda service:{'tag':SOURCES['api'][0],'id':SOURCES['api'][1],'paths':API_PATHS,'new':(HELPER,),'dist':'apps/api/dist','entry':'server.js'} if service=='api' else (_ for _ in ()).throw(GateError('api_only'))
    backend.target=lambda service,ref:target('api',ref)
    backend.command=bounded_command
    def compile_script(service,expected_dist=None):
        script=('const capFs=require("node:fs");const cpu=capFs.readFileSync("/sys/fs/cgroup/cpu.max","utf8").trim().split(/\\s+/);'
          'const pids=capFs.readFileSync("/sys/fs/cgroup/pids.max","utf8").trim();'
          'if(cpu.length!==2||!cpu.every(x=>/^\\d+$/.test(x))||BigInt(cpu[0])<=0n||BigInt(cpu[0])>BigInt(cpu[1])||!/^\\d+$/.test(pids)||BigInt(pids)>128n)throw Error("compiler_caps");'
          +backend.legacy.cgroup()+'cp.execFileSync("npm",["run","build","-w","@flixify/api"],{stdio:"inherit"});')
        if expected_dist is not None:
            script+=backend.legacy.snapshot_function()+"const baseline=snapshot('/app/apps/api/dist');"
            script+='if(baseline.sha256!=='+json.dumps(expected_dist['sha256'])+'||baseline.files!=='+str(expected_dist['files'])+')throw Error("baseline_source_dist_mismatch");'
        return script
    backend.compile_script=compile_script

def configure_web():
    previous.SOURCE_TAG,previous.SOURCE_ID,previous.BASE=SOURCES['ops-web'][0],SOURCES['ops-web'][1],BASE
    previous.target=lambda ref:target('ops-web',ref)
    previous.DESCRIPTOR,previous.APK,previous.UPDATE_MANIFEST=DESCRIPTOR,APK,UPDATE
    previous.APK_URL='https://flixify.vip/downloads/flixify-pro-1.4.16.apk'
    previous.OVERLAY=WEB_PATHS;previous.parse_manifest=manifest;previous.expected_public=expected_public
    previous.mac.SOURCE_ID,previous.mac.SOURCE_TAG=SOURCES['ops-web'][1],SOURCES['ops-web'][0]
    builder.SOURCE_ID,builder.SOURCE_TAG,builder.BASE_REVISION=SOURCES['ops-web'][1],SOURCES['ops-web'][0],BASE
    builder.PATHS,builder.NEW_PATHS,builder.target=(*WEB_MODIFIED,*WEB_NEW,DESCRIPTOR,WINDOWS_DESCRIPTOR),WEB_NEW,previous.target
    previous.web.EXCLUDED=(*WEB_PATHS,'apps/ops-web/.next')
    prior.command=bounded_command
    prior.client_download_verification=client_download_verification;prior.download_script=download_script
