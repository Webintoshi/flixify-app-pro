"""Offline real-Git publication and web-only deployment contracts."""
import base64
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(safe_load=json.loads, YAMLError=ValueError))
HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("live_registration_web_builder", HERE / "build-web.py")
web = importlib.util.module_from_spec(spec); spec.loader.exec_module(web)
APK = "apps/ops-web/public/downloads/flixify-pro-1.4.2.apk"
MANIFEST = "apps/ops-web/public/downloads/flixify-tv-update.json"
DESCRIPTOR = "apps/ops-web/app/platform/tv-download.ts"
GRADLE = "apps/tv-android/app/build.gradle"
NATIVE = "apps/tv-android/app/src/main/java/vip/flixify/tv/MainActivity.java"
ANDROID_MANIFEST = "apps/tv-android/app/src/main/AndroidManifest.xml"
RUNTIME = tuple("apps/ops-web/app/" + name for name in ("platform/personal-provider.ts", "platform/personal-integration.ts", "platform/session.tsx", "platform/catalog.tsx", "canli-tv/page.tsx"))

class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="flixify-live-web-contract-"); self.repo = Path(self.temp.name)
        self.git("init", "-q"); self.git("config", "user.name", "Fixture"); self.git("config", "user.email", "fixture@example.invalid")
        self.original = b'export const tvDownload={href:"/downloads/flixify-pro-1.4.1.apk",filename:"flixify-pro-1.4.1.apk",version:"1.4.1"};\n'
        self.put(DESCRIPTOR, self.original); self.put(GRADLE, b"android { defaultConfig { applicationId 'vip.flixify.tv'\nminSdk 23\nversionCode 9\nversionName '1.4.1'\n} }\n")
        self.put(ANDROID_MANIFEST, b'<manifest><application android:label="Flixify Pro"/></manifest>\n'); self.put(NATIVE, b"old native\n")
        for index, path in enumerate(RUNTIME): self.put(path, ("export const fixture" + str(index) + "='old';\n").encode())
        self.put(MANIFEST, b'{"old":"accepted-public-manifest"}\n'); self.old_manifest = self.read(MANIFEST)
        self.old_apk = "apps/ops-web/public/downloads/flixify-pro-1.4.1.apk"; self.put(self.old_apk, b"old immutable apk")
        self.base = self.commit()
        for path in RUNTIME: self.put(path, self.read(path).replace(b"old", b"reviewed"))
        self.put(GRADLE, self.read(GRADLE).replace(b"versionCode 9", b"versionCode 10").replace(b"'1.4.1'", b"'1.4.2'")); self.put(NATIVE, b"reviewed native\n"); self.native = self.commit()
        self.apk = b"PK\x03\x04" + b"accepted-artifact-fixture"*100; self.sha = hashlib.sha256(self.apk).hexdigest()
        self.manifest = {"packageName":"vip.flixify.tv", "versionName":"1.4.2", "versionCode":10, "minSdk":23, "apkUrl":"https://flixify.vip/downloads/flixify-pro-1.4.2.apk", "sha256":self.sha, "sizeBytes":len(self.apk), "notes":"Canli yayin ve kanal guncellemesi."}
        self.put(DESCRIPTOR, self.original.replace(b"1.4.1", b"1.4.2")); self.put(APK, self.apk); self.write_manifest(); self.revision = self.commit()
    def git(self, *args): return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE).decode().strip()
    def put(self, path, data):
        p=self.repo/path; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(data)
    def read(self, path): return (self.repo/path).read_bytes()
    def commit(self): self.git("add", "."); self.git("commit", "-qm", "owned fixture"); return self.git("rev-parse", "HEAD")
    def write_manifest(self): self.put(MANIFEST, (json.dumps(self.manifest,separators=(",", ":"))+"\n").encode())
    def pins(self): return patch.multiple(web, BASE_REVISION=self.base, BASELINE_MANIFEST_BYTES=len(self.old_manifest), BASELINE_MANIFEST_SHA256=hashlib.sha256(self.old_manifest).hexdigest())
    def close(self): self.temp.cleanup()

class SourceTests(unittest.TestCase):
    def setUp(self): self.f=Fixture(); self.addCleanup(self.f.close)
    def test_exact_source_and_independent_native_freeze_allow_only_reviewed_runtime_and_publication(self):
        f=self.f
        with f.pins(): web.validate_source_scope(f.repo,f.revision,f.native); web.validate_versions(f.repo,f.revision,f.native)
    def test_new_runtime_files_and_old_asset_changes_are_rejected(self):
        f=self.f
        for path in ("apps/ops-web/app/unreviewed.ts", "apps/ops-web/package.json", f.old_apk):
            f.put(path,b"unreviewed\n"); revision=f.commit()
            with f.pins(),self.subTest(path=path),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,revision,f.native)
            f.git("reset","--hard",f.revision)
    def test_native_tree_must_match_the_accepted_freeze(self):
        f=self.f; f.put(NATIVE,b"later native\n"); revision=f.commit()
        with f.pins(),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,revision,f.native)
    def test_unpinned_or_nonancestor_native_revision_is_rejected(self):
        f=self.f
        with f.pins():
            for value in ("HEAD", "", "f"*40):
                with self.subTest(value=value),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,f.revision,value)
    def test_descriptor_is_only_the_141_to_142_replacement(self):
        f=self.f; f.put(DESCRIPTOR,f.read(DESCRIPTOR)+b"unreviewed metadata\n"); revision=f.commit()
        with f.pins(),self.assertRaises(web.GateError):web.validate_versions(f.repo,revision,f.native)
    def test_real_apk_version_floor_and_label_are_required(self):
        f=self.f
        for path,data in ((GRADLE,f.read(GRADLE).replace(b"versionCode 10",b"versionCode 11")),(GRADLE,f.read(GRADLE).replace(b"minSdk 23",b"minSdk 22")),(ANDROID_MANIFEST,b'<manifest><application android:label="Wrong"/></manifest>')):
            f.git("reset","--hard",f.native); f.put(path,data); native=f.commit()
            with f.pins(),self.subTest(path=path),self.assertRaises(web.GateError):web.validate_versions(f.repo,f.revision,native)

