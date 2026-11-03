import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('qr_merge',HERE/'merge.py')
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ROOT=HERE.parents[2]

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
