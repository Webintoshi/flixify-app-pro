"""Offline direct-play TV APK and pending website release contracts."""
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

sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


AVAILABLE = Path(__file__).with_name("build-tv-direct-web.py").exists()
if AVAILABLE:
    tv = load("direct_tv_builder_test", "build-tv-direct-web.py")
    release = load("direct_tv_release_test", "release-tv-direct-web.py").release
    shared_release = load("direct_tv_release_contract", "test-web-release.py")
    shared_release.web, shared_release.guard = release, release.guard
    WebReleaseTests = shared_release.WebReleaseTests

REVISION = "a" * 40
CANDIDATE = "sha256:" + "b" * 64
SOURCE_ID = "sha256:81cb96468427b1d2463c2b41c09b4339e9795befadff369827476580d2dca399"
SOURCE_TAG = "flixify-ops-web:edge-recovery-d07eb17b22e3-20261026"
BASE = "120b35f77f2ea52c03a7179e1cbea556d477b65c"
APK = "apps/ops-web/public/downloads/flixify-tv-1.3.1-test.1.apk"
DESCRIPTOR = "apps/ops-web/app/platform/tv-download.ts"
GRADLE = "apps/tv-android/app/build.gradle"


class EntryPointTests(unittest.TestCase):
    def test_combined_release_has_its_own_reviewable_entrypoints(self):
        for filename in ("build-tv-direct-web.py", "release-tv-direct-web.py"):
            self.assertTrue(Path(__file__).with_name(filename).is_file(), filename)


@unittest.skipUnless(AVAILABLE, "new combined entrypoint is not implemented yet")
class SourceScopeTests(unittest.TestCase):
    def scope(self, extra=(), omitted=()):
        paths = [path for path in (*tv.PATHS, tv.APK, GRADLE) if path not in omitted]
        with patch.object(tv, "command", return_value=("\n".join(paths + list(extra)) + "\n").encode()):
            tv.validate_source_scope(Path("/repo"), REVISION)

    def test_exact_pins_and_runtime_union_exclude_native_code(self):
        self.assertEqual((tv.SOURCE_TAG, tv.SOURCE_ID, tv.BASE_REVISION), (SOURCE_TAG, SOURCE_ID, BASE))
        self.assertEqual(tv.PATHS, (*tv.style.PATHS, DESCRIPTOR))
        self.assertEqual(len(tv.PATHS), 16)
        self.assertEqual(tv.builder.PATHS, tv.PATHS)
        self.assertEqual(tv.NEW_PATHS, tv.style.NEW_PATHS)
        self.assertEqual(tv.APK, APK)
        self.assertTrue(all(path.startswith("apps/ops-web/app/") for path in tv.PATHS))

    def test_only_reviewed_runtime_native_tests_docs_and_tools_are_allowed(self):
        self.scope((*tv.NATIVE_PATHS, "apps/tv-android/README.md",
                    "apps/tv-android/app/src/androidTest/java/vip/flixify/tv/DirectPlaybackTest.java",
                    "apps/tv-android/app/src/test/java/vip/flixify/tv/CatalogFilterDataTest.java",
                    "apps/ops-web/app/platform/catalog-panels.test.tsx",
                    "docs/superpowers/tv-direct.md", *tv.TOOL_PATHS, *tv.style.TOOL_PATHS))

    def test_unreviewed_source_assets_dependencies_and_player_engine_are_rejected(self):
        for path in ("apps/api/src/main.ts", "apps/worker/src/main.ts", "package-lock.json",
                     "apps/tv-android/settings.gradle", "apps/tv-android/app/src/main/AndroidManifest.xml",
                     "apps/tv-android/app/src/main/res/raw/poster_move.wav",
                     "apps/tv-android/app/src/main/java/vip/flixify/tv/player/Media3PlayerEngine.java",
                     "apps/tv-android/app/src/main/java/vip/flixify/tv/data/TokenStore.java",
                     "apps/ops-web/public/downloads/flixify-tv-1.3.0-test.1.apk",
                     "apps/ops-web/app/platform/hidden.test.module.css",
                     "coolify/releases/2026-10-26-edge-recovery/build-web.py"):
            with self.subTest(path=path), self.assertRaises(tv.GateError):
                self.scope((path,))

    def test_required_runtime_apk_and_gradle_changes_cannot_be_omitted(self):
        for path in (*tv.PATHS, tv.APK, GRADLE):
            with self.subTest(path=path), self.assertRaises(tv.GateError):
                self.scope(omitted=(path,))

    def test_alias_revision_stops_before_any_boundary_read(self):
        with patch.object(tv, "command") as command, self.assertRaises(tv.GateError):
            tv.validate_source_scope(Path("/repo"), "HEAD")
        command.assert_not_called()

    def test_gradle_and_descriptor_only_receive_exact_version_replacements(self):
        original = {GRADLE: b"config\nversionCode 5\nversionName '1.3.0-test.1'\nrest\n",
                    DESCRIPTOR: b'file:"flixify-tv-1.3.0-test.1.apk", version:"1.3.0-test.1"\n'}
        expected = {GRADLE: original[GRADLE].replace(b"versionCode 5", b"versionCode 6").replace(b"1.3.0-test.1", b"1.3.1-test.1"),
                    DESCRIPTOR: original[DESCRIPTOR].replace(b"1.3.0-test.1", b"1.3.1-test.1")}
        def git_file(repo, revision, path):
            return original[path] if revision == BASE else expected[path]
        with patch.object(tv.core, "git_file", side_effect=git_file):
            tv.validate_versions(Path("/repo"), REVISION)
        for path in expected:
            expected[path] += b"unreviewed change"
            with patch.object(tv.core, "git_file", side_effect=git_file), self.assertRaises(tv.GateError):
                tv.validate_versions(Path("/repo"), REVISION)
            expected[path] = expected[path].removesuffix(b"unreviewed change")


