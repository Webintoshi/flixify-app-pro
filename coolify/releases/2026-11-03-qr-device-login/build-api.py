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
import uuid

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
QR_TESTS=tuple('apps/api/src/'+name+'.test.ts' for name in ('device-login','device-login-routes','device-login-server'))
QR_POSTGRES_TEST='apps/api/src/device-login-postgres.test.ts'
# Preserve the existing offline config exclusion for operational PostgreSQL tests.
EXCLUDED_POSTGRES_TEST='coolify/releases/2026-11-01-packages/billing-tests/payment-postgres.test.ts'

def validate_test_report(report, paths):
    if (not isinstance(report,dict) or any(type(report.get(field)) is not int or report[field] != 0
            for field in ('unhandledErrors','suiteErrors','numPendingTestSuites','numTodoTests'))):
        raise GateError('candidate_test_runtime_or_suite_error')
    expected=set(paths)-{EXCLUDED_POSTGRES_TEST}
    cases,seen={},set()
    suites=report.get('suites')
    if not isinstance(suites,list):raise GateError('candidate_test_report_invalid')
    for suite in suites:
        path=suite.get('path','') if isinstance(suite,dict) else ''
        if not isinstance(path,str) or not path.startswith('/app/'):raise GateError('candidate_test_path_invalid')
        path=path[5:]
        if path not in expected or path in seen or suite.get('hasError') is not False:
            raise GateError('candidate_test_suite_coverage_or_load_error')
        seen.add(path)
        rows=suite.get('cases')
        if not isinstance(rows,list) or not rows:raise GateError('candidate_test_empty_suite')
        failed=False
        for row in rows:
            name=row.get('fullName') if isinstance(row,dict) else None
            status=row.get('status') if isinstance(row,dict) else None
            if (not isinstance(name,str) or not name or len(name)>2000 or re.search(r'[\x00-\x1f\x7f]',name)
                    or status not in ('passed','failed','skipped') or (path,name) in cases):
                raise GateError('candidate_test_case_invalid_or_duplicate')
            digest=row.get('errorFirstLineSha256')
            if status=='failed':
                if not isinstance(digest,str) or not re.fullmatch('[a-f0-9]{64}',digest):raise GateError('candidate_test_error_signature_missing')
                failed=True
            elif digest is not None:raise GateError('candidate_test_unexpected_error_signature')
            cases[path,name]={'status':status,'errorFirstLineSha256':digest}
        if suite.get('status') != ('failed' if failed else 'passed'):raise GateError('candidate_test_unattributed_suite_failure')
    if seen != expected:raise GateError('candidate_test_missing_frozen_suite')
    counts={'total':len(cases),**{status:sum(case['status']==status for case in cases.values()) for status in ('passed','failed','skipped')}}
    for field,status in (('numTotalTests','total'),('numPassedTests','passed'),('numFailedTests','failed'),('numPendingTests','skipped')):
        if type(report.get(field)) is not int or report[field]!=counts[status]:raise GateError('candidate_test_counts_differ')
    if type(report.get('exitCode')) is not int or report['exitCode'] != int(counts['failed']>0):raise GateError('candidate_test_process_exit_differs')
    return cases,{'files':len(seen),**counts}

def require_qr_passes(cases):
    for path in QR_TESTS:
        rows=[case for (file,_),case in cases.items() if file==path]
        if not rows or any(row['status']!='passed' for row in rows):raise GateError('qr_candidate_tests_must_all_pass')
    postgres=[case for (file,_),case in cases.items() if file==QR_POSTGRES_TEST]
    if len(postgres)!=13 or any(case['status']!='skipped' for case in postgres):raise GateError('qr_postgres_separate_receipt_scope_differs')

