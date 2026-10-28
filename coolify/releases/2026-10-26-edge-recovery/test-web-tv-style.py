"""Offline TV-style web release gates; no Docker/server/provider connection."""
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


web = load("tv_style_builder_test", "build-web-tv-style.py")
release = load("tv_style_release_test", "release-web-tv-style.py").release
REVISION = "a" * 40
CANDIDATE = "sha256:" + "b" * 64
SOURCE_TAG = "flixify-ops-web:edge-recovery-d07eb17b22e3-20261026"
SOURCE_ID = "sha256:81cb96468427b1d2463c2b41c09b4339e9795befadff369827476580d2dca399"

# Exercise the established cgroup/config-restoration and web-only release
# contracts against fresh adapter modules, without editing historical tests.
builder_contract = load("tv_style_shared_builder_contract", "test-web-builder.py")
builder_contract.web = web.builder
release_contract = load("tv_style_shared_release_contract", "test-web-release.py")
release_contract.web, release_contract.guard = release, release.guard
WebReleaseTests = release_contract.WebReleaseTests


class SharedBuilderTests(builder_contract.WebBuilderTests):
    def test_only_reviewed_runtime_files_are_copied(self):
        dockerfile = web.dockerfile(REVISION)
        copies = [line for line in dockerfile.splitlines() if line.startswith("COPY ")]
        self.assertEqual(copies, [f"COPY {path} /app/{path}" for path in web.PATHS])
        self.assertEqual(len(web.PATHS), 15)
        self.assertIn("apps/ops-web/app/platform/series-detail.module.css", web.PATHS)
        self.assertNotIn("apps/ops-web/app/platform/series-detail.module.css", web.NEW_PATHS)
        self.assertEqual(set(web.NEW_PATHS), {
            "apps/ops-web/app/platform/catalog-dialog.ts",
            "apps/ops-web/app/platform/catalog-panels.module.css",
            "apps/ops-web/app/platform/catalog-search.tsx",
        })
        self.assertEqual(dockerfile.splitlines()[0], "FROM " + SOURCE_TAG)
        self.assertIn("LABEL vip.flixify.edge-recovery.base=" + SOURCE_ID, dockerfile)
        self.assertNotIn("COPY package", dockerfile)
        self.assertNotIn("public/", dockerfile)
        self.assertNotIn("npm ci", dockerfile)
        self.assertEqual(sum(line.startswith("RUN ") for line in dockerfile.splitlines()), 1)


class PinsAndPreflightTests(unittest.TestCase):
    def test_exact_current_source_and_baseline_are_isolated_from_old_entrypoints(self):
        self.assertEqual(web.SOURCE_TAG, SOURCE_TAG)
        self.assertEqual(web.SOURCE_ID, SOURCE_ID)
        self.assertEqual(web.BASE_REVISION, "120b35f77f2ea52c03a7179e1cbea556d477b65c")
        self.assertEqual(web.builder.PATHS, web.PATHS)
        self.assertEqual(web.builder.NEW_PATHS, web.NEW_PATHS)
        old = load("tv_style_historical_builder_check", "build-web.py")
        self.assertNotEqual(old.SOURCE_ID, SOURCE_ID)
        self.assertEqual(len(old.PATHS), 3)

    def test_manifest_rejects_duplicate_unsafe_or_unreviewed_new_paths(self):
        for paths, new in ((web.PATHS + (web.PATHS[0],), web.NEW_PATHS),
                           (("apps/ops-web/app/../secret",), ()),
                           (web.PATHS, ("apps/ops-web/app/not-in-manifest.ts",))):
            with self.subTest(paths=paths, new=new), patch.object(web.builder, "PATHS", paths), \
                 patch.object(web.builder, "NEW_PATHS", new), self.assertRaises(web.GateError):
                web.builder.validate_manifest()

    def test_full_scope_rejects_before_any_image_read_or_shared_preflight(self):
        changed = "\n".join((*web.PATHS, "apps/api/src/main.ts")).encode()
        with patch.object(web, "command", return_value=changed), \
             patch.object(web.builder, "preflight") as shared, \
             patch.object(web, "public_manifest") as public, self.assertRaises(web.GateError):
            web.preflight(Path("/repo"), REVISION)
        shared.assert_not_called()
        public.assert_not_called()

    def test_shared_source_drift_stops_before_public_tree_or_build(self):
        with patch.object(web, "validate_source_scope"), \
             patch.object(web.builder, "preflight", side_effect=web.GateError("web_base_image_drift")), \
             patch.object(web, "public_manifest") as public, \
             self.assertRaisesRegex(web.GateError, "web_base_image_drift"):
            web.preflight(Path("/repo"), REVISION)
        public.assert_not_called()

    def test_successful_preflight_freezes_exact_source_public_tree(self):
        data = ({"Id": SOURCE_ID}, {path: b"reviewed" for path in web.PATHS}, {"PUBLIC": "same"}, b"config")
        with patch.object(web, "validate_source_scope") as scope, \
             patch.object(web.builder, "preflight", return_value=data) as shared, \
             patch.object(web, "public_manifest", return_value=b"source manifest") as public:
            self.assertEqual(web.preflight(Path("/repo"), REVISION), (*data, b"source manifest"))
        scope.assert_called_once_with(Path("/repo"), REVISION)
        shared.assert_called_once_with(Path("/repo"), REVISION)
        public.assert_called_once_with(SOURCE_ID)


