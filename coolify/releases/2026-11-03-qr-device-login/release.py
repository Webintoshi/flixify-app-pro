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
flat=load('qr_release_web_flatten',HERE/'flatten.py')
reviewed=load('qr_reviewed_release_transaction',HERE.parent/'2026-11-01-packages/release-backend.py')
guard=reviewed.guard
BASELINES={
 'api':('flixify-api:analytics-07fbf0bf4b29-20261102','sha256:b7ef006b1733516a73f5ef1e5388b2cc7e746f738d0e4ebd80c164ad34067eb0'),
 'ops-web':('flixify-ops-web:forced-consent-eb3867d7dfdc-20261103','sha256:85892877db795825c23fc51ad3f56c77bcb503d0000f2fd35bd1c263a208f7f5'),
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
            ancestry=bool(layers) and candidate['RootFS']['Layers'][:len(layers)]==layers
            if name=='ops-web' and flat.flat_ancestry(candidate,base,revision): ancestry=True
            if candidate['Id']!=candidate_id or candidate_id==base['Id'] or not ancestry or labels.get('org.opencontainers.image.revision')!=revision or labels.get('vip.flixify.edge-recovery.base')!=base['Id']:
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


def rollback_sql(allow_absent):
    return ("""begin;
set local lock_timeout='15s';
set local statement_timeout='45s';
lock table public.device_sessions in share row exclusive mode;
do $qr_rollback$
declare
  has_auth boolean;
  has_family boolean;
  has_requests boolean;
begin
  select exists(select 1 from pg_attribute where attrelid='public.device_sessions'::regclass and attname='auth_method' and not attisdropped) into has_auth;
  select exists(select 1 from pg_attribute where attrelid='public.device_sessions'::regclass and attname='family_id' and not attisdropped) into has_family;
  has_requests := to_regclass('public.device_login_requests') is not null;
  if not has_auth and not has_family and not has_requests and ALLOW_ABSENT then
    return;
  end if;
  if not has_auth or not has_family or not has_requests then
    raise exception 'qr_rollback_schema_incomplete';
  end if;
  lock table public.device_login_requests in share row exclusive mode;
  update public.device_sessions set revoked_at=coalesce(revoked_at,clock_timestamp())
    where auth_method='device_link';
  update public.device_login_requests set state='cancelled',envelope=null;
  if exists(select 1 from public.device_sessions where auth_method='device_link' and revoked_at is null)
    or exists(select 1 from public.device_login_requests where envelope is not null or state <> 'cancelled') then
    raise exception 'qr_rollback_revocation_incomplete';
  end if;
end $qr_rollback$;
commit;
select 'qr_rollback_revoked';
""").replace('ALLOW_ABSENT', 'true' if allow_absent else 'false').encode()


def safe_rollback():
    _, compose, env, before, _, _ = guard.preflight('target', recovering=True)
    candidates = guard.candidate_images()
    guard.verify_source_images()
    current = guard.container_snapshot(allow_missing_changed=True)
    if guard.container_identity(current) != guard.container_identity(before):
        raise api.GateError('qr_rollback_api_drift')
    row = current['api']
    baseline = row['tag'] == guard.SOURCE['api'] and row['image_id'] == guard.SOURCE_IDS['api']
    if row['tag'] == guard.TARGET['api']:
        if row['image_id'] != candidates['api']:
            raise api.GateError('qr_rollback_api_drift')
        if row['running']:
            # Stop by immutable container ID; return means all its processes exited.
            guard.command('docker', 'stop', '--time', '30', row['id'], timeout=45)
    elif not baseline and row['id'] is not None:
        raise api.GateError('qr_rollback_api_drift')
    stopped = guard.container_snapshot(allow_missing_changed=True)
    # Docker can clear network endpoints on stop; ID/image/tag/config hash stay pinned.
    expected_stopped = dict(current)
    if not baseline:
        expected_stopped['api'] = {**row, 'guard': stopped['api'].get('guard')}
    if guard.container_identity(stopped) != guard.container_identity(expected_stopped) or (not baseline and stopped['api']['running']):
        raise api.GateError('qr_rollback_api_not_stopped')
    guard.verify_recovery_context(before, compose, env)
    if stopped['db']['image_id'] != DB:
        raise api.GateError('qr_rollback_database_drift')
    result = guard.command('docker', 'exec', '-i', stopped['db']['id'], 'sh', '-c',
        'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"',
        input_data=rollback_sql(baseline), timeout=60)
    if result.strip() != b'qr_rollback_revoked':
        raise api.GateError('qr_rollback_revocation_unconfirmed')
    fresh = guard.container_snapshot(allow_missing_changed=True)
    if guard.container_identity(fresh) != guard.container_identity(stopped) or (not baseline and fresh['api']['running']):
        raise api.GateError('qr_rollback_api_restarted')
    guard.verify_recovery_context(before, compose, env)
    guard.rollback()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision',required=True);parser.add_argument('--api-candidate-id',required=True);parser.add_argument('--web-candidate-id',required=True)
    parser.add_argument('--migration-receipt',type=Path);parser.add_argument('--migration-sha256')
    actions=parser.add_mutually_exclusive_group()
    for name in ('apply','recreate','rollback'):actions.add_argument('--'+name,action='store_true')
    args=parser.parse_args();configure(args.revision,{'api':args.api_candidate_id,'ops-web':args.web_candidate_id})
    action='rollback' if args.rollback else 'recreate' if args.recreate else 'apply' if args.apply else None
    if action != 'rollback':
        receipt=json.loads(args.migration_receipt.read_bytes()) if args.migration_receipt else {}
        if not re.fullmatch('[a-f0-9]{64}',args.migration_sha256 or '') or receipt.get('migrationSha256')!=args.migration_sha256 or receipt.get('applied') is not True or receipt.get('postgresTestsPassed') is not True:
            raise api.GateError('actual_migration_and_postgres_test_receipt_required')
    def run():
        before=protected()
        if action=='rollback':
            with contextlib.redirect_stdout(io.StringIO()):safe_rollback()
        elif action=='recreate':
            record,compose,env,containers,raw,rendered=guard.preflight('target')
            try:
                with contextlib.redirect_stdout(io.StringIO()):guard.recreate(containers,compose,env,raw,rendered)
            except Exception:
                guard.verify_recovery_context(containers,compose,env)
                with contextlib.redirect_stdout(io.StringIO()):safe_rollback()
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
