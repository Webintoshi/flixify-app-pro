"""Offline real-git and executed HTTP contracts for the1.4.0 publication adapter."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml",types.SimpleNamespace(YAMLError=Exception))
HERE=Path(__file__).parent
def load(name,filename):
    spec=importlib.util.spec_from_file_location(name,HERE/filename);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
web=load("device_cache_publication_test","build-tv-device-cache-web.py")
release_entry=load("device_cache_publication_release_test","release-tv-device-cache-web.py")
release_contract=load("device_cache_reused_transaction_contract","test-web-release.py")
release_contract.web,release_contract.guard=release_entry.release,release_entry.release.guard
WebReleaseTests=release_contract.WebReleaseTests
APK="apps/ops-web/public/downloads/flixify-pro-1.4.0.apk"
MANIFEST="apps/ops-web/public/downloads/flixify-tv-update.json"
DESCRIPTOR="apps/ops-web/app/platform/tv-download.ts"
GRADLE="apps/tv-android/app/build.gradle"
ANDROID_MANIFEST="apps/tv-android/app/src/main/AndroidManifest.xml"
NATIVE="apps/tv-android/app/src/main/java/vip/flixify/tv/ArtworkLoader.java"
OLD_APK="apps/ops-web/public/downloads/flixify-pro-1.3.2.apk"

class Fixture:
    def __init__(self):
        self.temp=tempfile.TemporaryDirectory(prefix="flixify-tv-device-release-contract-");self.repo=Path(self.temp.name)
        self.git("init","-q");self.git("config","user.name","Release Contract");self.git("config","user.email","release-contract@example.invalid")
        self.original=b'export const tvDownload={href:"/downloads/flixify-pro-1.3.2.apk",filename:"flixify-pro-1.3.2.apk",version:"1.3.2",minimumAndroid:"Android 6 ve uzeri"};\n'
        self.put(DESCRIPTOR,self.original);self.put(GRADLE,b"android { defaultConfig { applicationId 'vip.flixify.tv'\nminSdk 23\nversionCode 7\nversionName '1.3.2'\n} }\n")
        self.put(ANDROID_MANIFEST,b'<manifest><application android:label="Flixify Pro"/></manifest>\n');self.put(NATIVE,b"old native\n");self.put(OLD_APK,b"old immutable APK");self.base=self.commit()
        self.put(GRADLE,self.read(GRADLE).replace(b"versionCode 7",b"versionCode 8").replace(b"'1.3.2'",b"'1.4.0'"));self.put(NATIVE,b"accepted persistent artwork\n");self.native=self.commit()
        self.apk=b"PK\x03\x04"+b"accepted-apk-fixture"*128;self.sha=hashlib.sha256(self.apk).hexdigest()
        self.manifest={"packageName":"vip.flixify.tv","versionName":"1.4.0","versionCode":8,"minSdk":23,"apkUrl":"https://flixify.vip/downloads/flixify-pro-1.4.0.apk","sha256":self.sha,"sizeBytes":len(self.apk),"notes":"Cihaz onbellegi ve uygulama ici guncelleme."}
        self.put(DESCRIPTOR,self.original.replace(b"1.3.2",b"1.4.0"));self.put(APK,self.apk);self.write_manifest();self.revision=self.commit()
    def git(self,*args):return subprocess.check_output(["git","-C",str(self.repo),*args],stderr=subprocess.PIPE).decode().strip()
    def put(self,path,value):file=self.repo/path;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(value)
    def read(self,path):return (self.repo/path).read_bytes()
    def write_manifest(self):self.put(MANIFEST,(json.dumps(self.manifest,separators=(",",":"))+"\n").encode())
    def commit(self):self.git("add",".");self.git("commit","-qm","owned fixture");return self.git("rev-parse","HEAD")
    def pins(self):return patch.multiple(web,BASE_REVISION=self.base,RUNTIME_REVISION=self.base,ACCEPTED_NATIVE_REVISION=self.native)
    def close(self):self.temp.cleanup()

class SourceAndArtifactTests(unittest.TestCase):
    def setUp(self):self.fixture=Fixture();self.addCleanup(self.fixture.close)
    def validate(self,revision=None):
        f=self.fixture
        with f.pins(),patch.object(web.builder,"require_image_absent"):
            web.validate_source_scope(f.repo,revision or f.revision);web.validate_versions(f.repo,revision or f.revision)
            return web.validate_artifacts(f.repo,revision or f.revision,f.sha,len(f.apk))
    def test_actual_committed_frozen_native_and_two_exact_artifacts_are_accepted(self):
        try:values=self.validate()
        except web.GateError as error:self.fail("Accepted fixture rejected: "+str(error))
        self.assertEqual(values[APK],self.fixture.apk);self.assertEqual(values[MANIFEST],self.fixture.read(MANIFEST))
    def test_missing_native_acceptance_and_mutable_revision_fail_before_external_reads(self):
        with patch.object(web,"command") as command,self.assertRaises(web.GateError):web.validate_source_scope(self.fixture.repo,"HEAD")
        command.assert_not_called()
        with patch.object(web,"ACCEPTED_NATIVE_REVISION",""),patch.object(web,"command") as command,self.assertRaises(web.GateError):web.validate_source_scope(self.fixture.repo,self.fixture.revision)
        command.assert_not_called()
    def test_post_freeze_native_changes_are_rejected(self):
        self.fixture.put(NATIVE,b"unaccepted change\n");revision=self.fixture.commit()
        with self.assertRaises(web.GateError):self.validate(revision)
    def test_non_native_changes_before_acceptance_are_rejected(self):
        f=self.fixture;f.git("reset","--hard",f.native);f.put("apps/api/src/server.ts",b"not accepted\n");f.native=f.commit()
        f.put(DESCRIPTOR,f.original.replace(b"1.3.2",b"1.4.0"));f.put(APK,f.apk);f.write_manifest();f.revision=f.commit()
        with self.assertRaises(web.GateError):self.validate()
    def test_other_web_public_dependency_and_historical_guard_changes_are_rejected(self):
        for path in ("apps/ops-web/app/platform/shell.tsx",OLD_APK,"package-lock.json","apps/worker/src/main.ts","coolify/releases/2026-10-26-edge-recovery/build-web.py"):
            f=Fixture()
            try:
                f.put(path,b"outside scope\n");revision=f.commit()
                with f.pins(),self.subTest(path=path),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,revision)
            finally:f.close()
    def test_only_exact_descriptor_version_substitutions_are_accepted(self):
        f=self.fixture;f.put(DESCRIPTOR,f.read(DESCRIPTOR)+b"unreviewed export\n");revision=f.commit()
        with f.pins(),self.assertRaises(web.GateError):web.validate_versions(f.repo,revision)
    def test_missing_or_duplicate_manifest_fields_wrong_version_and_external_urls_fail(self):
        f=self.fixture
        for key,value in (("packageName","another.app"),("versionCode",7),("versionCode",True),("versionName","1.4.0-test.1"),("minSdk",24),("apkUrl","https://other.invalid/a.apk"),("apkUrl","https://flixify.vip/downloads/flixify-pro-1.4.0.apk?q=x"),("sha256","f"*64),("sizeBytes",1)):
            original=f.manifest[key];f.manifest[key]=value;f.write_manifest();revision=f.commit()
            with f.pins(),patch.object(web.builder,"require_image_absent"),self.subTest(key=key,value=value),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,revision,f.sha,len(f.apk))
            f.manifest[key]=original
        f.write_manifest();f.put(MANIFEST,f.read(MANIFEST).replace(b'{',b'{"versionCode":8,',1));revision=f.commit()
        with f.pins(),patch.object(web.builder,"require_image_absent"),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,revision,f.sha,len(f.apk))
    def test_manifest_and_apk_must_be_new_regular_nonexecutable_git_blobs(self):
        for path,symlink in ((APK,False),(MANIFEST,False),(APK,True),(MANIFEST,True)):
            f=Fixture()
            try:
                if symlink:(f.repo/path).unlink();(f.repo/path).symlink_to("old.apk")
                else:(f.repo/path).chmod(0o755)
                revision=f.commit()
                with f.pins(),patch.object(web.builder,"require_image_absent"),self.subTest(path=path,symlink=symlink),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,revision,f.sha,len(f.apk))
            finally:f.close()
    def test_artifact_bytes_must_match_independent_accepted_pins(self):
        f=self.fixture
        with f.pins(),patch.object(web.builder,"require_image_absent"):
            for sha,size in (("0"*64,len(f.apk)),(f.sha,len(f.apk)+1),(f.sha,33*1024*1024)):
                with self.subTest(sha=sha,size=size),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,f.revision,sha,size)
    def test_unaccepted_blob_sizes_are_rejected_before_materializing_their_bytes(self):
        for path,payload in ((APK,b"PK\x03\x04wrong-size"),(MANIFEST,b" "*(64*1024+1))):
            f=Fixture()
            try:
                f.put(path,payload);revision=f.commit();original=web.core.git_file
                def read(repo,ref,name):
                    if name==path:raise AssertionError("Unaccepted-sized blob was loaded into memory")
                    return original(repo,ref,name)
                with f.pins(),patch.object(web.builder,"require_image_absent"),patch.object(web.core,"git_file",side_effect=read),self.subTest(path=path),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,revision,f.sha,len(f.apk))
            finally:f.close()
    def test_old_public_assets_cannot_be_changed_or_deleted(self):
        f=self.fixture;(f.repo/OLD_APK).unlink();revision=f.commit()
        with f.pins(),patch.object(web.builder,"require_image_absent"),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,revision,f.sha,len(f.apk))
    def test_both_new_public_paths_require_absence_in_the_pinned_image(self):
        f=self.fixture
        with f.pins(),patch.object(web.builder,"require_image_absent") as absent:web.validate_artifacts(f.repo,f.revision,f.sha,len(f.apk))
        self.assertEqual([call.args[0] for call in absent.call_args_list],[APK,MANIFEST])
    def test_unrelated_native_freeze_and_runtime_baseline_drift_are_rejected(self):
        f=self.fixture;f.put(NATIVE,b"later unaccepted freeze\n");f.native=f.commit()
        with f.pins(),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,f.revision)
        f.git("reset","--hard",f.base);runtime=f.base;f.put("apps/ops-web/app/other.ts",b"unreviewed runtime\n");f.base=f.commit()
        f.put(GRADLE,f.read(GRADLE).replace(b"versionCode 7",b"versionCode 8").replace(b"'1.3.2'",b"'1.4.0'"));f.put(NATIVE,b"native\n");f.native=f.commit()
        f.put(DESCRIPTOR,f.original.replace(b"1.3.2",b"1.4.0"));f.put(APK,f.apk);f.write_manifest();f.revision=f.commit()
        with f.pins(),patch.object(web,"RUNTIME_REVISION",runtime),self.assertRaisesRegex(web.GateError,"runtime_base_differs"):web.validate_source_scope(f.repo,f.revision)

class BuildAndHttpTests(unittest.TestCase):
    def setUp(self):self.fixture=Fixture();self.addCleanup(self.fixture.close)
    def test_public_manifest_adds_exactly_apk_and_json_preserving_modes_and_digest(self):
        f=self.fixture;original=json.dumps([["dir","",493],["dir","downloads",493],["file","downloads/old.apk",420,5,"a"*64],["link","logo",511,"missing"]]).encode()
        try:result=json.loads(web.expected_public_manifest(original,f.sha,len(f.apk),f.read(MANIFEST)))
        except web.GateError as error:self.fail("Valid public additions rejected: "+str(error))
        self.assertEqual(len(result),6);self.assertIn(["file","downloads/flixify-pro-1.4.0.apk",420,len(f.apk),f.sha],result)
        self.assertIn(["file","downloads/flixify-tv-update.json",420,len(f.read(MANIFEST)),hashlib.sha256(f.read(MANIFEST)).hexdigest()],result)
        self.assertIn(["link","logo",511,"missing"],result)
        with self.assertRaises(web.GateError):web.expected_public_manifest(json.dumps(result).encode(),f.sha,len(f.apk),f.read(MANIFEST))
    def test_dockerfile_copies_only_descriptor_and_two_public_files_in_one_bounded_layer(self):
        value=web.dockerfile("a"*40)
        self.assertEqual(value.splitlines()[0],"FROM flixify-ops-web:edge-recovery-996d4e434e47-20261026")
        self.assertEqual([line for line in value.splitlines() if line.startswith("COPY ")],[f"COPY {path} /app/{path}" for path in (DESCRIPTOR,APK,MANIFEST)])
        self.assertEqual(sum(line.startswith("RUN ") for line in value.splitlines()),1)
        self.assertNotIn("npm ci",value);self.assertNotIn("apps/tv-android",value)
    def execute_http(self,failure=None):
        f=self.fixture;spec={"apk":list(f.apk),"manifest":f.read(MANIFEST).decode(),"size":len(f.apk),"failure":failure}
        prelude='const s='+json.dumps(spec)+';let calls=0;global.fetch=async()=>{const i=calls++,b=Buffer.from(s.apk);let body=i===1?b.subarray(0,32):i===2?b:Buffer.from(s.manifest);let status=i===1?206:200;const headers={"content-length":String(s.size),"content-type":i===3?"application/json":"application/vnd.android.package-archive","content-range":"bytes 0-31/"+s.size};if(s.failure==="mime"&&i===0)headers["content-type"]="text/plain";if(s.failure==="range"&&i===1)status=200;if(s.failure==="apk"&&i===2)body[10]^=1;if(s.failure==="manifest"&&i===3)body=Buffer.from("{}");return{ok:true,status,headers:{get:k=>headers[k]},arrayBuffer:async()=>body};};'
        try:script=web.download_verification_script(f.sha,len(f.apk),f.read(MANIFEST))
        except web.GateError as error:self.fail("HTTP contract unavailable: "+str(error))
        return subprocess.run(["node","-e",prelude+script],capture_output=True,text=True,timeout=15)
    def test_executed_download_contract_accepts_coherent_bytes(self):
        result=self.execute_http();self.assertEqual(result.returncode,0,result.stderr)
    def test_executed_download_contract_rejects_wrong_mime_range_digest_or_manifest(self):
        for failure in ("mime","range","apk","manifest"):
            with self.subTest(failure=failure):self.assertNotEqual(self.execute_http(failure).returncode,0)
    def test_container_http_check_is_network_none_bounded_and_stops_only_its_owned_image(self):
        f=self.fixture;candidate="sha256:"+"b"*64;calls=[]
        def command(*args,**kwargs):
            calls.append(args);return candidate.encode() if args[:3]==("docker","inspect","--format") else b""
        with patch.object(web,"command",side_effect=command):web.verify_download(candidate,f.sha,len(f.apk),f.read(MANIFEST))
        create=calls[0]
        for flag,value in (("--network","none"),("--memory","512m"),("--memory-swap","640m"),("--pids-limit","128")):self.assertEqual(create[create.index(flag)+1],value)
        self.assertEqual(calls[-1][:4],("docker","stop","-t","10"))
        calls.clear()
        with patch.object(web,"command",side_effect=lambda *args,**kwargs:(calls.append(args) or b"wrong-image") if args[:3]==("docker","inspect","--format") else (calls.append(args) or b"")),self.assertRaisesRegex(web.GateError,"container_drift"):web.verify_download(candidate,f.sha,len(f.apk),f.read(MANIFEST))
        self.assertFalse(any(args[:2]==("docker","stop") for args in calls))
    def test_candidate_public_tree_drift_stops_before_http_validation(self):
        f=self.fixture;original=b'[["dir","",493],["dir","downloads",493]]'
        with patch.object(web.builder,"verify_candidate",return_value="candidate"),patch.object(web.reviewed,"public_manifest",return_value=original),patch.object(web,"verify_download") as download,self.assertRaisesRegex(web.GateError,"public_tree_differs"):
            web.verify_candidate({},"a"*40,{MANIFEST:f.read(MANIFEST)},{},b"config",original,f.sha,len(f.apk))
        download.assert_not_called()

class ManifestNotesTests(unittest.TestCase):
    def setUp(self):self.fixture=Fixture();self.addCleanup(self.fixture.close)
    def parse(self,notes):
        f=self.fixture;manifest=dict(f.manifest,notes=notes)
        return web.parse_manifest(json.dumps(manifest).encode(),f.sha,len(f.apk))
    def test_empty_newline_and_2048_java_code_units_match_android_acceptance(self):
        for notes in ("","Yeni afişler\nGüncelleme hazır.","a"*2048,"🎬"*1024):
            with self.subTest(length=len(notes)):
                try:value=self.parse(notes)
                except web.GateError as error:self.fail("Android-compatible notes rejected: "+str(error))
                self.assertEqual(value["notes"],notes)
    def test_notes_longer_than_2048_java_code_units_are_rejected(self):
        for notes in ("a"*2049,"🎬"*1025):
            with self.subTest(length=len(notes)),self.assertRaises(web.GateError):self.parse(notes)
    def test_every_android_iso_control_except_newline_is_rejected(self):
        for code in (*range(0,10),*range(11,32),*range(127,160)):
            with self.subTest(code=code),self.assertRaises(web.GateError):self.parse("before"+chr(code)+"after")

class BuildActionsTests(unittest.TestCase):
    def setUp(self):
        self.output=contextlib.redirect_stdout(io.StringIO());self.output.__enter__();self.addCleanup(self.output.__exit__,None,None,None)
        self.updated={DESCRIPTOR:b"descriptor",APK:b"apk",MANIFEST:b"manifest"}
        self.preflight=patch.object(web,"preflight",return_value=({"Config":{"Cmd":["node","server.js"]}},self.updated,{"PUBLIC":"same"},b"config",b"public")).start()
        self.disk=patch.object(web.shutil,"disk_usage",return_value=types.SimpleNamespace(free=8*1024**3)).start();self.command=patch.object(web,"command",return_value=b"").start()
        self.candidate=patch.object(web,"verify_candidate",return_value="sha256:"+"b"*64).start();self.compile=patch.object(web,"container_compile").start();self.addCleanup(patch.stopall)
    def invoke(self,action=None):
        args=["build-tv-device-cache-web.py","/repo","--revision","a"*40,"--apk-sha256","c"*64,"--apk-bytes","2048"]
        with patch.object(sys,"argv",args+([action] if action else [])):web.main()
    def test_default_preflight_never_allocates_compiler_or_mutates_services(self):
        self.invoke();self.command.assert_not_called();self.disk.assert_not_called();self.compile.assert_not_called();self.candidate.assert_not_called()
    def test_both_build_modes_fail_below_eight_gib_without_allocation(self):
        self.disk.return_value.free=8*1024**3-1
        for action in ("--build","--container-build"):
            with self.subTest(action=action),self.assertRaisesRegex(web.GateError,"requires_8GiB"):self.invoke(action)
        self.command.assert_not_called();self.compile.assert_not_called()
    def test_bounded_offline_build_context_contains_only_three_verified_files(self):
        context={}
        def command(*args,**kwargs):
            if args[:2]==("docker","build"):
                root=Path(args[-1]);context.update({str(path.relative_to(root)):path.read_bytes() for path in root.rglob("*") if path.is_file()})
            return b""
        self.command.side_effect=command;self.invoke("--build")
        self.assertEqual(set(context),{DESCRIPTOR,APK,MANIFEST,"Dockerfile"})
        args=self.command.call_args.args
        for flag in ("--network=none","--pull=false","--no-cache","memory=1280m","memory-swap=1536m"):self.assertIn(flag,args)
        self.candidate.assert_called_once()
    def test_owned_container_build_receives_exact_artifacts_and_existing_tag_never_overwrites(self):
        self.invoke("--container-build");self.assertEqual(self.compile.call_args.args[2],self.updated)
        self.compile.reset_mock();self.command.return_value=(web.builder.target("a"*40)+"\n").encode()
        for action in ("--build","--container-build"):
            with self.subTest(action=action),self.assertRaisesRegex(web.GateError,"tag_already_exists"):self.invoke(action)
        self.compile.assert_not_called()
    def test_verify_existing_does_not_allocate_compiler(self):
        self.invoke("--verify-existing");self.command.assert_not_called();self.disk.assert_not_called();self.compile.assert_not_called();self.candidate.assert_called_once()

class ReleaseAcceptanceTests(unittest.TestCase):
    def test_unfilled_native_pin_stops_transaction_before_even_preflight(self):
        with patch.object(release_entry.publication,"ACCEPTED_NATIVE_REVISION",""),patch.object(release_entry.release,"main") as main,self.assertRaises(release_entry.publication.GateError):release_entry.main()
        main.assert_not_called()
    def test_current_source_pins_and_old_guards_remain_isolated(self):
        self.assertEqual(release_entry.release.SOURCE_ID,"sha256:bd2e42822516acedabd2480e5d85a1cb524c86097269df9069d375b8c4a185ca")
        self.assertEqual(web.builder.PATHS,(DESCRIPTOR,));self.assertEqual(web.builder.NEW_PATHS,())
        old=load("device_cache_historical_guard_unchanged","build-live-reliability-web.py")
        self.assertEqual(old.SOURCE_ID,"sha256:f7f38e513b8cdf21b8a10983fc7c2ce12f792562dd7a0f87168ff486dca4ab38")
        self.assertEqual(old.PATHS,("apps/ops-web/app/canli-tv/page.tsx","apps/ops-web/app/platform/personal-provider.ts"))

if __name__=="__main__":unittest.main()
