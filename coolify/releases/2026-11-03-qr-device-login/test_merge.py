import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('qr_merge',HERE/'merge.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ROOT=HERE.parents[2]
SERVER_PATH_IMPORT='import path from "node:path";\n'
QR_SERVER_IMPORTS=(
    'import { randomUUID } from "node:crypto";\n'
    'import { DeviceLoginCrypto, DeviceLoginService, redactDeviceLinkedPayload } from "./device-login.js";\n'
    'import { DeviceLoginStore } from "./device-login-store.js";\n'
    'import { registerDeviceLoginRoutes } from "./device-login-routes.js";\n'
)

class MergeTests(unittest.TestCase):
    def test_operational_insertions_retained(self):
        before='head\nfunction owner() {\n  return 1;\n}\ntail\n'
        after=before.replace('return 1','return 2')
        actual=before.replace('head\n','head\noperationalBilling();\n')+'operationalAnalytics();\n'
        self.assertEqual(m.merge_text(before,after,actual),actual.replace('return 1','return 2'))

    def test_changed_anchor_fails(self):
        with self.assertRaises(m.GateError): m.merge_text('head\nold\ntail\n','head\nnew\ntail\n','head\nconflict\ntail\n')

    def test_ambiguous_anchor_fails(self):
        with self.assertRaises(m.GateError): m.merge_text('head\nold\ntail\n','head\nnew\ntail\n','head\nold\ntail\n'*2)

    def test_server_imports_preserve_intervening_operational_imports(self):
        revision=m.git(ROOT,'rev-parse','HEAD').decode().strip()
        path='apps/api/src/server.ts'
        base=m.blob(ROOT,m.BASE,path).decode().replace(m.OLD_AUTH,m.NEW_AUTH)
        changed=m.blob(ROOT,revision,path).decode().replace(m.OLD_AUTH,m.NEW_AUTH)
        operational=(
            'import crypto from "node:crypto";\n'
            'import { TrialUnavailableError } from "./access-history.js";\n'
            'import { browserDirectPlayback } from "./browser-direct.js";\n'
        )
        actual=base.replace(SERVER_PATH_IMPORT,SERVER_PATH_IMPORT+operational,1)
        expected=changed.replace(QR_SERVER_IMPORTS,QR_SERVER_IMPORTS+operational,1)
        self.assertEqual(m.merge_source(path,base,changed,actual),expected)
        with self.assertRaises(m.GateError): m.merge_text(base,changed,actual)

    def test_repository_existing_pool_import_preserves_operational_imports(self):
        revision=m.git(ROOT,'rev-parse','HEAD').decode().strip()
        path='apps/api/src/repository.ts'
        base=m.blob(ROOT,m.BASE,path).decode()
        changed=m.blob(ROOT,revision,path).decode()
        old='import { query, withTransaction } from "./db.js";\n'
        new='import { pool, query, withTransaction } from "./db.js";\n'
        extra='import { ReferralStore } from "./referral-store.js";\n'
        actual=base.replace(old,new,1)+extra
        self.assertEqual(m.merge_source(path,base,changed,actual),changed+extra)

    def test_server_import_anchor_must_be_exact_and_unique(self):
        base=SERVER_PATH_IMPORT+'import { readFile } from "node:fs/promises";\nbody();\n'
        changed=base.replace(SERVER_PATH_IMPORT,SERVER_PATH_IMPORT+QR_SERVER_IMPORTS,1)
        for actual in (base.replace(SERVER_PATH_IMPORT,''),base+SERVER_PATH_IMPORT):
            with self.subTest(actual=actual), self.assertRaises(m.GateError):
                m.merge_source('apps/api/src/server.ts',base,changed,actual)

    def test_server_conflicting_qr_imports_are_rejected(self):
        base=SERVER_PATH_IMPORT+'import { readFile } from "node:fs/promises";\nbody();\n'
        changed=base.replace(SERVER_PATH_IMPORT,SERVER_PATH_IMPORT+QR_SERVER_IMPORTS,1)
        for conflict in (
            'import { DeviceLoginStore as ExistingStore } from "./device-login-store.js";\n',
            'import { randomUUID } from "node:crypto";\n',
        ):
            with self.subTest(conflict=conflict), self.assertRaises(m.GateError):
                m.merge_source('apps/api/src/server.ts',base,changed,base+conflict)

    def test_server_canonical_import_shape_is_required(self):
        base=SERVER_PATH_IMPORT+'import { readFile } from "node:fs/promises";\nbody();\n'
        changed=base.replace(SERVER_PATH_IMPORT,SERVER_PATH_IMPORT+QR_SERVER_IMPORTS,1)
        for invalid in (changed.replace('randomUUID','randomBytes'),changed.replace(QR_SERVER_IMPORTS,QR_SERVER_IMPORTS+'unexpected();\n')):
            with self.subTest(changed=invalid), self.assertRaises(m.GateError):
                m.merge_source('apps/api/src/server.ts',base,invalid,base)

    def test_repository_conflicting_pool_import_is_rejected(self):
        base='head\nimport { query, withTransaction } from "./db.js";\nimport { env } from "./env.js";\ntail\n'
        changed=base.replace('import { query, withTransaction } from "./db.js";\n',
            'import { pool, query, withTransaction } from "./db.js";\nimport { DeviceLoginStore } from "./device-login-store.js";\n')
        actual=base.replace('query, withTransaction','pool, query')
        with self.assertRaises(m.GateError): m.merge_source('apps/api/src/repository.ts',base,changed,actual)

    def test_actual_reviewed_hunks_preserve_operational_routes(self):
        revision=m.git(ROOT,'rev-parse','HEAD').decode().strip()
        for path in m.MODIFIED:
            base=m.blob(ROOT,m.BASE,path).decode(); changed=m.blob(ROOT,revision,path).decode()
            if path.endswith('server.ts'):
                base=base.replace(m.OLD_AUTH,m.NEW_AUTH); changed=changed.replace(m.OLD_AUTH,m.NEW_AUTH)
            extras='\n// Offline operational preservation sentinel\nconst operationalSentinel = 1;\n'
            actual=base+extras
            self.assertEqual(m.merge_text(base,changed,actual),changed+extras)

    def test_dependency_merge_preserves_overlay_dependencies(self):
        revision=m.git(ROOT,'rev-parse','HEAD').decode().strip()
        bp,np=(m.blob(ROOT,r,m.PACKAGE) for r in (m.BASE,revision))
        bl,nl=(m.blob(ROOT,r,m.LOCK) for r in (m.BASE,revision))
        ap=json.loads(bp); ap['dependencies']['stripe']='operational-pin'
        al=json.loads(bl); al['packages']['node_modules/stripe']={'version':'operational-pin'}
        updates=m.dependencies(bp,np,json.dumps(ap),bl,nl,json.dumps(al))
        self.assertEqual(json.loads(updates[m.PACKAGE])['dependencies']['stripe'],'operational-pin')
        self.assertEqual(json.loads(updates[m.LOCK])['packages']['node_modules/stripe'],{'version':'operational-pin'})

    def test_unrelated_package_change_rejected(self):
        revision=m.git(ROOT,'rev-parse','HEAD').decode().strip()
        bp,np=(m.blob(ROOT,r,m.PACKAGE) for r in (m.BASE,revision))
        bl,nl=(m.blob(ROOT,r,m.LOCK) for r in (m.BASE,revision))
        changed=json.loads(np); changed['scripts']['build']='different'
        with self.assertRaises(m.GateError): m.dependencies(bp,json.dumps(changed),bp,bl,nl,bl)

    def test_unverified_tarball_rejected(self):
        with self.assertRaises(m.GateError): m.tar_files(b'unverified archive')

if __name__=='__main__': unittest.main()
