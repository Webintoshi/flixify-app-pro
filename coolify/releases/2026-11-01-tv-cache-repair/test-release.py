"""Offline APK publication contracts; no device or production commands."""
import copy
import contextlib
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault('yaml',types.SimpleNamespace(safe_load=json.loads,YAMLError=ValueError))
HERE=Path(__file__).parent
def load(name,path):
    if not path.exists():return None
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
web=load('cache_publication_contract',HERE/'build-web.py')
release=load('cache_release_contract',HERE/'release-web.py')
android=load('cache_signature_contract',HERE/'verify-android.py')
upgrade=load('cache_upgrade_contract',HERE/'verify-upgrade.py')
REVISION='a'*40

class Fixture:
    def __init__(self):
        self.temp=tempfile.TemporaryDirectory(prefix='flixify-cache-publication-');self.repo=Path(self.temp.name)
        self.git('init','-q');self.git('config','user.name','Offline');self.git('config','user.email','offline@example.invalid')
        self.descriptor=b'export const tvDownload={href:"/downloads/flixify-pro-1.4.4.apk",filename:"flixify-pro-1.4.4.apk",version:"1.4.4"};\n'
        self.old_apk=b'PK\x03\x04'+b'old signed fixture'*100;self.old_manifest=b'{"previous":"accepted"}\n'
        self.put(web.DESCRIPTOR,self.descriptor);self.put(web.BASELINE_APK,self.old_apk);self.put(web.UPDATE_MANIFEST,self.old_manifest)
        self.put(web.GRADLE,b"android { defaultConfig { applicationId 'vip.flixify.tv'\nminSdk 23\ntargetSdk 35\nversionCode 12\nversionName '1.4.4'\n} }\n")
        self.put(web.ANDROID_MANIFEST,b'<manifest><application android:label="Flixify Pro"/></manifest>\n')
        self.put('packages/shared/unchanged.txt',b'unchanged shared package\n')
        self.native_file='apps/tv-android/app/src/main/java/vip/flixify/tv/MainActivity.java';self.put(self.native_file,b'old native\n')
        self.base=self.commit()
        self.put(web.GRADLE,self.read(web.GRADLE).replace(b'versionCode 12',b'versionCode 13').replace(b"'1.4.4'",b"'1.4.5'"));self.put(self.native_file,b'reviewed native cache repairs\n')
        self.native=self.commit();self.tree=self.git('rev-parse',self.native+':apps/tv-android')
        self.apk=b'PK\x03\x04'+b'new signed fixture'*100;self.sha=hashlib.sha256(self.apk).hexdigest()
        self.put(web.DESCRIPTOR,self.descriptor.replace(b'1.4.4',b'1.4.5'));self.put(web.APK,self.apk)
        self.manifest={'packageName':'vip.flixify.tv','versionName':'1.4.5','versionCode':13,'minSdk':23,'apkUrl':web.APK_URL,'sha256':self.sha,'sizeBytes':len(self.apk),'notes':'Yerel katalog, afiş ve favori iyileştirmeleri.'}
        self.put(web.UPDATE_MANIFEST,json.dumps(self.manifest).encode());self.revision=self.commit()
    def git(self,*args):return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.DEVNULL).decode().strip()
    def put(self,path,data):
        target=self.repo/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    def read(self,path):return (self.repo/path).read_bytes()
    def commit(self):self.git('add','.');self.git('commit','-qm','fixture');return self.git('rev-parse','HEAD')
    def pins(self):
        stack=contextlib.ExitStack();stack.enter_context(patch.multiple(web,BASE_REVISION=self.base,RUNTIME_REVISION=self.base))
        stack.enter_context(patch.multiple(web.reviewed,BASE_REVISION=self.base,BASELINE_APK_BYTES=len(self.old_apk),BASELINE_APK_SHA256=hashlib.sha256(self.old_apk).hexdigest(),BASELINE_MANIFEST_BYTES=len(self.old_manifest),BASELINE_MANIFEST_SHA256=hashlib.sha256(self.old_manifest).hexdigest()));return stack
    def proof(self):return {'schema':1,'nativeRevision':self.native,'nativeTree':self.tree,'packageName':'vip.flixify.tv','versionName':'1.4.5','versionCode':13,'minSdk':23,'targetSdk':35,'sha256':self.sha,'sizeBytes':len(self.apk),'certificateSha256':web.SIGNER_SHA256,'baselineApkSha256':web.BASELINE_APK_SHA256,'baselineApkSizeBytes':web.BASELINE_APK_BYTES,'signatureSchemes':['v1','v2'],'releaseDebuggable':False}