@unittest.skipUnless(AVAILABLE, "new combined entrypoint is not implemented yet")
class ApkAndPublicTreeTests(unittest.TestCase):
    def setUp(self):
        self.apk = b"PK\x03\x04" + b"x" * 2048
        self.sha = hashlib.sha256(self.apk).hexdigest()
        self.regular = patch.object(tv.builder, "require_regular_blob").start()
        self.entry = patch.object(tv.builder, "git_entry", side_effect=lambda repo, revision, path:
                                 b"100644 blob " + b"d" * 40 + b"\t" + APK.encode() + b"\x00"
                                 if revision == REVISION and path == APK else b"").start()
        self.absent = patch.object(tv.builder, "require_image_absent").start()
        self.git = patch.object(tv.core, "git_file", return_value=self.apk).start()
        self.command = patch.object(tv, "command", return_value=(APK + "\n").encode()).start()
        self.addCleanup(patch.stopall)

    def validate(self, sha=None, size=None):
        return tv.validate_apk(Path("/repo"), REVISION, sha or self.sha,
                               len(self.apk) if size is None else size)

    def original(self):
        return json.dumps([["dir", "", 493], ["dir", "downloads", 493],
                           ["file", "downloads/old.apk", 420, 2000, "d" * 64],
                           ["link", "logo", 511, "missing-logo"]]).encode()

    def expected(self):
        return json.loads(self.original()) + [["file", "downloads/flixify-tv-1.3.1-test.1.apk",
                                               420, len(self.apk), self.sha]]

    def test_exact_absent_regular_new_apk_bytes_are_accepted(self):
        self.assertEqual(self.validate(), self.apk)
        self.regular.assert_called_once_with(Path("/repo"), REVISION, APK)
        self.absent.assert_called_once_with(APK)

    def test_invalid_pin_wrong_bytes_or_other_public_changes_are_rejected(self):
        for sha, size in (("bad", 2048), (self.sha, 0), (self.sha, tv.MAX_APK_BYTES + 1)):
            with self.subTest(sha=sha, size=size), self.assertRaises(tv.GateError):
                self.validate(sha, size)
        for value in (self.apk + b"x", b"notzip" + b"x" * 2046):
            self.git.return_value = value
            with self.assertRaises(tv.GateError):
                self.validate()
        self.git.return_value = self.apk
        self.command.return_value = (APK + "\napps/ops-web/public/extra.apk\n").encode()
        with self.assertRaisesRegex(tv.GateError, "public_scope"):
            self.validate()

    def test_baseline_file_or_symlink_ancestor_does_not_count_as_absence(self):
        self.entry.side_effect = None
        self.entry.return_value = b"100644 blob dead\tfile\x00"
        with self.assertRaisesRegex(tv.GateError, "apk_exists"):
            self.validate()
        self.entry.side_effect = lambda repo, rev, path: (
            b"120000 blob dead\tlink\x00" if path == str(Path(APK).parent) else
            b"100644 blob " + b"d" * 40 + b"\t" + APK.encode() + b"\x00" if rev == REVISION and path == APK else b"")
        with self.assertRaisesRegex(tv.GateError, "ancestor_not_tree"):
            self.validate()

    def test_executable_apk_is_rejected_before_image_or_binary_reads(self):
        self.entry.side_effect = lambda repo, rev, path: (
            b"100755 blob " + b"d" * 40 + b"\t" + APK.encode() + b"\x00" if rev == REVISION and path == APK else b"")
        with self.assertRaisesRegex(tv.GateError, "apk_mode_invalid"):
            self.validate()
        self.absent.assert_not_called()
        self.git.assert_not_called()

    def test_expected_public_tree_adds_only_one_known_file(self):
        self.assertEqual(json.loads(tv.expected_public_manifest(self.original(), self.sha, len(self.apk))),
                         sorted(self.expected(), key=lambda row: row[1]))

    def test_public_manifest_refuses_duplicate_overwrite_or_missing_parent(self):
        for rows in (self.expected(), json.loads(self.original()) * 2,
                     [["dir", "", 493]], [["dir", "", 493], ["link", "downloads", 511, "/elsewhere"]]):
            with self.subTest(rows=rows), self.assertRaises(tv.GateError):
                tv.expected_public_manifest(json.dumps(rows).encode(), self.sha, len(self.apk))

    def test_candidate_old_bytes_modes_and_link_targets_are_immutable(self):
        for index, field, value in ((2, 4, "e" * 64), (2, 2, 384), (3, 3, "changed-logo")):
            rows = self.expected()
            rows[index][field] = value
            with patch.object(tv.builder, "verify_candidate", return_value=CANDIDATE), \
                 patch.object(tv, "public_manifest", return_value=json.dumps(rows).encode()), \
                 self.assertRaisesRegex(tv.GateError, "public_tree_differs"):
                tv.verify_candidate({}, REVISION, {}, {}, b"config", self.original(), self.sha, len(self.apk))

    def test_public_extra_missing_or_duplicate_entries_stop_candidate(self):
        for rows in (self.expected()[:-1], self.expected() + [["file", "extra", 420, 0, "f" * 64]],
                     self.expected() + [self.expected()[-1]]):
            with patch.object(tv.builder, "verify_candidate", return_value=CANDIDATE), \
                 patch.object(tv, "public_manifest", return_value=json.dumps(rows).encode()), \
                 self.assertRaises(tv.GateError):
                tv.verify_candidate({}, REVISION, {}, {}, b"config", self.original(), self.sha, len(self.apk))

    def test_candidate_returns_only_after_exact_public_tree_and_http_download(self):
        with patch.object(tv.builder, "verify_candidate", return_value=CANDIDATE) as shared, \
             patch.object(tv, "public_manifest", return_value=json.dumps(self.expected()).encode()) as public, \
             patch.object(tv, "verify_download") as download, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(tv.verify_candidate({}, REVISION, {}, {}, b"config", self.original(), self.sha, len(self.apk)), CANDIDATE)
        shared.assert_called_once()
        public.assert_called_once_with(CANDIDATE)
        download.assert_called_once_with(CANDIDATE, self.sha, len(self.apk))


