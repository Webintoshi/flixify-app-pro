#!/usr/bin/env python3
"""Narrow welcome-offer API overlay over the actual current production source."""
from __future__ import annotations
import hashlib
import importlib.util
import json
import re
import sys
import tempfile
from pathlib import Path

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
HERE=Path(__file__).parent
reviewed=load('welcome_reviewed_backend',HERE.parent/'2026-11-01-packages'/'build-backend.py')
GateError,core,helpers,command=reviewed.GateError,reviewed.core,reviewed.helpers,reviewed.command
BASE_REVISION='1e41bf2f092b2b87518af045aba9ce67dd16db05'
API_TAG='flixify-api:embedded-page-b0def990e266-20261101'
API_ID='sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1'
WEB_TAG='flixify-ops-web:tv-cache-repair-b9a7f606ba86-20261101'
WEB_ID='sha256:33e838ffbec2318214458b7a42868b58a974dac3cb48374cce3be63fc7064a63'
WORKER_TAG='flixify-worker:packages-8fa66d103053-20261101'
WORKER_ID='sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57'
DB_ID=reviewed.DB_ID
ENV_SHA256='c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42'
FENCE_SHA256='5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b'
ROOT='coolify/releases/2026-11-01-welcome-offer/'
API_SOURCE_ROOT=ROOT+'api-source/'
API_SOURCE_MANIFEST=ROOT+'api-source-manifest.json'
API_NAMES=('stripe-billing-routes.ts','stripe-billing-store.ts','stripe-billing-api.ts','stripe-payment-api.ts','stripe-payment.ts','stripe-payment-store.ts','welcome-offer.ts','welcome-offer-store.ts','welcome-offer-routes.ts')
API_NEW_PATHS=tuple('apps/api/src/'+name for name in API_NAMES[-3:])
PATCH_FILES={'apps/api/src/server.ts':(ROOT+'api-patches.json',2),'apps/api/src/repository.ts':(ROOT+'repository-patches.json',1)}
API_PATHS=tuple('apps/api/src/'+name for name in API_NAMES)+tuple(PATCH_FILES)
WEB_PATHS=tuple('apps/ops-web/'+name for name in ('app/platform/welcome-offer.tsx','app/platform/welcome-offer-model.ts','app/platform/welcome-offer.module.css','app/site-shell.tsx','app/paketler/page.tsx','app/paketler/packages-model.ts','components/ui/pricing.tsx','components/ui/pricing.module.css','lib/api.ts','app/platform/tv-download.ts','components/ui/package-checkout.tsx'))
WEB_NEW_PATHS=WEB_PATHS[:3]
PUBLIC_PATHS=('apps/ops-web/public/downloads/flixify-pro-1.4.6.apk','apps/ops-web/public/downloads/flixify-tv-update.json')
MIGRATION='supabase/migrations/202611010003_welcome_monthly_offer.sql'
HISTORICAL_TEST_ROOT='coolify/releases/2026-11-01-packages/'
WELCOME_TEST_FILES=tuple(ROOT+'welcome-tests/'+name for name in ('checkout-offer.test.ts','payment-offer.test.ts','welcome-state.test.ts','payment-postgres.test.ts','api-coupon.test.ts'))
API_TEST_FILES=(ROOT+'billing-vitest.config.ts',*WELCOME_TEST_FILES,*(path for path in reviewed.API_TEST_FILES if path!=HISTORICAL_TEST_ROOT+'billing-vitest.config.ts'))
original_host_snapshot=reviewed.host_snapshot

def validate_runtime_proofs(value):
    if value.get('environment')!=ENV_SHA256 or value.get('registrationFence')!=FENCE_SHA256:raise GateError('welcome_accepted_environment_or_fence_digest_differs')
    return value

def host_snapshot():return validate_runtime_proofs(original_host_snapshot())

