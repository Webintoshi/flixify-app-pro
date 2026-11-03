#!/usr/bin/env python3
"""Existing guarded two-image transaction, with QR pins and no environment edits."""
import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil

HERE=Path(__file__).resolve().parent

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

api=load('qr_release_api_builder',HERE/'build-api.py')
reviewed=load('qr_reviewed_release_transaction',HERE.parent/'2026-11-01-packages/release-backend.py')
guard=reviewed.guard
BASELINES={
 'api':('flixify-api:analytics-07fbf0bf4b29-20261102','sha256:b7ef006b1733516a73f5ef1e5388b2cc7e746f738d0e4ebd80c164ad34067eb0'),
 'ops-web':('flixify-ops-web:tv-first-content-publication-4d6cb8548e1c-20261103','sha256:8cae91c65a3fd53762ed13d6b6d27cd3893f58965b4c3766bed35711e48aa873'),
}
WORKER=('flixify-worker:packages-8fa66d103053-20261101','sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57')
DB='sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
ENV_SHA='c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42'
FENCE_SHA='5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b'


def configure(revision,candidates):
    api.target(revision)
    if set(candidates)!=set(BASELINES): raise api.GateError('two_exact_candidates_required')
    for value in candidates.values():api.identity(value)
    guard.REVISION=revision
    guard.CHANGED,guard.PROTECTED=('api','ops-web'),('db','worker')
    guard.SOURCE={k:v[0] for k,v in BASELINES.items()};guard.SOURCE_IDS={k:v[1] for k,v in BASELINES.items()}
    guard.TARGET={'api':api.target(revision),'ops-web':'flixify-ops-web:qr-device-login-'+revision[:12]+'-20261103'}
    guard.PROTECTED_IMAGES={'worker':WORKER};guard.PROTECTED_DB_IMAGE_ID=DB
    guard.PHP_READ_APPLICATIONS=reviewed.READ_APPLICATIONS.replace("['worker']","['api', 'ops-web']")
    guard.protected_application_images=lambda:json.loads(guard.command('docker','exec','coolify','php','-r',reviewed.READ_APPLICATIONS))
    guard.validate_plan=reviewed.validate_plan
    def candidate_images():
        for name,candidate_id in candidates.items():
            candidate=guard.image(guard.TARGET[name]);base=guard.image(guard.SOURCE_IDS[name]);labels=candidate['Config'].get('Labels') or {};layers=base['RootFS']['Layers']
            if candidate['Id']!=candidate_id or candidate_id==base['Id'] or not layers or candidate['RootFS']['Layers'][:len(layers)]!=layers or labels.get('org.opencontainers.image.revision')!=revision or labels.get('vip.flixify.edge-recovery.base')!=base['Id']:
                raise api.GateError('candidate_identity_or_ancestry_drift:'+name)
        return candidates
    guard.candidate_images=candidate_images
    def healthy(name,tag,identity=None):
        try:
            row=guard.container_snapshot(allow_missing_changed=True)[name]
            if row['tag']!=tag or row['image_id']!=identity or not row['running'] or row['health']=='unhealthy' or row['hash']!=guard.compose_hash(name): return False
            if name=='api':
                script='const r=await fetch("http://127.0.0.1:4000/health",{signal:AbortSignal.timeout(8000)});if(r.status!==200||(await r.json()).ok!==true)throw Error("health");'
            else:
                paths=['/','/indir','/paketler']+(['/cihaz','/giris-yap'] if tag==guard.TARGET[name] else [])
                script='for(const p of '+json.dumps(paths)+'){const r=await fetch("http://127.0.0.1:3000"+p,{signal:AbortSignal.timeout(8000)});if(r.status!==200)throw Error("health");}'
            guard.command('docker','exec',name+'-'+guard.UUID,'node','-e','(async()=>{'+script+'})().catch(()=>process.exit(1))',timeout=60)
            return True
        except Exception:return False
    guard.healthy=healthy

def protected():
    snapshot=api.backend.host_snapshot()
    if snapshot['environment']!=ENV_SHA or snapshot['registrationFence']!=FENCE_SHA:raise api.GateError('environment_or_registration_fence_drift')
    return {k:v for k,v in snapshot.items() if not isinstance(v,dict) or v.get('name') not in ('/api-'+guard.UUID,'/ops-web-'+guard.UUID)}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision',required=True);parser.add_argument('--api-candidate-id',required=True);parser.add_argument('--web-candidate-id',required=True)
    parser.add_argument('--migration-receipt',type=Path,required=True);parser.add_argument('--migration-sha256',required=True)
    actions=parser.add_mutually_exclusive_group()
    for name in ('apply','recreate','rollback'):actions.add_argument('--'+name,action='store_true')
    args=parser.parse_args();configure(args.revision,{'api':args.api_candidate_id,'ops-web':args.web_candidate_id})
    receipt=json.loads(args.migration_receipt.read_bytes())
    if not re.fullmatch('[a-f0-9]{64}',args.migration_sha256) or receipt.get('migrationSha256')!=args.migration_sha256 or receipt.get('applied') is not True or receipt.get('postgresTestsPassed') is not True:
        raise api.GateError('actual_migration_and_postgres_test_receipt_required')
    action='rollback' if args.rollback else 'recreate' if args.recreate else 'apply' if args.apply else None
    def run():
        before=protected()
        if action=='rollback':
            with contextlib.redirect_stdout(io.StringIO()):guard.rollback()
        elif action=='recreate':
            record,compose,env,containers,raw,rendered=guard.preflight('target')
            try:
                with contextlib.redirect_stdout(io.StringIO()):guard.recreate(containers,compose,env,raw,rendered)
            except Exception:
                guard.verify_recovery_context(containers,compose,env)
                with contextlib.redirect_stdout(io.StringIO()):guard.rollback()
                raise api.GateError('cutover_failed_old_images_restored')
        else:
            record,compose,env,containers,raw,rendered=guard.preflight('source')
            if action=='apply':
                with contextlib.redirect_stdout(io.StringIO()):guard.sync_images(record,compose,env,containers,raw,rendered,guard.SOURCE,guard.TARGET)
        if protected()!=before:raise api.GateError('protected_runtime_or_environment_changed')
        print('qr_'+(action or 'preflight')+'_verified; additive_schema_retained')
    if action:
        if action!='rollback' and shutil.disk_usage('/var/lib/docker').free<8*1024**3:raise api.GateError('requires_8GiB_no_pruning')
        with reviewed.release_lock():run()
    else:run()

if __name__=='__main__':main()
