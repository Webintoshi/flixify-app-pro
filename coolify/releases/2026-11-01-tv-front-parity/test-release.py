"""Offline APK publication contracts; no device or production commands."""
import copy
import contextlib
import hashlib
import importlib.util
import io
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
web=load('parity_publication_contract',HERE/'build-web.py')
release=load('parity_release_contract',HERE/'release-web.py')
android=load('parity_signature_contract',HERE/'verify-android.py')
upgrade=load('parity_upgrade_contract',HERE/'verify-upgrade.py')
REVISION='a'*40

class Fixture:
    def __init__(self):
        self.temp=tempfile.TemporaryDirectory(prefix='flixify-parity-publication-');self.repo=Path(self.temp.name)
        self.git('init','-q');self.git('config','user.name','Offline');self.git('config','user.email','offline@example.invalid')
        self.descriptor=b'export const tvDownload={href:"/downloads/flixify-pro-1.4.6.apk",filename:"flixify-pro-1.4.6.apk",version:"1.4.6"};\n'
        self.old_apk=b'PK\x03\x04'+b'old signed fixture'*100;self.old_manifest=b'{"previous":"accepted"}\n'
        self.put(web.DESCRIPTOR,self.descriptor);self.put(web.BASELINE_APK,self.old_apk);self.put(web.UPDATE_MANIFEST,self.old_manifest)
        self.put(web.GRADLE,b"android { defaultConfig { applicationId 'vip.flixify.tv'\nminSdk 23\ntargetSdk 35\nversionCode 14\nversionName '1.4.6'\n} }\n")
        self.put(web.ANDROID_MANIFEST,b'<manifest><application android:label="Flixify Pro"/></manifest>\n')
        self.put('packages/shared/unchanged.txt',b'unchanged shared package\n')
        self.native_file='apps/tv-android/app/src/main/java/vip/flixify/tv/MainActivity.java';self.put(self.native_file,b'old native\n')
        self.base=self.commit()
        self.put(web.GRADLE,self.read(web.GRADLE).replace(b'versionCode 14',b'versionCode 15').replace(b"'1.4.6'",b"'1.4.7'"));self.put(self.native_file,b'reviewed native cache repairs\n')
        self.native=self.commit();self.tree=self.git('rev-parse',self.native+':apps/tv-android')
        self.apk=b'PK\x03\x04'+b'new signed fixture'*100;self.sha=hashlib.sha256(self.apk).hexdigest()
        self.put(web.DESCRIPTOR,self.descriptor.replace(b'1.4.6',b'1.4.7'));self.put(web.APK,self.apk)
        self.manifest={'packageName':'vip.flixify.tv','versionName':'1.4.7','versionCode':15,'minSdk':23,'apkUrl':web.APK_URL,'sha256':self.sha,'sizeBytes':len(self.apk),'notes':'Yerel katalog, afiş ve favori iyileştirmeleri.'}
        self.put(web.UPDATE_MANIFEST,json.dumps(self.manifest).encode());self.revision=self.commit()
    def git(self,*args):return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.DEVNULL).decode().strip()
    def put(self,path,data):
        target=self.repo/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    def read(self,path):return (self.repo/path).read_bytes()
    def commit(self):self.git('add','.');self.git('commit','-qm','fixture');return self.git('rev-parse','HEAD')
    def pins(self):
        stack=contextlib.ExitStack();stack.enter_context(patch.multiple(web,BASE_REVISION=self.base))
        stack.enter_context(patch.multiple(web.reviewed,BASE_REVISION=self.base,BASELINE_APK_BYTES=len(self.old_apk),BASELINE_APK_SHA256=hashlib.sha256(self.old_apk).hexdigest(),BASELINE_MANIFEST_BYTES=len(self.old_manifest),BASELINE_MANIFEST_SHA256=hashlib.sha256(self.old_manifest).hexdigest()));return stack
    def proof(self):return {'schema':1,'nativeRevision':self.native,'nativeTree':self.tree,'packageName':'vip.flixify.tv','versionName':'1.4.7','versionCode':15,'minSdk':23,'targetSdk':35,'sha256':self.sha,'sizeBytes':len(self.apk),'certificateSha256':web.SIGNER_SHA256,'baselineApkSha256':web.BASELINE_APK_SHA256,'baselineApkSizeBytes':web.BASELINE_APK_BYTES,'signatureSchemes':['v1','v2'],'releaseDebuggable':False}