def configuration(service):
    if service!='api':raise GateError('welcome_offer_is_api_only')
    return {'tag':API_TAG,'id':API_ID,'paths':API_PATHS,'new':API_NEW_PATHS,'dist':'apps/api/dist','entry':'server.js'}

def target(service,revision):
    configuration(service)
    if not isinstance(revision,str) or not re.fullmatch(r'[0-9a-f]{40}',revision):raise GateError('exact_revision_required')
    return 'flixify-api:welcome-offer-'+revision[:12]+'-20261101'

def patch_source(path,original,description):
    if path not in PATCH_FILES or not isinstance(description,dict) or description.get('path')!=path:raise GateError('welcome_patch_path_differs')
    value=dict(description);value['path']='apps/api/src/server.ts'
    previous=reviewed.SERVER_PATCH_COUNT
    reviewed.SERVER_PATCH_COUNT=PATCH_FILES[path][1]
    try:return reviewed.patch_server(original,value)
    finally:reviewed.SERVER_PATCH_COUNT=previous

def support_path(path):
    return (path.startswith(ROOT) or path==MIGRATION or path.startswith('apps/tv-android/') or
        bool(re.fullmatch(r'docs/[A-Za-z0-9_./-]+\.md',path)) or
        bool(re.fullmatch(r'apps/ops-web/(?:app|components|lib)/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?',path)))

def validate_companion_scope(repo,revision):
    for ref in (BASE_REVISION,revision):
        target('api',ref)
        if command('git','-C',str(repo),'rev-parse',ref+'^{commit}').decode().strip()!=ref:raise GateError('welcome_revision_not_exact')
    command('git','-C',str(repo),'merge-base','--is-ancestor',BASE_REVISION,revision)
    changed=command('git','-C',str(repo),'diff','--no-renames','--name-only',BASE_REVISION,revision).decode().splitlines()
    for path in changed:
        if path not in (*WEB_PATHS,*PUBLIC_PATHS) and not support_path(path):raise GateError('change_outside_welcome_source_scope:'+path)
        helpers.require_regular_blob(repo,revision,path)

def updated_sources(repo,revision,service,pin):
    configuration(service);validate_companion_scope(repo,revision)
    changed=set(command('git','-C',str(repo),'diff','--name-only',BASE_REVISION,revision,'--',API_SOURCE_ROOT).decode().splitlines())
    if changed!={API_SOURCE_ROOT+name for name in API_NAMES}:raise GateError('welcome_api_module_scope_differs')
    helpers.require_regular_blob(repo,revision,API_SOURCE_MANIFEST)
    manifest=json.loads(core.git_file(repo,revision,API_SOURCE_MANIFEST))
    if not isinstance(manifest,dict) or set(manifest)!={'runtimeSources','patches'}:raise GateError('welcome_api_manifest_shape_differs')
    entries=manifest['runtimeSources']
    if not isinstance(entries,list) or len(entries)!=len(API_NAMES) or {x.get('path') for x in entries if isinstance(x,dict)}!=set(API_PATHS)-set(PATCH_FILES):raise GateError('welcome_api_manifest_scope_differs')
    updates={}
    for path in API_PATHS:
        original=None if path in API_NEW_PATHS else helpers.image_file(API_ID,path)
        if original is not None and hashlib.sha256(original).hexdigest()!=pin['sourceHashes'][path]:raise GateError('welcome_actual_source_hash_differs:'+path)
        if path in API_NEW_PATHS:
            previous=helpers.SOURCE_ID;helpers.SOURCE_ID=API_ID
            try:helpers.require_image_absent(path)
            finally:helpers.SOURCE_ID=previous
        if path in PATCH_FILES:continue
        source=API_SOURCE_ROOT+Path(path).name;helpers.require_regular_blob(repo,revision,source)
        value=core.git_file(repo,revision,source)
        if value==original:raise GateError('welcome_overlay_unchanged:'+path)
        updates[path]=value
        matching=[x for x in entries if x['path']==path]
        expected={'path':path,'source':source,'new':path in API_NEW_PATHS,'sha256':hashlib.sha256(value).hexdigest()}
        if len(matching)!=1 or matching[0]!=expected or type(matching[0]['new']) is not bool:raise GateError('welcome_api_manifest_digest_differs:'+path)
    patches=manifest['patches']
    if not isinstance(patches,list) or len(patches)!=len(PATCH_FILES):raise GateError('welcome_patch_manifest_scope_differs')
    for entry,(path,(source,count)) in zip(patches,PATCH_FILES.items()):
        helpers.require_regular_blob(repo,revision,source);data=core.git_file(repo,revision,source)
        if entry!={'path':path,'source':source,'sha256':hashlib.sha256(data).hexdigest()}:raise GateError('welcome_patch_manifest_digest_differs')
        updates[path]=patch_source(path,helpers.image_file(API_ID,path),json.loads(data))
    return updates

