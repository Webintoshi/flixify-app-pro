#!/usr/bin/env python3
"""Build an offline QR API overlay; never migrate, restart, or deploy a service."""
from __future__ import annotations
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile

HERE=Path(__file__).resolve().parent

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

merge=load('qr_source_merger',HERE/'merge.py')
backend=load('qr_existing_backend_builder',HERE.parent/'2026-11-01-packages/build-backend.py')
GateError=merge.GateError
command=backend.command
ACTUAL_SOURCE_HASHES={
    'apps/api/src/server.ts':'8ba20048c499237e0ac6e311495caae2bb800b579a29fc506381c4ab60c215a9',
    'apps/api/src/repository.ts':'0fd20a59aa0595987504da21eb97bc2fd19c3469926f9be8377606d117a7149d',
    'apps/api/package.json':'9f7916801b4fbf5d142eddaf0210c8982bd40dc64ca6e3a7e8fc0ef0bcc8a583',
    'package-lock.json':'d18f934e35060abec02ae961e9af6315822599be0a9d70bbefa29faf64289984',
}


def identity(value):
    if not isinstance(value,str) or not re.fullmatch(r'sha256:[a-f0-9]{64}',value): raise GateError('exact_image_id_required')
    return value

def target(revision):
    if not re.fullmatch('[a-f0-9]{40}',revision): raise GateError('exact_revision_required')
    return 'flixify-api:qr-device-login-'+revision[:12]+'-20261103'

def configure(image_id, tag, paths, new):
    identity(image_id)
    backend.configuration=lambda service: ({'tag':tag,'id':image_id,'paths':tuple(paths),'new':tuple(new),'dist':'apps/api/dist','entry':'server.js'} if service=='api' else (_ for _ in ()).throw(GateError('api_only')))
    backend.target=lambda service,revision:target(revision)
    original_snapshot=backend.snapshot_script
    def snapshot_script(service):
        value=original_snapshot(service)
        old=json.dumps((*paths,'apps/api/dist'))
        new_skip=json.dumps((*paths,'apps/api/dist',merge.QR_KEY))
        if value.count(old)!=1: raise GateError('snapshot_guard_shape_changed')
        return value.replace(old,new_skip)
    backend.snapshot_script=snapshot_script
    original=backend.command
    def bounded(*args,**kwargs):
        args=list(args)
        if args[:2]==['docker','create']:
            if '--network' not in args or args[args.index('--network')+1]!='none': raise GateError('offline_compiler_required')
            args[2:2]=['--cpus','1']
        if args[:2]==['docker','cp'] and ':/app/' in args[-1]:
            container,path=args[-1].split(':',1)
            if not re.fullmatch(r'flixify-packages-api-build-[a-f0-9]{12}',container): raise GateError('compiler_container_scope')
            original('docker','exec',container,'mkdir','-p',str(Path(path).parent))
        return original(*args,**kwargs)
    backend.command=bounded
    def compile_script(service,expected_dist=None):
        script=backend.legacy.cgroup()+'cp.execFileSync("npm",["run","build","-w","@flixify/api"],{stdio:"inherit"});'
        if expected_dist is not None:
            script+=backend.legacy.snapshot_function()+"const baseline=snapshot('/app/apps/api/dist');"
            script+='if(baseline.sha256!=='+json.dumps(expected_dist['sha256'])+'||baseline.files!=='+str(expected_dist['files'])+')throw Error("baseline_source_dist_mismatch");'
        return script
    backend.compile_script=compile_script

def image_sources(image, paths):
    script='const fs=require("node:fs");const out={};for(const p of '+json.dumps(paths)+'){try{const s=fs.lstatSync("/app/"+p);if(!s.isFile()||s.isSymbolicLink()||s.size>4194304)throw Error("source_file_invalid");out[p]=fs.readFileSync("/app/"+p).toString("base64")}catch(e){if(e.code!=="ENOENT")throw e;out[p]=null}}console.log(JSON.stringify(out))'
    rows=json.loads(command('docker','run','--rm','--network','none','--read-only','--cpus','0.5','--memory','256m','--pids-limit','64','--entrypoint','node',image,'-e',script,timeout=120))
    return {p:base64.b64decode(value,validate=True) if value is not None else None for p,value in rows.items()}