class Contracts(unittest.TestCase):
    def setUp(self):self.assertIsNotNone(web,'narrow APK publication adapter is required')
    def fixture(self):
        value=Fixture();self.addCleanup(value.temp.cleanup);return value
    def test_exact_static_runtime_and_current_service_pins(self):
        self.assertEqual(web.PATHS,(web.DESCRIPTOR,));self.assertEqual(web.NEW_PATHS,())
        self.assertEqual(set(web.EXCLUDED),{web.DESCRIPTOR,web.APK,web.UPDATE_MANIFEST,'apps/ops-web/.next'})
        self.assertEqual(web.BASELINE_APK_SHA256,'911bbfc9d6513676d6c6605af1e07a4d9e81f9997bb44c32c17688ae9b34a4b6')
        self.assertEqual(web.BASELINE_APK_BYTES,1374125)
        self.assertEqual(web.SOURCE_ID,'sha256:65a3d81e5337f292d180ffe98dee4e5661b29bf783fee0a33d16c9bfe86c59d2')
        self.assertEqual(web.target(REVISION),'flixify-ops-web:tv-front-parity-aaaaaaaaaaaa-20261101')
        for value in ('HEAD','a'*14,None):
            with self.assertRaises(web.GateError):web.target(value)
    def test_native_freeze_descriptor_and_artifact_scope_accepts_only_static_publication(self):
        f=self.fixture()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base):
            web.validate_source_scope(f.repo,f.revision,f.native,f.tree,web.PATHS);web.validate_versions(f.repo,f.revision,f.native)
        for path in ('apps/ops-web/app/platform/catalog.tsx','apps/ops-web/app/platform/welcome-offer.tsx','apps/ops-web/components/ui/package-checkout.tsx','apps/api/src/server.ts','packages/contracts/src/index.ts'):
            f.put(path,b'unreviewed downgrade\n');revision=f.commit()
            with f.pins(),patch.object(web,'BASE_REVISION',f.base),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,revision,f.native,f.tree,web.PATHS)
            f.git('reset','--hard',f.revision)
    def test_native_tree_change_after_freeze_is_rejected(self):
        f=self.fixture();f.put(f.native_file,b'late change\n');revision=f.commit()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,revision,f.native,f.tree,web.PATHS)
    def test_manifest_proof_types_signer_old_apk_and_notes_are_pinned(self):
        f=self.fixture();web.parse_manifest(json.dumps(f.manifest).encode(),f.sha,len(f.apk));web.validate_apk_proof(json.dumps(f.proof()).encode(),f.native,f.tree,f.sha,len(f.apk))
        for key,value in (('versionCode',14),('versionCode',True),('versionName','1.4.6'),('apkUrl','https://evil.example/new.apk'),('notes','x'*2049),('notes','bad\u0001')):
            data=dict(f.manifest);data[key]=value
            with self.subTest(key=key,value=str(value)[:24]),self.assertRaises(web.GateError):web.parse_manifest(json.dumps(data).encode(),f.sha,len(f.apk))
        for key,value in (('certificateSha256','f'*64),('baselineApkSha256','f'*64),('versionCode',14),('releaseDebuggable',True),('signatureSchemes',['v2'])):
            data=f.proof();data[key]=value
            with self.subTest(key=key),self.assertRaises(web.GateError):web.validate_apk_proof(json.dumps(data).encode(),f.native,f.tree,f.sha,len(f.apk))
    def test_old_apk_and_exact_new_apk_manifest_are_checked(self):
        f=self.fixture()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base),patch.object(web.builder,'require_image_absent'):
            actual=web.validate_artifacts(f.repo,f.revision,f.sha,len(f.apk));self.assertEqual(actual[web.APK],f.apk)
        f.put(web.BASELINE_APK,b'PK\x03\x04changed old APK');revision=f.commit()
        with f.pins(),patch.object(web,'BASE_REVISION',f.base),patch.object(web.builder,'require_image_absent'),self.assertRaises(web.GateError):web.validate_artifacts(f.repo,revision,f.sha,len(f.apk))
    def test_runtime_list_cannot_expand_and_download_verification_uses147_code15(self):
        self.assertEqual(web.parse_runtime_paths(json.dumps([web.DESCRIPTOR]).encode()),web.PATHS)
        with self.assertRaises(web.GateError):web.parse_runtime_paths(json.dumps([web.DESCRIPTOR,'apps/ops-web/app/platform/catalog.tsx']).encode())
        f=self.fixture();script=web.download_verification_script(f.sha,len(f.apk),json.dumps(f.manifest).encode())
        for text in ('flixify-pro-1.4.7.apk','j.versionName!=="1.4.7"||j.versionCode!==15','bytes=0-31','application/vnd.android.package-archive','manifest_digest_invalid'):self.assertIn(text,script)
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
        badging="package: name='vip.flixify.tv' versionCode='15' versionName='1.4.7'\nminSdkVersion:'23'\ntargetSdkVersion:'35'\n"
        android.validate_tool_output(signing,badging)
        for value in (badging.replace("versionCode='15'","versionCode='14'"),badging+'application-debuggable\n'):
            with self.assertRaises(android.GateError):android.validate_tool_output(signing,value)
        with self.assertRaises(android.GateError):android.validate_tool_output(signing.replace(web.SIGNER_SHA256,'f'*64),badging)
    def test_preservation_paths_require_session_metadata_and_artwork_without_traversal(self):
        paths=['shared_prefs/tv_encrypted_session.xml','files/catalog-cache-v1/'+'a'*64+'.bin','cache/artwork-v1/'+'b'*64+'.art']
        self.assertEqual(upgrade.validate_paths(paths),tuple(paths))
        for bad in (paths+['../escape'],paths+['/data/local/tmp/file'],paths+paths[:1],paths[:2]):
            with self.assertRaises(upgrade.GateError):upgrade.validate_paths(bad)
    def test_upgrade_retains_first_install_time_and_exact_reviewed_file_digests(self):
        old={'versionCode':14,'versionName':'1.4.6','firstInstallTime':'same','uid':10123};new={'versionCode':15,'versionName':'1.4.7','firstInstallTime':'same','uid':10123}
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
    def test_package_only_mode_requires_explicit_selection_and_rejects_unused_private_paths(self):
        self.assertEqual(upgrade.preservation_mode(True,None),'package-only')
        self.assertEqual(upgrade.preservation_mode(False,Path('/reviewed/paths.json')),'private-files')
        for package_only,path in ((True,Path('/reviewed/paths.json')),(False,None)):
            with self.assertRaises(upgrade.GateError):upgrade.preservation_mode(package_only,path)
    def test_public_package_uid_is_required_unambiguous_and_preserved(self):
        text='  userId=10123\n  versionCode=14 minSdk=23 targetSdk=35\n  versionName=1.4.6\n  firstInstallTime=2026-11-01 14:00:00\n'
        before=upgrade.installed(text);self.assertEqual(before['uid'],10123)
        self.assertEqual(upgrade.installed(text.replace('userId=','appId='))['uid'],10123)
        after=dict(before,versionCode=15,versionName='1.4.7')
        upgrade.require_package_upgrade(before,after)
        for value in (dict(after,uid=10124),dict(after,firstInstallTime='changed'),dict(after,uid=None)):
            with self.assertRaises(upgrade.GateError):upgrade.require_package_upgrade(before,value)
        for value in (text.replace('  userId=10123\n',''),text+'  userId=10124\n',text.replace('userId=10123','userId=0')):
            with self.assertRaises(upgrade.GateError):upgrade.installed(value)
    def test_package_only_full_flow_uses_install_r_without_root_or_private_file_claims(self):
        f=Fixture();self.addCleanup(f.temp.cleanup)
        proof=f.repo/'proof.json';proof.write_text(json.dumps(f.proof()));proof_sha=hashlib.sha256(proof.read_bytes()).hexdigest()
        output=f.repo/'upgrade.json';apk=f.repo/web.APK;calls=[];state={'installed':False}
        def run(args,**kwargs):
            values=args[3:];calls.append(values)
            if values==['shell','getprop','ro.kernel.qemu']:value='1\n'
            elif values==['shell','dumpsys','package',upgrade.PACKAGE]:value='  userId=10123\n  versionCode='+('15' if state['installed'] else '14')+' minSdk=23 targetSdk=35\n  versionName='+('1.4.7' if state['installed'] else '1.4.6')+'\n  firstInstallTime=2026-11-01 14:00:00\n'
            elif values==['shell','pm','path',upgrade.PACKAGE]:value='package:/data/app/owned/base.apk\n'
            elif values==['shell','sha256sum /data/app/owned/base.apk']:value=(f.sha if state['installed'] else web.BASELINE_APK_SHA256)+'  /data/app/owned/base.apk\n'
            elif values==['shell','am','force-stop',upgrade.PACKAGE]:value=''
            elif values==['install','-r',str(apk)]:state['installed']=True;value='Performing Streamed Install\nSuccess\n'
            elif values==['shell','am','start','-W','-n',upgrade.PACKAGE+'/.MainActivity']:value='Status: ok\n'
            elif values==['shell','pidof',upgrade.PACKAGE]:value='12345\n'
            elif values==['logcat','-d','--pid=12345','-v','brief']:value='clean\n'
            elif values==['shell','dumpsys','window']:value='mCurrentFocus=Window{owned '+upgrade.PACKAGE+'/.MainActivity}\n'
            else:self.fail('Unexpected emulator command: '+repr(values))
            return subprocess.CompletedProcess(args,0,value.encode(),b'')
        argv=['verify-upgrade.py','--serial','emulator-5554','--adb','/mock/adb','--apk',str(apk),'--apk-proof-file',str(proof),'--apk-proof-sha256',proof_sha,'--output',str(output),'--package-only','--run']
        with patch.object(sys,'argv',argv),patch.object(upgrade.subprocess,'run',side_effect=run),patch.object(upgrade.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):upgrade.main()
        evidence=json.loads(output.read_text());self.assertFalse(evidence['privateFilesVerified']);self.assertFalse(evidence['sessionDecryptionVerified']);self.assertTrue(evidence['publicUidPreserved']);self.assertEqual(evidence['verificationMode'],'package-only')
        self.assertFalse(evidence['privateFilesPreservedBeforeLaunch']);self.assertEqual(evidence['fileDigestsBefore'],{});self.assertEqual(evidence['fileDigestsAfterInstall'],{})
        self.assertEqual([call for call in calls if call[0]=='install'],[['install','-r',str(apk)]])
        self.assertFalse(any('id' in call or any('/data/user/' in value for value in call) for call in calls))

