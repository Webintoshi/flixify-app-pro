#!/usr/bin/env python3
"""Cinematic TV update + exact versioned APK candidate; default preflight only."""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, re, shlex, shutil, sys, tempfile, uuid
from pathlib import Path
spec=importlib.util.spec_from_file_location('tv_apk_bounded_web',Path(__file__).with_name('build-web.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
core=builder.core;GateError=builder.GateError;command=core.command
SOURCE_TAG='flixify-ops-web:edge-recovery-04a5f5db4677-20261026'
SOURCE_ID='sha256:1d7a1fde872b02467cd245a28d45947468871fa35273e08b3f029fbd3a685034'
BASE_REVISION='b25f105186163fea3d264176fdc631fe8efbe7f8'
PATHS=('apps/ops-web/app/platform/tv-download.ts',)
NEW_PATHS=()
APK='apps/ops-web/public/downloads/flixify-tv-1.1.0-test.1.apk'
MAX_APK_BYTES=64*1024*1024
builder.SOURCE_TAG=SOURCE_TAG;builder.SOURCE_ID=SOURCE_ID;builder.BASE_REVISION=BASE_REVISION
builder.PATHS=PATHS;builder.NEW_PATHS=NEW_PATHS

def validate_apk(repo,revision,sha256,size):
    if not re.fullmatch('[0-9a-f]{64}',sha256) or not 1024<=size<=MAX_APK_BYTES:
        raise GateError('apk_pin_invalid')
    builder.require_regular_blob(repo,revision,APK)
    if builder.git_entry(repo,BASE_REVISION,APK):raise GateError('apk_exists_in_baseline')
    for ancestor in Path(APK).parents:
        if str(ancestor)=='.':continue
        entry=builder.git_entry(repo,BASE_REVISION,str(ancestor))
        if entry and not entry.startswith(b'040000 tree '):raise GateError('apk_baseline_ancestor_not_tree')
    builder.require_image_absent(APK)
    changed=command('git','-C',str(repo),'diff','--name-only',BASE_REVISION,revision,'--','apps/ops-web/public').decode().splitlines()
    if changed!=[APK]:raise GateError('apk_public_scope_differs')
    value=core.git_file(repo,revision,APK)
    if len(value)!=size or hashlib.sha256(value).hexdigest()!=sha256 or not value.startswith(b'PK\x03\x04'):
        raise GateError('apk_bytes_differ_from_pin')
    return value

def dockerfile(revision):
    value=builder.dockerfile(revision)
    if value.count('\nRUN node -e ')!=1:raise GateError('web_compile_layer_differs')
    return value.replace('\nRUN node -e ',f'\nCOPY {APK} /app/{APK}\nRUN node -e ',1)

def verify_download(candidate_id,sha256,size):
    name='flixify-tv-apk-check-'+uuid.uuid4().hex[:12]
    command('docker','run','--rm','-d','--name',name,'--network','none','--memory','512m','--memory-swap','640m','--pids-limit','128',candidate_id)
    try:
        script='const crypto=require("node:crypto");(async()=>{const u="http://127.0.0.1:3000/downloads/flixify-tv-1.1.0-test.1.apk";let h;for(let n=0;n<40;n++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.ok)break}catch{}await new Promise(r=>setTimeout(r,250))}if(!h||h.status!==200||Number(h.headers.get("content-length"))!=='+str(size)+'||!h.headers.get("content-type")?.includes("application/vnd.android.package-archive"))throw Error("apk_head_invalid");const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/'+str(size)+'"||(await r.arrayBuffer()).byteLength!==32)throw Error("apk_range_invalid");const b=Buffer.from(await(await fetch(u,{signal:AbortSignal.timeout(10000)})).arrayBuffer());if(crypto.createHash("sha256").update(b).digest("hex")!=='+json.dumps(sha256)+')throw Error("apk_get_digest_invalid");console.log("candidate_apk_head_mime_get_range_verified")})().catch(()=>{console.error("candidate_apk_download_failed");process.exit(1)})'
        command('docker','exec',name,'node','-e',script,timeout=100)
        print('candidate_apk_head_mime_get_range_verified; network_disabled')
    finally:
        image=command('docker','inspect','--format','{{.Image}}',name).decode().strip()
        if image!=candidate_id:raise GateError('apk_check_container_drift')
        command('docker','stop','-t','10',name)

def container_compile(revision,base,updated,web_env):
    """Compile in an isolated disposable overlay; avoid reimporting a14GiB base into BuildKit."""
    config=base.get('Config') or {}
    if not config.get('Cmd') or config.get('Volumes'):
        raise GateError('container_compile_base_config_unsupported')
    name='flixify-tv-web-build-'+uuid.uuid4().hex[:12]
    args=['docker','create','--name',name,'--network','none','--memory',f'{builder.RUN_MEMORY_MIB}m','--memory-swap',f'{builder.RUN_TOTAL_MEMORY_MIB}m','--pids-limit','256']
    for key,value in web_env.items():args+=['--env',key+'='+value]
    args += [SOURCE_ID,'node','-e',builder.build_script()]
    created=False
    try:
        command(*args);created=True
        with tempfile.TemporaryDirectory(prefix='flixify-tv-overlay-') as directory:
            for index,(path,value) in enumerate(updated.items()):
                file=Path(directory)/str(index);file.write_bytes(value)
                command('docker','cp',str(file),name+':/app/'+path)
        command('docker','start','--attach',name,timeout=1200)
        status=command('docker','inspect','--format','{{.State.ExitCode}}',name).decode().strip()
        if status!='0':raise GateError('container_web_compile_failed')
        command('docker','commit','--change','CMD '+json.dumps(config['Cmd']),
                '--change','LABEL org.opencontainers.image.revision='+revision,
                '--change','LABEL vip.flixify.edge-recovery.base='+SOURCE_ID,name,builder.target(revision),timeout=300)
    finally:
        if created:command('docker','rm','--force',name)
    print('container_compile_passed; actual_cgroup_bounded; network_disabled; own_container_removed')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_repo',type=Path);parser.add_argument('--revision',required=True)
    parser.add_argument('--apk-sha256',required=True);parser.add_argument('--apk-bytes',required=True,type=int)
    action=parser.add_mutually_exclusive_group();action.add_argument('--build',action='store_true');action.add_argument('--container-build',action='store_true');action.add_argument('--verify-existing',action='store_true')
    args=parser.parse_args()
    base,updated,web_env,config=builder.preflight(args.source_repo,args.revision)
    updated[APK]=validate_apk(args.source_repo,args.revision,args.apk_sha256,args.apk_bytes)
    if not(args.build or args.container_build or args.verify_existing):print('tv_apk_web_preflight_ok; no_mutation');return
    if args.build or args.container_build:
        if shutil.disk_usage('/var/lib/docker').free<builder.MIN_FREE_BYTES:raise GateError('insufficient_disk_web_build_requires_8GiB')
        tags=command('docker','image','ls','--format','{{.Repository}}:{{.Tag}}',builder.target(args.revision)).decode().splitlines()
        if builder.target(args.revision) in tags:raise GateError('candidate_tag_already_exists_use_verify_existing')
        if args.container_build:
            container_compile(args.revision,base,updated,web_env)
        else:
            with tempfile.TemporaryDirectory(prefix='flixify-tv-web-') as directory:
                root=Path(directory)
                for path,value in updated.items():
                    file=root/path;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(value)
                (root/'Dockerfile').write_text(dockerfile(args.revision))
                build_args=[]
                for key,value in web_env.items():build_args+=['--build-arg',key+'='+value]
                command('docker','build','--load','--no-cache','--rm','--force-rm','--pull=false','--network=none','--resource',f'memory={builder.RUN_MEMORY_MIB}m','--resource',f'memory-swap={builder.RUN_TOTAL_MEMORY_MIB}m','-t',builder.target(args.revision),*build_args,str(root),timeout=1200)
    candidate=builder.verify_candidate(base,args.revision,updated,web_env,config)
    verify_download(candidate,args.apk_sha256,args.apk_bytes)
    print('web_candidate_verified:'+candidate)

if __name__=='__main__':
    try:main()
    except GateError as error:print('build_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except(ValueError,KeyError,TypeError,IndexError,OSError) as error:print('build_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