class Contracts(unittest.TestCase):
    def setUp(self):self.assertIsNotNone(web,'narrow APK publication adapter is required')
    def fixture(self):
        value=Fixture();self.addCleanup(value.temp.cleanup);return value
    def test_exact_static_runtime_and_current_service_pins(self):
        self.assertEqual(web.PATHS,(web.DESCRIPTOR,));self.assertEqual(web.NEW_PATHS,())
        self.assertEqual(set(web.EXCLUDED),{web.DESCRIPTOR,web.APK,web.UPDATE_MANIFEST,'apps/ops-web/.next'})
        self.assertEqual(web.BASELINE_APK_SHA256,'1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f')
        self.assertEqual(web.BASELINE_APK_BYTES,1355944)
        self.assertEqual(web.SOURCE_ID,'sha256:6f0a8b8ae11383d25a76d5ed6c3add935ea5d803415e164875e10a5d69c3fe32')
        self.assertEqual(web.target(REVISION),'flixify-ops-web:tv-cache-repair-aaaaaaaaaaaa-20261101')
        for value in ('HEAD','a'*12,None):
            with self.assertRaises(web.GateError):web.target(value)
    def test_native_freeze_descriptor_and_artifact_scope_accepts_only_static_publication(self):
        f=self.fixture()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base):
            web.validate_source_scope(f.repo,f.revision,f.native,f.tree,web.PATHS);web.validate_versions(f.repo,f.revision,f.native)
        for path in ('apps/ops-web/app/platform/catalog.tsx','apps/ops-web/components/ui/package-checkout.tsx','apps/api/src/server.ts','packages/contracts/src/index.ts'):
            f.put(path,b'unreviewed downgrade\n');revision=f.commit()
            with f.pins(),patch.object(web,'BASE_REVISION',f.base),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,revision,f.native,f.tree,web.PATHS)
    def test_native_tree_change_after_freeze_is_rejected(self):
        f=self.fixture();f.put(f.native_file,b'late change\n');revision=f.commit()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,revision,f.native,f.tree,web.PATHS)
    def test_manifest_proof_types_signer_old_apk_and_notes_are_pinned(self):
        f=self.fixture();web.parse_manifest(json.dumps(f.manifest).encode(),f.sha,len(f.apk));web.validate_apk_proof(json.dumps(f.proof()).encode(),f.native,f.tree,f.sha,len(f.apk))
        for key,value in (('versionCode',12),('versionCode',True),('versionName','1.4.4'),('apkUrl','https://evil.example/new.apk'),('notes','x'*2049),('notes','bad\u0001')):
            data=dict(f.manifest);data[key]=value
            with self.subTest(key=key,value=str(value)[:24]),self.assertRaises(web.GateError):web.parse_manifest(json.dumps(data).encode(),f.sha,len(f.apk))
        for key,value in (('certificateSha256','f'*64),('baselineApkSha256','f'*64),('versionCode',12),('releaseDebuggable',True),('signatureSchemes',['v2'])):
            data=f.proof();data[key]=value
            with self.subTest(key=key),self.assertRaises(web.GateError):web.validate_apk_proof(json.dumps(data).encode(),f.native,f.tree,f.sha,len(f.apk))
    def test_old_apk_and_exact_new_apk_manifest_are_checked(self):
        f=self.fixture()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base),patch.object(web.builder,'require_image_absent'):
            actual=web.validate_artifacts(f.repo,f.revision,f.sha,len(f.apk));self.assertEqual(actual[web.APK],f.apk)
        f.put(web.BASELINE_APK,b'PK\x03\x04changed old APK');revision=f.commit()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base),patch.object(web.builder,'require_image_absent'),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,revision,f.sha,len(f.apk))
    def test_runtime_list_cannot_expand_and_download_verification_uses145_code13(self):
        self.assertEqual(web.parse_runtime_paths(json.dumps([web.DESCRIPTOR]).encode()),web.PATHS)
        with self.assertRaises(web.GateError):web.parse_runtime_paths(json.dumps([web.DESCRIPTOR,'apps/ops-web/app/platform/catalog.tsx']).encode())
        f=self.fixture();script=web.download_verification_script(f.sha,len(f.apk),json.dumps(f.manifest).encode())
        for text in ('flixify-pro-1.4.5.apk','j.versionName!=="1.4.5"||j.versionCode!==13','bytes=0-31','application/vnd.android.package-archive','manifest_digest_invalid'):self.assertIn(text,script)
    def test_artwork_payment_and_catalog_stay_in_complete_untouched_fingerprint(self):
        script=web.snapshot_script()
        self.assertIn(web.DESCRIPTOR,script);self.assertIn(web.APK,script)
        for path in ('apps/ops-web/components','apps/ops-web/app/platform/catalog.tsx',web.BASELINE_APK,'node_modules'):
            self.assertNotIn(path,web.EXCLUDED)
        with patch.object(web,'original_protected_snapshot',return_value={'service':'exact'}),patch.object(web.backend,'host_snapshot',return_value={'fence':'same','external':'pinned'}):self.assertEqual(web.protected_snapshot(web.API_TAG,web.API_ID),{'services':{'service':'exact'},'host':{'fence':'same','external':'pinned'}})
    def test_bounded_compiler_copies_only_descriptor_apk_manifest_and_cleans_owned_container(self):
        f=self.fixture();calls=[];copied={}
        updates={web.DESCRIPTOR:f.read(web.DESCRIPTOR),web.APK:f.apk,web.UPDATE_MANIFEST:f.read(web.UPDATE_MANIFEST)}
        def command(*args,**kwargs):
            calls.append(args)
            if args[:2]==('docker','cp'):copied[args[3].split(':/app/')[1]]=Path(args[2]).read_bytes()
            if args[:3]==('docker','start','--attach'):raise web.GateError('fixture failure')
            return b''
        with patch.object(web.reviewed.reviewed,'command',side_effect=command),self.assertRaises(web.GateError):web.reviewed.container_compile(REVISION,{'Config':{'Cmd':['node','server']}},updates,{})
        create=next(row for row in calls if row[:2]==('docker','create'))
        self.assertEqual([create[create.index(key)+1] for key in ('--network','--memory','--memory-swap','--pids-limit')],['none','1280m','1536m','256'])
        self.assertEqual(copied,updates);owned=create[create.index('--name')+1]
        self.assertEqual([row for row in calls if row[:3]==('docker','rm','--force')],[('docker','rm','--force',owned)])
        self.assertFalse(any('prune' in row for row in calls))

