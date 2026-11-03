#!/usr/bin/env python3
"""Compile QR pages and pinned installers on the actual web image; no cutover."""
import argparse
import json
from pathlib import Path
import re
import shutil
import tempfile
import uuid
import importlib.util

HERE=Path(__file__).resolve().parent

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path); module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

api=load('qr_api_build_support',HERE/'build-api.py')
m=api.merge
web=load('qr_web_compile_support',HERE.parent/'2026-10-31-search-activation/build-web.py')
builder=web.builder
command=web.command
RUNTIME=tuple('apps/ops-web/'+p for p in ('app/ayarlar/page.tsx','app/cihaz/layout.tsx','app/cihaz/page.tsx','app/giris-yap/page.tsx','app/platform/device-login.module.css','app/platform/device-login.tsx','app/platform/login.tsx','app/platform/types.ts','lib/device-login-client.ts'))
DESCRIPTORS=tuple('apps/ops-web/app/platform/'+p+'-download.ts' for p in ('tv','mac','windows'))
UPDATE='apps/ops-web/public/downloads/flixify-tv-update.json'

def target(revision):
    if not re.fullmatch('[a-f0-9]{40}',revision): raise m.GateError('exact_revision_required')
    return 'flixify-ops-web:qr-device-login-'+revision[:12]+'-20261103'

def validate_public(repo,revision,artifacts):
    if set(artifacts)!={'android','macos','windows'}: raise m.GateError('three_native_artifacts_required')
    updates={}
    for platform,row in artifacts.items():
        if set(row)!={'path','sha256','bytes'} or not re.fullmatch(r'apps/ops-web/public/downloads/[A-Za-z0-9._-]+\.(apk|dmg|exe)',row['path']): raise m.GateError('native_artifact_pin_shape')
        path=row['path']; builder.require_regular_blob(repo,revision,path)
        if builder.git_entry(repo,m.BASE,path): raise m.GateError('new_artifact_existed_at_baseline')
        builder.require_image_absent(path)
        data=command('git','-C',str(repo),'show',revision+':'+path,timeout=120)
        if len(data)!=row['bytes'] or not 1024<=len(data)<=160*1024**2 or m.sha(data)!=row['sha256']: raise m.GateError('artifact_digest_or_size_mismatch:'+platform)
        if platform=='android' and not data.startswith(b'PK\x03\x04') or platform=='windows' and not data.startswith(b'MZ') or platform=='macos' and data[-512:-508]!=b'koly': raise m.GateError('artifact_magic_invalid')
        updates[path]=data
        descriptor=m.blob(repo,revision,DESCRIPTORS[('android','macos','windows').index(platform)]).decode()
        if ('href: "/downloads/'+Path(path).name+'"') not in descriptor or ('filename: "'+Path(path).name+'"') not in descriptor: raise m.GateError('descriptor_artifact_mismatch')
        if platform!='android' and (row['sha256'] not in descriptor or not re.search(r'sizeBytes:\s*'+str(row['bytes']),descriptor.replace('_',''))): raise m.GateError('descriptor_hash_or_size_mismatch')
    updates[UPDATE]=m.blob(repo,revision,UPDATE)
    manifest=json.loads(updates[UPDATE]); android=artifacts['android']
    expected={'packageName':'vip.flixify.tv','versionName':'1.4.13','versionCode':21,'minSdk':23,'apkUrl':'https://flixify.vip/'+android['path'].removeprefix('apps/ops-web/public/'),'sha256':android['sha256'],'sizeBytes':android['bytes']}
    if set(manifest)!=set(expected)|{'notes'} or any(manifest.get(k)!=v or type(manifest.get(k)) is not type(v) for k,v in expected.items()): raise m.GateError('tv_update_manifest_mismatch')
    return updates

