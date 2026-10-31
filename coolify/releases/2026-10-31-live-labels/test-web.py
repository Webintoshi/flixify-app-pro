"""Offline contracts for removing raw provider labels from web UI only."""
import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(safe_load=json.loads, YAMLError=ValueError))
HERE = Path(__file__).parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


web = load("live_labels_builder_contract", HERE / "build-web.py") if (HERE / "build-web.py").exists() else None
release = load("live_labels_release_contract", HERE / "release-web.py") if (HERE / "release-web.py").exists() else None
prior = load("live_labels_reviewed_contracts", HERE.parent / "2026-10-31-home-2026" / "test-web.py")
prior.web, prior.release = web.reviewed if web else None, release


class LabelSourceTests(prior.SourceTests):
    def test_rejects_shared_contract_api_and_worker_changes(self):
        for path in ("packages/contracts/src/index.ts", "apps/api/src/server.ts", "apps/worker/src/main.ts"):
            f = prior.Fixture()
            self.addCleanup(f.close)
            f.put(path, b"outside label-only publication\n")
            revision = f.commit()
            with self.subTest(path=path), patch.object(web.reviewed, "BASE_REVISION", f.base), self.assertRaisesRegex(web.GateError, "outside_lineup_scope"):
                web.validate_source_scope(f.repo, revision)


class LabelBuildTests(prior.BuildTests):
    def test_new_image_paths_reject_existing_leaves_and_symlink_ancestors(self):
        self.assertEqual(web.NEW_PATHS, ())
        fixture = prior.Fixture()
        self.addCleanup(fixture.close)
        fixture.put("apps/ops-web/app/platform/unreviewed-label-helper.ts", b"new runtime leaves are forbidden\n")
        revision = fixture.commit()
        with patch.object(web.reviewed, "BASE_REVISION", fixture.base), self.assertRaisesRegex(web.GateError, "outside_lineup_scope"):
            web.validate_source_scope(fixture.repo, revision)

    def test_pins_and_exclusions_keep_apks_public_and_dependencies_untouched(self):
        self.assertEqual(web.BASE_REVISION, "cbc90d6f846197122494afcb895fab55be522873")
        self.assertEqual(web.SOURCE_TAG, "flixify-ops-web:turkey-lineup-cbc90d6f8461-20261031")
        self.assertEqual(web.SOURCE_ID, "sha256:6fae8e37970359c91fbc3c9eb80739aa3c23212ad3e253676694565084b864c8")
        paths = ("apps/ops-web/app/canli-tv/page.tsx", "apps/ops-web/app/platform/catalog.tsx", "apps/ops-web/app/platform/catalog-search.tsx")
        self.assertEqual(web.PATHS, paths)
        self.assertEqual(web.NEW_PATHS, ())
        self.assertEqual(web.EXCLUDED, (*paths, "apps/ops-web/.next"))
        for module in (web.reviewed, web.reviewed.reviewed, web.builder):
            self.assertEqual((module.SOURCE_ID, module.BASE_REVISION), (web.SOURCE_ID, web.BASE_REVISION))
            self.assertEqual((module.PATHS, module.NEW_PATHS), (paths, ()))
            self.assertEqual(module.target("a" * 40), web.target("a" * 40))
        self.assertEqual(web.reviewed.TOOLS, web.TOOLS)
        self.assertEqual(web.reviewed.reviewed.EXCLUDED, web.EXCLUDED)
        self.assertEqual((web.builder.MIN_FREE_BYTES, web.builder.RUN_MEMORY_MIB, web.builder.RUN_TOTAL_MEMORY_MIB), (8 * 1024**3, 1280, 1536))
        self.assertEqual(web.target("a" * 40), "flixify-ops-web:live-labels-aaaaaaaaaaaa-20261031")
        self.assertEqual((web.APK_SHA256, web.APK_BYTES), ("1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f", 1355944))
        for value in ("HEAD", "main", "a" * 12):
            with self.subTest(value=value), self.assertRaises(web.GateError):
                web.target(value)

    def test_current_download_check_keeps_144_and_full_public_tree_unchanged(self):
        manifest = json.dumps({"packageName": "vip.flixify.tv", "versionName": "1.4.4", "versionCode": 12, "minSdk": 23, "apkUrl": "https://flixify.vip/downloads/flixify-pro-1.4.4.apk", "sha256": web.APK_SHA256, "sizeBytes": web.APK_BYTES, "notes": "unchanged"}).encode()
        script = web.reviewed.current_publication.download_verification_script(web.APK_SHA256, web.APK_BYTES, manifest)
        self.assertIn('j.versionName!=="1.4.4"||j.versionCode!==12', script)
        self.assertIn("http://127.0.0.1:3000/downloads/flixify-pro-1.4.4.apk", script)
        for path in ("apps/ops-web/public/downloads/flixify-pro-1.4.4.apk", "apps/ops-web/public/downloads/flixify-pro-1.4.3.apk", web.UPDATE_MANIFEST, "node_modules"):
            self.assertNotIn(path, web.EXCLUDED)


class LabelReleaseTests(prior.ReleaseTests):
    def test_current_source_is_the_only_rollback_target(self):
        self.assertEqual((release.SOURCE_TAG, release.SOURCE_ID), (web.SOURCE_TAG, web.SOURCE_ID))
        self.assertEqual(release.target("a" * 40), web.target("a" * 40))


class LabelTransactionTests(prior.TransactionTests):
    pass


if __name__ == "__main__":
    unittest.main()