class SourceScopeTests(unittest.TestCase):
    def scope(self, extra=(), omitted=()):
        paths = [path for path in web.PATHS if path not in omitted]
        with patch.object(web, "command", return_value=("\n".join(paths + list(extra)) + "\n").encode()):
            web.validate_source_scope(Path("/repo"), REVISION)

    def test_reviewed_runtime_tests_docs_and_tools_are_the_only_accepted_changes(self):
        self.scope(("apps/ops-web/app/canli-tv/live-stall-recovery.test.tsx",
                    "docs/superpowers/specs/tv-style.md", *web.TOOL_PATHS))

    def test_public_apk_assets_dependencies_backend_and_native_changes_are_rejected(self):
        for path in ("apps/ops-web/public/downloads/replaced.apk", "apps/ops-web/public/logo/logo.png",
                     "package-lock.json", "package.json", "apps/ops-web/package.json",
                     "apps/api/src/main.ts", "apps/worker/src/main.ts", "packages/viewer-core/src/index.ts",
                     "apps/tv-android/app/build.gradle", "apps/ops-web/next.config.ts",
                     "coolify/releases/2026-10-26-edge-recovery/build-web.py"):
            with self.subTest(path=path), self.assertRaises(web.GateError):
                self.scope((path,))

    def test_unreviewed_runtime_cannot_hide_behind_test_substring(self):
        for path in ("apps/ops-web/app/platform/hidden.test.module.css",
                     "apps/ops-web/app/platform/hidden.test.tsx/runtime.ts"):
            with self.subTest(path=path), self.assertRaises(web.GateError):
                self.scope((path,))

    def test_every_overlay_path_must_really_have_changed(self):
        with self.assertRaises(web.GateError):
            self.scope(omitted=(web.PATHS[0],))

    def test_branch_alias_is_never_accepted_as_revision(self):
        with patch.object(web, "command") as command, self.assertRaises(web.GateError):
            web.validate_source_scope(Path("/repo"), "HEAD")
        command.assert_not_called()