def test_parity(candidate, baseline, paths):
    candidate_cases,candidate_counts=validate_test_report(candidate,paths)
    require_qr_passes(candidate_cases)
    nonqr={key:value for key,value in candidate_cases.items() if key[0] not in (*QR_TESTS,QR_POSTGRES_TEST)}
    known=[];baseline_counts=None
    if baseline is None:
        if any(case['status']!='passed' for case in nonqr.values()):raise GateError('candidate_test_baseline_required')
    else:
        baseline_cases,baseline_counts=validate_test_report(baseline,[path for path in paths if path not in (*QR_TESTS,QR_POSTGRES_TEST)])
        if set(baseline_cases)!=set(nonqr):raise GateError('candidate_baseline_testcase_coverage_differs')
        for key,case in nonqr.items():
            prior=baseline_cases[key]
            if case['status']=='failed' and (prior['status']!='failed' or case['errorFirstLineSha256']!=prior['errorFirstLineSha256']):
                raise GateError('candidate_test_new_failure')
            if case['status']=='skipped' and prior['status']!='skipped':raise GateError('candidate_test_new_skip')
            if prior['status']=='failed':known.append({'path':key[0],'fullName':key[1],'errorFirstLineSha256':prior['errorFirstLineSha256']})
    return {'status':'passed_no_new_failures' if any(case['status']!='passed' for case in nonqr.values()) else 'all_passed',
            'candidateCounts':candidate_counts,'baselineCounts':baseline_counts,'baselineKnownFailures':sorted(known,key=lambda case:(case['path'],case['fullName'])),
            'qrPostgresSkipped':13,'qrPostgresAuthority':'separate_migration_receipt_required'}


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

ERROR_REPORTER = '''import fs from "node:fs";
export default class ErrorCountsReporter {
  onFinished(files = [], errors = []) {
    let suiteErrors = 0;
    const visit = task => {
      if (task.type !== "test") suiteErrors += task.result?.errors?.length || 0;
      for (const child of task.tasks || []) visit(child);
    };
    for (const file of files) visit(file);
    fs.writeFileSync("/tmp/qr-test-errors.json", JSON.stringify({unhandledErrors: errors.length, suiteErrors}));
  }
}
'''
HARNESS_CONFIG = r'''import frozen from "/app/coolify/releases/2026-11-03-qr-device-login/candidate-tests.config.ts";
const previousSetup = frozen.test?.setupFiles;
const setupFiles = previousSetup ? (Array.isArray(previousSetup) ? previousSetup : [previousSetup]) : [];
export default {
  ...frozen,
  resolve: {
    ...frozen.resolve,
    alias: [
      { find: /^\.\.\/api-source\/referral-store\.js$/, replacement: "/app/apps/api/src/referral-store.ts" },
      ...frozen.resolve.alias,
    ],
  },
  test: {
    ...frozen.test,
    setupFiles: [...setupFiles, "/app/coolify/releases/2026-11-03-qr-device-login/candidate-boundary.setup.mjs"],
  },
};
'''
BOUNDARY_SETUP = '''import { expect, vi } from "vitest";
// The operational /me response adds a database boundary absent from the frozen QR fixture.
if (expect.getState().testPath === "/app/apps/api/src/device-login-server.test.ts") {
  vi.doMock("/app/apps/api/src/access-history.ts", async (importActual) => ({
    ...(await importActual()),
    getAccessHistory: vi.fn(async () => null),
  }));
}
'''

def test_fixture_script(test_args):
    return backend.legacy.cgroup()+'''const crypto=require("node:crypto");
let exitCode=0;
try { cp.execFileSync("npx",'''+json.dumps(test_args)+''',{stdio:"ignore"}); }
catch (error) { exitCode=Number.isInteger(error.status)?error.status:125; }
const raw=JSON.parse(fs.readFileSync("/tmp/qr-test-raw.json","utf8"));
const errors=JSON.parse(fs.readFileSync("/tmp/qr-test-errors.json","utf8"));
const firstErrorHash = messages => {
  if (!messages?.length) return null;
  const line=String(messages[0]).replace(/\\u001b\\[[0-?]*[ -/]*[@-~]/g,"").split(/\\r?\\n/).find(line=>line.trim().length);
  return line ? crypto.createHash("sha256").update(line).digest("hex") : null;
};
const report={exitCode,...errors};
for (const key of ["numTotalTests","numPassedTests","numFailedTests","numPendingTests","numTodoTests","numPendingTestSuites"]) report[key]=raw[key];
report.suites=raw.testResults.map(suite=>({path:suite.name,status:suite.status,hasError:!!suite.message,
  cases:suite.assertionResults.map(test=>({fullName:test.fullName,status:test.status,errorFirstLineSha256:firstErrorHash(test.failureMessages)}))}));
fs.writeFileSync("/tmp/qr-test-sanitized.json",JSON.stringify(report));'''

