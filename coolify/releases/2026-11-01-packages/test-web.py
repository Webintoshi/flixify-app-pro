"""Offline exact-source and publication contracts for the package selector."""
import copy
import hashlib
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


web = load("packages_web_contract", HERE / "build-web.py") if (HERE / "build-web.py").exists() else None
release = load("packages_release_contract", HERE / "release-web.py") if (HERE / "release-web.py").exists() else None
prior = load("packages_common_contracts", HERE.parent / "2026-10-31-home-2026" / "test-web.py")
prior.web, prior.release = web.reviewed if web else None, release


class PackagesSourceTests(prior.SourceTests):
    def test_api_and_catalog_changes_are_not_website_overlays(self):
        f = prior.Fixture()
        self.addCleanup(f.close)
        for path in ("apps/api/src/demo-store.ts", "supabase/migrations/202611010001_single_dual_packages.sql"):
            f.put(path, b"separately reviewed backend source\n")
        revision = f.commit()
        with patch.object(web.reviewed, "BASE_REVISION", f.base):
            web.validate_source_scope(f.repo, revision)
        self.assertFalse(any(path.startswith(("apps/api/", "supabase/")) for path in web.PATHS))

    def test_rejects_any_extra_component_or_nested_symlink(self):
        for path in ("apps/ops-web/components/ui/extra.tsx", "apps/ops-web/components/extra.tsx"):
            f = prior.Fixture()
            self.addCleanup(f.close)
            f.put(path, b"unreviewed component\n")
            revision = f.commit()
            with patch.object(web.reviewed, "BASE_REVISION", f.base), self.assertRaises(web.GateError):
                web.validate_source_scope(f.repo, revision)


