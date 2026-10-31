"""Offline source, artifact and website-only Turkey lineup release contracts."""
import contextlib
import hashlib
import importlib.util
import io
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


web = load("turkey_lineup_builder_contract", HERE / "build-web.py") if (HERE / "build-web.py").exists() else None
release = load("turkey_lineup_release_contract", HERE / "release-web.py") if (HERE / "release-web.py").exists() else None
prior = load("turkey_lineup_reviewed_contracts", HERE.parent / "2026-10-31-home-2026" / "test-web.py")
prior.web, prior.release = web, release


class LineupSourceTests(prior.SourceTests):
    def test_rejects_api_worker_and_shared_contract_runtime_changes(self):
        for path in ("apps/api/src/server.ts", "apps/worker/src/main.ts", "packages/contracts/src/index.ts"):
            f = prior.Fixture()
            self.addCleanup(f.close)
            f.put(path, b"outside web-only lineup\n")
            revision = f.commit()
            with self.subTest(path=path), patch.object(web, "BASE_REVISION", f.base), self.assertRaisesRegex(web.GateError, "outside_lineup_scope"):
                web.validate_source_scope(f.repo, revision)


class LineupBuildTests(prior.BuildTests):
    def test_pins_and_exclusions_keep_apks_public_and_dependencies_untouched(self):
        self.assertEqual(web.BASE_REVISION, "dd8d7a16c2002c47dc80537cf777155ec7fc622c")
        self.assertEqual(web.SOURCE_TAG, "flixify-ops-web:live-curation-dd8d7a16c200-20261031")
        self.assertEqual(web.SOURCE_ID, "sha256:73a348089680a50ec4b341a6ea1586c2399565fe18ad659e158d3519e436ff9c")
        self.assertEqual(web.PATHS, ("apps/ops-web/app/canli-tv/live-channel-catalog.ts", "apps/ops-web/app/canli-tv/page.tsx", "apps/ops-web/app/platform/catalog.tsx", "apps/ops-web/app/platform/live-channel-lineup.ts"))
        self.assertEqual(web.NEW_PATHS, (web.PATHS[3],))
        self.assertNotIn("apps/ops-web/app/platform/catalog.tsx", web.NEW_PATHS)
        self.assertEqual(web.EXCLUDED, (*web.PATHS, "apps/ops-web/.next"))
        self.assertEqual((web.builder.MIN_FREE_BYTES, web.builder.RUN_MEMORY_MIB, web.builder.RUN_TOTAL_MEMORY_MIB), (8 * 1024**3, 1280, 1536))
        self.assertEqual(web.target("a" * 40), "flixify-ops-web:turkey-lineup-aaaaaaaaaaaa-20261031")
        self.assertEqual(web.APK_SHA256, "1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f")
        self.assertEqual(web.APK_BYTES, 1355944)
        for value in ("HEAD", "main", "a" * 12):
            with self.subTest(value=value), self.assertRaises(web.GateError):
                web.target(value)

    def test_current_download_verifier_keeps_144_and_143_public_bytes_immutable(self):
        manifest = json.dumps({"packageName": "vip.flixify.tv", "versionName": "1.4.4", "versionCode": 12, "minSdk": 23, "apkUrl": "https://flixify.vip/downloads/flixify-pro-1.4.4.apk", "sha256": web.APK_SHA256, "sizeBytes": web.APK_BYTES, "notes": "unchanged"}).encode()
        script = web.current_publication.download_verification_script(web.APK_SHA256, web.APK_BYTES, manifest)
        self.assertIn('j.versionName!=="1.4.4"||j.versionCode!==12', script)
        self.assertIn("http://127.0.0.1:3000/downloads/flixify-pro-1.4.4.apk", script)
        self.assertNotIn('j.versionName!=="1.4.3"', script)
        for path in ("apps/ops-web/public/downloads/flixify-pro-1.4.4.apk", "apps/ops-web/public/downloads/flixify-pro-1.4.3.apk", web.UPDATE_MANIFEST, "node_modules"):
            self.assertNotIn(path, web.EXCLUDED)


class LineupReleaseTests(prior.ReleaseTests):
    def test_release_and_rollback_pins_are_the_current_live_website(self):
        self.assertIsNotNone(release)
        self.assertEqual((release.SOURCE_TAG, release.SOURCE_ID), (web.SOURCE_TAG, web.SOURCE_ID))
        self.assertEqual(release.target("a" * 40), web.target("a" * 40))


class LineupTransactionTests(prior.TransactionTests):
    pass


if __name__ == "__main__":
    unittest.main()