class ArtifactTests(unittest.TestCase):
    def setUp(self): self.f=Fixture(); self.addCleanup(self.f.close)
    def validate(self, revision=None):
        f=self.f
        with f.pins(),patch.object(web.builder,"require_image_absent"):return web.validate_artifacts(f.repo,revision or f.revision,f.sha,len(f.apk))
    def test_pinned_apk_and_coherent_static_manifest_are_accepted(self):
        self.assertEqual(set(self.validate()),{APK,MANIFEST})
    def test_changed_old_apk_and_extra_public_files_are_rejected(self):
        f=self.f
        for path in (f.old_apk,"apps/ops-web/public/new-unreviewed.js"):
            f.put(path,b"wrong"); revision=f.commit()
            with self.subTest(path=path),self.assertRaises(web.GateError):self.validate(revision)
            f.git("reset","--hard",f.revision)
    def test_only_new_apk_must_be_absent_and_its_git_mode_regular(self):
        f=self.f
        with f.pins(),patch.object(web.builder,"require_image_absent") as absent:web.validate_artifacts(f.repo,f.revision,f.sha,len(f.apk))
        self.assertEqual([call.args[0] for call in absent.call_args_list],[APK])
        (f.repo/APK).chmod(0o755); revision=f.commit()
        with self.assertRaises(web.GateError):self.validate(revision)
    def test_artifact_bytes_and_previous_manifest_are_independently_pinned(self):
        f=self.f
        with f.pins(),patch.object(web.builder,"require_image_absent"):
            for sha,size in (("0"*64,len(f.apk)),(f.sha,len(f.apk)+1),(f.sha,33*1024*1024)):
                with self.subTest(size=size),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,f.revision,sha,size)
            with patch.object(web,"BASELINE_MANIFEST_SHA256","0"*64),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,f.revision,f.sha,len(f.apk))
    def test_manifest_rejects_mismatched_version_bool_integer_extra_key_and_duplicate(self):
        f=self.f
        for key,value in (("versionCode",9),("sizeBytes",True),("minSdk",22),("apkUrl","https://other.invalid/a.apk"),("extra",True)):
            value_map=dict(f.manifest);value_map[key]=value
            with self.subTest(key=key),self.assertRaises(web.GateError):web.parse_manifest(json.dumps(value_map).encode(),f.sha,len(f.apk))
        with self.assertRaises(web.GateError):web.parse_manifest(json.dumps(f.manifest).replace('{','{"versionCode":10,',1).encode(),f.sha,len(f.apk))
    def test_public_manifest_changes_exactly_new_apk_and_update_json_preserving_modes_and_links(self):
        f=self.f; old=json.dumps([["dir","",493],["dir","downloads",493],["file","downloads/old.apk",420,3,"a"*64],["link","logo",511,"target"],["file","downloads/flixify-tv-update.json",420,len(f.old_manifest),hashlib.sha256(f.old_manifest).hexdigest()]]).encode()
        with f.pins():new=json.loads(web.expected_public_manifest(old,f.sha,len(f.apk),f.read(MANIFEST)))
        self.assertIn(["file","downloads/old.apk",420,3,"a"*64],new);self.assertIn(["link","logo",511,"target"],new)
        self.assertIn(["file","downloads/flixify-pro-1.4.2.apk",420,len(f.apk),f.sha],new)
        with f.pins(),self.assertRaises(web.GateError):web.expected_public_manifest(json.dumps(new).encode(),f.sha,len(f.apk),f.read(MANIFEST))
    def test_previous_manifest_image_row_must_match_accepted_bytes_and_mode(self):
        f=self.f; old=[["dir","",493],["dir","downloads",493],["file","downloads/flixify-tv-update.json",493,len(f.old_manifest),hashlib.sha256(f.old_manifest).hexdigest()]]
        with f.pins(),self.assertRaises(web.GateError):web.expected_public_manifest(json.dumps(old).encode(),f.sha,len(f.apk),f.read(MANIFEST))

