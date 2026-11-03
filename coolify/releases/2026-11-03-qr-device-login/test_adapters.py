import importlib.util
from pathlib import Path
import unittest
import sys
import contextlib
import io
import json
import tempfile
import hashlib
import subprocess
from types import ModuleType
from types import SimpleNamespace
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class AdapterTests(unittest.TestCase):
    def parity_report(self, status='passed', message='AssertionError: expected true to be false'):
        qr=['device-login.test.ts','device-login-routes.test.ts','device-login-server.test.ts']
        suites=[{'path':'/app/apps/api/src/'+name,'status':'passed','hasError':False,
                 'cases':[{'fullName':name+' required case','status':'passed','errorFirstLineSha256':None}]} for name in qr]
        suites.append({'path':'/app/apps/api/src/device-login-postgres.test.ts','status':'passed','hasError':False,
                       'cases':[{'fullName':'PostgreSQL case '+str(index),'status':'skipped','errorFirstLineSha256':None} for index in range(13)]})
        suites.append({'path':'/app/apps/api/src/trial-direct-fallback.test.ts','status':'failed' if status=='failed' else 'passed','hasError':False,
                       'cases':[{'fullName':'trial fallback existing expectation','status':status,
                                 'errorFirstLineSha256':hashlib.sha256(message.encode()).hexdigest() if status=='failed' else None}]})
        return {'exitCode':1 if status=='failed' else 0,'unhandledErrors':0,'suiteErrors':0,
                'numTotalTests':17,'numPassedTests':4 if status=='passed' else 3,'numFailedTests':int(status=='failed'),
                'numPendingTests':13+int(status=='skipped'),'numTodoTests':0,'numPendingTestSuites':0,'suites':suites}

    def baseline_report(self, candidate):
        baseline=json.loads(json.dumps(candidate));baseline['suites']=baseline['suites'][-1:]
        baseline.update({'numTotalTests':1,'numPassedTests':int(baseline['suites'][0]['cases'][0]['status']=='passed'),
                         'numPendingTests':int(baseline['suites'][0]['cases'][0]['status']=='skipped')})
        return baseline

    def test_parity_accepts_only_identical_existing_failure_signature(self):
        api=load('qr_test_parity_known_failure','build-api.py')
        candidate=self.parity_report('failed');baseline=self.baseline_report(candidate)
        paths=[suite['path'].removeprefix('/app/') for suite in candidate['suites']]
        result=api.test_parity(candidate,baseline,paths)
        self.assertEqual(result['status'],'passed_no_new_failures')
        self.assertEqual(result['candidateCounts'],{'files':5,'total':17,'passed':3,'failed':1,'skipped':13})
        self.assertEqual(result['baselineKnownFailures'],[{
            'path':'apps/api/src/trial-direct-fallback.test.ts','fullName':'trial fallback existing expectation',
            'errorFirstLineSha256':'e504e64467245c9a2ca504331e7f890ef5ebaeac545f2344f2abb492157712f7',
        }])

    def test_parity_rejects_new_failure_changed_signature_and_new_skip(self):
        api=load('qr_test_parity_new_failure','build-api.py')
        candidate=self.parity_report('failed')
        paths=[suite['path'].removeprefix('/app/') for suite in candidate['suites']]
        for baseline in (self.baseline_report(self.parity_report()),self.baseline_report(self.parity_report('failed','different first error'))):
            with self.subTest(baseline=baseline),self.assertRaises(api.GateError):api.test_parity(candidate,baseline,paths)
        with self.assertRaises(api.GateError):api.test_parity(self.parity_report('skipped'),self.baseline_report(self.parity_report()),paths)
        skipped=self.parity_report('skipped')
        self.assertEqual(api.test_parity(skipped,self.baseline_report(skipped),paths)['status'],'passed_no_new_failures')

    def test_parity_rejects_qr_failures_load_errors_and_missing_cases(self):
        api=load('qr_test_parity_fail_closed','build-api.py')
        paths=[suite['path'].removeprefix('/app/') for suite in self.parity_report()['suites']]
        for defect in ('qr-failed','qr-skipped','load','hook','unhandled','missing-file','duplicate-case','pending','exit'):
            candidate=self.parity_report('failed')
            if defect in ('qr-failed','qr-skipped','pending'):
                row=candidate['suites'][0]['cases'][0]
                row['status']={'qr-failed':'failed','qr-skipped':'skipped','pending':'pending'}[defect]
                if defect=='qr-failed':
                    row['errorFirstLineSha256']='a'*64;candidate['suites'][0]['status']='failed'
                    candidate['numPassedTests']-=1;candidate['numFailedTests']+=1
                elif defect=='qr-skipped':candidate['numPassedTests']-=1;candidate['numPendingTests']+=1
            elif defect=='load':candidate['suites'][0]['hasError']=True
            elif defect=='hook':candidate['suiteErrors']=1
            elif defect=='unhandled':candidate['unhandledErrors']=1
            elif defect=='missing-file':candidate['suites'].pop(0)
            elif defect=='duplicate-case':candidate['suites'][-1]['cases']*=2
            elif defect=='exit':candidate['exitCode']=137
            with self.subTest(defect=defect),self.assertRaises(api.GateError):
                api.test_parity(candidate,self.baseline_report(self.parity_report('failed')),paths)
        baseline=self.baseline_report(self.parity_report('failed'));baseline['suites'][0]['cases'][0]['fullName']='different case'
        with self.assertRaises(api.GateError):api.test_parity(self.parity_report('failed'),baseline,paths)

    def test_full_generated_fixture_script_has_valid_node_syntax(self):
        api=load('qr_test_fixture_syntax','build-api.py')
        result=subprocess.run(['node','--check'],input=api.test_fixture_script(['--no-install','vitest','run']),text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_sanitizer_keeps_only_first_error_line_hash(self):
        api=load('qr_test_fixture_sanitizer','build-api.py')
        raw={'numTotalTests':1,'numPassedTests':0,'numFailedTests':1,'numPendingTests':0,'numTodoTests':0,'numPendingTestSuites':0,
             'testResults':[{'name':'/app/apps/api/src/trial-direct-fallback.test.ts','status':'failed','message':'',
                             'assertionResults':[{'fullName':'existing expectation','status':'failed',
                                                  'failureMessages':['\x1b[31mAssertionError: expected true to be false\x1b[39m\nprivate fixture value']}]}]}
        prelude='const cp={execFileSync(){throw {status:1}}};const fs={readFileSync(path){return JSON.stringify(path.includes("raw")?'+json.dumps(raw)+':{unhandledErrors:0,suiteErrors:0})},writeFileSync(path,data){console.log(data)}};'
        with patch.object(api.backend.legacy,'cgroup',return_value=prelude):
            result=subprocess.run(['node','-e',api.test_fixture_script([])],text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        sanitized=json.loads(result.stdout)
        self.assertEqual(sanitized['suites'][0]['cases'][0]['errorFirstLineSha256'],'e504e64467245c9a2ca504331e7f890ef5ebaeac545f2344f2abb492157712f7')
        self.assertNotIn('private fixture value',result.stdout)
        self.assertNotIn('expected true',result.stdout)

    def test_boundary_setup_mocks_only_exact_qr_server_file_and_preserves_exports(self):
        api=load('qr_test_boundary_setup','build-api.py')
        source=api.BOUNDARY_SETUP.replace('import { expect, vi } from "vitest";','')
        for path,expected in (
            ('/app/apps/api/src/device-login-server.test.ts',[{'path':'/app/apps/api/src/access-history.ts','history':None,'sameErrorClass':True,'otherExport':'retained'}]),
            ('/app/apps/api/src/trial-direct-fallback.test.ts',[]),
            ('/app/another/device-login-server.test.ts',[]),
        ):
            script='const pending=[],calls=[];const expect={getState:()=>({testPath:'+json.dumps(path)+'})};'
            script+='const vi={fn:fn=>fn,doMock(path,factory){const actual={TrialUnavailableError:class TrialUnavailableError{},readAccessHistory:async()=>"real",otherExport:"retained"};pending.push(factory(async()=>actual).then(async next=>{const pool={};const getAccessHistory=userId=>next.readAccessHistory(pool,userId);calls.push({path,history:await getAccessHistory("fixture-user"),sameErrorClass:next.TrialUnavailableError===actual.TrialUnavailableError,otherExport:next.otherExport})}))}};'
            script+=source+'\nawait Promise.all(pending);console.log(JSON.stringify(calls));'
            result=subprocess.run(['node','--input-type=module','-e',script],text=True,capture_output=True)
            with self.subTest(path=path):
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(json.loads(result.stdout),expected)

    def test_harness_wrapper_adds_only_direct_referral_alias_and_keeps_frozen_setup(self):
        api=load('qr_test_harness_config','build-api.py')
        source=api.HARNESS_CONFIG.split('\n',1)[1].replace('export default','const result =')
        prelude='const frozen={resolve:{alias:[{find:/^\\.\\/referral-store\\.js$/,replacement:"existing-fixture"}]},test:{setupFiles:["existing-setup"],include:["frozen-include"],exclude:["frozen-exclude"]}};'
        script=prelude+source+'\nconsole.log(JSON.stringify({direct:result.resolve.alias.filter(a=>a.find.test("../api-source/referral-store.js")).map(a=>a.replacement),local:result.resolve.alias.filter(a=>a.find.test("./referral-store.js")).map(a=>a.replacement),other:result.resolve.alias.filter(a=>a.find.test("../api-source/other.js")).length,test:result.test}));'
        result=subprocess.run(['node','-e',script],text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),{
            'direct':['/app/apps/api/src/referral-store.ts'],'local':['existing-fixture'],'other':0,
            'test':{'setupFiles':['existing-setup','/app/coolify/releases/2026-11-03-qr-device-login/candidate-boundary.setup.mjs'],
                    'include':['frozen-include'],'exclude':['frozen-exclude']},
        })

    def test_parity_accepts_candidate_improvement_and_requires_baseline_for_failure(self):
        api=load('qr_test_parity_improvement','build-api.py')
        candidate=self.parity_report();paths=[suite['path'].removeprefix('/app/') for suite in candidate['suites']]
        self.assertEqual(api.test_parity(candidate,self.baseline_report(self.parity_report('failed')),paths)['status'],'all_passed')
        with self.assertRaises(api.GateError):api.test_parity(self.parity_report('failed'),None,paths)

    def test_candidate_tests_run_only_frozen_mounted_test_paths(self):
        api=load('qr_test_candidate_scope','build-api.py')
        paths=[
            'apps/api/src/device-login.test.ts',
            'apps/api/src/device-login-routes.test.ts',
            'apps/api/src/device-login-server.test.ts',
            'apps/api/src/device-login-postgres.test.ts',
            'apps/api/src/trial-direct-fallback.test.ts',
            'coolify/releases/2026-11-01-welcome-offer/welcome-tests/analytics-policy.test.ts',
            'coolify/releases/2026-11-01-packages/billing-tests/checkout.test.ts',
            'coolify/releases/2026-11-01-packages/billing-tests/referral-store.fixture.ts',
            'coolify/releases/2026-11-01-packages/billing-tests/fixtures.ts',
        ]
        calls=[];generated={}
        report=self.parity_report()
        for path in paths[5:7]:
            report['suites'].append({'path':'/app/'+path,'status':'passed','hasError':False,
                                    'cases':[{'fullName':path+' required case','status':'passed','errorFirstLineSha256':None}]})
        report.update({'numTotalTests':19,'numPassedTests':6})
        def command(*args,**kwargs):
            calls.append(args)
            if args[:2]==('docker','run'):
                for index,value in enumerate(args):
                    if value=='-v':
                        source,destination=args[index+1].split(':',1)
                        if destination.endswith('/candidate-harness.config.mjs:ro') or destination.endswith('/candidate-boundary.setup.mjs:ro'):
                            generated[destination]=Path(source).read_bytes()
            if args[:2]==('docker','cp'):Path(args[-1]).write_text(json.dumps(report))
            return b''
        with patch.object(api.merge,'git',return_value=('\n'.join(paths)+'\n').encode()), \
             patch.object(api.merge,'blob',return_value=b'export {};\n'), \
             patch.object(api,'command',side_effect=command):
            result=api.candidate_tests(Path('/frozen-repo'),'b'*40,'sha256:'+'c'*64,'sha256:'+'d'*64)
        self.assertEqual(result['status'],'all_passed')
        self.assertEqual(len(calls),3)
        invocation=calls[0]
        name=invocation[invocation.index('--name')+1]
        self.assertRegex(name,r'^flixify-qr-tests-candidate-b{12}-[a-f0-9]{12}$')
        self.assertNotIn('--rm',invocation)
        self.assertEqual(calls[1][0:2],('docker','cp'))
        self.assertEqual(calls[2],('docker','rm','-f',name))
        self.assertEqual(invocation[invocation.index('--network')+1],'none')
        self.assertEqual(invocation[invocation.index('--add-host')+1],'example.com:93.184.216.34')
        self.assertEqual(invocation.count('--add-host'),1)
        script=invocation[-1]
        marker='cp.execFileSync("npx",'
        argv,_=json.JSONDecoder().raw_decode(script.split(marker,1)[1])
        config='coolify/releases/2026-11-03-qr-device-login/candidate-tests.config.ts'
        harness='coolify/releases/2026-11-03-qr-device-login/candidate-harness.config.mjs'
        setup='coolify/releases/2026-11-03-qr-device-login/candidate-boundary.setup.mjs'
        self.assertEqual(argv,[
            '--no-install','vitest','run','--root','/app','--config','/app/'+harness,'--maxWorkers=1',
            '--reporter=json','--reporter=/tmp/qr-test-errors-reporter.mjs','--outputFile.json=/tmp/qr-test-raw.json',
            '/app/apps/api/src/device-login.test.ts',
            '/app/apps/api/src/device-login-routes.test.ts',
            '/app/apps/api/src/device-login-server.test.ts',
            '/app/apps/api/src/device-login-postgres.test.ts',
            '/app/apps/api/src/trial-direct-fallback.test.ts',
            '/app/coolify/releases/2026-11-01-welcome-offer/welcome-tests/analytics-policy.test.ts',
            '/app/coolify/releases/2026-11-01-packages/billing-tests/checkout.test.ts',
        ])
        mounts=[invocation[index+1] for index,value in enumerate(invocation) if value=='-v']
        self.assertEqual([mount.split(':/app/',1)[1] for mount in mounts[:-1]],[path+':ro' for path in paths+[config,harness,setup]])
        self.assertTrue(mounts[-1].endswith(':/tmp/qr-test-errors-reporter.mjs:ro'))
        self.assertEqual(result['harnessConfigSha256'],hashlib.sha256(generated['/app/'+harness+':ro']).hexdigest())
        self.assertEqual(result['boundarySetupSha256'],hashlib.sha256(generated['/app/'+setup+':ro']).hexdigest())

    def test_candidate_fixture_removes_its_container_when_report_copy_fails(self):
        api=load('qr_test_candidate_cleanup','build-api.py');calls=[]
        def command(*args,**kwargs):
            calls.append(args)
            if args[:2]==('docker','cp'):raise api.GateError('copy_failed')
            return b''
        with tempfile.TemporaryDirectory() as directory,patch.object(api,'command',side_effect=command):
            with self.assertRaises(api.GateError):
                api.run_test_fixture('sha256:'+'c'*64,'b'*40,'candidate',[],[],{},Path(directory))
        name=calls[0][calls[0].index('--name')+1]
        self.assertEqual(calls[-1],('docker','rm','-f',name))

    def test_candidate_failure_replays_frozen_nonqr_tests_on_immutable_baseline(self):
        api=load('qr_test_candidate_baseline_replay','build-api.py')
        candidate=self.parity_report('failed');baseline=self.baseline_report(candidate)
        paths=[suite['path'].removeprefix('/app/') for suite in candidate['suites']]
        paths+=['coolify/releases/2026-11-01-packages/billing-tests/referral-store.fixture.ts']
        calls=[]
        def command(*args,**kwargs):
            calls.append(args)
            if args[:2]==('docker','cp'):
                Path(args[-1]).write_text(json.dumps(baseline if '-baseline-' in args[-2] else candidate))
            return b''
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(api.merge,'git',return_value=('\n'.join(paths)+'\n').encode()), \
             patch.object(api.merge,'blob',return_value=b'export {};\n'),patch.object(api,'command',side_effect=command):
            output=Path(directory)/'bound-report.json'
            result=api.candidate_tests(Path('/frozen-repo'),'b'*40,'sha256:'+'c'*64,'sha256:'+'d'*64,output)
            saved=json.loads(output.read_bytes())
        self.assertEqual(result['status'],'passed_no_new_failures')
        runs=[call for call in calls if call[:2]==('docker','run')]
        self.assertEqual(len(runs),2)
        self.assertEqual(runs[0][-3],'sha256:'+'c'*64)
        self.assertEqual(runs[1][-3],'sha256:'+'d'*64)
        marker='cp.execFileSync("npx",'
        candidate_argv,_=json.JSONDecoder().raw_decode(runs[0][-1].split(marker,1)[1])
        baseline_argv,_=json.JSONDecoder().raw_decode(runs[1][-1].split(marker,1)[1])
        self.assertEqual(baseline_argv,[arg for arg in candidate_argv if '/device-login' not in arg])
        candidate_mounts=[runs[0][index+1] for index,value in enumerate(runs[0]) if value=='-v']
        baseline_mounts=[runs[1][index+1] for index,value in enumerate(runs[1]) if value=='-v']
        self.assertEqual(baseline_mounts,[mount for mount in candidate_mounts if '/device-login' not in mount])
        self.assertEqual(set(saved['reports']),{'candidate','baseline'})
        self.assertEqual(saved['candidateImage'],'sha256:'+'c'*64)
        self.assertEqual(saved['baselineImage'],'sha256:'+'d'*64)
        self.assertEqual(saved['revision'],'b'*40)
        self.assertEqual(set(saved['frozenFileSha256']),set(paths+['coolify/releases/2026-11-03-qr-device-login/candidate-tests.config.ts']))

    def test_low_disk_rollback_reaches_locked_retained_image_transaction(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            release=load('qr_test_low_disk_release','release.py')
        with tempfile.TemporaryDirectory() as directory:
            receipt=Path(directory)/'receipt.json';digest='e'*64
            receipt.write_text(json.dumps({'migrationSha256':digest,'applied':True,'postgresTestsPassed':True}))
            argv=['release.py','--revision','b'*40,'--api-candidate-id','sha256:'+'c'*64,
                  '--web-candidate-id','sha256:'+'d'*64,'--migration-receipt',str(receipt),
                  '--migration-sha256',digest]
            events=[]
            @contextlib.contextmanager
            def locked():
                events.append('lock')
                try:yield
                finally:events.append('unlock')
            with patch.object(sys,'argv',argv[:7]+['--rollback']), \
                 patch.object(release,'protected',side_effect=lambda:events.append('protected') or {}), \
                 patch.object(release.reviewed,'release_lock',locked), \
                 patch.object(release,'safe_rollback',side_effect=lambda:events.append('rollback')) as rollback, \
                 patch.object(release.guard,'command',side_effect=AssertionError('Unexpected build, pull or prune')) as command, \
                 patch.object(release.shutil,'disk_usage',return_value=SimpleNamespace(free=1024**3)), \
                 contextlib.redirect_stdout(io.StringIO()):
                release.main()
                rollback.assert_called_once_with()
                command.assert_not_called()
                self.assertEqual(events,['lock','protected','rollback','protected','unlock'])
                for action in ('--apply','--recreate'):
                    with self.subTest(action=action), patch.object(sys,'argv',argv+[action]):
                        with self.assertRaisesRegex(release.api.GateError,'cutover_requires_4GiB_no_pruning'):
                            release.main()
                self.assertEqual(events,['lock','protected','rollback','protected','unlock'])

    def test_cutover_disk_boundary_preserves_locked_metadata_and_recreation(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            release=load('qr_test_cutover_disk_boundary','release.py')
        with tempfile.TemporaryDirectory() as directory:
            receipt=Path(directory)/'receipt.json';digest='e'*64
            receipt.write_text(json.dumps({'migrationSha256':digest,'applied':True,'postgresTestsPassed':True}))
            argv=['release.py','--revision','b'*40,'--api-candidate-id','sha256:'+'c'*64,
                  '--web-candidate-id','sha256:'+'d'*64,'--migration-receipt',str(receipt),
                  '--migration-sha256',digest]
            for action in ('--apply','--recreate'):
                for available in (4*1024**3-1,4*1024**3,5*1024**3):
                    with self.subTest(action=action,available=available):
                        events=[]
                        @contextlib.contextmanager
                        def locked():
                            events.append('lock')
                            try:yield
                            finally:events.append('unlock')
                        with patch.object(sys,'argv',argv+[action]), \
                             patch.object(release,'protected',side_effect=lambda:events.append('protected') or {}), \
                             patch.object(release.reviewed,'release_lock',locked), \
                             patch.object(release.guard,'preflight',side_effect=lambda stage:events.append(stage) or ({},b'compose',b'env',{}, {},{})), \
                             patch.object(release.guard,'sync_images',side_effect=lambda *args:events.append('sync')), \
                             patch.object(release.guard,'recreate',side_effect=lambda *args:events.append('recreate')), \
                             patch.object(release.guard,'command',side_effect=AssertionError('Unexpected build, pull or prune')), \
                             patch.object(release.shutil,'disk_usage',return_value=SimpleNamespace(free=available)), \
                             contextlib.redirect_stdout(io.StringIO()):
                            if available<4*1024**3:
                                with self.assertRaisesRegex(release.api.GateError,'cutover_requires_4GiB_no_pruning'):
                                    release.main()
                                self.assertEqual(events,[])
                            else:
                                release.main()
                                stage,operation=('source','sync') if action=='--apply' else ('target','recreate')
                                self.assertEqual(events,['lock','protected',stage,operation,'protected','unlock'])

    def test_failed_recreate_uses_safe_rollback_and_propagates_cleanup_failure(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            release=load('qr_test_failed_recreate','release.py')
        with tempfile.TemporaryDirectory() as directory:
            receipt=Path(directory)/'receipt.json';digest='e'*64
            receipt.write_text(json.dumps({'migrationSha256':digest,'applied':True,'postgresTestsPassed':True}))
            argv=['release.py','--revision','b'*40,'--api-candidate-id','sha256:'+'c'*64,
                  '--web-candidate-id','sha256:'+'d'*64,'--migration-receipt',str(receipt),
                  '--migration-sha256',digest,'--recreate']
            for cleanup_fails in (False,True):
                events=[]
                @contextlib.contextmanager
                def locked():
                    events.append('lock')
                    try:yield
                    finally:events.append('unlock')
                def safe():
                    events.append('safe_rollback')
                    if cleanup_fails:raise release.api.GateError('cleanup_failed_api_stopped')
                with patch.object(sys,'argv',argv), \
                     patch.object(release,'protected',return_value={}), \
                     patch.object(release.reviewed,'release_lock',locked), \
                     patch.object(release.guard,'preflight',return_value=({},b'compose',b'env',{}, {},{})), \
                     patch.object(release.guard,'recreate',side_effect=release.api.GateError('health_failed')), \
                     patch.object(release.guard,'verify_recovery_context',side_effect=lambda *args:events.append('recovery_guard')), \
                     patch.object(release,'safe_rollback',side_effect=safe), \
                     patch.object(release.guard,'rollback',side_effect=AssertionError('unsafe direct restore')), \
                     patch.object(release.shutil,'disk_usage',return_value=SimpleNamespace(free=10*1024**3)):
                    expected='cleanup_failed_api_stopped' if cleanup_fails else 'cutover_failed_old_images_restored'
                    with self.assertRaisesRegex(release.api.GateError,expected):release.main()
                self.assertEqual(events,['lock','recovery_guard','safe_rollback','unlock'])

    def test_api_compile_caps_and_new_package_directory(self):
        api=load('qr_test_api','build-api.py');calls=[]
        api.backend.command=lambda *a,**kw:calls.append((a,kw))
        api.configure('sha256:'+'a'*64,'flixify-api:test',('apps/api/src/server.ts',),())
        api.backend.command('docker','create','--name','flixify-packages-api-build-'+'a'*12,'--network','none')
        self.assertEqual(calls[0][0][2:4],('--cpus','1'))
        api.backend.command('docker','cp','/tmp/input','flixify-packages-api-build-'+'a'*12+':/app/node_modules/qrcode-generator/dist/index.js')
        self.assertEqual(calls[1][0][0:2],('docker','exec'))
        self.assertEqual(calls[1][0][-1],'/app/node_modules/qrcode-generator/dist')
        self.assertIn('node_modules/qrcode-generator',api.backend.snapshot_script('api'))
        with self.assertRaises(api.GateError):api.backend.command('docker','create','--network','host')

    def test_release_scope_and_no_environment_mutation_adapter(self):
        # Configuration is pure; YAML parsing remains an existing host-only guard dependency.
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            release=load('qr_test_release','release.py')
        original_php=release.guard.PHP_APPLY
        revision='b'*40
        release.configure(revision,{'api':'sha256:'+'c'*64,'ops-web':'sha256:'+'d'*64})
        self.assertEqual(release.guard.CHANGED,('api','ops-web'))
        self.assertEqual(release.guard.PROTECTED,('db','worker'))
        self.assertEqual(release.guard.PHP_APPLY,original_php)
        self.assertEqual(release.guard.PROTECTED_IMAGES,{'worker':release.WORKER})
        self.assertEqual(release.guard.PROTECTED_DB_IMAGE_ID,release.DB)
        self.assertEqual(release.guard.TARGET['api'],'flixify-api:qr-device-login-'+revision[:12]+'-20261103')

if __name__=='__main__':unittest.main()