class ReleaseContracts(unittest.TestCase):
    def test_web_only_transaction_preserves_latest_payment_api_worker_and_fence(self):
        self.assertIsNotNone(release,'scoped web transaction is required')
        release.configure(REVISION,'sha256:'+'b'*64,release.API_TAG,release.API_ID)
        self.assertEqual(release.guard.CHANGED,('ops-web',));self.assertEqual(release.guard.SOURCE_IDS,{'ops-web':web.SOURCE_ID})
        self.assertEqual(release.guard.PROTECTED_IMAGES,{'api':(web.API_TAG,web.API_ID),'worker':(web.WORKER_TAG,web.WORKER_ID)})
        self.assertEqual(release.reviewed.reviewed.builder.API_ID,'sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6')

class AdapterIntegration(unittest.TestCase):
    def test_public_tree_preserves_prior_apks_files_links_and_modes(self):
        f=Fixture();self.addCleanup(f.temp.cleanup)
        original=[['dir','',493],['dir','downloads',493],['file','logo.png',420,3,'a'*64],['link','logo-link',511,'logo.png'],['file',web.BASELINE_APK.removeprefix('apps/ops-web/public/'),420,len(f.old_apk),hashlib.sha256(f.old_apk).hexdigest()],['file','downloads/flixify-tv-update.json',420,len(f.old_manifest),hashlib.sha256(f.old_manifest).hexdigest()]]
        with f.pins():updated=json.loads(web.expected_public_manifest(json.dumps(original).encode(),f.sha,len(f.apk),f.read(web.UPDATE_MANIFEST)))
        for row in original[:-1]:self.assertIn(row,updated)
        self.assertIn(['file',web.APK.removeprefix('apps/ops-web/public/'),420,len(f.apk),f.sha],updated)
        for index in (4,5):
            bad=copy.deepcopy(original);bad[index][2]=493
            with f.pins(),self.assertRaises(web.GateError):web.expected_public_manifest(json.dumps(bad).encode(),f.sha,len(f.apk),f.read(web.UPDATE_MANIFEST))
    def test_native_version_floor_and_descriptor_changes_are_bounded(self):
        f=Fixture();self.addCleanup(f.temp.cleanup)
        for old,new in ((b'versionCode 15',b'versionCode 14'),(b'minSdk 23',b'minSdk 24'),(b'targetSdk 35',b'targetSdk 36')):
            f.git('reset','--hard',f.native);f.put(web.GRADLE,f.read(web.GRADLE).replace(old,new));native=f.commit()
            with f.pins(),self.assertRaises(web.GateError):web.validate_versions(f.repo,f.revision,native)
        f.git('reset','--hard',f.revision);f.put(web.DESCRIPTOR,f.read(web.DESCRIPTOR)+b'// unrelated change\n');revision=f.commit()
        with f.pins(),self.assertRaises(web.GateError):web.validate_versions(f.repo,revision,f.native)
    def test_real_inherited_reader_enforces_the_original_size_limit(self):
        self.assertIsNotNone(android)
        self.assertEqual(web.MAX_APK_BYTES,32*1024*1024)
        with tempfile.TemporaryDirectory() as directory:
            apk=Path(directory)/'fixture.apk';data=b'PK\x03\x04'+b'x'*2044;apk.write_bytes(data)
            self.assertEqual(android.regular_bytes(apk),data)
            apk.write_bytes(b'x'*2048)
            with self.assertRaises(android.GateError):android.regular_bytes(apk)
            apk.write_bytes(data);link=Path(directory)/'link.apk';link.symlink_to(apk)
            with self.assertRaises(android.GateError):android.regular_bytes(link)
            with apk.open('wb') as output:output.truncate(web.MAX_APK_BYTES+1)
            with self.assertRaises(android.GateError):android.regular_bytes(apk)
    def test_actual_current_service_and_manifest_pins_are_not_old_feature_pins(self):
        self.assertIsNotNone(web)
        self.assertEqual(web.BASE_REVISION,'3010833e1c4b1a7ebe059580d820f6c6a02d03e7')
        self.assertEqual(web.API_TAG,'flixify-api:welcome-offer-a052006305ed-20261101')
        self.assertEqual(web.API_ID,'sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496')
        self.assertEqual(web.BASELINE_MANIFEST_BYTES,483)
        self.assertEqual(web.BASELINE_MANIFEST_SHA256,'4d48c55550a17bd55ba8c5247da22ccae966ebe11fad4c2ab11f92bfcbd5a838')
        for module in (web.reviewed,web.publication,web.builder):
            self.assertEqual(module.SOURCE_ID,web.SOURCE_ID)
            self.assertEqual(module.PATHS,(web.DESCRIPTOR,))
        self.assertEqual(web.publication.API_ID,web.API_ID)
        self.assertEqual(web.publication.WORKER_ID,web.WORKER_ID)
        self.assertEqual(web.backend.ENV_SHA256,'c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42')
        self.assertEqual(web.backend.FENCE_SHA256,'5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b')
        with self.assertRaises(web.GateError):web.protected_snapshot('flixify-api:embedded-page-b0def990e266-20261101','sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1')
        for values in ({'environment':'bad','registrationFence':web.backend.FENCE_SHA256},{'environment':web.backend.ENV_SHA256,'registrationFence':'bad'}):
            with self.assertRaises(web.backend.GateError):web.backend.validate_runtime_proofs(values)
        with patch.object(web,'original_protected_snapshot',return_value={}),patch.object(web.backend,'host_snapshot',side_effect=web.backend.GateError('env drift')),self.assertRaises(web.GateError):web.protected_snapshot(web.API_TAG,web.API_ID)
        with patch.object(release.build.backend,'host_snapshot',side_effect=release.build.backend.GateError('env drift')),self.assertRaises(release.GateError):release.host_snapshot()

if __name__=='__main__':unittest.main()