class BuildTests(unittest.TestCase):
    def test_target_and_resource_floor_are_not_mutable_aliases(self):
        self.assertEqual(web.target("a"*40),"flixify-ops-web:live-registration-aaaaaaaaaaaa-20261031")
        for value in ("HEAD","main",""):
            with self.assertRaises(web.GateError):web.target(value)
        self.assertEqual((web.builder.MIN_FREE_BYTES,web.builder.RUN_MEMORY_MIB,web.builder.RUN_TOTAL_MEMORY_MIB),(8*1024**3,1280,1536))
    def test_snapshot_excludes_only_reviewed_source_publications_and_next_not_dependencies(self):
        self.assertIn("apps/ops-web/.next",web.EXCLUDED)
        self.assertNotIn("node_modules",web.EXCLUDED)
        self.assertNotIn("apps/api",web.EXCLUDED)
        self.assertEqual(set(web.EXCLUDED),set((*web.PATHS,APK,MANIFEST,"apps/ops-web/.next")))
    def test_untouched_files_count_and_bytes_must_both_survive(self):
        before={"sha256":"a"*64,"files":100}
        web.require_untouched(before,dict(before))
        for after in ({"sha256":"b"*64,"files":100},{"sha256":"a"*64,"files":99}):
            with self.subTest(after=after),self.assertRaises(web.GateError):web.require_untouched(before,after)
    def test_compile_is_network_disabled_cgroup_bounded_and_removes_owned_container_on_failure(self):
        calls=[]
        def command(*args,**kwargs):
            calls.append(args)
            if args[:3]==("docker","start","--attach"):raise web.GateError("fixture_compile_failure")
            return b""
        with patch.object(web,"command",side_effect=command),self.assertRaises(web.GateError):web.container_compile("a"*40,{"Config":{"Cmd":["node","server.js"]}}, {DESCRIPTOR:b"fixture"},{"NEXT_PUBLIC_API_BASE_URL":"https://fixture.invalid"})
        create=next(args for args in calls if args[:2]==("docker","create"))
        self.assertIn("none",create);self.assertIn("1280m",create);self.assertIn("1536m",create)
        self.assertTrue(any(args[:3]==("docker","rm","--force") for args in calls))
        self.assertIn("build_cgroup_limit_exceeds_cap",create[-1]);self.assertIn("finally",create[-1])
    def test_download_contract_executes_actual_head_mime_range_digest_and_json_checks(self):
        f=Fixture();self.addCleanup(f.close)
        script=web.download_verification_script(f.sha,len(f.apk),f.read(MANIFEST))
        setup='const apk=Buffer.from('+json.dumps(base64.b64encode(f.apk).decode())+',"base64"),manifest=Buffer.from('+json.dumps(base64.b64encode(f.read(MANIFEST)).decode())+',"base64");globalThis.fetch=async(u,o={})=>{if(String(u).endsWith(".json"))return new Response(manifest,{headers:{"content-type":"application/json"}});if(o.method==="HEAD")return new Response(null,{headers:{"content-type":"application/vnd.android.package-archive","content-length":String(apk.length)}});if(o.headers?.Range)return new Response(apk.subarray(0,32),{status:206,headers:{"content-range":"bytes 0-31/"+apk.length}});return new Response(apk);};'
        result=subprocess.run(["node","-e",setup+script],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr.decode())
        result=subprocess.run(["node","-e",setup.replace("application/vnd.android.package-archive","text/plain")+script],capture_output=True)
        self.assertNotEqual(result.returncode,0)
    def test_failed_checker_inspection_cannot_skip_cleanup_of_its_immutable_id(self):
        calls=[];owned="1"*64;candidate="sha256:"+"2"*64
        def command(*args,**kwargs):
            calls.append(args)
            if args[:2] in (("docker","run"),("docker","create")):return (owned+"\n").encode()
            if args[:2] in (("docker","inspect"),("docker","exec")):raise web.GateError("fixture_check_failure")
            return b""
        with patch.object(web,"command",side_effect=command),self.assertRaises(web.GateError):web.verify_download(candidate,"a"*64,1234,b"fixture")
        self.assertIn(("docker","rm","--force",owned),calls)
    def test_checker_start_identity_and_http_failures_all_remove_only_the_created_id(self):
        f=Fixture();self.addCleanup(f.close);owned="1"*64;candidate="sha256:"+"2"*64
        for phase in ("start","identity","http","success"):
            calls=[]
            def command(*args,**kwargs):
                calls.append(args)
                if args[:2]==("docker","create"):return (owned+"\n").encode()
                if args[:2]==("docker","start") and phase=="start":raise web.GateError("fixture_start_failure")
                if args[:2]==("docker","inspect"):return (("sha256:"+"3"*64) if phase=="identity" else candidate).encode()
                if args[:2]==("docker","exec") and phase=="http":raise web.GateError("fixture_http_failure")
                return b""
            with self.subTest(phase=phase),patch.object(web,"command",side_effect=command):
                if phase=="success":web.verify_download(candidate,f.sha,len(f.apk),f.read(MANIFEST))
                else:
                    with self.assertRaises(web.GateError):web.verify_download(candidate,f.sha,len(f.apk),f.read(MANIFEST))
            self.assertEqual([args for args in calls if args[:3]==("docker","rm","--force")],[("docker","rm","--force",owned)])
            self.assertFalse(any(args[:2]==("docker","stop") for args in calls))

