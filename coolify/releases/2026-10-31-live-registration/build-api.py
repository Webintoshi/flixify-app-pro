#!/usr/bin/env python3
"""Build a surgical API overlay over the pinned production image; never deploy."""
from __future__ import annotations
import argparse
import difflib
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
helpers=load('trial_api_build_helpers',Path(__file__).parents[1]/'2026-10-26-edge-recovery'/'build-web.py')
core,command,GateError=helpers.core,helpers.command,helpers.GateError
SOURCE_TAG='flixify-api:trial-capacity-92aa1fda3c46-20261030'
SOURCE_ID='sha256:cd45f38ba327cc585760b3e2247f30c3d29f2e12bef5da66389bb9cb32027ca5'
BASE_REVISION='92aa1fda3c467304ff58fa6b2d427b2c39faa8ca'
PATHS=tuple('apps/api/src/'+name for name in ('env.ts','repository.ts','server.ts','registration-limits.ts','live-channel-policy.ts'))
NEW_PATHS=PATHS[-2:]
SOURCE_HASHES=dict(zip(PATHS[:3],('be076c85d2b2251fcd42431ef2d848ff9d4e5d964d8263c60def5de888649992','1eb5b3cdd17a62e245045abf56d9c04e75079945c3408e19f4896eb5cfbdc68a','3b47af4eab831cf64d6c3eeae9fa7b30d65a3be04a0ae4572ae79208af7590fb')))
TEST_PATHS=tuple('apps/api/src/'+name for name in ('trusted-proxy.test.ts','trusted-proxy-config.test.ts','trial-capacity-config.test.ts','auto-trial-registration.test.ts','auth-register.test.ts','registration-limits.test.ts','live-channel-policy.test.ts','personal-provider-session-route.test.ts'))
MIN_FREE_BYTES=8*1024**3
MEMORY_MIB,TOTAL_MEMORY_MIB=1280,1536
DIST='apps/api/dist/server.js'
SOURCE_UNTOUCHED_SHA256='b76269eb211c393e8474048579c1c0ddb347c8299d5301a939944b399b3b6ab7'
SOURCE_DIST_TREE_SHA256='6c9d7b887015a0960fe9e7d5433e9c9c6d38b659ff5ef54afaf78f3c2a07c70f'
EXCLUDED=(*PATHS,'apps/api/dist')
SOURCE_DIST={'chunk-DBUZ7TB3.js':{'bytes':8151,'sha256':'3174d90e275450effbf9a2bc4803829c59ed694e14bf846f4996d0143e58c198'},'db-HON6YE7G.js':{'bytes':121,'sha256':'5a182b9adfb0b30258a50c4b8a67ae03c01c21b546e1da65d88e2cb7545733bf'},'server.js':{'bytes':551376,'sha256':'c70d8efd58b42a7c65b6561cc2bc19945472fa45a75aa4aa22c6990544631c58'}}
TEST_ENV={'DATABASE_URL':'postgresql://127.0.0.1:9/unused','APP_JWT_SECRET':'test-only-secret-with-at-least-thirty-two-characters','REGISTRATION_GUARD_SECRET':'test-only-stable-registration-guard-secret-32-characters','ADMIN_EMAILS':'admin@example.test','SUPABASE_URL':'https://example.test','SUPABASE_JWKS_URL':'https://example.test/auth/v1/.well-known/jwks.json','APP_DEMO_MODE':'false'}

def target(revision):
    if not re.fullmatch(r'[0-9a-f]{40}',revision):raise GateError('exact_revision_required')
    return 'flixify-api:live-registration-'+revision[:12]+'-20261031'

def validate_scope(repo,revision):
    target(revision)
    for ref in (BASE_REVISION,revision):
        if command('git','-C',str(repo),'rev-parse',ref+'^{commit}').decode().strip()!=ref:raise GateError('api_revision_not_exact')
    command('git','-C',str(repo),'merge-base','--is-ancestor',BASE_REVISION,revision)
    changed=command('git','-C',str(repo),'diff','--name-only',BASE_REVISION,revision,'--','apps/api').decode().splitlines()
    if {p for p in changed if '.test.' not in p}!=set(PATHS):raise GateError('api_runtime_overlay_scope_differs')
    for path in (*PATHS,*TEST_PATHS):helpers.require_regular_blob(repo,revision,path)
    for path in NEW_PATHS:
        if helpers.git_entry(repo,BASE_REVISION,path):raise GateError('api_new_source_exists_in_git_baseline')

