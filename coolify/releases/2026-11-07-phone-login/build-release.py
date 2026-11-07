#!/usr/bin/env python3
"""Pinned API/web overlays. Default preflight is read-only; --build creates local images only."""
from __future__ import annotations
import argparse, base64, hashlib, importlib.util, io, json, os, re, shutil, stat, subprocess, sys, tarfile, tempfile, urllib.request, uuid
from pathlib import Path, PurePosixPath

HERE=Path(__file__).resolve().parent
UUID='eupquokyj7qegufqvqkjmuyr'
SOURCES={
 'api':('flixify-api:trial-countdown-2522149cfda9-20261107','sha256:66805232ca883cbd6385c38341d21b4be0b9fc436b5718cc2b8e20d4398de4fb'),
 'ops-web':('flixify-ops-web:trial-countdown-2522149cfda9-20261107','sha256:456b47b777683b67cc1e74d8f3cfd93d6df382f28cad273c6aabe958b6900e33')}
WORKER=('flixify-worker:packages-8fa66d103053-20261101','sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57')
DB=('postgres:16-alpine','sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea')
MIN_FREE=8*1024**3
MIGRATIONS=('supabase/migrations/202611070001_phone_auth_local_preview.sql','supabase/migrations/202611070002_remembered_device_sessions.sql')
BACKFILL='scripts/sql/remembered-device-sessions-after-api-cutover.sql'
SETTINGS=frozenset(('PHONE_AUTH_ENABLED','PHONE_AUTH_LOCAL_ONLY','PHONE_AUTH_ALLOWED_ORIGINS','PHONE_AUTH_SECRET','PHONE_AUTH_PROVIDER_DIAGNOSTICS','VATANSMS_WHATSAPP_API_KEY','VATANSMS_WHATSAPP_REG_ID','VATANSMS_WHATSAPP_BASE_URL'))
WEB_RUNTIME=tuple('apps/ops-web/'+x for x in (
 'app/giris-yap/page.tsx','app/kayit-ol/page.tsx','app/giris-onizleme/page.tsx','app/giris-onizleme/phone-login-preview.tsx','app/giris-onizleme/phone-login-cinematic.module.css','app/giris-onizleme/phone-country-select.tsx','app/giris-onizleme/phone-country-select.module.css','app/giris-onizleme/phone-auth-client.ts','app/giris-onizleme/account-code-client.ts',
 'components/ui/3d-testimonails.tsx','components/ui/3d-testimonails.module.css','app/platform/login.tsx','app/platform/shell.tsx','app/platform/platform.module.css','app/platform/session.tsx','app/platform/device-login.tsx','app/platform/welcome-offer.tsx','app/platform/analytics-policy.ts','app/site-shell.tsx','lib/api.ts','lib/device-login-client.ts','lib/public-session-renewal.ts'))
PACKAGE_PATHS=('apps/ops-web/package.json','package-lock.json')
DEPENDENCIES={
 'libphonenumber-js':('1.13.15','sha512-AHdhEQeDFEJ4GKDAQ9AwxChy+v2kUILUB3TGQRpkXMkWePjXTU/WQEzWVQoIx/Gz8fE73Wr5SEuZCy2vk8jrMQ=='),
 'country-flag-icons':('1.6.20','sha512-py8JiEKzjhYw6HPJ0L7SxLgCYim36UPRTZX43/kqGueUCZLSvnrqAiwW8HtQibur7mdkFQUkjOgdK+o/9FBtaw==')}
class GateError(Exception):pass

def sha(data):return hashlib.sha256(data).hexdigest()
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m

