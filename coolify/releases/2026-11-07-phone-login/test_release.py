import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('phone_release_build',HERE/'build-release.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class ReleaseGuards(unittest.TestCase):
    def settings(self):
        return {'PHONE_AUTH_ENABLED':'true','PHONE_AUTH_LOCAL_ONLY':'false','PHONE_AUTH_SECRET':'a'*64,'PHONE_AUTH_ALLOWED_ORIGINS':'https://flixify.vip','VATANSMS_WHATSAPP_API_KEY':'test-key','VATANSMS_WHATSAPP_REG_ID':'123','VATANSMS_WHATSAPP_BASE_URL':'https://api.toplusmspaketleri.com','PHONE_AUTH_PROVIDER_DIAGNOSTICS':'false'}
    def test_valid_settings(self):self.assertEqual(b.validate_settings(self.settings()),self.settings())
    def test_cannot_change_existing_jwt(self):
        x=self.settings();x['APP_JWT_SECRET']='b'*64
        with self.assertRaises(b.GateError):b.validate_settings(x)
    def test_cannot_change_registration_secret(self):
        x=self.settings();x['REGISTRATION_GUARD_SECRET']='b'*64
        with self.assertRaises(b.GateError):b.validate_settings(x)
    def test_rejects_local_origins(self):
        x=self.settings();x['PHONE_AUTH_ALLOWED_ORIGINS']='http://127.0.0.1:3192'
        with self.assertRaises(b.GateError):b.validate_settings(x)
    def test_rejects_provider_redirect_origin(self):
        x=self.settings();x['VATANSMS_WHATSAPP_BASE_URL']='https://example.invalid'
        with self.assertRaises(b.GateError):b.validate_settings(x)
    def test_rejects_local_only_production(self):
        x=self.settings();x['PHONE_AUTH_LOCAL_ONLY']='true'
        with self.assertRaises(b.GateError):b.validate_settings(x)
    def test_rejects_enabled_diagnostics_by_default(self):
        x=self.settings();x['PHONE_AUTH_PROVIDER_DIAGNOSTICS']='true'
        with self.assertRaises(b.GateError):b.validate_settings(x)
    def test_requires_independent_phone_secret(self):
        x=self.settings()
        with self.assertRaises(b.GateError):b.validate_settings(x,{'APP_JWT_SECRET':x['PHONE_AUTH_SECRET']})
    def test_cannot_overlay_downloads(self):
        with self.assertRaises(b.GateError):b.validate_web_path('apps/ops-web/public/downloads/flixify-tv-update.json')
    def test_cannot_overlay_download_page(self):
        with self.assertRaises(b.GateError):b.validate_web_path('apps/ops-web/app/indir/page.tsx')
    def test_cannot_overlay_native(self):
        with self.assertRaises(b.GateError):b.validate_web_path('apps/tv-android/app/build.gradle')
    def test_known_flag(self):b.validate_web_path('apps/ops-web/public/flags/TR.svg')
    def test_no_traversal(self):
        for x in ['../a','/app/a','apps/ops-web/public/flags/../../app/indir/page.tsx']:
            with self.assertRaises(b.GateError):b.validate_web_path(x)
    def test_candidate_tags_require_exact_revision(self):
        with self.assertRaises(b.GateError):b.target('api','HEAD')
        self.assertIn('123456789abc',b.target('api','123456789abc'+'0'*28))
    def test_only_api_web_candidates(self):
        with self.assertRaises(b.GateError):b.target('worker','a'*40)
    def test_private_settings_file_0600(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'secret.json';p.write_text(json.dumps(self.settings()));p.chmod(0o644)
            with self.assertRaises(b.GateError):b.private_settings(p)
            p.chmod(0o600);self.assertEqual(b.private_settings(p),self.settings())
    def test_private_settings_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'secret.json';p.write_text('{}');p.chmod(0o600)
            q=Path(d)/'link';q.symlink_to(p)
            with self.assertRaises(b.GateError):b.private_settings(q)
    def test_untouched_environment_comparison(self):
        before={'APP_JWT_SECRET':'x','REGISTRATION_GUARD_SECRET':'y','PHONE_AUTH_ENABLED':'false'}
        after={**before,'PHONE_AUTH_ENABLED':'true'}
        self.assertEqual(b.protected_environment(before),b.protected_environment(after))
        after['REGISTRATION_GUARD_SECRET']='z';self.assertNotEqual(b.protected_environment(before),b.protected_environment(after))
    def test_safe_relative_regular_file(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'x').write_text('x');self.assertEqual(b.regular(root,'x').read_text(),'x')
            (root/'link').symlink_to(root/'x')
            with self.assertRaises(b.GateError):b.regular(root,'link')
    def test_backfill_is_separate_from_schema(self):
        self.assertNotIn('scripts/sql/remembered-device-sessions-after-api-cutover.sql',b.MIGRATIONS)
        self.assertEqual(len(b.MIGRATIONS),2)

class BoundedProofs(unittest.TestCase):
    def test_snapshot_executes_real_node_files_and_streams_chunks(self):
        import hashlib,subprocess
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'nested').mkdir();(root/'ignored').mkdir();small=b'hello';large=b'x'*(1024*1024+7);(root/'a.txt').write_bytes(small);(root/'nested/b.bin').write_bytes(large);(root/'nested/link').symlink_to('../a.txt');(root/'ignored/skip').write_text('excluded')
            result=subprocess.run(['node','-e',b.SNAPSHOT,json.dumps({'root':str(root),'excluded':['ignored'],'rows':True})],capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            value=json.loads(result.stdout);self.assertEqual(value['files'],3);self.assertEqual(value['bytes'],len(small)+len(large));rows={r[1]:r for r in value['rows']}
            self.assertEqual(rows['a.txt'][-1],hashlib.sha256(small).hexdigest());self.assertEqual(rows['nested/b.bin'][-1],hashlib.sha256(large).hexdigest());self.assertEqual(rows['nested/link'][0],'link');self.assertNotIn('ignored/skip',rows)
    def test_dependency_paths_do_not_expand_exec_argv(self):
        paths=['node_modules/libphonenumber-js/'+str(n)+'.js' for n in range(5000)]+list(b.WEB_RUNTIME)
        result=b.excluded_paths('ops-web',paths)
        self.assertLess(len(json.dumps(result)),16384)
        self.assertIn('node_modules/libphonenumber-js',result)
        self.assertIn('packages/contracts/dist',result)
        self.assertNotIn('apps/ops-web/public/downloads',result)
    def test_api_compilation_preserves_other_dependencies(self):
        result=b.excluded_paths('api',['apps/api/src/server.ts'])
        self.assertNotIn('node_modules',result)
        self.assertIn('apps/api/dist',result)
        self.assertIn('packages/contracts/dist',result)

class RecoveryContext(unittest.TestCase):
    def rows(self):
        return [{'Name':'/'+n+'-'+b.UUID,'Config':{'Labels':{'com.docker.compose.project':b.UUID}},'State':{'Running':True}} for n in ['api','ops-web','worker','db']]
    def test_explicit_recovery_can_inspect_failed_api(self):
        from unittest.mock import patch
        rows=self.rows();rows[0]['State']['Running']=False
        with patch.object(b,'command',return_value=json.dumps(rows).encode()):
            with self.assertRaises(b.GateError):b.services()
            self.assertIn('api',b.services(allow_changed_stopped=True))
    def test_recovery_still_rejects_stopped_worker(self):
        from unittest.mock import patch
        rows=self.rows();rows[2]['State']['Running']=False
        with patch.object(b,'command',return_value=json.dumps(rows).encode()):
            with self.assertRaises(b.GateError):b.services(allow_changed_stopped=True)

class CutoverBoundary(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        self.patch=patch
        spec=importlib.util.spec_from_file_location('phone_cutover',HERE/'release.py')
        self.r=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.r)
        self.proofs={n:{'candidateTag':'candidate-'+n,'candidateId':'sha256:new-'+n} for n in ('api','ops-web')}
        self.targets={n:(p['candidateTag'],p['candidateId']) for n,p in self.proofs.items()}
        self.settings={'PHONE_AUTH_ENABLED':'true'}
        self.rows={n:{'Config':{'Image':tag,'Env':['APP_JWT_SECRET=protected']},'Image':identity,'State':{'Running':True}} for n,(tag,identity) in {**b.SOURCES,'worker':b.WORKER,'db':b.DB}.items()}
        self.rows['api'].update({'Image':self.targets['api'][1],'Config':{'Image':self.targets['api'][0],'Env':['APP_JWT_SECRET=protected','PHONE_AUTH_ENABLED=true']}})
        self.protected={'api':b.sha(json.dumps({'APP_JWT_SECRET':'protected'},sort_keys=True).encode())}
        self.state={k:'expected' for k in ('rawSha','renderedSha','modelEnvSha','otherModelsSha','generatedSha','envSha')}
        for doc in ('raw','rendered','generated'):self.state[doc]={'services':{n:{'image':tag} for n,(tag,_) in self.targets.items()}}
        self.state['applications']={n:tag for n,(tag,_) in self.targets.items()}
    def invoke(self,*,require_new_api=True,tag_override=None,state_override=None):
        from contextlib import ExitStack
        with ExitStack() as stack:
            stack.enter_context(self.patch.object(self.r.b,'services',return_value=self.rows))
            stack.enter_context(self.patch.object(self.r.b,'outside_snapshot',return_value={'protected':'same'}))
            stack.enter_context(self.patch.object(self.r,'coolify_state',return_value=state_override or self.state))
            stack.enter_context(self.patch.object(self.r.b,'image_info',side_effect=lambda tag:{'Id':tag_override or next(i for t,i in self.targets.values() if t==tag)}))
            called=stack.enter_context(self.patch.object(self.r,'recreate'))
            self.r.guarded_recreate('ops-web',self.r.state_fingerprint(self.state),self.targets,self.settings,{'protected':'same'},proofs=self.proofs,protected=self.protected,require_new_api=require_new_api)
            called.assert_called_once_with('ops-web')
    def test_accepts_exact_api_before_web(self):self.invoke()
    def test_rejects_retargeted_candidate_tag(self):
        with self.assertRaises(self.r.GateError):self.invoke(tag_override='sha256:foreign')
    def test_rejects_changed_metadata_before_compose(self):
        state={**self.state,'renderedSha':'changed'}
        with self.assertRaises(self.r.GateError):self.invoke(state_override=state)
    def test_rejects_foreign_current_web_before_compose(self):
        self.rows['ops-web']['Image']='sha256:foreign'
        with self.assertRaises(self.r.GateError):self.invoke()
    def test_rejects_unrelated_api_environment_change_before_web(self):
        self.rows['api']['Config']['Env']=['APP_JWT_SECRET=changed','PHONE_AUTH_ENABLED=true']
        with self.assertRaises(self.r.GateError):self.invoke()
    def test_recovery_rejects_retargeted_source_web(self):
        self.targets['ops-web']=b.SOURCES['ops-web']
        for doc in ('raw','rendered','generated'):self.state[doc]['services']['ops-web']['image']=b.SOURCES['ops-web'][0]
        self.state['applications']['ops-web']=b.SOURCES['ops-web'][0]
        with self.assertRaises(self.r.GateError):self.invoke(tag_override='sha256:foreign')
    def test_schema_checks_protected_containers_after_transaction(self):
        with self.patch.object(self.r.b,'assert_source'),self.patch.object(self.r,'migrate',return_value={'schemaApplied':True}),self.patch.object(self.r.b,'outside_snapshot',return_value={'protected':'changed'}):
            with self.assertRaises(self.r.GateError):self.r.guarded_schema('repo','a'*40,{'protected':'same'})
    def test_private_metadata_payload_preserves_original_disk_bytes(self):
        import base64
        with tempfile.TemporaryDirectory() as d:
            env=Path(d)/'.env';compose=Path(d)/'docker-compose.yml';original_env=b"KEY='original'\nOTHER=unchanged";original_compose=b'# retained disk formatting\nservices: {}\n';env.write_bytes(original_env);compose.write_bytes(original_compose)
            state={**self.state,'envSha':b.sha(original_env),'generatedSha':b.sha(original_compose)}
            with self.patch.object(self.r,'ENV',env),self.patch.object(self.r,'COMPOSE',compose):
                payload=self.r.metadata_payload('preview',state,{}, {},self.settings)
            self.assertEqual(base64.b64decode(payload['envBytes']),original_env)
            self.assertEqual(base64.b64decode(payload['generatedBytes']),original_compose)
    def test_private_metadata_payload_rejects_disk_drift(self):
        with tempfile.TemporaryDirectory() as d:
            env=Path(d)/'.env';compose=Path(d)/'docker-compose.yml';env.write_bytes(b'KEY=changed');compose.write_bytes(b'services: {}')
            state={**self.state,'envSha':b.sha(b'KEY=original'),'generatedSha':b.sha(compose.read_bytes())}
            with self.patch.object(self.r,'ENV',env),self.patch.object(self.r,'COMPOSE',compose):
                with self.assertRaises(self.r.GateError):self.r.metadata_payload('apply',state,{}, {},self.settings)

class ProtectedContainerSnapshot(unittest.TestCase):
    def row(self):
        return {'Name':'/flixify-phone-login-smoke-unrelated-project','Id':'stable','Image':'sha256:stable','Config':{},'HostConfig':{'Memory':0},'Mounts':[],'NetworkSettings':{'Networks':{'production':{'IPAddress':'10.0.0.1'}}},'State':{'StartedAt':'stable','Running':True,'Paused':False},'RestartCount':0}
    def snapshot(self,row):
        from unittest.mock import patch
        with patch.object(b,'command',side_effect=[b'container-id',json.dumps([row]).encode()]):return b.outside_snapshot()
    def test_does_not_hide_arbitrary_tool_prefix_container(self):
        row=self.row();self.assertIn(row['Name'],self.snapshot(row))
    def test_detects_host_network_and_runtime_state_changes(self):
        import copy
        original=self.row();before=self.snapshot(original)
        mutations=[lambda x:x['HostConfig'].update(Memory=1024),lambda x:x['NetworkSettings']['Networks']['production'].update(IPAddress='10.0.0.2'),lambda x:x['State'].update(Running=False),lambda x:x['State'].update(Paused=True),lambda x:x.update(RestartCount=1)]
        for mutate in mutations:
            row=copy.deepcopy(original);mutate(row);self.assertNotEqual(before,self.snapshot(row))

if __name__=='__main__':unittest.main()