class PublicTreeTests(unittest.TestCase):
    def test_public_manifest_runs_without_network_and_with_bounded_resources(self):
        with patch.object(web, "command", return_value=b"manifest") as command:
            self.assertEqual(web.public_manifest(SOURCE_ID), b"manifest")
        args = command.call_args.args
        self.assertEqual(args[:4], ("docker", "run", "--rm", "--network"))
        for flag, value in (("--network", "none"), ("--memory", "256m"), ("--memory-swap", "320m"), ("--pids-limit", "128")):
            self.assertEqual(args[args.index(flag) + 1], value)
        self.assertEqual(args[-3], SOURCE_ID)

    def test_manifest_detects_binary_bytes_modes_and_link_targets_without_following_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "downloads").mkdir()
            apk = root / "downloads/app.apk"
            apk.write_bytes(b"PK\x03\x04\x00binary\xff")
            (root / "logo").symlink_to("missing-logo")
            script = web.public_manifest_script().replace("/app/apps/ops-web/public", str(root))
            def manifest():
                result = subprocess.run(("node", "-e", script), capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout
            first = manifest()
            rows = json.loads(first)
            self.assertTrue(any(row[:2] == ["link", "logo"] and row[-1] == "missing-logo" for row in rows))
            self.assertEqual(manifest(), first)
            apk.write_bytes(b"PK\x03\x04changed")
            changed_bytes = manifest()
            self.assertNotEqual(changed_bytes, first)
            apk.chmod(0o600)
            self.assertNotEqual(manifest(), changed_bytes)
            (root / "logo").unlink()
            (root / "logo").symlink_to("another-missing-logo")
            self.assertNotEqual(manifest(), first)

    def test_candidate_must_match_source_public_tree_including_existing_apks(self):
        for actual in (b"changed asset", b"missing APK", b"extra public file"):
            with self.subTest(actual=actual), patch.object(web.builder, "verify_candidate", return_value=CANDIDATE), \
                 patch.object(web, "public_manifest", return_value=actual), \
                 self.assertRaisesRegex(web.GateError, "public_tree_differs"):
                web.verify_candidate({}, REVISION, {}, {}, b"config", b"unchanged public")

    def test_verified_candidate_returns_only_after_public_tree_check(self):
        with patch.object(web.builder, "verify_candidate", return_value=CANDIDATE) as shared, \
             patch.object(web, "public_manifest", return_value=b"unchanged public") as public, \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(web.verify_candidate({}, REVISION, {}, {}, b"config", b"unchanged public"), CANDIDATE)
        shared.assert_called_once_with({}, REVISION, {}, {}, b"config")
        public.assert_called_once_with(CANDIDATE)

    def test_shared_candidate_identity_drift_stops_before_public_check(self):
        with patch.object(web.builder, "verify_candidate", side_effect=web.GateError("web_candidate_identity_invalid")), \
             patch.object(web, "public_manifest") as public, self.assertRaises(web.GateError):
            web.verify_candidate({}, REVISION, {}, {}, b"config", b"public")
        public.assert_not_called()


class ContainerCompileTests(unittest.TestCase):
    def base(self):
        return {"Config": {"Cmd": ["node", "server.js"], "Volumes": None}}

    def test_compile_is_bounded_offline_and_copies_only_reviewed_files(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return b"0\n" if args[:4] == ("docker", "inspect", "--format", "{{.State.ExitCode}}") else b""
        updated = {path: ("source:" + path).encode() for path in web.PATHS}
        with patch.object(web, "command", side_effect=command), contextlib.redirect_stdout(io.StringIO()):
            web.container_compile(REVISION, self.base(), updated, {"PUBLIC": "same"})
        create = calls[0]
        for flag, value in (("--network", "none"), ("--memory", "1280m"), ("--memory-swap", "1536m"), ("--pids-limit", "256")):
            self.assertEqual(create[create.index(flag) + 1], value)
        self.assertIn(SOURCE_ID, create)
        self.assertIn("build_cgroup_limit_exceeds_cap", create[-1])
        name = create[create.index("--name") + 1]
        self.assertTrue(name.startswith("flixify-tv-style-web-build-"))
        copies = [args[-1] for args in calls if args[:2] == ("docker", "cp")]
        self.assertEqual(copies, [name + ":/app/" + path for path in web.PATHS])
        self.assertEqual(calls[-1], ("docker", "rm", "--force", name))
        commit = next(args for args in calls if args[:2] == ("docker", "commit"))
        self.assertIn("CMD " + json.dumps(self.base()["Config"]["Cmd"]), commit)
        self.assertIn("LABEL vip.flixify.edge-recovery.base=" + SOURCE_ID, commit)

    def test_failed_compile_removes_only_owned_container_and_never_commits(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "start"):
                raise web.GateError("simulated_compile_failure")
            return b""
        with patch.object(web, "command", side_effect=command), self.assertRaises(web.GateError):
            web.container_compile(REVISION, self.base(), {web.PATHS[0]: b"source"}, {})
        name = calls[0][calls[0].index("--name") + 1]
        self.assertEqual(calls[-1], ("docker", "rm", "--force", name))
        self.assertFalse(any(args[:2] == ("docker", "commit") for args in calls))

    def test_nonzero_build_exit_is_not_committed(self):
        with patch.object(web, "command", return_value=b"1\n") as command, self.assertRaisesRegex(web.GateError, "container_web_compile_failed"):
            web.container_compile(REVISION, self.base(), {}, {})
        self.assertFalse(any(call.args[:2] == ("docker", "commit") for call in command.call_args_list))
        self.assertEqual(command.call_args.args[:3], ("docker", "rm", "--force"))

    def test_unsupported_base_does_not_create_any_container(self):
        for config in ({}, {"Cmd": []}, {"Cmd": ["node"], "Volumes": {"/app": {}}}):
            with self.subTest(config=config), patch.object(web, "command") as command, self.assertRaises(web.GateError):
                web.container_compile(REVISION, {"Config": config}, {}, {})
            command.assert_not_called()


class BuildActionsTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        self.updated = {path: ("source:" + path).encode() for path in web.PATHS}
        self.preflight = patch.object(web, "preflight", return_value=(
            {"Config": {"Cmd": ["node", "server.js"]}}, self.updated, {"PUBLIC": "same"}, b"config", b"public"
        )).start()
        self.disk = patch.object(web.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8 * 1024**3)).start()
        self.command = patch.object(web, "command", return_value=b"").start()
        self.candidate = patch.object(web, "verify_candidate", return_value=CANDIDATE).start()
        self.compile = patch.object(web, "container_compile").start()
        self.addCleanup(patch.stopall)

    def run_main(self, action=None):
        args = ["build-web-tv-style.py", "/repo", "--revision", REVISION]
        if action:
            args.append(action)
        with patch.object(sys, "argv", args):
            web.main()

    def test_default_preflight_never_allocates_a_build_or_recreates_any_service(self):
        self.run_main()
        self.command.assert_not_called()
        self.disk.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_not_called()

    def test_both_build_modes_stop_below_eight_gib_without_mutation(self):
        self.disk.return_value.free = 8 * 1024**3 - 1
        for action in ("--build", "--container-build"):
            with self.subTest(action=action), self.assertRaisesRegex(web.GateError, "requires_8GiB"):
                self.run_main(action)
        self.command.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_not_called()

    def test_build_at_floor_uses_exact_context_caps_and_no_public_or_dependencies(self):
        captured = {}
        def command(*args, **kwargs):
            if args[:2] == ("docker", "build"):
                root = Path(args[-1])
                captured.update({str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()})
            return b""
        self.command.side_effect = command
        self.run_main("--build")
        self.assertEqual(set(captured), {*web.PATHS, "Dockerfile"})
        self.assertTrue(all(captured[path] == value for path, value in self.updated.items()))
        args = self.command.call_args.args
        for flag in ("--load", "--pull=false", "--network=none", "--no-cache", "memory=1280m", "memory-swap=1536m"):
            self.assertIn(flag, args)
        self.candidate.assert_called_once()
        self.assertEqual(self.candidate.call_args.args[-1], b"public")

    def test_container_build_at_floor_overlays_exact_runtime_manifest(self):
        self.run_main("--container-build")
        self.assertEqual(self.compile.call_args.args[2], self.updated)
        self.assertFalse(any(call.args[:2] == ("docker", "build") for call in self.command.call_args_list))
        self.candidate.assert_called_once()

    def test_existing_tag_is_not_overwritten_by_either_build_mode(self):
        self.command.return_value = (web.builder.target(REVISION) + "\n").encode()
        for action in ("--build", "--container-build"):
            with self.subTest(action=action), self.assertRaisesRegex(web.GateError, "candidate_tag_already_exists"):
                self.run_main(action)
        self.compile.assert_not_called()
        self.candidate.assert_not_called()

    def test_verify_existing_checks_identity_and_public_without_build_allocation(self):
        self.run_main("--verify-existing")
        self.command.assert_not_called()
        self.disk.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_called_once()


class ReleaseActionsTests(unittest.TestCase):
    def invoke(self, action=None):
        argv = ["release-web-tv-style.py", "--revision", REVISION, "--candidate-id", CANDIDATE,
                "--protected-worker-tag", release_contract.WORKER_TAG, "--protected-worker-id", release_contract.WORKER_ID]
        if action:
            argv.append(action)
        with patch.object(sys, "argv", argv):
            release.main()

    def test_current_source_and_protected_service_pins_are_preserved(self):
        release.configure(REVISION, CANDIDATE, release_contract.WORKER_TAG, release_contract.WORKER_ID)
        guard = release.guard
        self.assertEqual(guard.SOURCE, {"ops-web": SOURCE_TAG})
        self.assertEqual(guard.SOURCE_IDS, {"ops-web": SOURCE_ID})
        self.assertEqual(guard.CHANGED, ("ops-web",))
        self.assertEqual(guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(release.API_ID, "sha256:8cdbf9dba8b15e78a74299a3f612c44b3bed51ee342dd3631cc5b811bdd41e53")
        self.assertEqual(guard.PROTECTED_DB_IMAGE_ID, "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea")

    def test_default_is_readonly_preflight_with_no_sync_or_recreate(self):
        with patch.object(release.guard, "preflight", return_value=({}, b"compose", b"env", {}, {}, {})) as preflight, \
             patch.object(release.guard, "sync_images") as sync, patch.object(release, "quiet_recreate") as recreate, \
             contextlib.redirect_stdout(io.StringIO()):
            self.invoke()
        preflight.assert_called_once_with("source")
        sync.assert_not_called()
        recreate.assert_not_called()

    def test_recreate_only_consumes_verified_target_context(self):
        before = {"protected": "snapshot"}
        with patch.object(release.guard, "preflight", return_value=({}, b"compose", b"env", before, {"raw": 1}, {"rendered": 1})) as preflight, \
             patch.object(release, "quiet_recreate") as recreate, patch.object(release.guard, "sync_images") as sync:
            self.invoke("--recreate")
        preflight.assert_called_once_with("target")
        recreate.assert_called_once_with(before, b"compose", b"env", {"raw": 1}, {"rendered": 1})
        sync.assert_not_called()

    def test_rollback_uses_scoped_source_guard_and_no_metadata_sync(self):
        with patch.object(release, "quiet_rollback") as rollback, patch.object(release.guard, "preflight") as preflight, \
             patch.object(release.guard, "sync_images") as sync:
            self.invoke("--rollback")
        rollback.assert_called_once()
        preflight.assert_not_called()
        sync.assert_not_called()

    def test_failed_health_rolls_back_only_after_recovery_context_is_verified(self):
        before = {"protected": "snapshot"}
        with patch.object(release.guard, "preflight", return_value=({}, b"compose", b"env", before, {}, {})), \
             patch.object(release, "quiet_recreate", side_effect=release.GateError("new_container_unhealthy:ops-web")), \
             patch.object(release.guard, "verify_recovery_context") as recovery, \
             patch.object(release, "quiet_rollback") as rollback, \
             self.assertRaisesRegex(release.GateError, "deploy_failed_but_source_restored"):
            self.invoke("--recreate")
        recovery.assert_called_once_with(before, b"compose", b"env")
        rollback.assert_called_once()


if __name__ == "__main__":
    unittest.main()