class ProtectedBuildTests(unittest.TestCase):
    API_TAG="flixify-api:live-registration-8645860e0552-20261031"
    API_ID="sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6"
    def rows(self):
        pins={"api":(self.API_TAG,self.API_ID),"worker":(web.WORKER_TAG,web.WORKER_ID),"db":("postgres:16-alpine",web.DB_ID),"ops-web":(web.SOURCE_TAG,web.SOURCE_ID)}
        return [{"Name":"/"+name+"-"+web.core.UUID,"Id":"container-"+name,"Image":identity,"RestartCount":0,"Config":{"Image":tag,"Env":["PRIVATE=fixture"],"Labels":{"com.docker.compose.project":web.core.UUID}},"HostConfig":{"Memory":1},"Mounts":[],"State":{"Running":True,"StartedAt":"accepted-start","Health":{"Status":"healthy"}},"NetworkSettings":{"Networks":{"same":{"NetworkID":"accepted"}}}} for name,(tag,identity) in pins.items()]
    def snapshot(self,rows,env=b"fresh current environment fixture"):
        with patch.object(web,"command",return_value=json.dumps(rows).encode()),patch.object(web.Path,"read_bytes",return_value=env):return web.protected_snapshot(self.API_TAG,self.API_ID)
    def test_new_api_and_full_config_env_restarts_network_and_identity_are_protected(self):
        original=self.rows();before=self.snapshot(original)
        self.assertEqual(set(before),{"api","worker","db","ops-web","env_file"})
        self.assertNotIn("PRIVATE",json.dumps(before));self.assertNotIn("fixture",json.dumps(before))
        for field in ("id","restart","environment","network","started"):
            rows=copy.deepcopy(original)
            if field=="id":rows[0]["Id"]="replaced"
            elif field=="restart":rows[0]["RestartCount"]=1
            elif field=="environment":rows[0]["Config"]["Env"].append("OTHER=changed")
            elif field=="network":rows[0]["NetworkSettings"]["Networks"]["same"]["NetworkID"]="changed"
            else:rows[0]["State"]["StartedAt"]="changed"
            with self.subTest(field=field):self.assertNotEqual(before,self.snapshot(rows))
        self.assertNotEqual(before,self.snapshot(original,b"other current environment"))
    def test_wrong_api_image_stopped_or_unhealthy_service_and_wrong_project_refuse(self):
        for field in ("image","tag","stopped","unhealthy","project"):
            rows=self.rows()
            if field=="image":rows[0]["Image"]="sha256:"+"0"*64
            elif field=="tag":rows[0]["Config"]["Image"]="flixify-api:old"
            elif field=="stopped":rows[0]["State"]["Running"]=False
            elif field=="unhealthy":rows[0]["State"]["Health"]["Status"]="unhealthy"
            else:rows[0]["Config"]["Labels"]["com.docker.compose.project"]="unrelated"
            with self.subTest(field=field),self.assertRaises(web.GateError):self.snapshot(rows)
    def arguments(self,action):return ["build-web.py","/owned/repo","--revision","a"*40,"--native-revision","b"*40,"--apk-sha256","c"*64,"--apk-bytes","1234","--protected-api-tag",self.API_TAG,"--protected-api-id",self.API_ID]+([action] if action else [])
    def preflight(self):return ({},{},{},b"config",b"[]",{"sha256":"a"*64,"files":1},{"accepted":"snapshot"})
    def test_default_is_readonly_and_never_calls_compiler_or_candidate_verifier(self):
        with patch.object(sys,"argv",self.arguments(None)),patch.object(web,"preflight",return_value=self.preflight()),patch.object(web,"container_compile") as compile,patch.object(web,"verify_candidate") as verify,contextlib.redirect_stdout(io.StringIO()) as output:web.main()
        compile.assert_not_called();verify.assert_not_called();self.assertIn("no_mutation",output.getvalue())
    def test_build_refuses_less_than_8GiB_before_compiler_or_tag_creation(self):
        with patch.object(sys,"argv",self.arguments("--build")),patch.object(web,"preflight",return_value=self.preflight()),patch.object(web.shutil,"disk_usage",return_value=types.SimpleNamespace(free=8*1024**3-1)),patch.object(web,"container_compile") as compile,self.assertRaisesRegex(web.GateError,"requires_8GiB"):web.main()
        compile.assert_not_called()
    def test_protected_state_change_after_candidate_verification_stops_acceptance(self):
        with patch.object(sys,"argv",self.arguments("--verify-existing")),patch.object(web,"preflight",return_value=self.preflight()),patch.object(web,"verify_candidate",return_value="sha256:"+"d"*64),patch.object(web,"protected_snapshot",return_value={"accepted":"CHANGED"}),self.assertRaisesRegex(web.GateError,"changed_protected_service"):web.main()


release_spec=importlib.util.spec_from_file_location("live_registration_web_transaction",HERE/"release-web.py")
release=importlib.util.module_from_spec(release_spec);release_spec.loader.exec_module(release)
REVISION="a"*40
CANDIDATE_ID="sha256:"+"b"*64
API_TAG="flixify-api:live-registration-8645860e0552-20261031"
API_ID="sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6"

