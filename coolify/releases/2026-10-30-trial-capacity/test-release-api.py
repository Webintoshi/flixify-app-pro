"""Offline API-only image/environment transaction contracts."""
import copy,importlib.util,json,sys,types,unittest,contextlib,io,tempfile,stat
from pathlib import Path
from unittest.mock import patch
sys.modules.setdefault("yaml",types.SimpleNamespace(YAMLError=Exception))
spec=importlib.util.spec_from_file_location("trial_api_release",Path(__file__).with_name("release-api.py"));api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api);guard=api.guard
REV="a"*40;CANDIDATE="sha256:"+"b"*64;WEB_TAG="flixify-ops-web:edge-recovery-123456789abc-20261026";WEB_ID="sha256:"+"c"*64
TARGET_ENV={"TRUSTED_PROXY_CIDRS":"10.0.2.4/32,127.0.0.1/32,::1/128","AUTO_TRIAL_DAILY_IP_LIMIT":"1000"}
def configure():api.configure(REV,CANDIDATE,WEB_TAG,WEB_ID)
def fixture(stage="source"):
    tags={"db":guard.PROTECTED_DB_TAG,"api":guard.expected_images(stage)["api"],"ops-web":WEB_TAG,"worker":api.WORKER_TAG}
    raw={"networks":{"kept":True},"services":{name:{"image":tag,"environment":{"PRESERVE":"secret-sentinel"}} for name,tag in tags.items()}}
    if stage=="target":raw["services"]["api"]["environment"].update(TARGET_ENV)
    ids={"db":guard.PROTECTED_DB_IMAGE_ID,"api":api.SOURCE_ID if stage=="source" else CANDIDATE,"ops-web":WEB_ID,"worker":api.WORKER_ID}
    snapshots={name:{"id":"container:"+name,"image_id":ids[name],"tag":tag,"hash":"config","guard":"unchanged","running":True,"health":None} for name,tag in tags.items()}
    return raw,copy.deepcopy(raw),copy.deepcopy(raw),snapshots,{"api":tags["api"]}