def patch_actual_lines(baseline,reviewed,original):
    """Apply only exact reviewed line edits, retaining production-only adjacent context."""
    old,new,actual=(value.splitlines(keepends=True) for value in (baseline,reviewed,original))
    mapping={}
    for block in difflib.SequenceMatcher(None,old,actual,autojunk=False).get_matching_blocks():
        for offset in range(block.size):mapping[block.a+offset]=block.b+offset
    edits=[]
    for operation,start,end,next_start,next_end in difflib.SequenceMatcher(None,old,new,autojunk=False).get_opcodes():
        if operation=='equal':continue
        if start<end:
            positions=[mapping.get(i) for i in range(start,end)]
            if any(i is None for i in positions) or positions!=list(range(positions[0],positions[0]+end-start)):
                raise GateError('api_reviewed_edit_overlaps_production_change')
            left,right=positions[0],positions[-1]+1
            if actual[left:right]!=old[start:end]:raise GateError('api_exact_removed_lines_differ')
        elif start and start-1 in mapping:left=right=mapping[start-1]+1
        elif start in mapping:left=right=mapping[start]
        else:raise GateError('api_reviewed_insertion_anchor_missing')
        before,after=start,end
        while before>max(0,start-4) and mapping.get(before-1)==left-(start-before)-1:before-=1
        while after<min(len(old),end+4) and mapping.get(after)==right+(after-end):after+=1
        window=old[before:after]
        if not window or sum(actual[i:i+len(window)]==window for i in range(len(actual)-len(window)+1))!=1:
            raise GateError('api_reviewed_edit_anchor_ambiguous')
        edits.append((left,right,new[next_start:next_end]))
    updated=actual.copy()
    for left,right,added in reversed(edits):updated[left:right]=added
    def changes(a,b):
        removed,added=[],[]
        for kind,x,y,u,v in difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes():
            if kind!='equal':removed.extend(a[x:y]);added.extend(b[u:v])
        return removed,added
    if changes(old,new)!=changes(actual,updated):raise GateError('api_reviewed_line_changes_differ')
    return b''.join(updated)

def patched_source(repo,revision,path,original):
    if path not in SOURCE_HASHES or hashlib.sha256(original).hexdigest()!=SOURCE_HASHES[path]:raise GateError('api_actual_source_hash_differs:'+path)
    return patch_actual_lines(core.git_file(repo,BASE_REVISION,path),core.git_file(repo,revision,path),original)

def snapshot_function():
    return r'''const crypto=require('node:crypto');function snapshot(root,skip=[]){let count=0;const result=crypto.createHash('sha256'),buffer=Buffer.alloc(65536);function visit(relative){if(skip.includes(relative))return;const p=relative?root+'/'+relative:root,s=fs.lstatSync(p),mode=s.mode&4095;let row;if(s.isSymbolicLink())row=['link',relative,mode,fs.readlinkSync(p)];else if(s.isDirectory()){row=['dir',relative,mode];result.update(JSON.stringify(row)+'\n');for(const name of fs.readdirSync(p).sort())visit(relative?relative+'/'+name:name);return}else if(s.isFile()){const digest=crypto.createHash('sha256'),fd=fs.openSync(p,'r');try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)digest.update(buffer.subarray(0,n))}finally{fs.closeSync(fd)}row=['file',relative,mode,s.size,digest.digest('hex')];count++}else throw Error('unexpected_filesystem_entry');result.update(JSON.stringify(row)+'\n')}visit('');return{sha256:result.digest('hex'),files:count}};'''

def snapshot_script():
    return "const fs=require('node:fs');"+snapshot_function()+"const p=require.resolve('fastify/package.json',{paths:['/app/apps/api','/app']}),dir='/app/apps/api/dist/',names=fs.readdirSync(dir).sort(),entries={};for(const name of names){const s=fs.lstatSync(dir+name);if(!s.isFile())throw Error('api_dist_not_regular');entries[name]={bytes:s.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(dir+name)).digest('hex')}}console.log(JSON.stringify({distEntries:entries,untouched:snapshot('/app',"+json.dumps(EXCLUDED)+"),dist:snapshot('/app/apps/api/dist'),distFiles:fs.readdirSync('/app/apps/api/dist').sort(),fastify:JSON.parse(fs.readFileSync(p,'utf8')).version}));"

