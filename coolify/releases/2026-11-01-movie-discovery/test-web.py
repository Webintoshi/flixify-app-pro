"""Offline source, public artifact and protected transaction contracts."""
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(safe_load=json.loads, YAMLError=ValueError))
HERE = Path(__file__).parent
REVISION = "a" * 40
CANDIDATE = "sha256:" + "b" * 64


def load(name, file):
    if not file.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


web = load("discovery_web_contract", HERE / "build-web.py")
release = load("discovery_release_contract", HERE / "release-web.py")


class Fixture:
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix="flixify-discovery-contract-")
        self.repo = Path(self.directory.name)
        self.git("init", "-q")
        self.git("config", "user.email", "offline@example.invalid")
        self.git("config", "user.name", "Offline Contract")
        for path in set(web.PATHS) - set(web.NEW_PATHS):
            self.put(path, ("original:" + path).encode())
        self.put(web.builder.CONFIG, b'import type { NextConfig } from "next";\nconst nextConfig: NextConfig = {};\nexport default nextConfig;\n')
        self.put("apps/ops-web/components/ui/package-checkout.tsx", b"preserved embedded_page SDK\n")
        self.base = self.commit()
        for path in web.PATHS:
            self.put(path, ("reviewed:" + path).encode())

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def put(self, path, value):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(web, "reviewed movie-discovery build profile is required")

    def test_current_payment_release_is_the_exact_source_and_only_five_leaves_are_excluded(self):
        self.assertEqual(web.BASE_REVISION, "b0def990e266c133acabd859e3de6e3638ee9751")
        self.assertEqual(web.SOURCE_ID, "sha256:3f123ce5af46e71106221917cd4eeb175d60e3ba8a3218834629bf316c814bf6")
        self.assertEqual(len(web.PATHS), 5)
        self.assertEqual(len(web.NEW_PATHS), 3)
        self.assertEqual(set(web.EXCLUDED), {*web.PATHS, "apps/ops-web/.next"})
        for path in ("node_modules", "apps/ops-web/components", "apps/ops-web/public", "apps/ops-web/app/paketler/page.tsx", "apps/ops-web/app/odeme-sonucu/page.tsx"):
            self.assertNotIn(path, web.EXCLUDED)
        self.assertEqual(web.target(REVISION), "flixify-ops-web:movie-discovery-aaaaaaaaaaaa-20261101")
        for revision in ("HEAD", "main", "a" * 12, None):
            with self.assertRaises(web.GateError): web.target(revision)

    def test_only_five_runtime_leaves_and_regular_tests_plan_and_guard_docs_are_allowed(self):
        f = Fixture(); self.addCleanup(f.directory.cleanup)
        for path in ("apps/ops-web/app/platform/movie-showcase.test.ts", "docs/plans/movie-discovery.md", "coolify/releases/2026-11-01-movie-discovery/README.md"):
            f.put(path, b"reviewed\n")
        revision = f.commit()
        with patch.object(web, "BASE_REVISION", f.base): web.validate_source_scope(f.repo, revision)

    def test_payment_api_apk_dependencies_native_and_unlisted_components_cannot_change(self):
        for path in ("apps/ops-web/components/ui/package-checkout.tsx", "apps/ops-web/app/paketler/page.tsx", "apps/ops-web/app/odeme-sonucu/page.tsx", "apps/ops-web/public/downloads/flixify-pro-1.4.4.apk", "apps/ops-web/package.json", "apps/api/src/server.ts", "apps/tv-android/app/build.gradle", "coolify/releases/2026-11-01-packages/api-source/stripe-billing-api.ts", "packages/shared/src/changed.ts"):
            with self.subTest(path=path):
                f = Fixture(); self.addCleanup(f.directory.cleanup)
                f.put(path, b"unreviewed\n"); revision = f.commit()
                with patch.object(web, "BASE_REVISION", f.base), self.assertRaises(web.GateError): web.validate_source_scope(f.repo, revision)

    def test_missing_reviewed_leaf_and_new_file_symlink_are_rejected(self):
        f = Fixture(); self.addCleanup(f.directory.cleanup)
        (f.repo / web.NEW_PATHS[0]).unlink()
        revision = f.commit()
        with patch.object(web, "BASE_REVISION", f.base), self.assertRaises(web.GateError): web.validate_source_scope(f.repo, revision)
        (f.repo / web.NEW_PATHS[0]).symlink_to("/outside")
        revision = f.commit()
        with patch.object(web, "BASE_REVISION", f.base), self.assertRaises(web.GateError): web.validate_source_scope(f.repo, revision)


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(web, "reviewed movie-discovery build profile is required")

    def test_bounded_compiler_copies_exact_five_files_and_removes_only_owned_container_on_failure(self):
        calls, copied = [], {}
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "cp"):
                copied[args[3].split(":/app/")[1]] = Path(args[2]).read_bytes()
            if args[:3] == ("docker", "start", "--attach"): raise web.GateError("fixture")
            return b""
        updated = {path: ("reviewed:" + path).encode() for path in web.PATHS}
        with patch.object(web.reviewed.reviewed, "command", side_effect=command), self.assertRaises(web.GateError):
            web.container_compile(REVISION, {"Config": {"Cmd": ["node", "server"]}}, updated, {})
        create = next(row for row in calls if row[:2] == ("docker", "create"))
        self.assertEqual([create[create.index(key) + 1] for key in ("--network", "--memory", "--memory-swap", "--pids-limit")], ["none", "1280m", "1536m", "256"])
        self.assertEqual(copied, updated)
        owned = create[create.index("--name") + 1]
        self.assertEqual([row for row in calls if row[:3] == ("docker", "rm", "--force")], [("docker", "rm", "--force", owned)])
        self.assertFalse(any("prune" in row for row in calls))

    def test_compiler_rejects_added_leaf_before_any_docker_action(self):
        with patch.object(web.reviewed.reviewed, "command") as command, self.assertRaises(web.GateError):
            web.container_compile(REVISION, {"Config": {"Cmd": ["node"]}}, {**dict.fromkeys(web.PATHS, b"reviewed"), "extra": b"bad"}, {})
        command.assert_not_called()

    def test_full_host_snapshot_adds_all_project_and_registration_fence_protection(self):
        with patch.object(web, "original_protected_snapshot", return_value={"services": "exact"}), patch.object(web.backend, "host_snapshot", return_value={"registrationFence": "same", "external": "pinned"}):
            self.assertEqual(web.protected_snapshot(web.API_TAG, web.API_ID), {"services": {"services": "exact"}, "host": {"registrationFence": "same", "external": "pinned"}})

    def test_public_tree_and_untouched_fingerprint_are_required_before_download_verification(self):
        before = {"sha256": "c" * 64, "files": 9}
        public = b'[["dir","",493]]'
        for mutation in (None, "public", "untouched"):
            actual = before if mutation != "untouched" else {"sha256": "e" * 64, "files": 9}
            with patch.object(web.builder, "verify_candidate", return_value=CANDIDATE), patch.object(web.reviewed, "untouched", return_value=actual), patch.object(web.reviewed, "public_manifest", return_value=(public if mutation != "public" else b"[]")), patch.object(web.reviewed, "verify_download") as download:
                if mutation:
                    with self.assertRaises(web.GateError): web.verify_candidate({}, REVISION, {}, {}, b"config", public, before, b"manifest")
                    download.assert_not_called()
                else:
                    self.assertEqual(web.verify_candidate({}, REVISION, {}, {}, b"config", public, before, b"manifest"), CANDIDATE)
                    download.assert_called_once_with(CANDIDATE, "1c39269832a326935ce6b3911c7b3b9487150b72f182e251c30c82b4fb66f68f", 1355944, b"manifest")

    def test_resources_and_next_config_restoration_are_retained(self):
        self.assertEqual(web.builder.MIN_FREE_BYTES, 8 * 1024**3)
        script = web.builder.build_script()
        for text in ("build_cgroup_limit_exceeds_cap", "webpackBuildWorker", "config.cache = false", "finally", "next_config_restore_failed"):
            self.assertIn(text, script)

    def test_inherited_preflight_checks_two_existing_sources_and_exact_three_new_absences(self):
        f = Fixture(); self.addCleanup(f.directory.cleanup)
        revision = f.commit()
        original_command = web.builder.command
        base = {"Id": web.SOURCE_ID, "Config": {"Cmd": ["node", "server"]}}
        current = {"Image": web.SOURCE_ID, "State": {"Running": True}, "Config": {"Image": web.SOURCE_TAG, "Labels": {"com.docker.compose.project": web.core.UUID}, "Env": [key + "=fixture" for key in web.builder.PUBLIC_WEB_KEYS]}}
        def command(*args, **kwargs):
            if args[:2] == ("docker", "inspect"): return json.dumps([current]).encode()
            return original_command(*args, **kwargs)
        def image_file(image, path):
            self.assertEqual(image, web.SOURCE_ID)
            return subprocess.check_output(["git", "-C", str(f.repo), "show", f.base + ":" + path])
        with patch.object(web.builder, "BASE_REVISION", f.base), patch.object(web.builder.core, "image", return_value=base), patch.object(web.builder, "command", side_effect=command), patch.object(web.builder, "image_file", side_effect=image_file) as image, patch.object(web.builder, "require_image_absent") as absent:
            actual_base, updated, env, config = web.builder.preflight(f.repo, revision)
        self.assertEqual(actual_base, base)
        self.assertEqual(updated, {path: (f.repo / path).read_bytes() for path in web.PATHS})
        self.assertEqual({call.args[0] for call in absent.call_args_list}, set(web.NEW_PATHS))
        self.assertEqual({call.args[1] for call in image.call_args_list}, (set(web.PATHS) - set(web.NEW_PATHS)) | {web.builder.CONFIG})
        self.assertEqual(env, dict.fromkeys(web.builder.PUBLIC_WEB_KEYS, "fixture"))
        self.assertEqual(config, (f.repo / web.builder.CONFIG).read_bytes())


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(release, "reviewed movie-discovery transaction is required")

    def test_only_web_changes_and_current_api_worker_and_original_fence_are_protected(self):
        release.configure(REVISION, CANDIDATE, release.API_TAG, release.API_ID)
        guard = release.guard
        self.assertEqual(guard.CHANGED, ("ops-web",))
        self.assertEqual(guard.SOURCE_IDS, {"ops-web": web.SOURCE_ID})
        self.assertEqual(guard.PROTECTED_IMAGES, {"api": (web.API_TAG, web.API_ID), "worker": (web.WORKER_TAG, web.WORKER_ID)})
        self.assertEqual(release.reviewed.reviewed.builder.API_ID, "sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6")
        self.assertIs(guard.validate_plan, release.reviewed.reviewed.validate_plan)

    def test_stale_api_pin_and_non_exact_candidate_are_rejected(self):
        with self.assertRaises(release.GateError): release.configure(REVISION, CANDIDATE, "stale", release.API_ID)
        with self.assertRaises(release.GateError): release.configure(REVISION, "latest", release.API_TAG, release.API_ID)


if __name__ == "__main__":
    unittest.main()