def test_candidate(repo,revision,service,candidate):
    configuration(service)
    tests={}
    for path in API_TEST_FILES:
        helpers.require_regular_blob(repo,revision,path);value=core.git_file(repo,revision,path)
        if not 1<=len(value)<=1024*1024:raise GateError('welcome_regression_file_size_invalid')
        tests[path]=value
    environment=dict(reviewed.legacy.TEST_ENV)
    environment.update({key:'' for key in ('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TEST_DATABASE_URL','PG_TEST_DATABASE_URL','PACKAGE_CATALOG_TEST_DATABASE_URL','PACKAGE_PAYMENT_TEST_DATABASE_URL','WELCOME_OFFER_TEST_DATABASE_URL')})
    environment['STRIPE_BILLING_ENABLED']='false'
    with tempfile.TemporaryDirectory(prefix='welcome-api-regressions-') as directory:
        args=['docker','run','--rm','--network','none','--memory','1280m','--memory-swap','1536m','--pids-limit','256']
        for key,value in environment.items():args.extend(('-e',key+'='+value))
        for index,(path,value) in enumerate(tests.items()):
            source=Path(directory)/str(index);source.write_bytes(value);args.extend(('-v',str(source)+':/app/'+path+':ro'))
        setup="for(const name of ['referral-policy.ts','time.ts','user-route-error.ts']){const s=fs.lstatSync('/app/apps/api/src/'+name);if(!s.isFile()||s.isSymbolicLink())throw Error('candidate_dependency_not_regular')}"
        for root in (ROOT,HISTORICAL_TEST_ROOT):
            setup+="{const root='/app/"+root.rstrip('/')+"';const alias=root+'/api-source';if(fs.existsSync(alias)||fs.lstatSync(root).isSymbolicLink())throw Error('candidate_source_alias_exists');fs.symlinkSync('/app/apps/api/src',alias,'dir')}"
        arguments=['--no-install','vitest','run','--root','/app','--config','/app/'+ROOT+'billing-vitest.config.ts']
        script=reviewed.legacy.cgroup()+setup+'cp.execFileSync("npx",'+json.dumps(arguments)+',{stdio:"inherit"});'
        command(*args,'--entrypoint','node',candidate,'-e',script,timeout=300)
    print('backend_candidate_regressions_passed:api; actual_source_aliases; network_none; fixture_environment')

reviewed.configuration,reviewed.target,reviewed.updated_sources=configuration,target,updated_sources
reviewed.test_candidate=test_candidate
reviewed.host_snapshot=host_snapshot
snapshot_script,validate_source_pin,main=reviewed.snapshot_script,reviewed.validate_source_pin,reviewed.main
# The reviewed builder API_ID remains the permanent registration-fence proof249.
if __name__=='__main__':
    try:main()
    except GateError as error:print('build_stopped:'+str(error),file=sys.stderr);sys.exit(1)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as error:print('build_stopped:'+type(error).__name__,file=sys.stderr);sys.exit(1)