def snapshot(image):
    return json.loads(command('docker','run','--rm','--network','none','--memory','512m','--memory-swap','640m','--pids-limit','128','--entrypoint','node',image,'-e',snapshot_script(),timeout=180))

def cgroup():return helpers.build_script().split('const p=',1)[0]

def compile_script(expected_dist=None):
    script=cgroup()+'cp.execFileSync("npm",["run","build","-w","@flixify/api"],{stdio:"inherit"});'
    if expected_dist is not None:
        script+=snapshot_function()+"if(JSON.stringify(snapshot('/app/apps/api/dist'))!=="+json.dumps(json.dumps(expected_dist,separators=(',',':')))+")throw Error('baseline_source_dist_mismatch');"
    return script

def preflight(repo,revision):
    validate_scope(repo,revision)
    base=core.image(SOURCE_ID)
    if base['Id']!=SOURCE_ID or core.image(SOURCE_TAG)['Id']!=SOURCE_ID:raise GateError('api_source_image_drift')
    current=json.loads(command('docker','inspect','api-'+core.UUID))[0]
    if current['Image']!=SOURCE_ID or current['Config']['Image']!=SOURCE_TAG or not current['State']['Running'] or (current['Config'].get('Labels') or {}).get('com.docker.compose.project')!=core.UUID:raise GateError('api_running_source_drift')
    updated={}
    for path in PATHS:
        if path in NEW_PATHS:
            old=helpers.SOURCE_ID;helpers.SOURCE_ID=SOURCE_ID
            try:helpers.require_image_absent(path)
            finally:helpers.SOURCE_ID=old
            updated[path]=core.git_file(repo,revision,path)
        else:updated[path]=patched_source(repo,revision,path,helpers.image_file(SOURCE_ID,path))
    before=snapshot(SOURCE_ID)
    if before['fastify']!='5.12.5' or before['distEntries']!=SOURCE_DIST or before['untouched']['sha256']!=SOURCE_UNTOUCHED_SHA256 or before['dist']['sha256']!=SOURCE_DIST_TREE_SHA256:raise GateError('api_production_dependency_or_artifact_shape_drift')
    return base,updated,before

def compile_checked(name,expected_dist=None):
    args=('docker','exec',name,'node','-e',compile_script(expected_dist))
    try:result=subprocess.run(args,capture_output=True,timeout=300)
    except (OSError,subprocess.TimeoutExpired) as error:raise GateError('api_isolated_compile_unavailable') from error
    if result.returncode:
        if b'baseline_source_dist_mismatch' in result.stdout+result.stderr:raise GateError('baseline_source_dist_mismatch')
        raise GateError('api_isolated_compile_failed:'+core.safe_failure_summary(result.returncode,result.stdout,result.stderr))

def compile_overlay(base,revision,updated,before,publish=True):
    config=base.get('Config') or {}
    if not config.get('Cmd') or config.get('Volumes'):raise GateError('api_base_config_unsupported')
    name='flixify-trial-api-build-'+uuid.uuid4().hex[:12];created=False
    try:
        command('docker','create','--name',name,'--network','none','--memory',str(MEMORY_MIB)+'m','--memory-swap',str(TOTAL_MEMORY_MIB)+'m','--pids-limit','256',SOURCE_ID,'node','-e','setInterval(()=>{},2147483647)');created=True
        command('docker','start',name)
        compile_checked(name,before['dist'])
        print('baseline_actual_source_dist_verified; before_overlay')
        with tempfile.TemporaryDirectory(prefix='flixify-trial-api-overlay-') as directory:
            for index,(path,value) in enumerate(updated.items()):
                source=Path(directory)/str(index);source.write_bytes(value);source.chmod(0o644);command('docker','cp',str(source),name+':/app/'+path)
        compile_checked(name)
        expected=json.loads(command('docker','exec',name,'node','-e',snapshot_script(),timeout=180))
        if expected['untouched']!=before['untouched'] or expected['fastify']!=before['fastify'] or 'server.js' not in expected['distFiles'] or any(not re.fullmatch(r'[A-Za-z0-9_-]+\.js',p) for p in expected['distFiles']):raise GateError('api_compile_changed_untouched_runtime_or_dependencies')
        if publish:
            command('docker','commit','--change','CMD '+json.dumps(config['Cmd']),'--change','LABEL org.opencontainers.image.revision='+revision,'--change','LABEL vip.flixify.edge-recovery.base='+SOURCE_ID,name,target(revision),timeout=300)
        return expected
    finally:
        if created:command('docker','rm','--force',name)

