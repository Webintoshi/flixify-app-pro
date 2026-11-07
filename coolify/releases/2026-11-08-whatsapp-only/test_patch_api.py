import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('whatsapp_only_patch',Path(__file__).with_name('patch-api.py'))
patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)

class ApiOverlayTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.payload=self.root/'payload';self.stage=self.root/'stage';self.payload.mkdir();self.stage.mkdir()
        self.old_recipe_sha=patch.RECIPE_SHA256
        self.sources={
            patch.PATCHED_PATHS[0]:b'// production prefix\r\n  app.post("/auth/register-anon", oldRegistration);\n  app.post("/auth/login-by-code", existingLogin);\r\n// payments and package routes\r\n',
            patch.PATCHED_PATHS[1]:b'// production prefix\r\nexport async function createUser(){\r\n  return preserveTrialWelcomeReferral();\r\n}\r\nexport async function storePlainKryptoniteCode(){}\nexport async function getAdminUserDetail(){return {summary:null};}\n// production suffix\r\n',
            patch.PATCHED_PATHS[2]:b'// production prefix\r\nif(!userId){\n  userId=await createVerifiedAccount();\n}\nreturn preserveExistingPhoneLoginAndBinding();\r\n'
        }
        edits=[
            {'old':'  app.post("/auth/register-anon", oldRegistration);\n','new':'  app.post("/auth/register-anon", {onRequest:rejectUnverified}, rejectUnverified);\n'},
            {'old':'return {summary:null};','new':'return {summary:null,registration:{method:null,platform:null,createdAt:null}};'},
            {'old':'  userId=await createVerifiedAccount();\n','new':'  userId=await createVerifiedAccount();\n  await recordOriginalRegistration();\n'}
        ]
        self.description={'schemaVersion':1,'sourceImageId':patch.EXPECTED_SOURCE_ID,'existing':{}}
        self.expected={}
        for path,edit in zip(patch.PATCHED_PATHS,edits):
            original=self.sources[path];updated=original.replace(edit['old'].encode(),edit['new'].encode());self.expected[path]=updated
            self.description['existing'][path]={'before':patch.sha(original),'after':patch.sha(updated),'edits':[edit]}
            target=self.stage/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(original)
        self.write_recipe()
    def tearDown(self):
        patch.RECIPE_SHA256=self.old_recipe_sha;self.temp.cleanup()
    def write_recipe(self):
        target=self.payload/patch.RECIPE;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(self.description));patch.RECIPE_SHA256=patch.sha(target.read_bytes())
    def plan(self):return patch.plan(self.payload,self.stage,source_image_id=patch.EXPECTED_SOURCE_ID)
    def test_plan_is_read_only_and_preserves_raw_production_regions(self):
        updates,proof=self.plan();self.assertEqual(updates,self.expected)
        self.assertEqual(set(proof['changedPaths']),set(patch.PATCHED_PATHS));self.assertEqual(len(proof['preserved']),2)
        for path,data in self.sources.items():self.assertEqual((self.stage/path).read_bytes(),data)
    def test_apply_changes_only_the_three_reviewed_sources(self):
        marker=self.stage/'unrelated';marker.write_bytes(b'preserve');proof=patch.apply(self.payload,self.stage,source_image_id=patch.EXPECTED_SOURCE_ID)
        self.assertEqual(marker.read_bytes(),b'preserve')
        for path,data in self.expected.items():self.assertEqual((self.stage/path).read_bytes(),data);self.assertEqual(proof['after'][path],patch.sha(data))
    def test_unknown_source_hash_fails_before_any_write(self):
        path=patch.PATCHED_PATHS[-1];(self.stage/path).write_bytes(self.sources[path]+b'unknown')
        with self.assertRaisesRegex(patch.PatchError,'exact_source_hash_differs'):patch.apply(self.payload,self.stage,source_image_id=patch.EXPECTED_SOURCE_ID)
        self.assertEqual((self.stage/patch.PATCHED_PATHS[0]).read_bytes(),self.sources[patch.PATCHED_PATHS[0]])
    def test_wrong_image_fails_before_any_write(self):
        with self.assertRaisesRegex(patch.PatchError,'exact_source_image_required'):patch.apply(self.payload,self.stage,source_image_id='sha256:wrong')
    def test_wrong_recipe_hash_fails_closed(self):
        patch.RECIPE_SHA256='0'*64
        with self.assertRaisesRegex(patch.PatchError,'reviewed_recipe_hash_differs'):self.plan()
    def test_duplicate_anchor_rejected_even_with_reviewed_source_hash(self):
        path=patch.PATCHED_PATHS[-1];original=self.sources[path]+self.description['existing'][path]['edits'][0]['old'].encode();(self.stage/path).write_bytes(original)
        self.description['existing'][path]['before']=patch.sha(original);self.write_recipe()
        with self.assertRaisesRegex(patch.PatchError,'exact_anchor_not_unique'):self.plan()
    def test_modified_code_login_is_rejected_even_if_recipe_hashes_match(self):
        path=patch.PATCHED_PATHS[0];old='existingLogin';new='changedLogin';row=self.description['existing'][path]
        row['edits'].append({'old':old,'new':new});row['after']=patch.sha(self.expected[path].replace(b'  app.post("/auth/login-by-code", existingLogin);\r\n',b'  app.post("/auth/login-by-code", changedLogin);\n'));self.write_recipe()
        with self.assertRaisesRegex(patch.PatchError,'protected_existing_behavior_changed'):self.plan()
    def test_modified_core_trial_creation_is_rejected_even_if_recipe_hashes_match(self):
        path=patch.PATCHED_PATHS[1];old='preserveTrialWelcomeReferral';new='changedTrial';row=self.description['existing'][path]
        row['edits'].append({'old':old,'new':new});row['after']=patch.sha(self.expected[path].replace(b'  return preserveTrialWelcomeReferral();\r\n',b'  return changedTrial();\n'));self.write_recipe()
        with self.assertRaisesRegex(patch.PatchError,'protected_existing_behavior_changed'):self.plan()
    def test_unknown_file_scope_is_rejected(self):
        self.description['existing']['unknown.ts']=copy.deepcopy(next(iter(self.description['existing'].values())));self.write_recipe()
        with self.assertRaisesRegex(patch.PatchError,'reviewed_recipe_scope_differs'):self.plan()
    def test_symlink_source_is_rejected(self):
        path=self.stage/patch.PATCHED_PATHS[-1];data=path.read_bytes();path.unlink();target=self.root/'elsewhere';target.write_bytes(data);path.symlink_to(target)
        with self.assertRaisesRegex(patch.PatchError,'source_symlink_forbidden'):self.plan()
    def test_equal_prefix_and_suffix_line_endings_are_not_normalized(self):
        for path,data in self.plan()[0].items():
            self.assertTrue(data.startswith(b'// production prefix\r\n'))
            self.assertEqual(data.count(b'\r\n'),self.sources[path].count(b'\r\n'))
    def test_wrong_after_hash_is_rejected(self):
        self.description['existing'][patch.PATCHED_PATHS[0]]['after']='0'*64;self.write_recipe()
        with self.assertRaisesRegex(patch.PatchError,'exact_updated_hash_differs'):self.plan()

if __name__=='__main__':unittest.main()