def compile_candidate(revision,base,updates,env,image_id):
    if not base['Config'].get('Cmd') or base['Config'].get('Volumes'): raise m.GateError('unsupported_base_config')
    name='flixify-qr-web-build-'+uuid.uuid4().hex[:12]
    args=['docker','create','--name',name,'--network','none','--cpus','1','--memory','1280m','--memory-swap','1536m','--pids-limit','256']
    for k,v in env.items(): args+=['-e',k+'='+v]
    created=False
    try:
        command(*args,image_id,'node','-e','setInterval(()=>{},2147483647)');created=True
        command('docker','start',name)
        with tempfile.TemporaryDirectory(prefix='qr-web-overlay-') as directory:
            for index,(path,data) in enumerate(updates.items()):
                command('docker','exec',name,'mkdir','-p','/app/'+str(Path(path).parent))
                file=Path(directory)/str(index);file.write_bytes(data);file.chmod(0o644)
                command('docker','cp',str(file),name+':/app/'+path)
        command('docker','exec',name,'node','-e',builder.build_script(),timeout=1200)
        command('docker','commit','--change','CMD '+json.dumps(base['Config']['Cmd']),'--change','LABEL org.opencontainers.image.revision='+revision,'--change','LABEL vip.flixify.edge-recovery.base='+image_id,name,target(revision),timeout=300)
    finally:
        if created: command('docker','rm','--force',name)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo',type=Path);parser.add_argument('--revision',required=True)
    parser.add_argument('--base-image-id',required=True);parser.add_argument('--base-image-tag',required=True)
    parser.add_argument('--artifacts',required=True,type=Path);parser.add_argument('--source-pin',type=Path)
    action=parser.add_mutually_exclusive_group();action.add_argument('--measure',action='store_true');action.add_argument('--build',action='store_true');action.add_argument('--verify-existing',action='store_true')
    args=parser.parse_args();api.identity(args.base_image_id);target(args.revision)
    artifacts=json.loads(args.artifacts.read_bytes())
    paths=(*RUNTIME,*DESCRIPTORS,UPDATE,*(row['path'] for row in artifacts.values()))
    builder.SOURCE_ID,builder.SOURCE_TAG,builder.BASE_REVISION=args.base_image_id,args.base_image_tag,m.BASE
    builder.PATHS,builder.target=RUNTIME+DESCRIPTORS,target
    web.EXCLUDED=(*paths,'apps/ops-web/.next','apps/ops-web/app/cihaz')
    before_host=api.backend.host_snapshot()
    before_images=set(command('docker','image','ls','--no-trunc','-q').decode().splitlines())
    base=builder.core.image(args.base_image_id)
    if builder.core.image(args.base_image_tag)['Id']!=args.base_image_id: raise m.GateError('source_tag_drift')
    source=web.untouched(args.base_image_id)
    if args.measure: print(json.dumps(source,sort_keys=True));return
    if args.source_pin is None or json.loads(args.source_pin.read_bytes())!=source: raise m.GateError('independent_web_source_pin_required')
    changed=command('git','-C',str(args.repo),'diff','--name-only',m.BASE,args.revision,'--','apps/ops-web').decode().splitlines()
    if {p for p in changed if '.test.' not in p}!=set(paths): raise m.GateError('web_delta_outside_reviewed_scope')
    updates={}
    for path in (*RUNTIME,*DESCRIPTORS):
        if builder.git_entry(args.repo,m.BASE,path):
            original=builder.image_file(args.base_image_id,path)
            updates[path]=m.merge_text(m.blob(args.repo,m.BASE,path).decode(),m.blob(args.repo,args.revision,path).decode(),original.decode()).encode()
        else:
            builder.require_image_absent(path)
            updates[path]=m.blob(args.repo,args.revision,path)
    public_before=json.loads(web.canonical_public_manifest(web.public_manifest(args.base_image_id)))
    updates.update(validate_public(args.repo,args.revision,artifacts))
    public_expected=[row for row in public_before if row[1]!=UPDATE.removeprefix('apps/ops-web/public/')]
    for path in (*[r['path'] for r in artifacts.values()],UPDATE):
        public_expected.append(['file',path.removeprefix('apps/ops-web/public/'),0o644,len(updates[path]),m.sha(updates[path])])
    public_expected=sorted(public_expected,key=lambda row:row[1])
    current=json.loads(command('docker','inspect','ops-web-'+builder.UUID))[0]
    if current['Image']!=args.base_image_id or current['Config']['Image']!=args.base_image_tag or not current['State']['Running']: raise m.GateError('actual_web_runtime_drift')
    env=dict(row.split('=',1) for row in current['Config']['Env'] if '=' in row)
    env={key:env[key] for key in builder.PUBLIC_WEB_KEYS}
    config=builder.image_file(args.base_image_id,builder.CONFIG)
    if config!=m.blob(args.repo,m.BASE,builder.CONFIG): raise m.GateError('next_config_drift')
    if not (args.build or args.verify_existing): print('qr_web_preflight_passed');return
    if shutil.disk_usage('/var/lib/docker').free<8*1024**3: raise m.GateError('requires_8GiB_no_pruning')
    if args.build:
        if target(args.revision) in command('docker','image','ls','--format','{{.Repository}}:{{.Tag}}').decode().splitlines(): raise m.GateError('candidate_exists')
        compile_candidate(args.revision,base,updates,env,args.base_image_id)
    candidate=builder.verify_candidate(base,args.revision,updates,env,config)
    if web.untouched(candidate)!=source or json.loads(web.canonical_public_manifest(web.public_manifest(candidate)))!=public_expected: raise m.GateError('untouched_or_public_assets_changed')
    if api.backend.host_snapshot()!=before_host: raise m.GateError('existing_host_changed')
    if not before_images<=set(command('docker','image','ls','--no-trunc','-q').decode().splitlines()): raise m.GateError('existing_image_removed')
    print('qr_web_candidate_verified:'+candidate)

if __name__=='__main__': main()