class PackagesBuildTests(prior.BuildTests):
    def test_pins_and_exclusions_keep_apks_public_and_dependencies_untouched(self):
        self.assertEqual(web.BASE_REVISION, "2f39237f8200d8258c9d662b2a45c0ff5a1e3a58")
        self.assertEqual(web.SOURCE_TAG, "flixify-ops-web:tvplus-lineup-2f39237f8200-20261031")
        self.assertEqual(web.SOURCE_ID, "sha256:94078bed2ba04e00ddef43a358b4c1526f4e5c58c636d0954f86f2e833de979a")
        self.assertEqual(web.target("a" * 40), "flixify-ops-web:packages-aaaaaaaaaaaa-20261101")
        self.assertEqual(set(web.EXCLUDED), set((*web.APP_PATHS, web.COMPONENT_ROOT, "apps/ops-web/.next")))
        self.assertEqual(len(web.COMPONENT_PATHS), 4)
        self.assertEqual(len(web.PATHS), 10)
        self.assertEqual((web.builder.MIN_FREE_BYTES, web.builder.RUN_MEMORY_MIB, web.builder.RUN_TOTAL_MEMORY_MIB), (8 * 1024**3, 1280, 1536))
        for path in ("node_modules", "apps/ops-web/public", "apps/ops-web/package.json", web.UPDATE_MANIFEST):
            self.assertNotIn(path, web.EXCLUDED)
        for value in ("HEAD", "main", "a" * 12):
            with self.assertRaises(web.GateError):
                web.target(value)

    def test_candidate_must_preserve_full_public_tree_and_untouched_fingerprint(self):
        before = {"sha256": "c" * 64, "files": 9}
        public = b'[["dir","",493]]'
        updates = dict.fromkeys(web.COMPONENT_PATHS, b"reviewed component")
        expected = web.expected_component_manifest(updates)
        for changed in ("none", "public", "untouched", "components"):
            tree = public if changed != "public" else b'[]'
            untouched = before if changed != "untouched" else {"sha256": "e" * 64, "files": 9}
            components = expected if changed != "components" else expected + [["file", "ui/extra.tsx", 420, 1, "f" * 64]]
            with self.subTest(changed=changed), patch.object(web.builder, "verify_candidate", return_value=prior.CANDIDATE), patch.object(web.reviewed, "untouched", return_value=untouched), patch.object(web.reviewed, "public_manifest", return_value=tree), patch.object(web.reviewed, "verify_download"), patch.object(web, "component_manifest", return_value=components):
                if changed == "none":
                    self.assertEqual(web.verify_candidate({}, prior.REVISION, updates, {}, b"config", public, before, b"manifest"), prior.CANDIDATE)
                else:
                    with self.assertRaises(web.GateError):
                        web.verify_candidate({}, prior.REVISION, updates, {}, b"config", public, before, b"manifest")

    def test_compiler_failure_removes_only_owned_bounded_network_none_container(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:3] == ("docker", "start", "--attach"):
                raise web.GateError("fixture compile failure")
            return b""
        updates = dict.fromkeys(web.PATHS, b"reviewed source")
        with patch.object(web.reviewed.reviewed, "command", side_effect=command), self.assertRaises(web.GateError):
            web.container_compile(prior.REVISION, {"Config": {"Cmd": ["node", "server.js"]}}, updates, {})
        create = next(args for args in calls if args[:2] == ("docker", "create"))
        self.assertEqual(create[create.index("--network") + 1], "none")
        self.assertEqual(create[create.index("--memory") + 1], "1280m")
        self.assertEqual(create[create.index("--memory-swap") + 1], "1536m")
        owned = create[create.index("--name") + 1]
        self.assertEqual([args for args in calls if args[:3] == ("docker", "rm", "--force")], [("docker", "rm", "--force", owned)])
        self.assertFalse(any("prune" in args for args in calls))

    def test_component_manifest_requires_exact_files_modes_and_content(self):
        updates = {path: ("source:" + path).encode() for path in web.COMPONENT_PATHS}
        expected = web.expected_component_manifest(updates)
        self.assertEqual(expected[:2], [["dir", "", 0o755], ["dir", "ui", 0o755]])
        for row in expected[2:]:
            value = updates[web.COMPONENT_ROOT + "/" + row[1]]
            self.assertEqual(row[2:], [0o644, len(value), hashlib.sha256(value).hexdigest()])
        for changed in ("extra", "symlink", "mode", "digest"):
            actual = copy.deepcopy(expected)
            if changed == "extra": actual.append(["file", "ui/extra.tsx", 420, 1, "f" * 64])
            if changed == "symlink": actual[2] = ["link", actual[2][1], 511, "/outside"]
            if changed == "mode": actual[2][2] = 0o777
            if changed == "digest": actual[2][-1] = "f" * 64
            with self.subTest(changed=changed), patch.object(web, "component_manifest", return_value=actual), self.assertRaisesRegex(web.GateError, "component_manifest_differs"):
                web.verify_components(prior.CANDIDATE, updates)

    def test_app_builder_manifest_never_expands_to_components_or_dependencies(self):
        self.assertEqual(set(web.PATHS), set((*web.APP_PATHS, *web.COMPONENT_PATHS)))
        for path in web.COMPONENT_PATHS:
            self.assertTrue(path.startswith(web.COMPONENT_ROOT + "/ui/"))
        self.assertFalse(any(path.endswith("package.json") for path in web.PATHS))

    def test_compile_copies_only_reviewed_sources_and_exact_new_tree(self):
        calls, copied = [], {}
        updates = {path: ("reviewed:" + path).encode() for path in web.PATHS}
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "cp"):
                source = Path(args[2])
                if source.is_file():
                    copied[args[3].split(":/app/")[1]] = source.read_bytes()
                else:
                    self.assertEqual(source.stat().st_mode & 0o777, 0o755)
                    self.assertEqual((source / "ui").stat().st_mode & 0o777, 0o755)
                    leaves = sorted(path.relative_to(source).as_posix() for path in source.rglob("*") if path.is_file())
                    self.assertEqual(leaves, ["ui/package-checkout.module.css", "ui/package-checkout.tsx", "ui/pricing.module.css", "ui/pricing.tsx"])
                    for relative in leaves:
                        file = source / relative
                        self.assertEqual(file.stat().st_mode & 0o777, 0o644)
                        copied[web.COMPONENT_ROOT + "/" + relative] = file.read_bytes()
            if args[:3] == ("docker", "inspect", "--format"):
                return b"0"
            return b""
        with patch.object(web.reviewed.reviewed, "command", side_effect=command):
            web.container_compile(prior.REVISION, {"Config": {"Cmd": ["node", "server.js"]}}, updates, {})
        self.assertEqual(copied, updates)
        self.assertEqual(sum(args[:2] == ("docker", "commit") for args in calls), 1)
        self.assertFalse(any(args[:2] == ("docker", "run") for args in calls))


class PackagesReleaseTests(prior.ReleaseTests):
    def test_current_source_is_the_only_rollback_target(self):
        self.assertEqual((release.SOURCE_TAG, release.SOURCE_ID), (web.SOURCE_TAG, web.SOURCE_ID))
        self.assertEqual(release.target(prior.REVISION), web.target(prior.REVISION))


class PackagesTransactionTests(prior.TransactionTests):
    pass


if __name__ == "__main__":
    unittest.main()
