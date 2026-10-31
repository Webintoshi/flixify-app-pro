"""Offline permanent-registration rollout safety contracts."""
import base64,contextlib,copy,hashlib,importlib.util,io,json,os,subprocess,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
sys.modules.setdefault("yaml",types.SimpleNamespace(YAMLError=Exception))
spec=importlib.util.spec_from_file_location("live_release",Path(__file__).with_name("release-api.py"));api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
class TransactionTests(unittest.TestCase):
    def test_existing_env_bytes_survive_exactly_and_only_one_secret_line_is_added(self):
        before=b"# original formatting\r\nUNRELATED=kept\r\n"
        line=b'REGISTRATION_GUARD_SECRET="fixture-only"'
        self.assertEqual(api.append_guard_line(before,line),before+line)
        self.assertEqual(api.append_guard_line(before[:-2],line),before[:-2]+b"\n"+line)
        for bad in (b"OTHER=wrong",line+b"\n",line+b"\nOTHER=wrong",b"REGISTRATION_GUARD_SECRET"):
            with self.subTest(bad=bad),self.assertRaises(api.GateError):api.append_guard_line(before,bad)
        with self.assertRaises(api.GateError):api.append_guard_line(before+line,line)
    def test_apply_is_ordered_verified_stop_migrate_metadata_recreate_and_never_source_rollback(self):
        calls=[];context={"fence":{"phase":"prepared"},"before":{},"proof":{},"runtime":{}}
        with patch.object(api,"rollout_lock",side_effect=contextlib.nullcontext),patch.object(api,"prepare",side_effect=lambda *a: calls.append("verified") or context),patch.object(api,"write_fence",side_effect=lambda *a:calls.append("fence")),patch.object(api,"stop_api",side_effect=lambda *a:calls.append("stop")),patch.object(api,"verify_protected",side_effect=lambda *a:calls.append("protected")),patch.object(api,"migrate",side_effect=lambda *a:calls.append("migration") or {}),patch.object(api,"sync_metadata",side_effect=lambda *a:calls.append("metadata")),patch.object(api,"start_candidate",side_effect=lambda *a:calls.append("candidate")):
            api.apply(Path("/repo"),"a"*40)
        self.assertLess(calls.index("verified"),calls.index("stop"));self.assertLess(calls.index("stop"),calls.index("migration"));self.assertLess(calls.index("migration"),calls.index("metadata"));self.assertLess(calls.index("metadata"),calls.index("candidate"))
    def test_failure_after_seed_stops_api_and_never_restarts_old_image(self):
        context={"fence":{"phase":"prepared"},"before":{},"proof":{},"runtime":{}}
        with patch.object(api,"rollout_lock",side_effect=contextlib.nullcontext),patch.object(api,"prepare",return_value=context),patch.object(api,"write_fence"),patch.object(api,"stop_api") as stop,patch.object(api,"verify_protected"),patch.object(api,"migrate",return_value={}),patch.object(api,"sync_metadata",side_effect=api.GateError("metadata_failed")),patch.object(api,"start_candidate") as start,self.assertRaises(api.GateError):api.apply(Path("/repo"),"a"*40)
        self.assertEqual(stop.call_count,2);start.assert_not_called()
    def test_default_cli_is_readonly_and_rollback_cannot_be_requested(self):
        args=["release-api.py","/repo","--revision","a"*40,"--candidate-id","sha256:"+"b"*64,"--protected-web-tag","flixify-ops-web:fixture","--protected-web-id","sha256:"+"c"*64]
        with patch.object(sys,"argv",args),patch.object(api,"configure"),patch.object(api,"prepare") as prepare,patch.object(api,"apply") as apply,contextlib.redirect_stdout(io.StringIO()):api.main()
        prepare.assert_called_once();apply.assert_not_called()
        with patch.object(sys,"argv",args+["--rollback"]),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):api.main()