def run_test_fixture(image,revision,role,paths,mounts,env,directory):
    identity(image)
    if role not in ('candidate','baseline') or not re.fullmatch('[a-f0-9]{40}',revision):raise GateError('test_fixture_identity_invalid')
    name='flixify-qr-tests-'+role+'-'+revision[:12]+'-'+uuid.uuid4().hex[:12]
    reporter=directory/'errors-reporter.mjs';reporter.write_text(ERROR_REPORTER)
    wrapper=directory/'harness.config.mjs';wrapper.write_text(HARNESS_CONFIG)
    setup=directory/'boundary.setup.mjs';setup.write_text(BOUNDARY_SETUP)
    # Logo tests mock fetch but resolve example.com through the real DNS lookup.
    args=['docker','run','--name',name,'--network','none','--add-host','example.com:93.184.216.34','--cpus','1','--memory','1280m','--memory-swap','1536m','--pids-limit','256']
    for key,value in env.items():args+=['-e',key+'='+value]
    for source,path in mounts:args+=['-v',str(source)+':/app/'+path+':ro']
    config='coolify/releases/2026-11-03-qr-device-login/candidate-harness.config.mjs'
    setup_path='coolify/releases/2026-11-03-qr-device-login/candidate-boundary.setup.mjs'
    args+=['-v',str(wrapper)+':/app/'+config+':ro','-v',str(setup)+':/app/'+setup_path+':ro']
    args+=['-v',str(reporter)+':/tmp/qr-test-errors-reporter.mjs:ro']
    test_args=['--no-install','vitest','run','--root','/app','--config','/app/'+config,'--maxWorkers=1',
               '--reporter=json','--reporter=/tmp/qr-test-errors-reporter.mjs','--outputFile.json=/tmp/qr-test-raw.json']
    test_args+=['/app/'+path for path in paths]
    report_file=directory/(role+'-sanitized.json')
    try:
        command(*args,'--entrypoint','node',image,'-e',test_fixture_script(test_args),timeout=900)
        command('docker','cp',name+':/tmp/qr-test-sanitized.json',str(report_file),timeout=60)
        if report_file.is_symlink() or not report_file.is_file() or report_file.stat().st_size>4*1024**2:raise GateError('test_fixture_report_invalid')
        try:return json.loads(report_file.read_bytes())
        except (ValueError,UnicodeDecodeError):raise GateError('test_fixture_report_invalid') from None
    finally:
        command('docker','rm','-f',name,timeout=120)

