import hashlib,importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('tv_apk_web_test',Path(__file__).with_name('build-android-tv-web.py'))
tv=importlib.util.module_from_spec(spec);spec.loader.exec_module(tv)
class TvApkGuards(unittest.TestCase):
 def setUp(self):
  self.value=b'PK\x03\x04'+b'x'*2048;self.sha=hashlib.sha256(self.value).hexdigest();self.rev='a'*40
  self.regular=patch.object(tv.builder,'require_regular_blob').start()
  self.entry=patch.object(tv.builder,'git_entry',return_value=b'').start()
  self.absent=patch.object(tv.builder,'require_image_absent').start()
  self.git=patch.object(tv.core,'git_file',return_value=self.value).start()
  self.command=patch.object(tv,'command',return_value=(tv.APK+'\n').encode()).start()
  self.addCleanup(patch.stopall)
 def run_pin(self,sha=None,size=None):return tv.validate_apk(Path('/repo'),self.rev,sha or self.sha,len(self.value) if size is None else size)
 def test_exact_regular_absent_binary_scope_and_digest(self):
  self.assertEqual(self.run_pin(),self.value);self.regular.assert_called_once_with(Path('/repo'),self.rev,tv.APK);self.absent.assert_called_once_with(tv.APK)
 def test_invalid_digest_size_and_oversized_stop(self):
  for sha,size in [('bad',2048),(self.sha,0),(self.sha,tv.MAX_APK_BYTES+1)]:
   with self.assertRaisesRegex(tv.GateError,'apk_pin_invalid'):self.run_pin(sha,size)
 def test_new_path_cannot_overwrite_baseline(self):
  self.entry.return_value=b'100644 blob dead\tfile\x00'
  with self.assertRaisesRegex(tv.GateError,'apk_exists'):self.run_pin()
 def test_symlink_ancestor_stops(self):
  self.entry.side_effect=lambda repo,rev,path:b'120000 blob dead\tlink\x00' if path==str(Path(tv.APK).parent) else b''
  with self.assertRaisesRegex(tv.GateError,'ancestor_not_tree'):self.run_pin()
 def test_absence_errors_are_not_treated_as_missing(self):
  self.absent.side_effect=tv.GateError('image_check_failed')
  with self.assertRaisesRegex(tv.GateError,'image_check_failed'):self.run_pin()
 def test_extra_or_missing_public_changes_stop(self):
  for value in [b'',(tv.APK+'\napps/ops-web/public/extra.apk\n').encode()]:
   self.command.return_value=value
   with self.assertRaisesRegex(tv.GateError,'public_scope'):self.run_pin()
 def test_wrong_size_digest_and_nonzip_stop(self):
  for value in [self.value+b'x',b'PK\x03\x04'+b'y'*2048,b'notzip'+b'x'*2046]:
   self.git.return_value=value
   with self.assertRaisesRegex(tv.GateError,'bytes_differ'):self.run_pin()
 def test_candidate_binary_is_in_compile_context_with_bounds(self):
  value=tv.dockerfile(self.rev)
  self.assertIn('COPY '+tv.APK+' /app/'+tv.APK,value)
  self.assertIn(tv.SOURCE_TAG,value);self.assertIn('build_cgroup_limit_exceeds_cap',value)
  self.assertIn('next_config_restore_failed',value);self.assertEqual(value.count('RUN node -e '),1)
 def test_container_compile_caps_restores_command_and_removes_only_owned_container(self):
  self.command.side_effect=lambda *args,**kwargs:b'0\n' if args[:3]==('docker','inspect','--format') else b'ok'
  base={'Config':{'Cmd':['npm','run','start','-w','@flixify/ops-web'],'Volumes':None}}
  tv.container_compile(self.rev,base,{tv.APK:self.value},{'NEXT_PUBLIC_API_BASE_URL':'https://api.test'})
  calls=[call.args for call in self.command.call_args_list]
  create=next(x for x in calls if x[:2]==('docker','create'))
  self.assertIn('--network',create);self.assertIn('none',create);self.assertIn('1280m',create);self.assertIn('1536m',create);self.assertIn(tv.SOURCE_ID,create)
  commit=next(x for x in calls if x[:2]==('docker','commit'));self.assertIn('CMD ["npm", "run", "start", "-w", "@flixify/ops-web"]',commit)
  self.assertEqual(calls[-1][:3],('docker','rm','--force'));self.assertTrue(calls[-1][3].startswith('flixify-tv-web-build-'))
 def test_container_compile_rejects_volumes_before_mutation(self):
  with self.assertRaisesRegex(tv.GateError,'base_config_unsupported'):
   tv.container_compile(self.rev,{'Config':{'Cmd':['node'],'Volumes':{'/app':{}}}},{},{})
  self.command.assert_not_called()
 def test_runtime_manifest_is_six_paths_with_one_new_path(self):
  self.assertEqual(len(tv.PATHS),6);self.assertEqual(tv.NEW_PATHS,('apps/ops-web/app/platform/tv-download.ts',))
  self.assertEqual(tv.builder.SOURCE_ID,tv.SOURCE_ID)
if __name__=='__main__':unittest.main()