class SafetyTests(unittest.TestCase):
    def test_recovery_refuses_any_legacy_writer_restart_after_seed_and_stops_it(self):
        api.guard.CANDIDATE_ID='sha256:'+'b'*64
        for changes in ({'_running':True},{'_container_id':'new-legacy-container'},{'_started_at':'restarted'}):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);fence=root/'state';compose=root/'compose';env=root/'env';compose.write_bytes(b'compose');env.write_bytes(b'env')
                f={'version':1,'revision':'a'*40,'candidate_id':api.guard.CANDIDATE_ID,'phase':'seeded','before':{'api':{'id':'original'}},'source_started_at':'original-start','raw_sha':api.guard.sha('raw'),'rendered_sha':api.guard.sha('rendered'),'compose_sha':api.guard.sha(b'compose'),'old_env_sha':api.guard.sha(b'env'),'target_raw_sha':'other','target_rendered_sha':'other','target_env_sha':'other'}
                fence.write_text(json.dumps(f));runtime={'_image_id':api.SOURCE_ID,'_container_id':'original','_started_at':'original-start','_running':False,**changes}
                with patch.object(api,'FENCE',fence),patch.object(api.guard,'COMPOSE',compose),patch.object(api.guard,'ENV',env),patch.object(api.guard,'verify_source_images'),patch.object(api.guard,'candidate_images'),patch.object(api,'verify_protected'),patch.object(api.guard,'service_record',return_value={'docker_compose_raw':'raw','docker_compose':'rendered'}),patch.object(api,'runtime_values',return_value=runtime),patch.object(api,'stop_api') as stop,patch.object(api,'metadata') as metadata,patch.object(api,'cutover') as cutover,self.assertRaisesRegex(api.GateError,'manual_ledger_resync_required'):
                    api.resume_locked(Path('/repo'),'a'*40)
                stop.assert_called_once();metadata.assert_not_called();cutover.assert_not_called()
    def test_fence_is_exclusive_and_never_contains_runtime_or_secret(self):
        with tempfile.TemporaryDirectory() as directory,patch.object(api,"FENCE",Path(directory)/"state.json"):
            with api.rollout_lock():
                with self.assertRaisesRegex(api.GateError,"another_registration_rollout"):
                    with api.rollout_lock():pass
            api.write_fence({"phase":"seeded","candidate_id":"immutable"})
            self.assertEqual(api.FENCE.stat().st_mode&0o777,0o600)
            self.assertEqual(json.loads(api.FENCE.read_bytes()),{"phase":"seeded","candidate_id":"immutable"})
    def test_source_and_target_environment_require_exact_narrow_trust_and_limits(self):
        old={"TRUSTED_PROXY_CIDRS":api.TRUSTED,"AUTO_TRIAL_DAILY_IP_LIMIT":"1000","KEEP":"same"}
        for stage,values in (("source",old),("target",dict(old,AUTO_TRIAL_DAILY_IP_LIMIT="2",REGISTRATION_GUARD_SECRET=api.GUARD_REF))):
            doc={"services":{"api":{"environment":values}}}
            with patch.object(api.prior,"ORIGINAL_VALIDATE_PLAN"):api.validate_plan(doc,doc,doc,{}, {},stage)
            for key,value in (("TRUSTED_PROXY_CIDRS","0.0.0.0/0"),("AUTO_TRIAL_DAILY_IP_LIMIT","3"),("REGISTRATION_GUARD_SECRET","literal-leak")):
                bad=copy.deepcopy(doc);bad["services"]["api"]["environment"][key]=value
                with self.subTest(stage=stage,key=key),patch.object(api.prior,"ORIGINAL_VALIDATE_PLAN"),self.assertRaises(api.GateError):api.validate_plan(bad,bad,bad,{}, {},stage)
    def test_stop_refuses_unknown_image_and_recovery_starts_only_target_api(self):
        api.guard.CANDIDATE_ID="sha256:"+"b"*64;api.guard.TARGET={"api":"candidate"}
        with patch.object(api.guard,"container_snapshot",return_value={"api":{"id":"x","image_id":"other","tag":"other","running":True}}),patch.object(api.guard,"command") as command,self.assertRaises(api.GateError):api.stop_api({})
        command.assert_not_called()
        current={"api":{"tag":"candidate","running":False}}
        with patch.object(api.guard,"preflight",return_value=({},b"compose",b"env",current,{},{})),patch.object(api,"verify_protected"),patch.object(api.guard,"command") as command,patch.object(api.guard,"recreate") as recreate,patch.object(api,"runtime_values",return_value={api.GUARD_KEY:"dummy-key","APP_JWT_SECRET":"dummy-key","TRUSTED_PROXY_CIDRS":api.TRUSTED,"AUTO_TRIAL_DAILY_IP_LIMIT":"2"}):
            api.start_candidate({"before":{},"runtime":{"APP_JWT_SECRET":"dummy-key"},"proof":{"guard_secret":base64.b64encode(b"dummy-key").decode()}})
        args=command.call_args.args
        self.assertEqual(args[-1],"api");self.assertIn("--no-deps",args);self.assertIn("--no-build",args);self.assertIn("never",args);recreate.assert_called_once()
    def test_migration_command_contains_no_credentials_and_uses_private_database_namespace(self):
        migration={"version":"one","sha":"a"*64,"sql":"SELECT 1;"};context={"before":{},"runtime":{"DATABASE_URL":"postgresql://fixture:private@db/fixture"},"proof":{"guard_secret":base64.b64encode(b"fixture-stable-private-key-32-bytes").decode()},"fence":{"migrations":[{"version":"one","sha":"a"*64}]}}
        with patch.object(api,"verify_protected"),patch.object(api.guard,"container_snapshot",return_value={"api":{"running":False}}),patch.object(api,"migration_inputs",return_value=[migration]),patch.object(api.guard,"command",return_value=json.dumps({"migrations":2,"schemaSha":"c"*64}).encode()) as command:
            api.migrate(context,Path("/repo"),"a"*40)
        args=command.call_args.args;payload=json.loads(command.call_args.kwargs["input_data"])
        self.assertEqual(args[args.index("--network")+1],"container:db-"+api.guard.UUID);self.assertIn("--read-only",args);self.assertIn(api.SOURCE_ID,args);self.assertNotIn("private",str(args));self.assertEqual(payload["databaseUrl"],context["runtime"]["DATABASE_URL"])
        with patch.object(api,"verify_protected"),patch.object(api.guard,"container_snapshot",return_value={"api":{"running":True}}),patch.object(api.guard,"command") as command,self.assertRaisesRegex(api.GateError,"must_be_stopped"):api.migrate(context,Path("/repo"),"a"*40)
        command.assert_not_called()
    def test_protected_container_identity_and_running_status_are_preserved(self):
        api.guard.PROTECTED=("worker",);before={"worker":{"id":"kept","image_id":"image","tag":"tag","hash":"hash","guard":"guard","running":True}}
        for field,value in (("id","changed"),("guard","changed"),("running",False)):
            after=copy.deepcopy(before);after["worker"][field]=value
            with patch.object(api.prior,"verify_proxy_peer"),patch.object(api.guard,"verify_protected_applications"),patch.object(api.guard,"container_snapshot",return_value=after),self.assertRaisesRegex(api.GateError,"protected_container_changed"):api.verify_protected(before)