def candidate_tests(repo,revision,candidate):
    roots=('apps/api/src/','coolify/releases/2026-11-01-welcome-offer/welcome-tests/','coolify/releases/2026-11-01-packages/billing-tests/')
    paths=merge.git(repo,'ls-tree','-r','--name-only',revision,'--',*roots).decode().splitlines()
    paths=[p for p in paths if (p.endswith('.test.ts') or p.endswith('.fixture.ts') or p.endswith('/fixtures.ts'))]
    if len([p for p in paths if '/device-login' in p])<4: raise GateError('all_qr_candidate_tests_required')
    config='coolify/releases/2026-11-03-qr-device-login/candidate-tests.config.ts'
    env=dict(backend.legacy.TEST_ENV)
    env.update({k:'' for k in ('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TEST_DATABASE_URL','PG_TEST_DATABASE_URL','DEVICE_LOGIN_TEST_DATABASE_URL','PACKAGE_CATALOG_TEST_DATABASE_URL','PACKAGE_PAYMENT_TEST_DATABASE_URL','WELCOME_OFFER_TEST_DATABASE_URL','GA4_WEB_API_SECRET','GA4_WINDOWS_API_SECRET')})
    env.update({'STRIPE_BILLING_ENABLED':'false','GA4_ENABLED':'false'})
    with tempfile.TemporaryDirectory(prefix='qr-candidate-tests-') as directory:
        args=['docker','run','--rm','--network','none','--cpus','1','--memory','1280m','--memory-swap','1536m','--pids-limit','256']
        for key,value in env.items(): args+=['-e',key+'='+value]
        for index,path in enumerate(paths+[config]):
            file=Path(directory)/str(index); file.write_bytes(merge.blob(repo,revision,path)); args+=['-v',str(file)+':/app/'+path+':ro']
        script=backend.legacy.cgroup()+'cp.execFileSync("npx",["--no-install","vitest","run","--root","/app","--config","/app/'+config+'","--maxWorkers=1"],{stdio:"inherit"});'
        command(*args,'--entrypoint','node',candidate,'-e',script,timeout=900)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo',type=Path); parser.add_argument('--revision',required=True)
    parser.add_argument('--base-image-id',required=True); parser.add_argument('--base-image-tag',required=True)
    parser.add_argument('--qrcode-tarball',required=True,type=Path); parser.add_argument('--source-pin',type=Path)
    action=parser.add_mutually_exclusive_group(); action.add_argument('--measure',action='store_true'); action.add_argument('--build',action='store_true'); action.add_argument('--verify-existing',action='store_true')
    args=parser.parse_args(); identity(args.base_image_id)
    tar=args.qrcode_tarball.read_bytes(); package_files=merge.tar_files(tar)
    paths=(*merge.MODIFIED,*merge.NEW,merge.PACKAGE,merge.LOCK,*package_files)
    configure(args.base_image_id,args.base_image_tag,paths,(*merge.NEW,*package_files))
    if backend.core.image(args.base_image_tag)['Id']!=args.base_image_id: raise GateError('source_image_tag_drift')
    before_host=backend.host_snapshot()
    before_images=set(command('docker','image','ls','--no-trunc','-q').decode().splitlines())
    source=backend.snapshot(args.base_image_id,'api')
    if any(source['sourceHashes'].get(path)!=digest for path,digest in ACTUAL_SOURCE_HASHES.items()): raise GateError('root_measured_actual_api_source_drift')
    if args.measure: print(json.dumps(source,sort_keys=True)); return
    if args.source_pin is None or json.loads(args.source_pin.read_bytes())!=source: raise GateError('independent_actual_source_pin_required')
    sources=image_sources(args.base_image_id,paths)
    def actual(path):
        if sources[path] is None: raise FileNotFoundError(path)
        return sources[path]
    updates,audit=merge.prepare(args.repo,args.revision,actual,tar)
    if set(updates)!=set(paths): raise GateError('overlay_manifest_differs')
    if not (args.build or args.verify_existing): print(json.dumps({'preflight':'passed','merge':audit},sort_keys=True)); return
    if shutil.disk_usage('/var/lib/docker').free<8*1024**3: raise GateError('requires_8GiB_no_pruning')
    base=backend.core.image(args.base_image_id)
    tag=target(args.revision)
    exists=tag in command('docker','image','ls','--format','{{.Repository}}:{{.Tag}}',tag).decode().splitlines()
    if args.build and exists: raise GateError('candidate_exists_use_verify_existing')
    expected=backend.compile_overlay('api',args.revision,base,updates,source,publish=args.build)
    candidate=backend.verify_candidate('api',args.revision,base,updates,source,expected)
    candidate_tests(args.repo,args.revision,candidate)
    if backend.host_snapshot()!=before_host: raise GateError('existing_host_changed')
    if not before_images<=set(command('docker','image','ls','--no-trunc','-q').decode().splitlines()): raise GateError('existing_image_removed')
    print(json.dumps({'candidate':candidate,'revision':args.revision,'merge':audit,'tests':'passed','migrationApplied':False},sort_keys=True))

if __name__=='__main__': main()