def candidate_tests(repo,revision,candidate,base_image,test_report=None):
    roots=('apps/api/src/','coolify/releases/2026-11-01-welcome-offer/welcome-tests/','coolify/releases/2026-11-01-packages/billing-tests/')
    paths=merge.git(repo,'ls-tree','-r','--name-only',revision,'--',*roots).decode().splitlines()
    paths=[p for p in paths if (p.endswith('.test.ts') or p.endswith('.fixture.ts') or p.endswith('/fixtures.ts'))]
    test_paths=[path for path in paths if path.endswith('.test.ts')]
    if not set((*QR_TESTS,QR_POSTGRES_TEST))<=set(test_paths):raise GateError('all_qr_candidate_tests_required')
    config='coolify/releases/2026-11-03-qr-device-login/candidate-tests.config.ts'
    env=dict(backend.legacy.TEST_ENV)
    env.update({k:'' for k in ('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TEST_DATABASE_URL','PG_TEST_DATABASE_URL','DEVICE_LOGIN_TEST_DATABASE_URL','PACKAGE_CATALOG_TEST_DATABASE_URL','PACKAGE_PAYMENT_TEST_DATABASE_URL','WELCOME_OFFER_TEST_DATABASE_URL','GA4_WEB_API_SECRET','GA4_WINDOWS_API_SECRET')})
    env.update({'STRIPE_BILLING_ENABLED':'false','GA4_ENABLED':'false'})
    with tempfile.TemporaryDirectory(prefix='qr-candidate-tests-') as directory:
        directory=Path(directory);mounts=[];hashes={}
        for index,path in enumerate(paths+[config]):
            data=merge.blob(repo,revision,path);file=directory/str(index);file.write_bytes(data)
            mounts.append((file,path));hashes[path]=merge.sha(data)
        bound={'revision':revision,'candidateImage':identity(candidate),'baselineImage':identity(base_image),
               'frozenFileSha256':hashes,'errorReporterSha256':merge.sha(ERROR_REPORTER.encode()),
               'harnessConfigSha256':merge.sha(HARNESS_CONFIG.encode()),'boundarySetupSha256':merge.sha(BOUNDARY_SETUP.encode()),'reports':{}}
        try:
            report=run_test_fixture(candidate,revision,'candidate',test_paths,mounts,env,directory)
            bound['reports']['candidate']=report
            cases,_=validate_test_report(report,test_paths);require_qr_passes(cases)
            baseline=None
            if any(case['status']!='passed' for (path,_),case in cases.items() if path not in (*QR_TESTS,QR_POSTGRES_TEST)):
                nonqr=[path for path in test_paths if path not in (*QR_TESTS,QR_POSTGRES_TEST)]
                baseline=run_test_fixture(base_image,revision,'baseline',nonqr,[(file,path) for file,path in mounts if path not in (*QR_TESTS,QR_POSTGRES_TEST)],env,directory)
                bound['reports']['baseline']=baseline
            result=test_parity(report,baseline,test_paths)
            result.update({key:bound[key] for key in ('revision','candidateImage','baselineImage','frozenFileSha256','errorReporterSha256','harnessConfigSha256','boundarySetupSha256')})
            bound['result']=result
            return result
        except GateError as error:
            bound['result']={'status':'blocked','reason':str(error)}
            failures=[]
            for role,report in bound['reports'].items():
                if not isinstance(report,dict) or not isinstance(report.get('suites'),list):continue
                for suite in report['suites']:
                    if not isinstance(suite,dict) or not isinstance(suite.get('cases'),list):continue
                    for case in suite['cases']:
                        if isinstance(case,dict) and case.get('status')=='failed':
                            failures.append({'reportRole':role,'path':suite.get('path'),'fullName':case.get('fullName'),
                                             'errorFirstLineSha256':case.get('errorFirstLineSha256')})
            print(json.dumps({'candidateTests':{**bound['result'],'failedCases':failures}},sort_keys=True))
            raise
        finally:
            if test_report is not None:
                if test_report.is_symlink():raise GateError('test_report_destination_symlink')
                test_report.write_text(json.dumps(bound,sort_keys=True,indent=2)+'\n')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo',type=Path); parser.add_argument('--revision',required=True)
    parser.add_argument('--base-image-id',required=True); parser.add_argument('--base-image-tag',required=True)
    parser.add_argument('--qrcode-tarball',required=True,type=Path); parser.add_argument('--source-pin',type=Path)
    parser.add_argument('--test-report',type=Path)
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
    candidate_test_result=candidate_tests(args.repo,args.revision,candidate,args.base_image_id,args.test_report)
    if backend.host_snapshot()!=before_host: raise GateError('existing_host_changed')
    if not before_images<=set(command('docker','image','ls','--no-trunc','-q').decode().splitlines()): raise GateError('existing_image_removed')
    print(json.dumps({'candidate':candidate,'revision':args.revision,'merge':audit,'tests':'passed','candidateTests':candidate_test_result,'migrationApplied':False},sort_keys=True))

if __name__=='__main__': main()