def command(*args,input_data=None,timeout=180):
 try:r=subprocess.run([str(x) for x in args],input=input_data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 except (OSError,subprocess.TimeoutExpired):raise GateError('command_unavailable_or_timed_out') from None
 if r.returncode:
  # Outputs can contain environment values. Preserve no raw stderr in the console.
  sample=(r.stdout[-16384:]+r.stderr[-16384:]).lower();label='failed'
  for needle,name in ((b'no space left','disk_full'),(b'out of memory','memory'),(b'cannot find module','dependency'),(b'type error','typecheck'),(b'failed tests','tests')):
   if needle in sample:label=name;break
  raise GateError('command_'+label+':'+str(r.returncode))
 return r.stdout

def revision(value):
 if not isinstance(value,str) or not re.fullmatch('[a-f0-9]{40}',value):raise GateError('exact_revision_required')
 return value

def target(service,ref):
 if service not in SOURCES:raise GateError('only_api_web_allowed')
 return ('flixify-api' if service=='api' else 'flixify-ops-web')+':phone-login-'+revision(ref)[:12]+'-20261107'

def relative(path):
 if not isinstance(path,str) or not path or '\\' in path or '\x00' in path or path.startswith('/') or any(p in ('','..','.') for p in path.split('/')):raise GateError('unsafe_relative_path')
 return path

def regular(root,path,maximum=4*1024**2):
 relative(path);p=Path(root)
 for part in PurePosixPath(path).parts:
  p=p/part
  if p.is_symlink():raise GateError('symlink_not_allowed')
 try:s=p.stat()
 except OSError:raise GateError('payload_file_missing:'+path) from None
 if not stat.S_ISREG(s.st_mode) or s.st_size>maximum:raise GateError('payload_file_bounds:'+path)
 return p

def protected_environment(value):return {k:v for k,v in value.items() if k not in SETTINGS and k!='HOSTNAME'}

def validate_settings(value,existing=None):
 if not isinstance(value,dict) or set(value)!=SETTINGS or any(not isinstance(v,str) or '\x00' in v or '\n' in v or '\r' in v for v in value.values()):raise GateError('only_exact_phone_settings_allowed')
 if value['PHONE_AUTH_ENABLED'] not in ('true','false') or value['PHONE_AUTH_LOCAL_ONLY']!='false' or value['PHONE_AUTH_PROVIDER_DIAGNOSTICS']!='false':raise GateError('production_phone_flags_invalid')
 origins=value['PHONE_AUTH_ALLOWED_ORIGINS'].split(',')
 if not origins or len(origins)!=len(set(origins)) or any(x not in ('https://flixify.vip','https://www.flixify.vip') for x in origins):raise GateError('exact_production_origins_required')
 if not 32<=len(value['PHONE_AUTH_SECRET'])<=256 or '$' in value['PHONE_AUTH_SECRET']:raise GateError('stable_phone_secret_required')
 if not re.fullmatch('[0-9]{1,30}',value['VATANSMS_WHATSAPP_REG_ID']) or not 1<=len(value['VATANSMS_WHATSAPP_API_KEY'])<=1024 or value['VATANSMS_WHATSAPP_BASE_URL']!='https://api.toplusmspaketleri.com':raise GateError('fixed_provider_configuration_required')
 if existing and value['PHONE_AUTH_SECRET'] in (existing.get('APP_JWT_SECRET'),existing.get('REGISTRATION_GUARD_SECRET')):raise GateError('independent_phone_secret_required')
 return value

def private_settings(path):
 path=Path(path)
 try:s=path.lstat()
 except OSError:raise GateError('private_settings_missing') from None
 if not stat.S_ISREG(s.st_mode) or stat.S_IMODE(s.st_mode)!=0o600 or s.st_uid!=os.getuid() or s.st_size>8192:raise GateError('private_settings_must_be_owned_0600_regular_file')
 try:return validate_settings(json.loads(path.read_text()))
 except (ValueError,UnicodeError):raise GateError('private_settings_invalid') from None

def validate_web_path(path):
 relative(path)
 if path in WEB_RUNTIME or path in PACKAGE_PATHS:return
 if re.fullmatch(r'apps/ops-web/public/flags/(?:[A-Z]{2}\.svg|LICENSE(?:\.txt)?)',path):return
 if re.fullmatch(r'apps/ops-web/public/avatars/auth-preview/profile-[1-9]\.jpg',path):return
 if path in ('apps/ops-web/public/icons/whatsapp.svg','apps/ops-web/public/icons/whatsapp.NOTICE.txt'):return
 raise GateError('web_path_outside_login_scope:'+path)

def manifest(root,value):
 if not isinstance(value,dict) or value.get('schemaVersion')!=1 or value.get('sourceImageId')!=SOURCES['ops-web'][1] or set(value.get('runtimePaths',[]))!=set(WEB_RUNTIME) or set(value.get('packageManifestPaths',[]))!=set(PACKAGE_PATHS):raise GateError('web_manifest_identity_or_scope_differs')
 assets=value.get('assetPaths');entries=value.get('files');deps=value.get('dependencyTrees')
 if not isinstance(assets,list) or len(assets)!=len(set(assets)) or not isinstance(entries,list) or not isinstance(deps,list) or {x.get('name') for x in deps}!=set(DEPENDENCIES):raise GateError('web_manifest_shape_invalid')
 expected=set(WEB_RUNTIME)|set(PACKAGE_PATHS)|set(assets);result={}
 for entry in entries:
  p=entry.get('path');validate_web_path(p)
  if set(entry)!={'path','bytes','sha256','mode'} or p in result or entry['mode']!=0o644 or type(entry['bytes']) is not int or not re.fullmatch('[a-f0-9]{64}',str(entry['sha256'])):raise GateError('web_manifest_entry_invalid')
  data=regular(root,p).read_bytes()
  if len(data)!=entry['bytes'] or sha(data)!=entry['sha256']:raise GateError('web_payload_digest_differs:'+p)
  result[p]=data
 if set(result)!=expected or sum(map(len,result.values()))>16*1024**2:raise GateError('web_manifest_file_set_or_budget_differs')
 return result,deps

SNAPSHOT=r'''const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');
const input=JSON.parse(process.argv[1]);function snap(root,excluded=[]){const rows=[];let total=0;function walk(rel){const path=p.join(root,rel);for(const n of fs.readdirSync(path).sort()){const r=rel?rel+'/'+n:n;if(excluded.some(x=>r===x||r.startsWith(x+'/')))continue;const q=p.join(root,r),s=fs.lstatSync(q);if(s.isSymbolicLink()){rows.push(['link',r,s.mode&511,fs.readlinkSync(q)]);continue}if(s.isDirectory()){walk(r);continue}if(!s.isFile()||s.size>1024**3)throw Error('snapshot_type');const h=c.createHash('sha256'),fd=fs.openSync(q,'r'),b=Buffer.alloc(1024**2);let bytesRead;while((bytesRead=fs.readSync(fd,b,0,b.length,null))>0)h.update(b.subarray(0,bytesRead));fs.closeSync(fd);total+=s.size;if(total>8*1024**3)throw Error('snapshot_budget');rows.push(['file',r,s.mode&511,s.size,h.digest('hex')]);}}walk('');return {sha256:c.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),files:rows.length,bytes:total,rows:input.rows?rows:undefined};}
console.log(JSON.stringify(snap(input.root,input.excluded||[])));'''

def image_info(image):
 rows=json.loads(command('docker','image','inspect',image))
 if len(rows)!=1:raise GateError('image_identity_invalid')
 return rows[0]

def snapshot(image,root='/app',excluded=(),rows=False):
 config=json.dumps({'root':root,'excluded':list(excluded),'rows':rows},separators=(',',':'))
 return json.loads(command('docker','run','--rm','--network','none','--read-only','--memory','512m','--memory-swap','640m','--cpus','1','--pids-limit','128','--entrypoint','node',image,'-e',SNAPSHOT,config,timeout=300))

def services(*,allow_changed_stopped=False):
 names=[x+'-'+UUID for x in ('api','ops-web','worker','db')]
 rows=json.loads(command('docker','inspect',*names));result={}
 for row in rows:
  service=row['Name'].removeprefix('/').removesuffix('-'+UUID)
  if service not in ('api','ops-web','worker','db') or (row['Config'].get('Labels') or {}).get('com.docker.compose.project')!=UUID or (not row['State']['Running'] and not (allow_changed_stopped and service in SOURCES)):raise GateError('service_identity_or_running_state_changed')
  result[service]=row
 if set(result)!=set(('api','ops-web','worker','db')):raise GateError('service_set_differs')
 return result

def assert_source():
 current=services()
 for name,(tag,identity) in SOURCES.items():
  if current[name]['Image']!=identity or current[name]['Config']['Image']!=tag or image_info(tag)['Id']!=identity:raise GateError('running_source_drift:'+name)
 for name,pin in [('worker',WORKER),('db',DB)]:
  if (current[name]['Config']['Image'],current[name]['Image'])!=pin:raise GateError('protected_service_image_drift:'+name)
 return current

def outside_snapshot():
 ids=command('docker','ps','-aq').decode().split();result={}
 if not ids:return result
 for row in json.loads(command('docker','inspect',*ids)):
  name=row['Name']
  if name in ('/api-'+UUID,'/ops-web-'+UUID):continue
  result[name]={'id':row['Id'],'image':row['Image'],'config':sha(json.dumps(row['Config'],sort_keys=True,separators=(',',':')).encode()),'hostConfig':sha(json.dumps(row['HostConfig'],sort_keys=True,separators=(',',':')).encode()),'mounts':sha(json.dumps(row['Mounts'],sort_keys=True,separators=(',',':')).encode()),'networks':sha(json.dumps(row['NetworkSettings'].get('Networks',{}),sort_keys=True,separators=(',',':')).encode()),'startedAt':row['State']['StartedAt'],'running':row['State']['Running'],'paused':row['State']['Paused'],'restartCount':row['RestartCount']}
 return result

def require_disk():
 if shutil.disk_usage('/var/lib/docker').free<MIN_FREE:raise GateError('requires_8GiB_free_no_pruning')

def archive(updates):
 buffer=io.BytesIO()
 with tarfile.open(fileobj=buffer,mode='w') as tar:
  for path,data in sorted(updates.items()):
   relative(path);info=tarfile.TarInfo(path);info.size=len(data);info.mode=0o644;info.uid=info.gid=0;tar.addfile(info,io.BytesIO(data))
 if buffer.tell()>64*1024**2:raise GateError('overlay_archive_exceeds_64MiB')
 return buffer.getvalue()

def dependency_payload(root,ref,deps,stage):
 lock=json.loads(regular(root,'package-lock.json',8*1024**2).read_text());out={}
 for dep in deps:
  name=dep.get('name');version,pinned=DEPENDENCIES.get(name,(None,None))
  if dep.get('version')!=version or dep.get('path')!='node_modules/'+name:raise GateError('dependency_identity_differs')
  entry=lock.get('packages',{}).get('node_modules/'+name,{})
  url='https://registry.npmjs.org/'+name+'/-/'+name+'-'+version+'.tgz'
  integrity=entry.get('integrity')
  if entry.get('version')!=version or entry.get('resolved')!=url or not isinstance(integrity,str) or not integrity.startswith('sha512-') or pinned and integrity!=pinned:raise GateError('official_dependency_pin_differs')
  request=urllib.request.Request(url,headers={'User-Agent':'Flixify-release/1'})
  with urllib.request.urlopen(request,timeout=30) as response:
   if response.url!=url:raise GateError('dependency_redirect_not_allowed')
   data=response.read(8*1024**2+1)
  if len(data)>8*1024**2 or 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()!=integrity:raise GateError('dependency_archive_digest_differs')
  expected={e['path']:e for e in dep['files']};seen=set();total=0
  with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
   for member in tar:
    if member.isdir():continue
    if not member.isfile() or not member.name.startswith('package/') or member.size>4*1024**2:raise GateError('dependency_archive_entry_invalid')
    path='node_modules/'+name+'/'+member.name.removeprefix('package/');relative(path)
    if path not in expected or path in seen:raise GateError('dependency_file_set_differs')
    value=tar.extractfile(member).read();entry=expected[path]
    if len(value)!=entry['bytes'] or sha(value)!=entry['sha256']:raise GateError('dependency_file_digest_differs')
    total+=len(value);seen.add(path);out[path]=value
  if seen!=set(expected) or total!=dep['bytes'] or len(seen)!=dep['fileCount']:raise GateError('dependency_tree_size_differs')
 return out

def git_payload(repo,ref,destination,paths):
 revision(ref)
 if command('git','-C',repo,'rev-parse',ref+'^{commit}').decode().strip()!=ref:raise GateError('revision_not_resolved_exactly')
 for path in paths:
  relative(path);entry=command('git','-C',repo,'ls-tree',ref,'--',path).decode().strip()
  if not re.fullmatch(r'100644 blob [a-f0-9]{40}\t'+re.escape(path),entry):raise GateError('payload_must_be_regular_committed_blob:'+path)
  data=command('git','-C',repo,'show',ref+':'+path)
  if len(data)>8*1024**2:raise GateError('payload_blob_too_large')
  output=destination/path;output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(data);output.chmod(0o644)

def extract_sources(image,stage,paths):
 name='flixify-phone-login-extract-'+uuid.uuid4().hex[:12]
 command('docker','create','--name',name,'--network','none',image,'node','--version')
 try:
  for path in paths:
   dest=stage/path;dest.parent.mkdir(parents=True,exist_ok=True)
   command('docker','cp',name+':/app/'+path,str(dest))
 finally:command('docker','rm',name)

def compiler_script(service,public):
 caps=r'''const fs=require('node:fs'),cp=require('node:child_process');const mem=BigInt(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim()),swap=BigInt(fs.readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim()),cpu=fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(/\s+/).map(BigInt),pids=BigInt(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim());if(mem>1342177280n||mem+swap>1610612736n||cpu[0]<=0n||cpu[0]>cpu[1]||pids>128n)throw Error('compiler_caps');'''
 script=caps+'const env={...process.env,...'+json.dumps(public)+',NODE_OPTIONS:"--max-old-space-size=1024"};'
 if service in ('api','ops-web'):script+='cp.execFileSync("npm",["run","build","-w","@flixify/contracts"],{stdio:"inherit",env});'
 script+='cp.execFileSync("npm",["run","build","-w",'+json.dumps('@flixify/'+service)+'],{stdio:"inherit",env});'
 return script

def excluded_paths(service,paths):
 result=[p for p in paths if not p.startswith('node_modules/')]
 result+=['packages/contracts/dist']
 if service=='api':result+=['apps/api/dist']
 else:result+=['apps/ops-web/.next','node_modules/libphonenumber-js','node_modules/country-flag-icons']
 return sorted(set(result))

def web_contract_overlay(web_original,api_original,api_updated):
 if sha(web_original)!='973aa039be6ef0b71a6518648b113bcfce7b3e26dc685cb25b97dc7701f7047a' or sha(api_original)!='f8b3958ad86e0bd0868127d1271f68992b44efab25ca3a849b83776d316b76fa':raise GateError('web_api_contract_source_pins_differ')
 anchor=b'  hasActiveSubscription: z.boolean(),\n';field=b'  trialProvisionStatus: z.enum(["pending", "review"]).nullable().optional(),\n'
 if web_original.count(anchor)!=1:raise GateError('web_contract_trial_anchor_differs')
 aligned=web_original.replace(anchor,anchor+field)
 if aligned!=api_original:raise GateError('web_contract_difference_outside_reviewed_optional_trial_field')
 old=b'  platform: z.string().nullable(),\n  expiresAt: z.string(),\n  lastSeenAt: z.string(),';new=old.replace(b'expiresAt: z.string(),',b'expiresAt: z.string().nullable(),')
 if aligned.count(old)!=1:raise GateError('web_contract_session_anchor_differs')
 updated=aligned.replace(old,new)
 if updated!=api_updated:raise GateError('api_contract_delta_outside_reviewed_nullable_session_expiry')
 return updated

def candidate(service,ref,updates,work,public):
 if command('docker','image','ls','-q',target(service,ref)).strip():raise GateError('candidate_tag_already_exists')
 source=SOURCES[service][1];dist='apps/api/dist' if service=='api' else 'apps/ops-web/.next'
 excluded=excluded_paths(service,updates)
 before=snapshot(source,excluded=excluded)
 old_public=snapshot(source,'/app/apps/ops-web/public') if service=='ops-web' else None
 baseline_static=None
 if service=='ops-web':
  baseline_static=work/'old-static';extract_sources(source,work,['apps/ops-web/.next/static']);baseline_static=work/'apps/ops-web/.next/static'
 name='flixify-phone-login-build-'+service+'-'+uuid.uuid4().hex[:12];created=False
 try:
  args=['docker','create','--name',name,'--network','none','--memory','1280m','--memory-swap','1536m','--cpus','1','--pids-limit','128']
  if baseline_static:args+=['--mount','type=bind,src='+str(baseline_static.resolve())+',dst=/tmp/flixify-old-static,readonly']
  command(*args,source,'node','-e','setInterval(()=>{},2147483647)');created=True;command('docker','start',name)
  command('docker','cp','-',name+':/app/',input_data=archive(updates),timeout=120)
  command('docker','exec',name,'node','-e',compiler_script(service,public),timeout=480)
  if baseline_static:
   merge=r'''const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');function walk(a,b){fs.mkdirSync(b,{recursive:true});for(const n of fs.readdirSync(a)){const x=p.join(a,n),y=p.join(b,n),s=fs.lstatSync(x);if(s.isSymbolicLink())throw Error('static_link');if(s.isDirectory())walk(x,y);else if(s.isFile()){if(fs.existsSync(y)){if(c.createHash('sha256').update(fs.readFileSync(x)).digest('hex')!==c.createHash('sha256').update(fs.readFileSync(y)).digest('hex'))throw Error('immutable_static_collision')}else fs.copyFileSync(x,y,fs.constants.COPYFILE_EXCL)}else throw Error('static_type')}}walk('/tmp/flixify-old-static','/app/apps/ops-web/.next/static');'''
   command('docker','exec',name,'node','-e',merge)
  base=image_info(source);tag=target(service,ref)
  command('docker','commit','--change','CMD '+json.dumps(base['Config']['Cmd']),'--change','LABEL org.opencontainers.image.revision='+ref,'--change','LABEL vip.flixify.edge-recovery.base='+source,name,tag,timeout=300)
  info=image_info(tag);identity=info['Id']
  after=snapshot(identity,excluded=excluded)
  if before!=after:raise GateError('candidate_changed_untouched_tree:'+service)
  for key in ('Env','Cmd','Entrypoint','WorkingDir','User','Healthcheck','Volumes','ExposedPorts','StopSignal','Shell'):
   if info['Config'].get(key)!=base['Config'].get(key):raise GateError('candidate_image_config_changed:'+key)
  if service=='ops-web':
   after_public=snapshot(identity,'/app/apps/ops-web/public',excluded=[p.removeprefix('apps/ops-web/public/') for p in updates if p.startswith('apps/ops-web/public/')])
   if after_public!=old_public:raise GateError('old_public_downloads_or_assets_changed')
  output=snapshot(identity,'/app/'+dist)
  if output['bytes']>256*1024**2:raise GateError('compiled_output_budget')
  proof={'schemaVersion':1,'service':service,'revision':ref,'sourceImageId':source,'candidateTag':tag,'candidateId':identity,'sourceHashes':{p:sha(v) for p,v in updates.items()},'untouched':before,'compiled':output,'oldPublic':old_public,'staticCompatibility':bool(baseline_static)}
  (work/(service+'-proof.json')).write_text(json.dumps(proof,indent=2));return proof
 finally:
  if created:command('docker','rm','--force',name)

def verify_candidate(proof):
 if not isinstance(proof,dict) or proof.get('schemaVersion')!=1 or proof.get('service') not in SOURCES:raise GateError('candidate_proof_shape')
 service=proof['service'];revision(proof['revision']);base=image_info(SOURCES[service][1]);actual=image_info(proof['candidateTag']);layers=base.get('RootFS',{}).get('Layers',[])
 if proof['sourceImageId']!=SOURCES[service][1] or proof['candidateTag']!=target(service,proof['revision']) or actual['Id']!=proof['candidateId'] or actual['Id']==base['Id'] or not layers or actual.get('RootFS',{}).get('Layers',[])[:len(layers)]!=layers:raise GateError('candidate_identity_or_ancestry_drift')
 labels=actual['Config'].get('Labels') or {}
 if labels.get('org.opencontainers.image.revision')!=proof['revision'] or labels.get('vip.flixify.edge-recovery.base')!=base['Id']:raise GateError('candidate_labels_drift')
 for k in ('Env','Cmd','Entrypoint','WorkingDir','User','Healthcheck','Volumes','ExposedPorts','StopSignal','Shell'):
  if actual['Config'].get(k)!=base['Config'].get(k):raise GateError('candidate_configuration_drift')
 paths=list(proof['sourceHashes']);excluded=excluded_paths(service,paths)
 if snapshot(actual['Id'],excluded=excluded)!=proof['untouched']:raise GateError('candidate_untouched_digest_drift')
 check='const fs=require("node:fs"),c=require("node:crypto"),expected=JSON.parse(fs.readFileSync(0,"utf8"));for(const [p,h]of Object.entries(expected)){const s=fs.lstatSync("/app/"+p);if(!s.isFile()||s.isSymbolicLink()||c.createHash("sha256").update(fs.readFileSync("/app/"+p)).digest("hex")!==h)throw Error("source_digest")}';bdata=json.dumps(proof['sourceHashes'],separators=(',',':')).encode()
 command('docker','run','-i','--rm','--network','none','--read-only','--memory','256m','--memory-swap','320m','--pids-limit','128','--entrypoint','node',actual['Id'],'-e',check,input_data=bdata,timeout=120)
 return actual['Id']

LOGIN_SSR_CHECK=r'''function verifyLoginMarkup(text){if(!text.includes('id="phone-number"')||!(/\bautocomplete="tel-national"/i).test(text)||!text.includes('aria-label="Flixify hesabına giriş"'))throw Error('new_login_missing');}'''

def smoke(proof):
 service=proof['service'];name='flixify-phone-login-smoke-'+service+'-'+uuid.uuid4().hex[:12]
 args=['docker','create','--name',name,'--network','none','--memory','512m','--memory-swap','640m','--cpus','1','--pids-limit','128']
 if service=='api':
  env={'APP_DEMO_MODE':'true','DATABASE_URL':'postgresql://fixture:fixture@127.0.0.1:9/fixture','APP_JWT_SECRET':'fixture-only-'+('a'*40),'REGISTRATION_GUARD_SECRET':'fixture-only-'+('b'*40),'ADMIN_EMAILS':'fixture@example.invalid','SUPABASE_URL':'https://fixture.invalid','SUPABASE_JWKS_URL':'https://fixture.invalid/jwks','PHONE_AUTH_ENABLED':'false','PHONE_AUTH_LOCAL_ONLY':'false','PHONE_AUTH_ALLOWED_ORIGINS':'https://flixify.vip','STRIPE_BILLING_ENABLED':'false'}
  for k,v in env.items():args+=['-e',k+'='+v]
 created=False
 try:
  command(*args,proof['candidateId']);created=True;command('docker','start',name)
  paths=['/health','/auth/phone/status'] if service=='api' else ['/giris-yap','/kayit-ol','/indir','/paketler','/']
  port=4000 if service=='api' else 3000
  script=LOGIN_SSR_CHECK+"(async()=>{const paths=PATHS;for(let attempt=0;attempt<30;attempt++){try{for(const path of paths){const r=await fetch('http://127.0.0.1:PORT'+path,{redirect:'manual',signal:AbortSignal.timeout(5000)});if(r.status!==200)throw Error('status');const text=await r.text();if(text.length>4*1024*1024)throw Error('body');if(path==='/health'&&JSON.parse(text).ok!==true)throw Error('health');if(path==='/auth/phone/status'){const x=JSON.parse(text);if(x.nativePhoneLogin!==true||x.enabled!==false)throw Error('phone_status')}if(path==='/giris-yap')verifyLoginMarkup(text)}return}catch(e){if(attempt===29)throw e;await new Promise(r=>setTimeout(r,250))}}})().catch(()=>process.exit(1))".replace('PATHS',json.dumps(paths)).replace('PORT',str(port))
  command('docker','exec',name,'node','-e',script,timeout=190)
 finally:
  if created:command('docker','rm','--force',name)


def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('repo',type=Path);parser.add_argument('--revision',required=True);parser.add_argument('--web-manifest',type=Path,required=True);parser.add_argument('--work-dir',type=Path,required=True);parser.add_argument('--service',choices=('api','ops-web','both'),default='both');parser.add_argument('--build',action='store_true');args=parser.parse_args()
 ref=revision(args.revision);current=assert_source();outside=outside_snapshot();web=json.loads(args.web_manifest.read_text())
 # Always consume committed blobs; the caller's checkout can contain unrelated changes.
 paths=set(web['runtimePaths'])|set(web['assetPaths'])|set(web['packageManifestPaths'])
 patcher=load('phone_api_overlay',HERE/'patch-api.py');paths.update(patcher.PAYLOAD_PATHS);paths.update(MIGRATIONS);paths.add(BACKFILL)
 with tempfile.TemporaryDirectory(prefix='flixify-phone-payload-') as d:
  payload=Path(d);git_payload(args.repo,ref,payload,paths);web_updates,deps=manifest(payload,web)
  if not args.build:print(json.dumps({'state':'phone_login_preflight_verified','revision':ref,'services':list(SOURCES),'webFiles':len(web_updates),'noMutation':True}));return
  require_disk();args.work_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
  if args.work_dir.is_symlink():raise GateError('work_directory_symlink')
  stage=args.work_dir/'api-extracted'
  if stage.exists():raise GateError('fresh_api_extraction_directory_required')
  stage.mkdir(mode=0o700)
  extract_sources(SOURCES['api'][1],stage,['apps/api/src','packages/contracts/src'])
  api_updates,api_proof=patcher.plan(payload,stage,source_image_id=SOURCES['api'][1])
  (args.work_dir/'api-overlay-proof.json').write_text(json.dumps(api_proof,indent=2))
  proofs={}
  if args.service in ('api','both'):proofs['api']=candidate('api',ref,api_updates,args.work_dir,{})
  if args.service in ('ops-web','both'):
   domain='packages/contracts/src/domain.ts'
   web_contract=args.work_dir/'web-contract-original';extract_sources(SOURCES['ops-web'][1],web_contract,[domain])
   web_updates[domain]=web_contract_overlay(regular(web_contract,domain).read_bytes(),regular(stage,domain).read_bytes(),api_updates[domain])
   (args.work_dir/'web-contract-overlay-proof.json').write_text(json.dumps({'sourceImageId':SOURCES['ops-web'][1],'apiSourceImageId':SOURCES['api'][1],'webBefore':sha(regular(web_contract,domain).read_bytes()),'apiBefore':sha(regular(stage,domain).read_bytes()),'after':sha(web_updates[domain]),'reviewedChanges':['optional_trial_provision_status','nullable_device_session_expiry']},indent=2))
   web_updates.update(dependency_payload(payload,ref,deps,args.work_dir))
   public={k:v for k,v in (entry.split('=',1) for entry in current['ops-web']['Config'].get('Env',[])) if k.startswith('NEXT_PUBLIC_') or k in ('PUBLIC_API_BASE_URL','NODE_ENV')}
   proofs['ops-web']=candidate('ops-web',ref,web_updates,args.work_dir,public)
  for proof in proofs.values():verify_candidate(proof);smoke(proof)
  if outside_snapshot()!=outside:raise GateError('protected_container_or_other_project_changed')
  report={'state':'phone_login_candidates_verified','revision':ref,'candidates':{k:v['candidateId'] for k,v in proofs.items()},'protected':outside,'webManifestSha256':sha(args.web_manifest.read_bytes())};(args.work_dir/'build-proof.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='protected'}))

if __name__=='__main__':
 try:main()
 except (GateError,ValueError,KeyError,TypeError,OSError) as e:print('phone_login_build_stopped:'+str(e),file=sys.stderr);sys.exit(1)
