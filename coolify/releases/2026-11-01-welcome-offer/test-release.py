"""Offline welcome-offer release contracts; never contacts a device or host."""
import contextlib
import copy
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
backend=load('welcome_backend_contract',HERE/'build-backend.py')
web=load('welcome_web_contract',HERE/'build-web.py')
api_release=load('welcome_api_release_contract',HERE/'release-backend.py')
web_release=load('welcome_web_release_contract',HERE/'release-web.py')
android=load('welcome_artifact_contract',HERE/'verify-android.py')
upgrade=load('welcome_upgrade_contract',HERE/'verify-upgrade.py')
REV='a'*40

class Fixture:
    def __init__(self):
        self.temp=tempfile.TemporaryDirectory(prefix='welcome-release-contract-');self.repo=Path(self.temp.name)
        self.git('init','-q');self.git('config','user.name','Offline');self.git('config','user.email','offline@example.invalid')
        self.put('apps/tv-android/app/build.gradle',b"android { defaultConfig { applicationId 'vip.flixify.tv'\nminSdk 23\ntargetSdk 35\nversionCode 13\nversionName '1.4.5'\n} }\n")
        self.put('apps/tv-android/app/src/main/AndroidManifest.xml',b'<application android:label="Flixify Pro"/>\n')
        self.descriptor=b'const download={href:"flixify-pro-1.4.5.apk",filename:"flixify-pro-1.4.5.apk",version:"1.4.5"};\n'
        for path in web.PATHS:
            if path not in web.NEW_PATHS:self.put(path,self.descriptor if path==web.DESCRIPTOR else b'preserved original\n')
        self.put(web.BASELINE_APK,b'PK\x03\x04old fixture');self.put(web.UPDATE_MANIFEST,b'old manifest')
        self.base=self.commit()
    def git(self,*args):return subprocess.check_output(['git','-C',str(self.repo),*args],stderr=subprocess.DEVNULL).decode().strip()
    def put(self,path,data):
        destination=self.repo/path;destination.parent.mkdir(parents=True,exist_ok=True);destination.write_bytes(data)
    def commit(self):self.git('add','.');self.git('commit','-qm','fixture');return self.git('rev-parse','HEAD')
    def web_publication(self):
        self.put(web.GRADLE,(self.repo/web.GRADLE).read_bytes().replace(b'versionCode 13',b'versionCode 14').replace(b"'1.4.5'",b"'1.4.6'"))
        for path in web.PATHS:
            if path!=web.DESCRIPTOR:self.put(path,b'reviewed welcome UI\n')
        self.native=self.commit();self.tree=self.git('rev-parse',self.native+':apps/tv-android')
        self.put(web.DESCRIPTOR,self.descriptor.replace(b'1.4.5',b'1.4.6'));self.put(web.APK,b'PK\x03\x04new fixture');self.put(web.UPDATE_MANIFEST,b'new manifest')
        return self.commit()