class WebTransactionFixture:
    """Keep transaction logic real and replace only Docker/Coolify boundaries."""

    def __init__(self):
        release.configure(REVISION, CANDIDATE_ID, API_TAG, API_ID)
        self.guard = g = release.guard
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.compose = self.root / 'docker-compose.yml'
        self.env = self.root / '.env'
        self.env.write_bytes(b'# original formatting\r\nPRESERVE=fixture-private\r\n')
        self.doc = {'services': {
            'db': {'image': 'postgres:16-alpine', 'environment': {'KEEP': 'db'}},
            'api': {'image': API_TAG, 'environment': {'KEEP': 'api'}},
            'worker': {'image': 'flixify-worker:edge-recovery-539e01cff3c3-20261026', 'environment': {'KEEP': 'worker'}},
            'ops-web': {'image': 'flixify-ops-web:edge-recovery-ed852d2a69d4-20261026', 'environment': {'KEEP': 'web'}},
        }}
        self.record = {'id': 1, 'uuid': g.UUID, 'docker_compose_raw': json.dumps(self.doc), 'docker_compose': json.dumps(self.doc)}
        self.compose.write_bytes(json.dumps(self.doc).encode())
        self.apps = {name: self.doc['services'][name]['image'] for name in ('api', 'worker', 'ops-web')}
        self.tags = {
            'db': ('postgres:16-alpine', 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'),
            'api': (API_TAG, API_ID),
            'worker': ('flixify-worker:edge-recovery-539e01cff3c3-20261026', 'sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee'),
            'ops-web': ('flixify-ops-web:edge-recovery-ed852d2a69d4-20261026', 'sha256:d6abf84cc47f3395466bf637c3505489b91cc2e69ca2c8ce061e6c815b4354c0'),
        }
        self.containers = {name: self.container(name, *pin) for name, pin in self.tags.items()}
        base = {'Id': self.tags['ops-web'][1], 'RootFS': {'Layers': ['source-layer']}, 'Config': {'Labels': {}}}
        candidate = {'Id': CANDIDATE_ID, 'RootFS': {'Layers': ['source-layer', 'web-overlay']}, 'Config': {'Labels': {
            'org.opencontainers.image.revision': REVISION,
            'vip.flixify.edge-recovery.base': self.tags['ops-web'][1],
        }}}
        self.images = {self.tags['ops-web'][0]: base, self.tags['ops-web'][1]: base,
                       g.TARGET['ops-web']: candidate, CANDIDATE_ID: candidate}
        for name in ('api', 'worker'):
            tag, identity = self.tags[name]
            self.images[tag] = {'Id': identity}
        self.events = []
        self.break_env_once = False
        self.fail_target_health = False
        self.fail_target_guard = False
        self.stack = contextlib.ExitStack()
        for key, value in (('DIRECTORY', self.root), ('COMPOSE', self.compose), ('ENV', self.env), ('command', self.command)):
            self.stack.enter_context(patch.object(g, key, value))
        self.stack.enter_context(patch.object(g.time, 'sleep'))

    def close(self):
        self.stack.close()
        self.directory.cleanup()

    def container(self, name, tag, identity):
        return {'Id': 'original-' + name, 'Image': identity, 'RestartCount': 0,
                'Config': {'Image': tag, 'Env': ['PRIVATE=fixture-only'], 'Labels': {
                    'com.docker.compose.project': self.guard.UUID,
                    'com.docker.compose.config-hash': 'hash:' + tag}},
                'State': {'Running': True, 'StartedAt': 'original-start', 'Health': {'Status': 'healthy'}},
                'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped'}},
                'Mounts': [], 'NetworkSettings': {'Networks': {'fixture': {'NetworkID': 'same'}}}}

    def command(self, *args, input_data=None, **kwargs):
        self.events.append(args)
        if args[:3] == ('docker', 'image', 'inspect'):
            return json.dumps([self.images[args[3]]]).encode()
        if args[:2] == ('docker', 'inspect'):
            name = args[2].removesuffix('-' + self.guard.UUID)
            return json.dumps([self.containers[name]]).encode()
        if args[:3] == ('docker', 'exec', 'coolify-db'):
            return json.dumps(self.record).encode()
        if args[:3] in (('docker', 'exec', 'coolify'), ('docker', 'exec', '-i')):
            if input_data is None:
                match = re.search(r'foreach \(\[([^\]]+)\] as \$name\)', args[-1])
                if match is None:
                    raise AssertionError('unexpected Coolify read')
                names = re.findall(r"'([^']+)'", match[1])
                return json.dumps({name: self.apps[name] for name in names}).encode()
            payload = json.loads(input_data)
            assert payload['raw_sha'] == self.guard.sha(self.record['docker_compose_raw'])
            assert payload['rendered_sha'] == self.guard.sha(self.record['docker_compose'])
            assert payload['old'] == {'ops-web': self.apps['ops-web']}
            assert payload['protected'] == {name: self.apps[name] for name in ('api', 'worker')}
            assert set(payload['new']) == {'ops-web'}
            for field in ('docker_compose_raw', 'docker_compose'):
                document = json.loads(self.record[field])
                document['services']['ops-web']['image'] = payload['new']['ops-web']
                release.isolate_guard_document(document,payload['isolate_guard'])
                self.record[field] = json.dumps(document)
            self.apps.update(payload['new'])
            self.compose.write_bytes(self.record['docker_compose'].encode())
            if self.break_env_once:
                self.env.write_bytes(b'UNEXPECTED=fixture\n')
                self.break_env_once = False
            return b'coolify_api_web_source_synced\n'
        if args[:2] == ('docker', 'compose'):
            if '--hash' in args:
                name = args[-1]
                return ('hash:' + json.loads(self.record['docker_compose'])['services'][name]['image']).encode()
            if 'up' in args:
                assert args[-1] == 'ops-web'
                assert all(flag in args for flag in ('--no-deps', '--no-build', '--force-recreate'))
                assert args[args.index('--pull') + 1] == 'never'
                tag = json.loads(self.record['docker_compose'])['services']['ops-web']['image']
                self.containers['ops-web'] = self.container('ops-web', tag, self.images[tag]['Id'])
                self.containers['ops-web']['Id'] = 'recreated-web-' + str(len(self.events))
                self.containers['ops-web']['State']['StartedAt'] = 'new-start'
                self.containers['ops-web']['Config']['Env'].append('REGISTRATION_GUARD_SECRET=')
            return b''
        if args[:3] == ('docker', 'exec', 'api-' + self.guard.UUID):
            return b''
        if args[:3] == ('docker', 'exec', 'ops-web-' + self.guard.UUID):
            if (self.fail_target_health or (self.fail_target_guard and 'REGISTRATION_GUARD_SECRET' in args[-1])) and self.containers['ops-web']['Image'] == CANDIDATE_ID:
                raise release.GateError('command_failed')
            return b''
        raise AssertionError('unexpected external boundary: ' + repr(args[:3]))

    def invoke(self, action=None):
        args = ['release-web.py', '--revision', REVISION, '--candidate-id', CANDIDATE_ID,
                '--protected-api-tag', API_TAG, '--protected-api-id', API_ID]
        with patch.object(sys, 'argv', args + ([action] if action else [])), contextlib.redirect_stdout(io.StringIO()) as output:
            release.main()
        return output.getvalue()

    def mutations(self):
        return [args for args in self.events if ('up' in args and args[:2] == ('docker', 'compose')) or args[:3] == ('docker', 'exec', '-i')]


class WebTransactionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = WebTransactionFixture()
        self.addCleanup(self.fixture.close)

    def test_readonly_default_verifies_pins_without_mutation(self):
        f = self.fixture
        self.assertIn('dry_run_ok', f.invoke())
        self.assertEqual(f.mutations(), [])

    def test_cli_requires_full_revision_candidate_and_api_pins_before_host_reads(self):
        f = self.fixture
        for revision, candidate, api_tag, api_id in (
            ('HEAD', CANDIDATE_ID, API_TAG, API_ID), (REVISION, 'latest', API_TAG, API_ID),
            (REVISION, CANDIDATE_ID, '', API_ID), (REVISION, CANDIDATE_ID, API_TAG, ''),
        ):
            with self.subTest(revision=revision, api_tag=api_tag), self.assertRaises(release.GateError):
                release.configure(revision, candidate, api_tag, api_id)
        self.assertEqual(f.events, [])

    def test_apply_recreate_and_rollback_change_only_web_and_preserve_environment(self):
        f = self.fixture
        original = copy.deepcopy(f.containers)
        original_doc = json.loads(f.record['docker_compose_raw'])
        original_env = f.env.read_bytes()
        f.invoke('--apply')
        self.assertEqual(f.containers, original)
        after = json.loads(f.record['docker_compose_raw'])
        original_doc['services']['ops-web']['image'] = 'flixify-ops-web:live-registration-aaaaaaaaaaaa-20261031'
        for name in release.ISOLATED_SERVICES:original_doc['services'][name]['environment']['REGISTRATION_GUARD_SECRET']=''
        self.assertEqual(after, original_doc)
        self.assertEqual(f.env.read_bytes(), original_env)
        f.invoke('--recreate')
        self.assertEqual(f.containers['ops-web']['Image'], CANDIDATE_ID)
        for name in ('api', 'worker', 'db'):
            self.assertEqual(f.containers[name], original[name])
        f.invoke('--rollback')
        self.assertEqual(f.containers['ops-web']['Image'], 'sha256:d6abf84cc47f3395466bf637c3505489b91cc2e69ca2c8ce061e6c815b4354c0')
        self.assertEqual(f.env.read_bytes(), original_env)
        for name in ('api', 'worker', 'db'):
            self.assertEqual(f.containers[name], original[name])
        self.assertTrue(all(args[-1] == 'ops-web' for args in f.events if args[:2] == ('docker', 'compose') and 'up' in args))

    def test_environment_postcheck_failure_restores_web_models_and_original_bytes(self):
        f = self.fixture
        original = copy.deepcopy(f.record)
        original_compose, original_env = f.compose.read_bytes(), f.env.read_bytes()
        f.break_env_once = True
        with self.assertRaisesRegex(release.GateError, 'postcheck_failed_source_restored:env_changed_after_sync'):
            f.invoke('--apply')
        self.assertEqual(f.record, original)
        self.assertEqual(f.compose.read_bytes(), original_compose)
        self.assertEqual(f.env.read_bytes(), original_env)

    def test_unhealthy_candidate_restores_only_source_web(self):
        f = self.fixture
        protected = {name: copy.deepcopy(f.containers[name]) for name in ('api', 'worker', 'db')}
        original_env = f.env.read_bytes()
        f.invoke('--apply')
        f.fail_target_health = True
        with self.assertRaisesRegex(release.GateError, 'deploy_failed_but_source_restored'):
            f.invoke('--recreate')
        self.assertEqual(f.containers['ops-web']['Image'], 'sha256:d6abf84cc47f3395466bf637c3505489b91cc2e69ca2c8ce061e6c815b4354c0')
        self.assertEqual(f.env.read_bytes(), original_env)
        self.assertEqual({name: f.containers[name] for name in protected}, protected)

    def test_nonempty_runtime_guard_rolls_back_only_web_and_keeps_literal_empty_isolation(self):
        f=self.fixture;protected={name:copy.deepcopy(f.containers[name]) for name in ('api','worker','db')};env=f.env.read_bytes()
        f.invoke('--apply');f.fail_target_guard=True
        with self.assertRaisesRegex(release.GateError,'deploy_failed_but_source_restored'):f.invoke('--recreate')
        self.assertEqual(f.containers['ops-web']['Image'],release.SOURCE_ID)
        self.assertEqual({name:f.containers[name] for name in protected},protected);self.assertEqual(f.env.read_bytes(),env)
        doc=json.loads(f.record['docker_compose_raw'])
        for name in release.ISOLATED_SERVICES:self.assertEqual(doc['services'][name]['environment']['REGISTRATION_GUARD_SECRET'],'')
        self.assertTrue(all(args[-1]=='ops-web' for args in f.events if args[:2]==('docker','compose') and 'up' in args))
    def test_protected_restart_or_running_change_stops_before_recreation(self):
        f = self.fixture
        f.invoke('--apply')
        context = f.guard.preflight('target')
        for change in ('restart', 'stopped'):
            original = copy.deepcopy(f.containers['api'])
            if change == 'restart':
                f.containers['api']['RestartCount'] = 1
            else:
                f.containers['api']['State']['Running'] = False
            before_mutations = len(f.mutations())
            with self.subTest(change=change), self.assertRaisesRegex(release.GateError, 'protected_container_changed:api'):
                release.quiet_recreate(context[3], context[1], context[2], context[4], context[5])
            self.assertEqual(len(f.mutations()), before_mutations)
            f.containers['api'] = original

    def test_api_worker_database_image_or_model_drift_is_refused(self):
        f = self.fixture
        for name in ('api', 'worker', 'db'):
            original = f.containers[name]['Image']
            f.containers[name]['Image'] = 'sha256:' + 'c' * 64
            with self.subTest(name=name), self.assertRaises(release.GateError):
                f.invoke('--apply')
            f.containers[name]['Image'] = original
        f.apps['api'] = 'flixify-api:unexpected'
        with self.assertRaisesRegex(release.GateError, 'protected_coolify_application_image_drift'):
            f.invoke('--apply')
        self.assertEqual(f.mutations(), [])

    def test_candidate_ancestry_revision_and_reviewed_identity_are_required(self):
        f = self.fixture
        candidate = f.images[f.guard.TARGET['ops-web']]
        for section, key, value in (
            (candidate, 'Id', 'sha256:' + 'c' * 64),
            (candidate['Config']['Labels'], 'org.opencontainers.image.revision', 'c' * 40),
            (candidate['Config']['Labels'], 'vip.flixify.edge-recovery.base', 'sha256:' + 'c' * 64),
            (candidate['RootFS'], 'Layers', ['other-source']),
        ):
            original = copy.deepcopy(section[key])
            section[key] = value
            with self.subTest(key=key), self.assertRaises(release.GateError):
                f.invoke('--apply')
            section[key] = original
        self.assertEqual(f.mutations(), [])

    def test_generated_config_drift_or_environment_race_refuses_mutation(self):
        f = self.fixture
        document = json.loads(f.compose.read_bytes())
        document['services']['api']['environment']['KEEP'] = 'changed'
        f.compose.write_bytes(json.dumps(document).encode())
        with self.assertRaisesRegex(release.GateError, 'generated_compose_differs_from_database'):
            f.invoke('--apply')
        self.assertEqual(f.mutations(), [])
        f.compose.write_bytes(f.record['docker_compose'].encode())
        context = f.guard.preflight('source')
        f.env.write_bytes(b'CHANGED=fixture\n')
        with self.assertRaisesRegex(release.GateError, 'service_files_changed_during_preflight'):
            f.guard.sync_images(*context, f.guard.SOURCE, f.guard.TARGET)
        self.assertEqual(f.mutations(), [])


