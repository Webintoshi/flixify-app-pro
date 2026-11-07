import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
BASE='2522149cfda9dae514fc81d9820cbbfb70c57ea6'
spec=importlib.util.spec_from_file_location('phone_api_patcher',HERE/'patch-api.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

def digest(value):return hashlib.sha256(value).hexdigest()

class ApiOverlayTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.payload=self.root/'payload';self.stage=self.root/'stage'
        for path in p.EXISTING_FILES:
            target=self.stage/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(subprocess.check_output(['git','-C',str(ROOT),'show',BASE+':'+path]))
        for path in p.NEW_FILES:
            target=self.payload/path;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/path,target)
        target=self.payload/'coolify/releases/2026-11-07-phone-login/api-edits.json';target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(HERE/'api-edits.json',target)
        recipe=json.loads(target.read_bytes());self.recipe=recipe
        server=self.stage/'apps/api/src/server.ts';value=server.read_text();value='import { withTrialCountdown } from "./trial-countdown.js";\n'+value
        trial=json.loads((ROOT/'coolify/releases/2026-11-07-trial-countdown/api-patches.json').read_bytes())['replacements'][1]['new']
        a=value.index('  app.get("/me",');b=value.index('\n\n  app.',a);value=value[:a]+trial+value[b:]
        value=value.replace('  app.get("/me/sessions",',"  app.get('/me/referrals',async()=>({existingReferral:true}));\n  app.get(\"/me/sessions\",")
        value+='\nexport const productionStripeAndNotificationsSentinel="preserved";\n';server.write_text(value)
        repository=self.stage/'apps/api/src/repository.ts';value=repository.read_text();needle='    return userId;\n  });\n}\n\nexport async function storePlainKryptoniteCode('
        self.extra='    await client.query("existing-production-registration-notification",[userId]);\n'
        welcome='    await client.query(\n      "'+recipe['createUser']['welcomeAnchor']+'",\n      [userId]\n    );\n'
        assert value.count(needle)==1;value=value.replace(needle,welcome+self.extra+needle);repository.write_text(value)
        self.before=self.snapshot()
    def snapshot(self):return {str(x.relative_to(self.stage)):digest(x.read_bytes()) for x in self.stage.rglob('*') if x.is_file()}
    def run_apply(self,**kwargs):return p.apply(self.payload,self.stage,source_image_id=kwargs.get('source_image_id',p.EXPECTED_SOURCE_ID))
    def test_preserves_actual_welcome_notifications_and_unrelated_routes(self):
        original=(self.stage/'apps/api/src/server.ts').read_text();me=original[original.index('  app.get("/me",'):]
        proof=self.run_apply();server=(self.stage/'apps/api/src/server.ts').read_text();repo=(self.stage/'apps/api/src/repository.ts').read_text()
        self.assertEqual(server[server.index('  app.get("/me",'):],me)
        self.assertIn('productionStripeAndNotificationsSentinel',server);self.assertIn('createUserInTransaction',repo);self.assertIn(self.extra,repo)
        self.assertEqual(repo.count(self.recipe['createUser']['welcomeAnchor']),1);self.assertEqual(repo.count('insert into public.referral_attributions'),1)
        self.assertIn("rc.user_id<>$1",repo);self.assertIn("u.status<>'blocked'",repo);self.assertIn('u.deleted_at is null',repo)
        self.assertEqual(set(proof['changedPaths']),set(p.EXISTING_FILES+p.NEW_FILES));self.assertEqual(proof['before'],{x:self.before[x] for x in p.EXISTING_FILES})
        self.assertEqual(proof['after'],{x:digest((self.stage/x).read_bytes()) for x in p.EXISTING_FILES+p.NEW_FILES})
        self.assertIn('createUserOriginalBodySha256',proof['preserved'])
    def test_plan_is_read_only_and_matches_apply(self):
        planned,proof=p.plan(self.payload,self.stage,source_image_id=p.EXPECTED_SOURCE_ID);self.assertEqual(self.snapshot(),self.before)
        self.assertEqual(set(planned),set(p.EXISTING_FILES+p.NEW_FILES));self.assertEqual(self.run_apply(),proof)
    def test_rejects_wrong_image_before_any_write(self):
        with self.assertRaisesRegex(p.PatchError,'source_image'):self.run_apply(source_image_id='sha256:'+'0'*64)
        self.assertEqual(self.snapshot(),self.before)
    def test_rejects_unknown_anchor_before_any_write(self):
        target=self.stage/'apps/api/src/env.ts';target.write_text(target.read_text().replace('API_PORT: z.coerce.number().int().positive().default(4000)','API_PORT: z.coerce.number().int().positive().default(4001)'))
        before=self.snapshot()
        with self.assertRaisesRegex(p.PatchError,'anchor'):self.run_apply()
        self.assertEqual(self.snapshot(),before)
    def test_rejects_duplicate_anchors(self):
        target=self.stage/'apps/api/src/cors-config.ts';target.write_text(target.read_text()+self.recipe['existing']['apps/api/src/cors-config.ts'][0]['old'])
        with self.assertRaisesRegex(p.PatchError,'anchor'):self.run_apply()
    def test_rejects_preexisting_new_module(self):
        target=self.stage/p.NEW_FILES[0];target.write_text('existing source')
        before=self.snapshot()
        with self.assertRaisesRegex(p.PatchError,'already_exists'):self.run_apply()
        self.assertEqual(self.snapshot(),before)
    def test_rejects_tampered_new_module(self):
        target=self.payload/p.NEW_FILES[0];target.write_text(target.read_text()+'\n//unreviewed\n')
        with self.assertRaisesRegex(p.PatchError,'payload_hash'):self.run_apply()
        self.assertEqual(self.snapshot(),self.before)
    def test_rejects_recipe_mutation(self):
        target=self.payload/'coolify/releases/2026-11-07-phone-login/api-edits.json';target.write_text(target.read_text()+' ')
        with self.assertRaisesRegex(p.PatchError,'recipe_hash'):self.run_apply()
        self.assertEqual(self.snapshot(),self.before)
    def test_rejects_source_symlinks(self):
        target=self.stage/p.EXISTING_FILES[0];other=self.root/'external.ts';target.rename(other);target.symlink_to(other)
        with self.assertRaisesRegex(p.PatchError,'regular'):self.run_apply()
    def test_rejects_parent_symlinks(self):
        target=self.stage/'apps/api';other=self.root/'outside-api';target.rename(other);target.symlink_to(other,target_is_directory=True)
        with self.assertRaisesRegex(p.PatchError,'symlink'):self.run_apply()
    def test_requires_actual_welcome_row(self):
        target=self.stage/'apps/api/src/repository.ts';target.write_text(target.read_text().replace(self.recipe['createUser']['welcomeAnchor'],'unknown-campaign'))
        with self.assertRaisesRegex(p.PatchError,'welcome'):self.run_apply()
    def test_rejects_changed_transaction_wrapper(self):
        target=self.stage/'apps/api/src/repository.ts';target.write_text(target.read_text().replace('return withTransaction(async (client) => {','return otherTransaction(async (client) => {',1))
        with self.assertRaisesRegex(p.PatchError,'transaction'):self.run_apply()
    def test_rejects_reapplying_overlay(self):
        self.run_apply();before=self.snapshot()
        with self.assertRaises(p.PatchError):self.run_apply()
        self.assertEqual(self.snapshot(),before)

if __name__=='__main__':unittest.main()