class ReleaseTests(unittest.TestCase):
    def setUp(self):
        configure();self.ids=patch.object(guard,"image_id",side_effect=lambda t:{WEB_TAG:WEB_ID,api.WORKER_TAG:api.WORKER_ID,api.SOURCE_TAG:api.SOURCE_ID,api.target(REV):CANDIDATE}.get(t,"unexpected"));self.ids.start();self.addCleanup(self.ids.stop)
    def test_only_api_changes_and_web_worker_db_are_pinned(self):
        self.assertEqual(guard.CHANGED,("api",));self.assertEqual(guard.PROTECTED,("db","worker","ops-web"));self.assertEqual(guard.PROTECTED_IMAGES,{"worker":(api.WORKER_TAG,api.WORKER_ID),"ops-web":(WEB_TAG,WEB_ID)})
    def test_raw_environment_list_and_rendered_map_round_trip_without_shape_or_order_changes(self):
        raw,rendered,generated,snapshots,applications=fixture();source=["PRESERVE=secret-sentinel","UNRELATED_BARE","WITH_EQUALS=a=b=c","DUP=first","DUP=second"]
        raw["services"]["api"]["environment"]=source.copy()
        guard.validate_plan(raw,rendered,generated,snapshots,applications,"source")
        a,b=guard.expected_swapped(raw,rendered,guard.TARGET)
        self.assertEqual(a["services"]["api"]["environment"],source+[key+"="+value for key,value in TARGET_ENV.items()]);self.assertIsInstance(b["services"]["api"]["environment"],dict)
        c,d=guard.expected_swapped(a,b,guard.SOURCE);self.assertEqual(c,raw);self.assertEqual(d,rendered);self.assertEqual(raw["services"]["api"]["environment"],source)
    def test_raw_list_rejects_existing_bare_target_duplicate_or_drifted_target_values(self):
        for entry in ("TRUSTED_PROXY_CIDRS","AUTO_TRIAL_DAILY_IP_LIMIT","TRUSTED_PROXY_CIDRS=bad"):
            raw,rendered,*_=fixture();raw["services"]["api"]["environment"]=["KEPT=literal",entry]
            with self.subTest(entry=entry),self.assertRaises(guard.GateError):guard.expected_swapped(raw,rendered,guard.TARGET)
        target=[key+"="+value for key,value in TARGET_ENV.items()]
        for entries in (target+[target[0]],[target[0],"AUTO_TRIAL_DAILY_IP_LIMIT"],[target[0],"AUTO_TRIAL_DAILY_IP_LIMIT=2000"],target+[123]):
            raw,rendered,*_=fixture("target");raw["services"]["api"]["environment"]=["PRESERVE=secret-sentinel",*entries]
            with self.subTest(entries=entries),self.assertRaises(guard.GateError):guard.expected_swapped(raw,rendered,guard.SOURCE)
    def test_forward_swap_adds_exact_two_api_values_and_preserves_every_other_value(self):
        raw,rendered,*_=fixture();old=copy.deepcopy(raw);expected=copy.deepcopy(raw);expected["services"]["api"]["image"]=api.target(REV);expected["services"]["api"]["environment"].update(TARGET_ENV)
        a,b=guard.expected_swapped(raw,rendered,guard.TARGET);self.assertEqual(a,expected);self.assertEqual(b,expected);self.assertEqual(raw,old)
    def test_reverse_swap_restores_absent_keys_and_preserves_other_environment(self):
        raw,rendered,*_=fixture("target");a,b=guard.expected_swapped(raw,rendered,guard.SOURCE);self.assertEqual(a,fixture()[0]);self.assertEqual(b,fixture()[1])
    def test_source_preexisting_keys_and_target_wrong_values_are_rejected(self):
        for stage in ("source","target"):
            for key in TARGET_ENV:
                values=fixture(stage);values[0]["services"]["api"]["environment"][key]="wrong"
                with self.subTest(stage=stage,key=key),self.assertRaises(guard.GateError):guard.validate_plan(*values,stage)
    def test_exact_source_and_target_are_accepted(self):
        for stage in ("source","target"):guard.validate_plan(*fixture(stage),stage)
    def test_target_broad_proxy_or_altered_capacity_are_rejected(self):
        for key,value in (("TRUSTED_PROXY_CIDRS","10.0.2.0/24"),("AUTO_TRIAL_DAILY_IP_LIMIT","9999")):
            values=fixture("target")
            for document in values[:3]:document["services"]["api"]["environment"][key]=value
            with self.subTest(key=key),self.assertRaises(guard.GateError):guard.validate_plan(*values,"target")
    def test_rollback_does_not_remove_drifted_environment(self):
        raw,rendered,*_=fixture("target");raw["services"]["api"]["environment"]["AUTO_TRIAL_DAILY_IP_LIMIT"]="2000"
        with self.assertRaises(guard.GateError):guard.expected_swapped(raw,rendered,guard.SOURCE)
    def test_mutable_revision_and_unpinned_web_are_rejected(self):
        for args in (("HEAD",CANDIDATE,WEB_TAG,WEB_ID),(REV,"latest",WEB_TAG,WEB_ID),(REV,CANDIDATE,"",WEB_ID),(REV,CANDIDATE,WEB_TAG,"")):
            with self.subTest(args=args),self.assertRaises(guard.GateError):api.configure(*args)
    def test_locked_swap_payload_is_api_only_and_contains_env_direction(self):
        raw,rendered,*_=fixture();record={"docker_compose_raw":"raw","docker_compose":"rendered"}
        with patch.object(guard,"command") as command:guard.locked_image_swap(record,guard.SOURCE,guard.TARGET)
        payload=json.loads(command.call_args.kwargs["input_data"]);self.assertEqual(payload["old"],guard.SOURCE);self.assertEqual(payload["new"],guard.TARGET);self.assertTrue(payload.get("add_trial_env"));self.assertEqual(payload["protected"],{"worker":api.WORKER_TAG,"ops-web":WEB_TAG})
        with patch.object(guard,"command") as command:guard.locked_image_swap(record,guard.TARGET,guard.SOURCE)
        self.assertFalse(json.loads(command.call_args.kwargs["input_data"]).get("add_trial_env"))
    def test_transaction_rejects_unexpected_service_or_image_directions(self):
        with patch.object(guard,"command") as command,self.assertRaises(guard.GateError):guard.locked_image_swap({},guard.SOURCE,{"api":"unreviewed"})
        command.assert_not_called()
    def test_api_health_checks_exact_container_local_port_and_json_ok(self):
        snapshot=fixture("target")[3]
        with patch.object(guard,"container_snapshot",return_value=snapshot),patch.object(guard,"compose_hash",return_value="config"),patch.object(guard,"command") as command:
            self.assertTrue(api.healthy("api",api.target(REV),CANDIDATE));args=command.call_args.args;self.assertEqual(args[:4],("docker","exec","api-"+guard.UUID,"node"));self.assertIn("http://127.0.0.1:4000/health",args[-1]);self.assertIn("ok!==true",args[-1])
    def test_recreate_only_api_preserves_env_file_and_never_restarts_dependencies(self):
        before=fixture()[3];updated=fixture("target")[3];snapshots=iter((before,))
        with patch.object(guard,"candidate_images",return_value={"api":CANDIDATE}),patch.object(guard,"verify_candidate_ids"),patch.object(guard,"container_snapshot",side_effect=lambda **k:next(snapshots,updated)),patch.object(guard,"verify_recreate_context"),patch.object(guard,"healthy",return_value=True),patch.object(guard.time,"sleep"),patch.object(guard,"ENV") as env,patch.object(guard,"command") as command:
            env.read_bytes.return_value=b"unmodified-secret-file";api.quiet_recreate(before,b"compose",b"unmodified-secret-file",{},{});self.assertEqual(command.call_args.args[-1],"api");self.assertIn("--no-deps",command.call_args.args);self.assertIn("--no-build",command.call_args.args);self.assertIn("never",command.call_args.args);self.assertEqual(command.call_count,1)
    def proxy_fixture(self):
        proxy={"Id":"proxy-id","Image":api.PROXY_ID,"Config":{"Image":api.PROXY_TAG,"Labels":{"coolify.managed":"true","com.docker.compose.project":"coolify-proxy"}},"State":{"Running":True},"NetworkSettings":{"Networks":{guard.UUID:{"NetworkID":api.PROXY_NETWORK_ID,"IPAddress":"10.0.2.4"}}}}
        service={"Name":"/api-"+guard.UUID,"State":{"Running":True},"NetworkSettings":{"Networks":{guard.UUID:{"NetworkID":api.PROXY_NETWORK_ID,"IPAddress":"10.0.2.7"}}}}
        return proxy,service
    def proxy_command(self,proxy,service):
        return lambda *args,**kwargs:json.dumps([proxy if args[-1]=="coolify-proxy" else service]).encode()
    def test_proxy_peer_is_strictly_pinned_to_exact_role_network_and_ip(self):
        base,service=self.proxy_fixture()
        with patch.object(guard,"command",side_effect=self.proxy_command(base,service)):api.verify_proxy_peer()
        for changes in ({"ip":"10.0.2.5"},{"network":"other"},{"image":"other"},{"managed":"false"},{"running":False}):
            bad=copy.deepcopy(base)
            if "ip" in changes:bad["NetworkSettings"]["Networks"][guard.UUID]["IPAddress"]=changes["ip"]
            if "network" in changes:bad["NetworkSettings"]["Networks"][guard.UUID]["NetworkID"]=changes["network"]
            if "image" in changes:bad["Image"]=changes["image"]
            if "managed" in changes:bad["Config"]["Labels"]["coolify.managed"]=changes["managed"]
            if "running" in changes:bad["State"]["Running"]=False
            with self.subTest(changes=changes),patch.object(guard,"command",side_effect=self.proxy_command(bad,service)),self.assertRaises(guard.GateError):api.verify_proxy_peer()
    def test_api_must_join_the_same_dedicated_network_but_its_ip_can_change(self):
        proxy,service=self.proxy_fixture();service["NetworkSettings"]["Networks"][guard.UUID]["NetworkID"]="other-network"
        with patch.object(guard,"command",side_effect=self.proxy_command(proxy,service)),self.assertRaisesRegex(guard.GateError,"api_trusted_proxy_network_differs"):api.verify_proxy_peer()
        service["NetworkSettings"]["Networks"][guard.UUID].update(NetworkID=api.PROXY_NETWORK_ID,IPAddress="10.0.2.11")
        with patch.object(guard,"command",side_effect=self.proxy_command(proxy,service)):api.verify_proxy_peer()
    def test_recovery_only_allows_missing_or_stopped_unattached_api_not_wrong_live_network(self):
        proxy,service=self.proxy_fixture();service["NetworkSettings"]["Networks"]={}
        with patch.object(guard,"command",side_effect=self.proxy_command(proxy,service)),self.assertRaises(guard.GateError):api.verify_proxy_peer(allow_missing_api=True)
        service["State"]["Running"]=False
        with patch.object(guard,"command",side_effect=self.proxy_command(proxy,service)),self.assertRaises(guard.GateError):api.verify_proxy_peer()
        with patch.object(guard,"command",side_effect=self.proxy_command(proxy,service)):api.verify_proxy_peer(allow_missing_api=True)
        service["NetworkSettings"]["Networks"]={guard.UUID:{"NetworkID":"unexpected-network"}}
        with patch.object(guard,"command",side_effect=self.proxy_command(proxy,service)),self.assertRaises(guard.GateError):api.verify_proxy_peer(allow_missing_api=True)
    def test_proxy_is_rechecked_before_after_preflight_and_in_recovery_context(self):
        with patch.object(api,"verify_proxy_peer") as proxy,patch.object(api,"ORIGINAL_PREFLIGHT",return_value="result"):
            self.assertEqual(guard.preflight("source"),"result");self.assertEqual(proxy.call_count,2)
        with patch.object(api,"verify_proxy_peer") as proxy,patch.object(api,"ORIGINAL_RECREATE_CONTEXT") as inner:
            guard.verify_recreate_context("checked");proxy.assert_called_once();inner.assert_called_once_with("checked")
        with patch.object(api,"verify_proxy_peer") as proxy,patch.object(api,"ORIGINAL_RECOVERY_CONTEXT") as inner:
            guard.verify_recovery_context("checked");proxy.assert_called_once();inner.assert_called_once_with("checked")
    def test_apply_passes_api_only_to_the_atomic_transaction(self):
        args=["release-api.py","--revision",REV,"--candidate-id",CANDIDATE,"--protected-web-tag",WEB_TAG,"--protected-web-id",WEB_ID,"--apply"]
        with patch.object(api,"configure"),patch.object(sys,"argv",args),patch.object(guard,"preflight",return_value=({},b"compose",b"secret",{}, {},{})),patch.object(guard,"sync_images") as sync:
            api.main();self.assertEqual(sync.call_args.args[-2:],(guard.SOURCE,guard.TARGET));self.assertEqual(set(sync.call_args.args[-1]),{"api"})
    def test_unhealthy_api_attempts_rollback_only_after_guarding_current_context(self):
        args=["release-api.py","--revision",REV,"--candidate-id",CANDIDATE,"--protected-web-tag",WEB_TAG,"--protected-web-id",WEB_ID,"--recreate"]
        with patch.object(api,"configure"),patch.object(sys,"argv",args),patch.object(guard,"preflight",return_value=({},b"compose",b"secret",{}, {},{})),patch.object(api,"quiet_recreate",side_effect=guard.GateError("new_container_unhealthy:api")),patch.object(guard,"verify_recovery_context") as recovery,patch.object(api,"quiet_rollback") as rollback,self.assertRaisesRegex(guard.GateError,"deploy_failed_but_source_restored"):
            api.main()
        recovery.assert_called_once();rollback.assert_called_once()
    def test_rollback_recreates_only_api_with_the_pinned_source_and_absent_two_keys(self):
        raw,rendered,_,before,_=fixture("target");restored=fixture()[3];_,source_rendered=guard.expected_swapped(raw,rendered,guard.SOURCE);snapshots=iter((before,))
        with patch.object(guard,"preflight",return_value=({},b"target",b"secret",before,raw,rendered)),patch.object(guard,"sync_images") as sync,patch.object(guard,"COMPOSE") as compose,patch.object(guard,"parsed",return_value=source_rendered),patch.object(guard,"verify_recreate_context"),patch.object(guard,"verify_source_images"),patch.object(guard,"container_snapshot",side_effect=lambda **k:next(snapshots,restored)),patch.object(guard,"healthy",return_value=True) as healthy,patch.object(guard,"ENV") as env,patch.object(guard,"command") as command:
            compose.read_bytes.return_value=b"source";env.read_bytes.return_value=b"secret";api.quiet_rollback();self.assertEqual(sync.call_args.args[-2:],(guard.TARGET,guard.SOURCE));self.assertEqual(command.call_count,1);self.assertEqual(command.call_args.args[-1],"api");healthy.assert_called_with("api",api.SOURCE_TAG,api.SOURCE_ID)
    def exercise_sync(self,break_env=False):
        raw,rendered,_,containers,_=fixture();record={"docker_compose_raw":json.dumps(raw),"docker_compose":json.dumps(rendered)};state=copy.deepcopy(record);secret=b"# retained formatting\r\nAPP_JWT_SECRET=fixture-only\r\n";directions=[]
        with tempfile.TemporaryDirectory(prefix="trial-api-env-contract-") as directory:
            compose=Path(directory)/"docker-compose.yml";env=Path(directory)/".env";compose.write_bytes(record["docker_compose"].encode());env.write_bytes(secret);env.chmod(0o600);original_compose=compose.read_bytes()
            def swap(current,old,new):
                directions.append((old,new));a,b=api.expected_swapped(json.loads(state["docker_compose_raw"]),json.loads(state["docker_compose"]),new);state.update(docker_compose_raw=json.dumps(a),docker_compose=json.dumps(b));compose.write_bytes(state["docker_compose"].encode())
                if break_env and new==guard.TARGET:env.write_bytes(b"unexpected-rewrite")
            with patch.object(guard,"COMPOSE",compose),patch.object(guard,"ENV",env),patch.object(guard,"parsed",side_effect=json.loads),patch.object(guard,"service_record",side_effect=lambda:copy.deepcopy(state)),patch.object(guard,"container_snapshot",return_value=containers),patch.object(guard,"application_images",side_effect=lambda:{"api":json.loads(state["docker_compose_raw"])["services"]["api"]["image"]}),patch.object(guard,"verify_protected_applications"),patch.object(guard,"locked_image_swap",side_effect=swap),patch.object(guard,"command"):
                if break_env:
                    with self.assertRaisesRegex(guard.GateError,"postcheck_failed_source_restored:env_changed_after_sync"):guard.sync_images(record,original_compose,secret,containers,raw,rendered,guard.SOURCE,guard.TARGET)
                else:guard.sync_images(record,original_compose,secret,containers,raw,rendered,guard.SOURCE,guard.TARGET)
            self.assertEqual(env.read_bytes(),secret);self.assertEqual(stat.S_IMODE(env.stat().st_mode),0o600)
            final=json.loads(state["docker_compose"]);self.assertEqual(final["services"]["worker"],raw["services"]["worker"]);self.assertEqual(final["services"]["api"]["environment"].get("PRESERVE"),"secret-sentinel")
            if break_env:self.assertEqual(state,record);self.assertEqual(compose.read_bytes(),original_compose);self.assertEqual(len(directions),2)
            else:self.assertEqual(final["services"]["api"]["environment"],dict(raw["services"]["api"]["environment"],**TARGET_ENV));self.assertEqual(len(directions),1)
    def test_real_temporary_files_preserve_exact_secret_env_bytes_and_mode(self):self.exercise_sync()
    def test_postcheck_env_rewrite_is_repaired_and_only_our_api_settings_are_reversed(self):self.exercise_sync(True)
if __name__=="__main__":unittest.main()