@unittest.skipUnless(AVAILABLE, "new combined entrypoint is not implemented yet")
class BuildAndDownloadTests(unittest.TestCase):
    def test_dockerfile_contains_exact_runtime_and_only_the_new_apk(self):
        text = tv.dockerfile(REVISION)
        self.assertEqual(text.splitlines()[0], "FROM " + SOURCE_TAG)
        self.assertEqual([row for row in text.splitlines() if row.startswith("COPY ")],
                         [f"COPY {path} /app/{path}" for path in (*tv.PATHS, APK)])
        self.assertIn("build_cgroup_limit_exceeds_cap", text)
        self.assertIn("next_config_restore_failed", text)
        self.assertEqual(text.count("RUN node -e "), 1)
        self.assertNotIn("COPY apps/tv-android", text)

    def test_download_uses_bounded_offline_candidate_and_new_url_with_full_contract(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return (CANDIDATE + "\n").encode() if args[:3] == ("docker", "inspect", "--format") else b""
        with patch.object(tv, "command", side_effect=command), contextlib.redirect_stdout(io.StringIO()):
            tv.verify_download(CANDIDATE, "c" * 64, 2048)
        for flag, value in (("--network", "none"), ("--memory", "512m"), ("--memory-swap", "640m"), ("--pids-limit", "128")):
            self.assertEqual(calls[0][calls[0].index(flag) + 1], value)
        script = next(call[-1] for call in calls if call[:2] == ("docker", "exec"))
        for marker in ("/downloads/flixify-tv-1.3.1-test.1.apk", 'method:"HEAD"', 'Range:"bytes=0-31"',
                       "application/vnd.android.package-archive", 'createHash("sha256")'):
            self.assertIn(marker, script)
        self.assertEqual(calls[-1][:4], ("docker", "stop", "-t", "10"))

    def test_download_cleanup_does_not_stop_a_different_image(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return b"sha256:wrong\n"
        with patch.object(tv, "command", side_effect=command), self.assertRaisesRegex(tv.GateError, "apk_check_container_drift"):
            tv.verify_download(CANDIDATE, "c" * 64, 2048)
        self.assertFalse(any(call[:2] == ("docker", "stop") for call in calls))

    def test_container_compile_reuses_reviewed_caps_config_restoration_and_owned_cleanup(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return b"0\n" if args[:4] == ("docker", "inspect", "--format", "{{.State.ExitCode}}") else b""
        updated = {path: path.encode() for path in (*tv.PATHS, APK)}
        with patch.object(tv.style, "command", side_effect=command), contextlib.redirect_stdout(io.StringIO()):
            tv.container_compile(REVISION, {"Config": {"Cmd": ["node", "server.js"], "Volumes": None}}, updated, {})
        create = calls[0]
        for flag, value in (("--network", "none"), ("--memory", "1280m"), ("--memory-swap", "1536m"), ("--pids-limit", "256")):
            self.assertEqual(create[create.index(flag) + 1], value)
        name = create[create.index("--name") + 1]
        self.assertEqual([call[-1] for call in calls if call[:2] == ("docker", "cp")],
                         [name + ":/app/" + path for path in updated])
        self.assertEqual(calls[-1], ("docker", "rm", "--force", name))

    def test_container_compile_failure_cleans_owned_overlay_without_commit(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "start"):
                raise tv.GateError("compile_failed")
            return b""
        with patch.object(tv.style, "command", side_effect=command), self.assertRaises(tv.GateError):
            tv.container_compile(REVISION, {"Config": {"Cmd": ["node"], "Volumes": None}}, {APK: b"apk"}, {})
        self.assertEqual(calls[-1], ("docker", "rm", "--force", calls[0][calls[0].index("--name") + 1]))
        self.assertFalse(any(call[:2] == ("docker", "commit") for call in calls))


@unittest.skipUnless(AVAILABLE, "new combined entrypoint is not implemented yet")
class BuildActionsTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        self.updated = {path: b"reviewed" for path in (*tv.PATHS, APK)}
        patch.object(tv, "preflight", return_value=({}, self.updated, {}, b"config", b"public")).start()
        self.disk = patch.object(tv.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8 * 1024**3)).start()
        self.command = patch.object(tv, "command", return_value=b"").start()
        self.compile = patch.object(tv, "container_compile").start()
        self.candidate = patch.object(tv, "verify_candidate", return_value=CANDIDATE).start()
        self.addCleanup(patch.stopall)

    def invoke(self, action=None):
        argv = ["build-tv-direct-web.py", "/repo", "--revision", REVISION,
                "--apk-sha256", "c" * 64, "--apk-bytes", "2048"]
        if action:
            argv.append(action)
        with patch.object(sys, "argv", argv):
            tv.main()

    def test_default_preflight_never_builds_or_allocates(self):
        self.invoke()
        self.disk.assert_not_called()
        self.command.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_not_called()

    def test_both_build_modes_stop_below_eight_gib_before_mutation(self):
        self.disk.return_value.free -= 1
        for action in ("--build", "--container-build"):
            with self.subTest(action=action), self.assertRaisesRegex(tv.GateError, "requires_8GiB"):
                self.invoke(action)
        self.command.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_not_called()

    def test_container_build_receives_exact_runtime_and_apk_then_verifies_everything(self):
        self.invoke("--container-build")
        self.compile.assert_called_once_with(REVISION, {}, self.updated, {})
        self.candidate.assert_called_once_with({}, REVISION, self.updated, {}, b"config", b"public", "c" * 64, 2048)

    def test_existing_candidate_is_never_overwritten(self):
        self.command.return_value = (tv.builder.target(REVISION) + "\n").encode()
        for action in ("--build", "--container-build"):
            with self.subTest(action=action), self.assertRaisesRegex(tv.GateError, "candidate_tag_already_exists"):
                self.invoke(action)
        self.compile.assert_not_called()
        self.candidate.assert_not_called()

    def test_verify_existing_allocates_no_build_and_still_verifies_candidate(self):
        self.invoke("--verify-existing")
        self.disk.assert_not_called()
        self.command.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_called_once()

    def test_docker_build_context_has_only_reviewed_files_and_existing_resource_caps(self):
        captured = {}
        def command(*args, **kwargs):
            if args[:2] == ("docker", "build"):
                root = Path(args[-1])
                captured.update({str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()})
            return b""
        self.command.side_effect = command
        self.invoke("--build")
        self.assertEqual(set(captured), {*tv.PATHS, APK, "Dockerfile"})
        for flag in ("--load", "--pull=false", "--network=none", "--no-cache", "memory=1280m", "memory-swap=1536m"):
            self.assertIn(flag, self.command.call_args.args)


@unittest.skipUnless(AVAILABLE, "new combined entrypoint is not implemented yet")
class ReleasePinsTests(unittest.TestCase):
    def test_only_web_changes_and_all_original_protected_pins_remain(self):
        release.configure(REVISION, CANDIDATE, shared_release.WORKER_TAG, shared_release.WORKER_ID)
        self.assertEqual(release.guard.SOURCE, {"ops-web": SOURCE_TAG})
        self.assertEqual(release.guard.SOURCE_IDS, {"ops-web": SOURCE_ID})
        self.assertEqual(release.guard.CHANGED, ("ops-web",))
        self.assertEqual(release.guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(release.API_ID, "sha256:8cdbf9dba8b15e78a74299a3f612c44b3bed51ee342dd3631cc5b811bdd41e53")
        self.assertEqual(release.guard.PROTECTED_DB_IMAGE_ID, "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea")


if __name__ == "__main__":
    unittest.main()