class MigrationRunnerTests(unittest.TestCase):
    def run_node(self,mode):
        script=r'''const vm=require('node:vm'),crypto=require('node:crypto');const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const mode=MODE,events=[],proof={tables:[{name:'fixture',rls:true}]};let exitCode=0,output=null,connected=null;
const migrations=[{version:'202610310001_registration_lifetime_limits',sql:'MIGRATION_ONE'},{version:'202610310002_live_channel_exclusions',sql:'MIGRATION_TWO'}].map(x=>({...x,sha:sha(x.sql)}));
const payload={databaseUrl:'postgresql://fixture:dummy@db/isolated',secret:'dummy-stable-registration-secret-32-bytes',migrations};
class Client{constructor(config){connected=new URL(config.connectionString)}async connect(){}async end(){}async query(sql,args){events.push(sql);
if(mode==='second-fails'&&sql==='MIGRATION_TWO')throw Error('fixture');
if(sql.includes("to_regclass('public.flixify_release_migrations')"))return{rows:[{marker:mode.startsWith('retry')?'present':null}]};
if(sql.startsWith('select version,source_sha,schema_sha'))return{rows:migrations.map(m=>({version:m.version,source_sha:mode==='retry-source-drift'?'bad':m.sha,schema_sha:mode==='retry-schema-drift'?'bad':sha(JSON.stringify(proof))}))};
if(sql.startsWith('select count(*)::int count'))return{rows:[{count:mode==='unmarked-existing'?1:0}]};
if(sql.startsWith('select json_build_object'))return{rows:[{proof}]};return{rows:[]};}}
vm.runInNewContext(RUNNER,{require:name=>(name==='fs'||name==='node:fs')?{readFileSync:()=>JSON.stringify(payload)}:name==='pg'?{Client}:require(name),URL,console:{log:x=>{output=JSON.parse(x)},error:()=>{}},process:{set exitCode(v){exitCode=v}}});
setTimeout(()=>console.log(JSON.stringify({events,exitCode,output,host:connected.hostname,port:connected.port})),20);'''
        script=script.replace('MODE',json.dumps(mode)).replace('RUNNER',json.dumps(api.MIGRATION_RUNNER))
        result=subprocess.run(['node','-e',script],capture_output=True,text=True,timeout=10);self.assertEqual(result.returncode,0,result.stderr);return json.loads(result.stdout)
    def test_both_migrations_and_two_proofs_commit_atomically_with_local_secret_scope(self):
        result=self.run_node('new');self.assertEqual(result['exitCode'],0);events=result['events']
        self.assertLess(events.index('begin'),events.index('MIGRATION_ONE'));self.assertLess(events.index('MIGRATION_ONE'),events.index('MIGRATION_TWO'));self.assertEqual(events[-1],'commit');self.assertEqual(sum(x.startswith('insert into public.flixify_release_migrations') for x in events),2)
        self.assertIn("select set_config('flixify.registration_guard_secret',$1,true)",events);self.assertEqual(result['host'],'127.0.0.1');self.assertEqual(result['port'],'5432')
    def test_second_migration_failure_rolls_back_everything(self):
        result=self.run_node('second-fails');self.assertEqual(result['exitCode'],1);self.assertEqual(result['events'][-1],'rollback');self.assertNotIn('commit',result['events']);self.assertFalse(any(x.startswith('insert into public.flixify_release_migrations') for x in result['events']))
    def test_marker_replay_validates_source_and_exact_schema_without_reapplying(self):
        result=self.run_node('retry');self.assertEqual(result['exitCode'],0);self.assertTrue(result['output']['alreadyApplied']);self.assertNotIn('MIGRATION_TWO',result['events'])
        for mode in ('retry-source-drift','retry-schema-drift','unmarked-existing'):
            result=self.run_node(mode);self.assertEqual(result['exitCode'],1,mode);self.assertEqual(result['events'][-1],'rollback');self.assertNotIn('MIGRATION_ONE',result['events'])
if __name__=="__main__":unittest.main()
