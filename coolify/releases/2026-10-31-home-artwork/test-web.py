"""Offline contracts for the three-file homepage artwork patch."""
import contextlib
import importlib.util
import io
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(safe_load=__import__("json").loads, YAMLError=ValueError))
HERE = Path(__file__).parent

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

web = load("artwork_patch_build_contract", HERE / "build-web.py") if (HERE / "build-web.py").exists() else None
release = load("artwork_patch_release_contract", HERE / "release-web.py") if (HERE / "release-web.py").exists() else None
prior_tests = load("artwork_patch_reviewed_contracts", HERE.parent / "2026-10-31-home-2026" / "test-web.py")
prior_tests.web, prior_tests.release = web.reviewed if web else None, release

class PatchSourceTests(prior_tests.SourceTests):
    pass

class PatchTransactionTests(prior_tests.TransactionTests):
    pass

class PatchPinsTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(web, "artwork patch build adapter must exist")
        self.assertIsNotNone(release, "artwork patch release adapter must exist")

    def test_current_home_is_the_only_source_and_rollback_target(self):
        self.assertEqual(web.BASE_REVISION, "cca30ce96a9137b85c40e32aed9cbce7d12c3e72")
        self.assertEqual(web.SOURCE_TAG, "flixify-ops-web:home-2026-cca30ce96a91-20261031")
        self.assertEqual(web.SOURCE_ID, "sha256:4f0fb47292ddac6232bb302d7b82f1b26820d02c62e84ddc0fea152b7fe4e7bb")
        self.assertEqual((release.SOURCE_TAG, release.SOURCE_ID), (web.SOURCE_TAG, web.SOURCE_ID))
        self.assertEqual(web.target("a" * 40), "flixify-ops-web:home-artwork-aaaaaaaaaaaa-20261031")
        self.assertEqual(release.target("a" * 40), web.target("a" * 40))
        for value in ("HEAD", "a" * 12, "latest"):
            with self.assertRaises(web.GateError): web.target(value)
            with self.assertRaises(release.GateError): release.target(value)

    def test_only_three_existing_files_are_overlaid_and_public_and_dependencies_are_included(self):
        paths = tuple("apps/ops-web/app/platform/" + name for name in ("catalog.tsx", "homepage-showcase.ts", "homepage-hero.tsx"))
        self.assertEqual(web.PATHS, paths)
        self.assertEqual(web.NEW_PATHS, ())
        self.assertEqual(web.EXCLUDED, (*paths, "apps/ops-web/.next"))
        for module in (web.reviewed, web.reviewed.reviewed, web.builder):
            self.assertEqual(module.SOURCE_ID, web.SOURCE_ID)
            self.assertEqual(module.BASE_REVISION, web.BASE_REVISION)
            self.assertEqual(module.PATHS, paths)
            self.assertEqual(module.NEW_PATHS, ())
            self.assertEqual(module.target("a" * 40), web.target("a" * 40))
        self.assertEqual(web.reviewed.reviewed.EXCLUDED, web.EXCLUDED)
        self.assertEqual((web.builder.MIN_FREE_BYTES, web.builder.RUN_MEMORY_MIB, web.builder.RUN_TOTAL_MEMORY_MIB), (8 * 1024**3, 1280, 1536))

    def test_new_runtime_files_are_rejected_even_if_existing_three_changes_are_valid(self):
        f = prior_tests.Fixture()
        self.addCleanup(f.close)
        f.put("apps/ops-web/app/platform/unreviewed-new.ts", b"new runtime is outside artwork patch\n")
        revision = f.commit()
        with patch.object(web.reviewed, "BASE_REVISION", f.base), self.assertRaisesRegex(web.GateError, "runtime_scope_differs"):
            web.validate_source_scope(f.repo, revision)

    def test_fresh_independent_fingerprint_is_required_before_any_host_read(self):
        for sha, count in ((None, 1), ("HEAD", 1), ("a" * 64, 0), ("a" * 64, True)):
            with self.subTest(sha=sha, count=count), patch.object(web.reviewed, "protected_snapshot") as host, self.assertRaisesRegex(web.GateError, "independent_source_fingerprint_required"):
                web.preflight(Path("/not-read"), "a" * 40, web.API_TAG, web.API_ID, sha, count)
            host.assert_not_called()

    def test_release_changes_only_web_preserving_protected_api_and_existing_isolation(self):
        release.configure("a" * 40, "sha256:" + "b" * 64, release.API_TAG, release.API_ID)
        self.assertEqual(release.guard.CHANGED, ("ops-web",))
        self.assertEqual(release.guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(release.guard.SOURCE_IDS, {"ops-web": web.SOURCE_ID})
        self.assertEqual(release.guard.TARGET, {"ops-web": web.target("a" * 40)})
        self.assertEqual(release.guard.PROTECTED_IMAGES["api"], (release.API_TAG, release.API_ID))
        self.assertNotIn("isolateRegistrationGuard", release.guard.PHP_APPLY)
        with self.assertRaisesRegex(release.GateError, "accepted_protected_api_pins_required"):
            release.configure("a" * 40, "sha256:" + "b" * 64, "unreviewed", "sha256:" + "f" * 64)

if __name__ == "__main__":
    unittest.main()