class GuardIsolationTests(unittest.TestCase):
    def test_only_three_non_api_literal_empty_overrides_are_added_and_rollback_keeps_them(self):
        f=WebTransactionFixture();self.addCleanup(f.close);original=copy.deepcopy(f.doc)
        a,b=release.expected_swapped(f.doc,f.doc,f.guard.TARGET)
        for name in ('ops-web','worker','db'):self.assertEqual(a['services'][name]['environment'],dict(original['services'][name]['environment'],REGISTRATION_GUARD_SECRET=''))
        self.assertEqual(a['services']['api'],original['services']['api'])
        source,_=release.expected_swapped(a,b,f.guard.SOURCE)
        for name in ('ops-web','worker','db'):self.assertEqual(source['services'][name]['environment']['REGISTRATION_GUARD_SECRET'],'')
        self.assertEqual(source['services']['ops-web']['image'],release.SOURCE_TAG)
    def test_runtime_health_checks_execute_empty_web_and_nonempty_api_in_their_exact_containers(self):
        for web_value,api_value,expected in ((None,'x'*32,False),('accidental-secret','x'*32,False),('',None,False),('','short',False),('','x'*32,True)):
            calls=[]
            def command(*args,**kwargs):
                calls.append(args);values=os.environ.copy();values.pop('REGISTRATION_GUARD_SECRET',None)
                value=web_value if args[2].startswith('ops-web-') else api_value
                if value is not None:values['REGISTRATION_GUARD_SECRET']=value
                result=subprocess.run(['node','-e',args[-1]],env=values,capture_output=True)
                if result.returncode:raise release.GateError('command_failed')
                return result.stdout
            with self.subTest(web_value=web_value,api_value=api_value),patch.object(release.prior,'healthy',return_value=True),patch.object(release.guard,'command',side_effect=command):
                self.assertEqual(release.healthy('ops-web','candidate','sha256:fixture'),expected)
                self.assertEqual(calls[0][2],'ops-web-'+release.guard.UUID)
                if web_value=='':self.assertEqual(calls[1][2],'api-'+release.guard.UUID)
    def test_partial_or_nonempty_override_profile_is_refused(self):
        f=WebTransactionFixture();self.addCleanup(f.close)
        for value in (None,'${REGISTRATION_GUARD_SECRET}','unexpected'):
            doc=copy.deepcopy(f.doc);doc['services']['ops-web']['environment']['REGISTRATION_GUARD_SECRET']=value
            with self.subTest(value=value),self.assertRaises(release.GateError):release.expected_swapped(doc,doc,f.guard.TARGET)
    def test_mixed_shapes_preserve_order_and_duplicates_or_mixed_profiles_fail_closed(self):
        f=WebTransactionFixture();self.addCleanup(f.close);doc=copy.deepcopy(f.doc)
        doc['services']['worker']['environment']=['KEEP=worker','WITH_EQUALS=a=b=c']
        a,_=release.expected_swapped(doc,doc,f.guard.TARGET)
        self.assertEqual(a['services']['worker']['environment'],['KEEP=worker','WITH_EQUALS=a=b=c','REGISTRATION_GUARD_SECRET='])
        for entries in (['KEEP=worker','REGISTRATION_GUARD_SECRET='],['REGISTRATION_GUARD_SECRET=','REGISTRATION_GUARD_SECRET='],['KEEP=first','KEEP=second']):
            bad=copy.deepcopy(doc);bad['services']['worker']['environment']=entries
            with self.subTest(entries=entries),self.assertRaises(release.GateError):release.expected_swapped(bad,bad,f.guard.TARGET)
    def test_reconstructed_legacy_source_hash_requires_exact_container_and_exact_removed_key(self):
        doc={'services':{'ops-web':{'image':release.SOURCE_TAG,'environment':{'KEEP':'unchanged','REGISTRATION_GUARD_SECRET':'dummy'}}}}
        item={'Id':release.LEGACY_WEB_CONTAINER_ID,'Image':release.SOURCE_ID,'Config':{'Image':release.SOURCE_TAG,'Labels':{'com.docker.compose.config-hash':release.LEGACY_WEB_CONFIG_HASH}}}
        with patch.object(release,'normalized_hash',side_effect=[release.LEGACY_SHARED_GUARD_HASH,release.LEGACY_WEB_CONFIG_HASH]):
            self.assertTrue(release.legacy_source_compatible(item,doc,release.LEGACY_SHARED_GUARD_HASH))
        for key,value in (('Id','other-container'),('Image','other-image')):
            bad=copy.deepcopy(item);bad[key]=value
            with self.subTest(key=key),patch.object(release,'normalized_hash') as normalized:self.assertFalse(release.legacy_source_compatible(bad,doc,release.LEGACY_SHARED_GUARD_HASH));normalized.assert_not_called()
        with patch.object(release,'normalized_hash',side_effect=[release.LEGACY_SHARED_GUARD_HASH,'unrelated-drift']):self.assertFalse(release.legacy_source_compatible(item,doc,release.LEGACY_SHARED_GUARD_HASH))
        with patch.object(release,'normalized_hash') as normalized:self.assertFalse(release.legacy_source_compatible(item,doc,'unreviewed-computed-hash'));normalized.assert_not_called()
        with patch.object(release,'normalized_hash',side_effect=['wrong-control-roundtrip',release.LEGACY_WEB_CONFIG_HASH]) as normalized:
            self.assertFalse(release.legacy_source_compatible(item,doc,release.LEGACY_SHARED_GUARD_HASH));self.assertEqual(normalized.call_count,1)
        empty=copy.deepcopy(doc);empty['services']['ops-web']['environment']['REGISTRATION_GUARD_SECRET']=''
        with patch.object(release,'normalized_hash',side_effect=[release.LEGACY_EMPTY_GUARD_HASH,release.LEGACY_WEB_CONFIG_HASH]):self.assertTrue(release.legacy_source_compatible(item,empty,release.LEGACY_EMPTY_GUARD_HASH))
        self.assertEqual(doc['services']['ops-web']['environment']['REGISTRATION_GUARD_SECRET'],'dummy')




if __name__=="__main__":unittest.main()