def verify_candidate(base,revision,updated,before,expected):
    candidate=core.image(target(revision));labels=candidate.get('Config',{}).get('Labels') or {};layers=base.get('RootFS',{}).get('Layers') or []
    if candidate['Id']==SOURCE_ID or labels.get('org.opencontainers.image.revision')!=revision or labels.get('vip.flixify.edge-recovery.base')!=SOURCE_ID or not layers or candidate.get('RootFS',{}).get('Layers',[])[:len(layers)]!=layers:raise GateError('api_candidate_identity_or_ancestry_differs')
    config=dict(base['Config']);config['Labels']=dict(config.get('Labels') or {})|{'org.opencontainers.image.revision':revision,'vip.flixify.edge-recovery.base':SOURCE_ID}
    for key in ('Env','Cmd','Entrypoint','WorkingDir','User','Healthcheck','Volumes','ExposedPorts','StopSignal','Shell','Labels'):
        if candidate['Config'].get(key)!=config.get(key):raise GateError('api_candidate_config_differs')
    for path,value in updated.items():
        if helpers.image_file(candidate['Id'],path)!=value:raise GateError('api_candidate_source_differs')
    if snapshot(candidate['Id'])!=expected or expected['untouched']!=before['untouched']:raise GateError('api_candidate_compiled_runtime_or_dependencies_differ')
    command('docker','run','--rm','--network','none','--memory','512m','--memory-swap','640m','--pids-limit','128','--entrypoint','node',candidate['Id'],'--check','/app/'+DIST)
    print('candidate_source_dist_and_untouched_runtime_verified; production_fastify_retained')
    return candidate['Id']

def test_candidate(repo,revision,candidate):
    with tempfile.TemporaryDirectory(prefix='flixify-trial-api-tests-') as directory:
        args=['docker','run','--rm','--network','none','--memory',str(MEMORY_MIB)+'m','--memory-swap',str(TOTAL_MEMORY_MIB)+'m','--pids-limit','256']
        for key,value in TEST_ENV.items():args+=['-e',key+'='+value]
        for index,path in enumerate(TEST_PATHS):
            file=Path(directory)/str(index);file.write_bytes(core.git_file(repo,revision,path));args+=['-v',str(file)+':/app/'+path+':ro']
        script=cgroup()+'cp.execFileSync("npx",'+json.dumps(['--no-install','vitest','run','--root','/app',*TEST_PATHS])+',{stdio:"inherit"});'
        command(*args,'--entrypoint','node',candidate,'-e',script,timeout=240)
    print('candidate_api_regressions_passed; production_dependencies_retained; network_none')

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source_repo',type=Path);parser.add_argument('--revision',required=True)
    actions=parser.add_mutually_exclusive_group();actions.add_argument('--build',action='store_true');actions.add_argument('--verify-existing',action='store_true');args=parser.parse_args()
    base,updated,before=preflight(args.source_repo,args.revision)
    if not (args.build or args.verify_existing):print('trial_api_preflight_ok; no_live_mutation; actual_source_patches_pinned');return
    if args.build or args.verify_existing:
        if shutil.disk_usage('/var/lib/docker').free<MIN_FREE_BYTES:raise GateError('api_build_requires_8GiB')
        if args.build and target(args.revision) in command('docker','image','ls','--format','{{.Repository}}:{{.Tag}}',target(args.revision)).decode().splitlines():raise GateError('candidate_tag_exists_use_verify_existing')
        expected=compile_overlay(base,args.revision,updated,before,publish=args.build)
    candidate=verify_candidate(base,args.revision,updated,before,expected);test_candidate(args.source_repo,args.revision,candidate)
    print('candidate_verified:'+candidate)

if __name__=='__main__':
    try:main()
    except GateError as error:print('build_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print('build_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