class DeviceContracts(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(android,'same certificate artifact verifier is required');self.assertIsNotNone(upgrade,'owned emulator upgrade verifier is required')
    def test_signature_and_release_identity_requirements(self):
        signing='Signer #1 certificate SHA-256 digest: '+web.SIGNER_SHA256+'\nVerified using v1 scheme (JAR signing): true\nVerified using v2 scheme (APK Signature Scheme v2): true\n'
        badging="package: name='vip.flixify.tv' versionCode='13' versionName='1.4.5'\nminSdkVersion:'23'\ntargetSdkVersion:'35'\n"
        android.validate_tool_output(signing,badging)
        for value in (badging.replace("versionCode='13'","versionCode='12'"),badging+'application-debuggable\n'):
            with self.assertRaises(android.GateError):android.validate_tool_output(signing,value)
        with self.assertRaises(android.GateError):android.validate_tool_output(signing.replace(web.SIGNER_SHA256,'f'*64),badging)
    def test_preservation_paths_require_session_metadata_and_artwork_without_traversal(self):
        paths=['shared_prefs/tv_encrypted_session.xml','files/catalog-cache-v1/'+'a'*64+'.bin','cache/artwork-v1/'+'b'*64+'.art']
        self.assertEqual(upgrade.validate_paths(paths),tuple(paths))
        for bad in (paths+['../escape'],paths+['/data/local/tmp/file'],paths+paths[:1],paths[:2]):
            with self.assertRaises(upgrade.GateError):upgrade.validate_paths(bad)
    def test_upgrade_retains_first_install_time_and_exact_reviewed_file_digests(self):
        old={'versionCode':12,'versionName':'1.4.4','firstInstallTime':'same'};new={'versionCode':13,'versionName':'1.4.5','firstInstallTime':'same'}
        upgrade.require_upgrade(old,new,{'session':'a'},{'session':'a'})
        for actual,files in ((dict(new,firstInstallTime='new'),{'session':'a'}),(new,{'session':'b'})):
            with self.assertRaises(upgrade.GateError):upgrade.require_upgrade(old,actual,{'session':'a'},files)
    def test_physical_or_remote_device_is_refused_before_any_adb_command(self):
        for serial in ('USB123456','192.168.1.2:5555'):
            argv=['verify-upgrade.py','--serial',serial,'--adb','/unused/adb','--apk','/unused/new.apk','--apk-proof-file','/unused/proof.json','--preserved-paths-file','/unused/paths.json','--output','/unused/output.json','--apk-proof-sha256','f'*64,'--run']
            with patch.object(sys,'argv',argv),patch.object(upgrade.subprocess,'run') as command,self.assertRaises(upgrade.GateError):upgrade.main()
            command.assert_not_called()
    def test_adb_streamed_install_prelude_is_accepted_but_failures_are_not(self):
        upgrade.require_install_success('Performing Streamed Install\nSuccess\n')
        for value in ('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]','Success\nFailure [bad]','not installed'):
            with self.assertRaises(upgrade.GateError):upgrade.require_install_success(value)

class ReleaseContracts(unittest.TestCase):
    def test_web_only_transaction_preserves_latest_payment_api_worker_and_fence(self):
        self.assertIsNotNone(release,'scoped web transaction is required')
        release.configure(REVISION,'sha256:'+'b'*64,release.API_TAG,release.API_ID)
        self.assertEqual(release.guard.CHANGED,('ops-web',));self.assertEqual(release.guard.SOURCE_IDS,{'ops-web':web.SOURCE_ID})
        self.assertEqual(release.guard.PROTECTED_IMAGES,{'api':(web.API_TAG,web.API_ID),'worker':(web.WORKER_TAG,web.WORKER_ID)})
        self.assertEqual(release.reviewed.reviewed.builder.API_ID,'sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6')

if __name__=='__main__':unittest.main()