class Contracts(unittest.TestCase):
    def setUp(self):self.assertIsNotNone(backend,'welcome API adapter required');self.assertIsNotNone(web,'welcome web publication adapter required')
    def test_exact_current_sources_and_permanent_fence_are_separate(self):
        self.assertEqual(backend.configuration('api')['id'],'sha256:cfc1c2b85087e7480759bc6d33686186eb358777d9c97c5434caab3d16e57bd1')
        self.assertEqual(web.SOURCE_ID,'sha256:33e838ffbec2318214458b7a42868b58a974dac3cb48374cce3be63fc7064a63')
        self.assertEqual(backend.reviewed.API_ID,'sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6')
        with self.assertRaises(backend.GateError):backend.configuration('worker')
        self.assertEqual(backend.target('api',REV),'flixify-api:welcome-offer-aaaaaaaaaaaa-20261101')
    def test_two_actual_source_patch_descriptions_are_bounded_unique_and_nonoverlapping(self):
        original=b'import old;\nfunction register() { oldRegistration(); }\n'
        desc={'path':'apps/api/src/server.ts','sourceSha256':hashlib.sha256(original).hexdigest(),'replacements':[{'old':'import old;','new':'import preserved;\nimport offer;'},{'old':'oldRegistration();','new':'oldRegistration(); welcomeRoutes();'}]}
        actual=backend.patch_source('apps/api/src/server.ts',original,desc)
        self.assertIn(b'oldRegistration(); welcomeRoutes();',actual)
        for mutate in ('hash','duplicate','overlap','wrongPath','count'):
            value=copy.deepcopy(desc)
            if mutate=='hash':value['sourceSha256']='f'*64
            if mutate=='duplicate':value['replacements'][0]['old']='missing'
            if mutate=='overlap':value['replacements'][1]['old']='import old;\nfunction'
            if mutate=='wrongPath':value['path']='apps/api/src/repository.ts'
            if mutate=='count':value['replacements']=value['replacements'][:1]
            with self.subTest(mutate=mutate),self.assertRaises(backend.GateError):backend.patch_source('apps/api/src/server.ts',original,value)
    def test_new_runtime_scope_is_exact_and_entire_payment_and_cache_trees_stay_covered(self):
        self.assertEqual(len(backend.API_PATHS),11);self.assertEqual(len(backend.API_NEW_PATHS),3)
        self.assertEqual(len(web.PATHS),11);self.assertEqual(len(web.NEW_PATHS),3)
        self.assertIn('apps/ops-web/lib/api.ts',web.PATHS)
        for path in ('apps/ops-web/app/platform/catalog.tsx','apps/ops-web/components/ui/package-checkout.module.css',web.BASELINE_APK,'node_modules','apps/ops-web/components','apps/ops-web/app/platform'):
            self.assertNotIn(path,web.EXCLUDED)
        self.assertEqual(set(web.parse_runtime_paths(json.dumps(list(web.PATHS)).encode())),set(web.PATHS))
        for paths in (list(web.PATHS)[:-1],list(web.PATHS)+['apps/ops-web/app/platform/catalog.tsx']):
            with self.assertRaises(web.GateError):web.parse_runtime_paths(json.dumps(paths).encode())
    def test_146_manifest_and_same_signer_proof_keep_145_immutable(self):
        sha='b'*64;size=1400000;native='c'*40;tree='d'*40
        manifest={'packageName':'vip.flixify.tv','versionName':'1.4.6','versionCode':14,'minSdk':23,'apkUrl':web.APK_URL,'sha256':sha,'sizeBytes':size,'notes':'Welcome offer'}
        web.parse_manifest(json.dumps(manifest).encode(),sha,size)
        proof={'schema':1,'nativeRevision':native,'nativeTree':tree,'packageName':'vip.flixify.tv','versionName':'1.4.6','versionCode':14,'minSdk':23,'targetSdk':35,'sha256':sha,'sizeBytes':size,'certificateSha256':web.SIGNER_SHA256,'baselineApkSha256':web.BASELINE_APK_SHA256,'baselineApkSizeBytes':web.BASELINE_APK_BYTES,'signatureSchemes':['v1','v2'],'releaseDebuggable':False}
        web.validate_apk_proof(json.dumps(proof).encode(),native,tree,sha,size)
        self.assertEqual(web.BASELINE_APK_SHA256,'0557946f54082e60a171d5ada901b725e8308b7136d606efcb78233b5ff4d338')
        self.assertEqual(web.BASELINE_APK_BYTES,1367652)
        for key,value in (('versionCode',13),('versionCode',True),('versionName','1.4.5'),('apkUrl','http://example.invalid/new.apk')):
            bad=dict(manifest);bad[key]=value
            with self.assertRaises(web.GateError):web.parse_manifest(json.dumps(bad).encode(),sha,size)
        bad=dict(proof,baselineApkSha256='e'*64)
        with self.assertRaises(web.GateError):web.validate_apk_proof(json.dumps(bad).encode(),native,tree,sha,size)
    def test_public_download_checks_target_146_and_bound_full_body_range_and_manifest(self):
        sha='b'*64;size=1400000
        manifest={'packageName':'vip.flixify.tv','versionName':'1.4.6','versionCode':14,'minSdk':23,'apkUrl':web.APK_URL,'sha256':sha,'sizeBytes':size,'notes':''}
        script=web.download_verification_script(sha,size,json.dumps(manifest).encode())
        for text in ('flixify-pro-1.4.6.apk','j.versionName!=="1.4.6"||j.versionCode!==14','bytes=0-31','manifest_digest_invalid','apk_get_digest_invalid'):self.assertIn(text,script)
    def test_api_pin_only_accepts_exact_baseline_or_reviewed_descendant(self):
        candidate='sha256:'+'a'*64;tag='flixify-api:welcome-offer-'+REV[:12]+'-20261101'
        base={'Id':web.API_ID,'RootFS':{'Layers':['base']},'Config':{'Labels':{}}}
        new={'Id':candidate,'RootFS':{'Layers':['base','new']},'Config':{'Labels':{'org.opencontainers.image.revision':REV,'vip.flixify.edge-recovery.base':web.API_ID}}}
        def image(value):return base if value in (web.API_ID,web.API_TAG) else new
        with patch.object(web.core,'image',side_effect=image):
            self.assertEqual(web.accept_api_pin(web.API_TAG,web.API_ID),(web.API_TAG,web.API_ID))
            with patch.object(web.core,'image',side_effect=lambda value:new if value in (tag,candidate) else base):self.assertEqual(web.accept_api_pin(tag,candidate),(tag,candidate))
            with self.assertRaises(web.GateError):web.accept_api_pin('flixify-api:unreviewed',candidate)
    def test_snapshot_pin_measurements_are_bounded_read_only_and_keep_all_other_files(self):
        script=backend.snapshot_script('api');self.assertIn('sourceHashes',script);self.assertIn('distEntries',script)
        self.assertIn('apps/api/src/repository.ts',script);self.assertIn('apps/api/src/server.ts',script)
        self.assertIn('welcome-offer.ts',web.snapshot_script())
        self.assertNotIn('prune',script)
    def test_real_git_scope_preserves_native_freeze_and_rejects_unrelated_frontend(self):
        f=Fixture();self.addCleanup(f.temp.cleanup);revision=f.web_publication()
        with patch.object(web,'BASE_REVISION',f.base),patch.object(web.backend,'BASE_REVISION',f.base):
            web.validate_source_scope(f.repo,revision,f.native,f.tree,web.PATHS);web.validate_versions(f.repo,revision,f.native)
            for path in ('apps/ops-web/app/platform/catalog.tsx','apps/ops-web/components/ui/package-checkout.module.css','packages/contracts/src/index.ts','apps/api/src/server.ts'):
                f.put(path,b'unreviewed runtime\n');changed=f.commit()
                with self.subTest(path=path),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,changed,f.native,f.tree,web.PATHS)
        f=Fixture();self.addCleanup(f.temp.cleanup);revision=f.web_publication();f.put(web.GRADLE,b'late native change');changed=f.commit()
        with patch.object(web,'BASE_REVISION',f.base),patch.object(web.backend,'BASE_REVISION',f.base),self.assertRaises(web.GateError):web.validate_source_scope(f.repo,changed,f.native,f.tree,web.PATHS)
    def test_actual_api_source_and_both_patch_manifests_are_verified_before_overlay(self):
        f=Fixture();self.addCleanup(f.temp.cleanup)
        originals={path:('original '+path+'\n').encode() for path in backend.API_PATHS if path not in backend.API_NEW_PATHS}
        originals['apps/api/src/server.ts']=b'import old;\noldRegistration();\n'
        originals['apps/api/src/repository.ts']=b'createTrialJob();\n'
        entries=[]
        for name in backend.API_NAMES:
            path='apps/api/src/'+name;source=backend.API_SOURCE_ROOT+name;value=('reviewed '+name+'\n').encode();f.put(source,value)
            entries.append({'path':path,'source':source,'new':path in backend.API_NEW_PATHS,'sha256':hashlib.sha256(value).hexdigest()})
        descriptions=[]
        for path,(source,count) in backend.PATCH_FILES.items():
            edits=[{'old':'import old;','new':'import old; import welcome;'},{'old':'oldRegistration();','new':'oldRegistration(); welcomeRoutes();'}] if path.endswith('server.ts') else [{'old':'createTrialJob();','new':'createTrialJob(); grantNewAccountOffer();'}]
            data=json.dumps({'path':path,'sourceSha256':hashlib.sha256(originals[path]).hexdigest(),'replacements':edits}).encode();f.put(source,data)
            descriptions.append({'path':path,'source':source,'sha256':hashlib.sha256(data).hexdigest()})
        manifest={'runtimeSources':entries,'patches':descriptions};f.put(backend.API_SOURCE_MANIFEST,json.dumps(manifest).encode());revision=f.commit()
        pin={'sourceHashes':{path:None if path in backend.API_NEW_PATHS else hashlib.sha256(originals[path]).hexdigest() for path in backend.API_PATHS}}
        with patch.object(backend,'BASE_REVISION',f.base),patch.object(backend.helpers,'image_file',side_effect=lambda identity,path:originals[path]),patch.object(backend.helpers,'require_image_absent'):
            result=backend.updated_sources(f.repo,revision,'api',pin);self.assertEqual(set(result),set(backend.API_PATHS));self.assertIn(b'grantNewAccountOffer();',result['apps/api/src/repository.ts'])
            bad=copy.deepcopy(pin);bad['sourceHashes']['apps/api/src/repository.ts']='f'*64
            with self.assertRaises(backend.GateError):backend.updated_sources(f.repo,revision,'api',bad)
            manifest['runtimeSources'][0]['sha256']='f'*64;f.put(backend.API_SOURCE_MANIFEST,json.dumps(manifest).encode());changed=f.commit()
            with self.assertRaises(backend.GateError):backend.updated_sources(f.repo,changed,'api',pin)
    def test_api_and_web_transactions_change_one_service_and_keep_fence249(self):
        identity='sha256:'+'b'*64
        with patch.object(api_release.guard,'image_id',return_value=backend.WEB_ID),patch.object(api_release.guard,'image',return_value={'Id':backend.WEB_ID}):api_release.configure('api',REV,identity,backend.WEB_TAG,backend.WEB_ID)
        self.assertEqual(api_release.guard.CHANGED,('api',));self.assertEqual(api_release.guard.SOURCE_IDS,{'api':backend.API_ID})
        self.assertEqual(api_release.guard.PROTECTED_IMAGES,{'ops-web':(backend.WEB_TAG,backend.WEB_ID),'worker':(backend.WORKER_TAG,backend.WORKER_ID)})
        self.assertEqual(api_release.reviewed.builder.API_ID,'sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6')
        candidate='sha256:'+'c'*64;tag=backend.target('api',REV)
        with patch.object(web_release.build,'accept_api_pin',return_value=(tag,candidate)):web_release.configure(REV,identity,tag,candidate)
        self.assertEqual(web_release.guard.CHANGED,('ops-web',));self.assertEqual(web_release.guard.SOURCE_IDS,{'ops-web':web.SOURCE_ID})
        self.assertEqual(web_release.guard.PROTECTED_IMAGES,{'api':(tag,candidate),'worker':(backend.WORKER_TAG,backend.WORKER_ID)})
        with patch.object(web_release.build,'accept_api_pin',return_value=(backend.API_TAG,backend.API_ID)),self.assertRaises(web_release.GateError):web_release.configure(REV,identity,backend.API_TAG,backend.API_ID)
    def test_candidate_regressions_use_actual_source_both_aliases_and_no_live_environment(self):
        calls=[]
        with patch.object(backend.helpers,'require_regular_blob'),patch.object(backend.core,'git_file',return_value=b'fixture'),patch.object(backend,'command',side_effect=lambda *args,**kwargs:calls.append(args)):
            backend.test_candidate(Path('/reviewed'),REV,'api','sha256:'+'b'*64)
        self.assertEqual(len(calls),1);args=calls[0]
        self.assertEqual(args[args.index('--network')+1],'none');self.assertEqual(args[args.index('--memory')+1],'1280m')
        mounts=[args[n+1] for n,arg in enumerate(args) if arg=='-v']
        self.assertEqual(len(mounts),len(backend.API_TEST_FILES));self.assertTrue(all(value.endswith(':ro') for value in mounts))
        script=args[-1]
        self.assertIn("root+'/api-source'",script);self.assertIn('/app/apps/api/src',script)
        for root in (backend.ROOT,backend.HISTORICAL_TEST_ROOT):self.assertIn('/app/'+root.rstrip('/'),script)
        for value in ('STRIPE_SECRET_KEY=','STRIPE_WEBHOOK_SECRET=','STRIPE_BILLING_ENABLED=false','WELCOME_OFFER_TEST_DATABASE_URL='):self.assertIn(value,args)
        self.assertEqual(set(backend.WELCOME_TEST_FILES),{backend.ROOT+'welcome-tests/'+name for name in ('checkout-offer.test.ts','payment-offer.test.ts','welcome-state.test.ts','payment-postgres.test.ts','api-coupon.test.ts')})
    def test_native_artifact_tools_require_code14_same_signer_and_exact13_to14_upgrade(self):
        self.assertIsNotNone(android);self.assertIsNotNone(upgrade)
        signing='Signer #1 certificate SHA-256 digest: '+web.SIGNER_SHA256+'\nVerified using v1 scheme (JAR signing): true\nVerified using v2 scheme (APK Signature Scheme v2): true\n'
        badging="package: name='vip.flixify.tv' versionCode='14' versionName='1.4.6'\nminSdkVersion:'23'\ntargetSdkVersion:'35'\n"
        android.validate_tool_output(signing,badging)
        for value in (badging.replace("versionCode='14'","versionCode='13'"),badging+'application-debuggable\n'):
            with self.assertRaises(android.GateError):android.validate_tool_output(signing,value)
        old={'versionCode':13,'versionName':'1.4.5','firstInstallTime':'same','uid':10094};new={'versionCode':14,'versionName':'1.4.6','firstInstallTime':'same','uid':10094}
        upgrade.require_package_upgrade(old,new)
        for before,after in ((dict(old,versionCode=12),new),(old,dict(new,versionCode=13)),(old,dict(new,uid=10095)),(old,dict(new,firstInstallTime='changed'))):
            with self.assertRaises(upgrade.GateError):upgrade.require_package_upgrade(before,after)
        self.assertEqual(upgrade.preservation_mode(True,None),'package-only')
        with self.assertRaises(upgrade.GateError):upgrade.preservation_mode(True,Path('/unused/private-paths.json'))
    def test_accepted_raw_environment_and_original_registration_proof_cannot_drift(self):
        expected={'environment':backend.ENV_SHA256,'registrationFence':backend.FENCE_SHA256,'otherProject':'unchanged'}
        self.assertEqual(backend.validate_runtime_proofs(expected),expected)
        for key in ('environment','registrationFence'):
            value=dict(expected);value[key]='f'*64
            with self.assertRaises(backend.GateError):backend.validate_runtime_proofs(value)

if __name__=='__main__':unittest.main()
