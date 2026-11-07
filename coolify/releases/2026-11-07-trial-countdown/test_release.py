import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import copy
import json
import sys
import tempfile
from types import ModuleType
from types import SimpleNamespace

spec=importlib.util.spec_from_file_location('trial_test_common',Path(__file__).parent/'common.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class PatchTests(unittest.TestCase):
    def fixture(self):
        original=b'import path from "node:path";\n  app.get("/me", async (request, reply) => {\n    return { user: { ...userContext.summary, accessHistory: await getAccessHistory(auth.userId) }, contact: {} };\n  });\n\n  app.get(\'/me/referrals\', async()=>({ preserved: true }));\n'
        old=original.decode().split('  app.get("/me"',1)[1].split("\n\n  app.get('/me/referrals'",1)[0]
        old='  app.get("/me"'+old
        new=old.replace('    return {','    return withTrialCountdown({').replace('contact: {} };','contact: {} }, userContext);')
        recipe={'path':c.SERVER,'sourceSha256':c.sha(original),'replacements':[{'old':'import path from "node:path";','new':'import { withTrialCountdown } from "./trial-countdown.js";\nimport path from "node:path";'}, {'old':old,'new':new}]}
        return original,recipe
    def test_exact_patch_preserves_access_history_referrals_and_all_other_bytes(self):
        original,recipe=self.fixture()
        with patch.object(c,'API_SERVER_SHA',c.sha(original)):result=c.patch_server(original,recipe)
        expected=original
        for row in recipe['replacements']:expected=expected.replace(row['old'].encode(),row['new'].encode())
        self.assertEqual(result,expected)
        self.assertIn(b'accessHistory: await getAccessHistory(auth.userId)',result)
        self.assertIn(b"app.get('/me/referrals', async()=>({ preserved: true }))",result)
    def test_wrong_source_hash_cannot_be_patched(self):
        original,recipe=self.fixture()
        with self.assertRaises(c.GateError):c.patch_server(original,recipe)
    def test_other_route_cannot_be_modified(self):
        original,recipe=self.fixture();recipe['replacements'][1]={'old':"  app.get('/me/referrals', async()=>({ preserved: true }));",'new':'  app.get(\'/me/referrals\', async()=>({ preserved: false }));'}
        with patch.object(c,'API_SERVER_SHA',c.sha(original)),self.assertRaises(c.GateError):c.patch_server(original,recipe)
    def test_duplicate_anchor_is_rejected(self):
        original,recipe=self.fixture();original+=recipe['replacements'][0]['old'].encode();recipe['sourceSha256']=c.sha(original)
        with patch.object(c,'API_SERVER_SHA',c.sha(original)),self.assertRaises(c.GateError):c.patch_server(original,recipe)
class ReleaseSafetyTests(unittest.TestCase):
    def module(self,name,file):
        with patch.dict(sys.modules,{'yaml':ModuleType('yaml')}):return c.load('test_trial_'+name,Path(__file__).parent/file)
    def native(self):return {'schemaVersion':1,'nativeRevision':'1'*40,'nativeTree':'2'*40,'packageName':'vip.flixify.tv','versionName':'1.4.16','versionCode':24,'minSdk':23,'targetSdk':35,'apkSha256':'3'*64,'apkBytes':2048,'signerSha256':c.previous.SIGNER,'checks':{k:True for k in ('releaseBuild','releaseLint','unitTests','instrumentationTests')}}
    def windows(self):return {'schemaVersion':1,'versionName':'1.0.4','architecture':'x64','distribution':'unsigned TEST','nativeRevision':c.WINDOWS_REVISION,'nativeTree':c.WINDOWS_TREE,'ciRunId':42371335948,'artifactId':13573554970,'artifactZipSha256':c.WINDOWS_ZIP_SHA,'artifactZipBytes':c.WINDOWS_ZIP_BYTES,'installerSha256':c.WINDOWS_SHA,'installerBytes':c.WINDOWS_BYTES,'checks':{'ciBuild':True,'installSmoke':True,'privacyScan':True}}
    def test_native_evidence_accepts_only_the_new_version_and_real_boolean_checks(self):
        value=self.native();self.assertEqual(c.native_proof(json.dumps(value).encode()),value)
        for change in ({'versionCode':23},{'signerSha256':'4'*64},{'checks':{k:1 for k in value['checks']}}):
            bad=copy.deepcopy(value);bad.update(change)
            with self.assertRaises(c.GateError):c.native_proof(json.dumps(bad).encode())
    def test_manifest_cannot_claim_different_version_bytes_or_digest(self):
        native=self.native();manifest={'packageName':'vip.flixify.tv','versionName':'1.4.16','versionCode':24,'minSdk':23,'apkUrl':'https://flixify.vip/downloads/flixify-pro-1.4.16.apk','sha256':native['apkSha256'],'sizeBytes':native['apkBytes'],'notes':'Geri sayım'}
        self.assertEqual(c.manifest(json.dumps(manifest).encode(),native),manifest)
        for key,value in (('sha256','4'*64),('versionCode',23),('sizeBytes',2049)):
            bad=dict(manifest);bad[key]=value
            with self.assertRaises(c.GateError):c.manifest(json.dumps(bad).encode(),native)
    def test_compiler_limits_are_applied_to_the_actual_docker_create(self):
        calls=[]
        with patch.object(c,'_base_command',side_effect=lambda *args,**kw:calls.append(args) or b'owned'):
            c.bounded_command('docker','create','--name','fixture','--network','none','--pids-limit','256','--memory','1280m','source','node','-e','if(BigInt(pids)>256n)throw Error()')
        call=calls[0];self.assertEqual(call[call.index('--cpus')+1],'1');self.assertEqual(call[call.index('--pids-limit')+1],'128');self.assertIn('>128n',call[-1])
        with self.assertRaises(c.GateError):c.bounded_command('docker','create','--network','host','source','node','-e','fixture')
    def test_api_disk_monitor_is_scoped_and_stopped_during_owned_cleanup(self):
        calls=[];name='flixify-packages-api-build-'+'a'*12
        class Watch:
            def __init__(self,value):self.value=value
            def __enter__(self):calls.append(('watch',self.value))
            def __exit__(self,*args):calls.append(('stopped',self.value))
        with patch.object(c,'_base_command',return_value=b'owned'),patch.object(c.prior,'DiskWatch',Watch):
            c.bounded_command('docker','create','--name',name,'--network','none','--pids-limit','256','source','node','-e','fixture')
            c.bounded_command('docker','start',name);c.bounded_command('docker','rm','--force',name)
        self.assertEqual(calls,[('watch',name),('stopped',name)]);self.assertNotIn(name,c._api_owned);self.assertNotIn(name,c._api_watches)
    def test_source_patch_recipe_retains_the_actual_runtime_only_access_history(self):
        value=json.loads((Path(__file__).parent/'api-patches.json').read_text())
        self.assertEqual(value['sourceSha256'],c.API_SERVER_SHA)
        self.assertEqual(len(value['replacements']),2)
        route=value['replacements'][1]
        self.assertNotIn("'/me/referrals'",route['old']);self.assertNotIn("'/me/referrals'",route['new'])
        self.assertIn('user: { ...userContext.summary, accessHistory: await getAccessHistory(auth.userId) }',route['new'])
    def test_other_emitted_api_modules_cannot_change(self):
        api=self.module('api','build-api.py');old={'untouched':{'sha256':'a'},'distEntries':{'server.js':{'sha256':'server'},'billing.js':{'sha256':'billing'}}}
        new=copy.deepcopy(old);new['distEntries']['server.js']={'sha256':'updated'};api.dist_delta(old,new)
        new['distEntries']['billing.js']={'sha256':'changed'}
        with self.assertRaises(api.GateError):api.dist_delta(old,new)
    def test_bundled_api_cannot_add_or_remove_dist_files(self):
        api=self.module('api_bundle_scope','build-api.py');old={'untouched':{'sha256':'a'},'distEntries':{'server.js':{'sha256':'server'},'billing.js':{'sha256':'billing'}}}
        with self.assertRaises(api.GateError):api.dist_delta(old,copy.deepcopy(old))
        for filename in ('trial-countdown.js','server.js.map','unexpected.js'):
            new=copy.deepcopy(old);new['distEntries'][filename]={'sha256':'extra'}
            with self.assertRaises(api.GateError):api.dist_delta(old,new)
        new=copy.deepcopy(old);del new['distEntries']['billing.js']
        with self.assertRaises(api.GateError):api.dist_delta(old,new)
    def test_candidate_helper_check_uses_actual_source_without_assuming_separate_tsup_output(self):
        api=self.module('api_helper_source','build-api.py');calls=[]
        with patch.object(api,'command',side_effect=lambda *args,**kw:calls.append(args) or b''):api.helper_check('sha256:'+'4'*64)
        self.assertEqual(len(calls),1);call=calls[0]
        self.assertIn('--import',call);self.assertEqual(call[call.index('--import')+1],'tsx')
        self.assertIn('/app/apps/api/src/trial-countdown.ts',call[-1]);self.assertNotIn('/app/apps/api/dist/trial-countdown.js',call[-1])
        self.assertEqual(call[call.index('--network')+1],'none');self.assertIn('--read-only',call)
        self.assertEqual(call[call.index('--env')+1],'TSX_DISABLE_CACHE=1')
    def test_current_web_and_new_download_check_stay_pinned(self):
        local=self.module('web','build-web.py').c;local.configure_web()
        self.assertEqual(local.builder.SOURCE_ID,c.SOURCES['ops-web'][1])
        self.assertEqual(local.previous.OVERLAY,local.WEB_PATHS)
        script=local.prior.client_download_verification();self.assertIn('flixify-pro-1.4.16.apk',script);self.assertNotIn('flixify-pro-1.4.15.apk',script)
        self.assertIn('apps/ops-web/app/platform/windows-download.ts',local.WEB_PATHS)
        self.assertIn(local.WINDOWS_EXE,local.WEB_PATHS);self.assertNotIn(local.WINDOWS_EXE,local.GIT_WEB_PATHS)
        self.assertIn('currentWindowsDescriptor',script);self.assertIn(local.WINDOWS_SHA,script)
    def test_windows_proof_rejects_wrong_artifact_source_version_hash_and_boolean_evidence(self):
        value=self.windows();self.assertEqual(c.windows_proof(json.dumps(value).encode()),value)
        for change in ({'versionName':'1.0.3'},{'nativeRevision':'4'*40},{'nativeTree':'4'*40},{'artifactId':13573554971},{'installerSha256':'4'*64},{'installerBytes':70367452},{'checks':{'ciBuild':1,'installSmoke':True,'privacyScan':True}}):
            bad=copy.deepcopy(value);bad.update(change)
            with self.assertRaises(c.GateError):c.windows_proof(json.dumps(bad).encode())
    def test_external_installer_checks_size_digest_and_real_pe_signature(self):
        data=bytearray(128);data[:2]=b'MZ';data[60:64]=(64).to_bytes(4,'little');data[64:68]=b'PE\x00\x00';data=bytes(data)
        with tempfile.TemporaryDirectory() as directory:
            installer=Path(directory)/'fixture.exe';installer.write_bytes(data)
            with patch.object(c,'WINDOWS_BYTES',128),patch.object(c,'WINDOWS_SHA',c.sha(data)):
                proof={'installerBytes':128,'installerSha256':c.sha(data)};self.assertEqual(c.windows_installer(installer,proof),data)
                installer.write_bytes(data[:-1])
                with self.assertRaises(c.GateError):c.windows_installer(installer,proof)
                installer.write_bytes(data[:-1]+b'changed'[:1])
                with self.assertRaises(c.GateError):c.windows_installer(installer,proof)
                installer.unlink();installer.symlink_to(Path(directory)/'missing')
                with self.assertRaises(c.GateError):c.windows_installer(installer,proof)
        for bad in (b'not executable',data[:64]+b'XX\x00\x00'+data[68:]):
            with self.assertRaises(c.GateError):c.windows_pe(bad,len(bad))
    def test_windows_tree_must_match_ci_and_installer_cannot_be_in_git(self):
        web=self.module('windows_web','build-web.py');proof=self.windows();calls=[]
        def changed(*args,**kwargs):
            calls.append(args)
            return (c.WINDOWS_TREE if args[-1].startswith(c.WINDOWS_REVISION) else '0'*40).encode()
        with patch.object(web,'command',side_effect=changed),self.assertRaises(web.GateError):web.windows_sources(Path('/repo'),'5'*40,proof,Path('/installer'))
        with patch.object(web,'command',return_value=c.WINDOWS_TREE.encode()),patch.object(web.c.builder,'git_entry',return_value=b'blob'),self.assertRaises(web.GateError):web.windows_sources(Path('/repo'),'5'*40,proof,Path('/installer'))
    def test_windows_descriptor_only_changes_version_size_and_hash(self):
        web=self.module('windows_descriptor','build-web.py');repo=Path(__file__).resolve().parents[3]
        old=c.blob(repo,c.BASE,c.WINDOWS_DESCRIPTOR);new=web.windows_descriptor(old)
        self.assertEqual(new,old.replace(b'1.0.3',b'1.0.4').replace(b'70365988',str(c.WINDOWS_BYTES).encode()).replace(b'5425571a13c4e696b00be4357b5a6be8137d3904c1b1efec3e08dcf69238872e',c.WINDOWS_SHA.encode()))
        self.assertIn(b'signed: false',new);self.assertIn(b'SmartScreen',new)
        with self.assertRaises(web.GateError):web.windows_descriptor(new)
    def test_overlay_budget_allows_only_exact_accepted_installer_apk_and_small_ui(self):
        native=self.native();binary=c.WINDOWS_BYTES+native['apkBytes']
        self.assertEqual(c.web_budget(10*1024**2,binary+1024,native)['hostReserveBytes'],1024**3)
        for overlay in (binary-1,binary+2*1024**2+1):
            with self.assertRaises(c.GateError):c.web_budget(10*1024**2,overlay,native)
    def test_public_overlay_preserves_old_installer_and_all_other_assets(self):
        local=self.module('public_tree','build-web.py').c;local.configure_web();native=self.native()
        manifest=json.dumps({'packageName':'vip.flixify.tv','versionName':'1.4.16','versionCode':24,'minSdk':23,'apkUrl':'https://flixify.vip/downloads/flixify-pro-1.4.16.apk','sha256':native['apkSha256'],'sizeBytes':native['apkBytes'],'notes':'Geri sayım'}).encode()
        old_windows=['file','downloads/flixify-pro-windows-1.0.3-x64-test-setup.exe',0o644,70365988,'4'*64]
        other=['file','favicon.ico',0o644,123,'5'*64]
        original=[['dir','downloads',0o755],old_windows,other,['file','downloads/flixify-tv-update.json',0o644,456,'6'*64]]
        rows=local.expected_public(json.dumps(original).encode(),native,manifest)
        self.assertIn(old_windows,rows);self.assertIn(other,rows)
        self.assertIn(['file',local.WINDOWS_EXE.removeprefix('apps/ops-web/public/'),0o644,local.WINDOWS_BYTES,local.WINDOWS_SHA],rows)
        self.assertEqual(len(rows),len(original)+2)
        original.append(['file',local.WINDOWS_EXE.removeprefix('apps/ops-web/public/'),0o644,0,'0'*64])
        with self.assertRaises(local.GateError):local.expected_public(json.dumps(original).encode(),native,manifest)
    def test_artifact_url_does_not_accept_http_credentials_or_other_origins(self):
        stage=self.module('stage','stage-windows.py')
        for url in ('https://files.oaiusercontent.com/temporary?sig=opaque','https://productionresultssa19.blob.core.windows.net/actions/temporary?sig=opaque'):self.assertEqual(stage.safe_url(url),url)
        for url in ('http://files.oaiusercontent.com/a','https://files.oaiusercontent.com.evil.example/a','https://127.0.0.1/a','https://token@files.oaiusercontent.com/a','https://files.oaiusercontent.com/a#fragment'):
            with self.assertRaises(stage.c.GateError):stage.safe_url(url)
    def test_windows_staging_preserves_reserve_during_both_installer_copies(self):
        stage=self.module('staging_peak','stage-windows.py')
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory).resolve();proof=folder/'proof.json';url=folder/'url.txt';output=folder/'installer.exe'
            proof.write_text(json.dumps(self.windows()));url.write_text('https://files.oaiusercontent.com/temporary?sig=fixture')
            required=stage.c.RESERVE+stage.c.WINDOWS_ZIP_BYTES+2*stage.c.WINDOWS_BYTES+2*1024**2
            argv=['stage-windows.py','--download-url-file',str(url),'--windows-proof',str(proof),'--output',str(output)]
            with patch.object(sys,'argv',argv),patch.object(stage.shutil,'disk_usage',return_value=SimpleNamespace(free=required-1)),patch.object(stage,'download',side_effect=AssertionError('Transfer must not start below peak disk budget')) as download:
                with self.assertRaisesRegex(stage.c.GateError,'windows_staging_requires_preserved_disk_reserve'):stage.main()
                download.assert_not_called()
            with patch.object(sys,'argv',argv),patch.object(stage.shutil,'disk_usage',return_value=SimpleNamespace(free=required)),patch.object(stage,'download',side_effect=RuntimeError('reached_bounded_transfer')) as download:
                with self.assertRaisesRegex(RuntimeError,'reached_bounded_transfer'):stage.main()
                download.assert_called_once()
            self.assertFalse(output.exists())
    def test_compose_writer_retains_the_original_transaction_and_avoids_env_regeneration(self):
        release=self.module('release','release.py');candidates={k:'sha256:'+'4'*64 for k in c.SOURCES};release.configure('5'*40,candidates,self.native(),b'{}')
        before,after=release.ORIGINAL_PHP.split('$service->saveComposeConfigs();')
        replacement="instant_remote_write_file($service->server, $service->workdir().'/docker-compose.yml', $service->docker_compose);"
        self.assertEqual(release.guard.PHP_APPLY,before+replacement+after)
        self.assertEqual(release.guard.CHANGED,('api','ops-web'));self.assertEqual(release.guard.SOURCE_IDS,{k:v[1] for k,v in c.SOURCES.items()})
    def test_rollback_calls_only_the_existing_image_rollback_and_no_session_sql(self):
        release=self.module('rollback','release.py');calls=[]
        with patch.object(release.c,'protected',return_value={}),patch.object(release.guard,'rollback',side_effect=lambda:calls.append('images')),patch.object(release.guard,'command',side_effect=AssertionError('No SQL or other commands belong in wrapper rollback')):
            release.invoke('rollback')
        self.assertEqual(calls,['images'])

if __name__=='__main__':unittest.main()
