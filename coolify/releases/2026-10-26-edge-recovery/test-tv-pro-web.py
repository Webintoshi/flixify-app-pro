"""Offline contracts for the narrow Flixify Pro VOD-control APK release."""
import contextlib
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


AVAILABLE = Path(__file__).with_name("build-tv-pro-web.py").is_file()
if AVAILABLE:
    pro = load("pro_tv_builder_test", "build-tv-pro-web.py")
    tv = pro.direct
    release = load("pro_tv_release_test", "release-tv-pro-web.py").release
else:
    tv = load("pro_previous_builder_for_red", "build-tv-direct-web.py")

SOURCE_TAG = "flixify-ops-web:edge-recovery-4d7cb2940197-20261026"
SOURCE_ID = "sha256:e83c21103c3cb8d21b36cf148eaca873c41c21d81caa044944691cf527a0cc21"
BASE = "6dd7714f3c7a16cd5acdb2ed02cc1dbab3ee37f9"
REVISION = "a" * 40
CANDIDATE = "sha256:" + "b" * 64
DESCRIPTOR = "apps/ops-web/app/platform/tv-download.ts"
SHELL = "apps/ops-web/app/platform/shell.tsx"
DOWNLOAD_PAGE = "apps/ops-web/app/indir/page.tsx"
APK = "apps/ops-web/public/downloads/flixify-pro-1.3.2.apk"
GRADLE = "apps/tv-android/app/build.gradle"
MANIFEST = "apps/tv-android/app/src/main/AndroidManifest.xml"
PLAYER = "apps/tv-android/app/src/main/java/vip/flixify/tv/PlayerActivity.java"
BUILD_SCRIPT = "apps/tv-android/scripts/build-test-apk.sh"


class NarrowOverlayTests(unittest.TestCase):
    def test_new_release_copies_only_download_descriptor_and_test_status_wording(self):
        self.assertEqual(tv.PATHS, (DESCRIPTOR, SHELL, DOWNLOAD_PAGE))
        self.assertEqual(tv.NEW_PATHS, ())
        self.assertEqual(tv.APK, APK)
        self.assertRegex(tv.SOURCE_ID, r"^sha256:[0-9a-f]{64}$")
        self.assertEqual((tv.SOURCE_TAG, tv.SOURCE_ID, tv.BASE_REVISION), (SOURCE_TAG, SOURCE_ID, BASE))


@unittest.skipUnless(AVAILABLE, "new release specialization has not been implemented")
class ProSourceScopeTests(unittest.TestCase):
    def scope(self, extra=(), omitted=()):
        changed = [path for path in (*tv.PATHS, APK, GRADLE, MANIFEST, PLAYER) if path not in omitted]
        with patch.object(tv, "command", return_value=("\n".join(changed + list(extra)) + "\n").encode()):
            pro.validate_source_scope(Path("/repo"), REVISION)

    def test_exact_player_metadata_wording_apk_docs_and_new_tools_are_allowed(self):
        self.scope((*pro.TOOL_PATHS, BUILD_SCRIPT, "apps/tv-android/README.md",
                    "apps/tv-android/app/src/androidTest/java/vip/flixify/tv/PlayerRemoteTest.java",
                    "docs/superpowers/tv-pro.md"))

    def test_every_required_runtime_and_artifact_change_is_required(self):
        for path in (*tv.PATHS, APK, GRADLE, MANIFEST, PLAYER):
            with self.subTest(path=path), self.assertRaises(tv.GateError):
                self.scope(omitted=(path,))

    def test_live_cards_provider_engine_palette_other_tests_and_old_assets_are_outside_scope(self):
        for path in ("apps/tv-android/app/src/main/java/vip/flixify/tv/MainActivity.java",
                     "apps/tv-android/app/src/main/java/vip/flixify/tv/TvLayout.java",
                     "apps/tv-android/app/src/main/java/vip/flixify/tv/PlayerIconButton.java",
                     "apps/tv-android/app/src/main/java/vip/flixify/tv/player/Media3PlayerEngine.java",
                     "apps/tv-android/app/src/main/java/vip/flixify/tv/data/NetworkTvRepository.java",
                     "apps/tv-android/app/src/main/res/raw/poster_move.wav",
                     "apps/tv-android/app/src/androidTest/java/vip/flixify/tv/LiveCardsRemoteTest.java",
                     "apps/ops-web/public/downloads/flixify-tv-1.3.1-test.1.apk",
                     "apps/ops-web/app/canli-tv/page.tsx", "package-lock.json",
                     "coolify/releases/2026-10-26-edge-recovery/build-tv-direct-web.py"):
            with self.subTest(path=path), self.assertRaises(tv.GateError):
                self.scope((path,))

    def test_alias_revision_is_rejected_before_reading_git_or_images(self):
        with patch.object(tv, "command") as command, self.assertRaises(tv.GateError):
            pro.validate_source_scope(Path("/repo"), "HEAD")
        command.assert_not_called()

    def fixtures(self):
        original = {
            GRADLE: b"namespace 'vip.flixify.tv'\nversionCode 6\nversionName '1.3.1-test.1'\nunchanged\n",
            MANIFEST: b'<application android:label="Flixify TV Test" android:allowBackup="false"/>\n',
            DESCRIPTOR: b'export const tvDownload={href:"/downloads/flixify-tv-1.3.1-test.1.apk",filename:"flixify-tv-1.3.1-test.1.apk",version:"1.3.1-test.1"};\n',
            SHELL: "rest Tek APK · Test sürümü rest\n".encode(),
            DOWNLOAD_PAGE: "ANDROID TV · TEST SÜRÜMÜ\nFlixify TV Test’i aç\nBu ilk test sürümü. Karşılaştığın sorunu\nrest\n".encode(),
            BUILD_SCRIPT: b"build-command\nprint('Test APK:',p.resolve())\nrest\n",
        }
        expected = dict(original)
        for path, replacements in pro.REPLACEMENTS.items():
            for before, after in replacements:
                expected[path] = expected[path].replace(before, after)
        return original, expected

    def test_only_exact_version_label_descriptor_and_wording_replacements_are_accepted(self):
        original, expected = self.fixtures()
        def git_file(repo, revision, path):
            return original[path] if revision == BASE else expected[path]
        with patch.object(tv.core, "git_file", side_effect=git_file):
            pro.validate_versions(Path("/repo"), REVISION)
        for path in original:
            expected[path] += b"unrelated change"
            with patch.object(tv.core, "git_file", side_effect=git_file), self.assertRaises(tv.GateError):
                pro.validate_versions(Path("/repo"), REVISION)
            expected[path] = expected[path].removesuffix(b"unrelated change")

    def test_build_script_may_remain_unchanged(self):
        original, expected = self.fixtures()
        expected[BUILD_SCRIPT] = original[BUILD_SCRIPT]
        with patch.object(tv.core, "git_file", side_effect=lambda repo, revision, path:
                          original[path] if revision == BASE else expected[path]):
            pro.validate_versions(Path("/repo"), REVISION)

    def test_missing_or_duplicated_baseline_marker_is_rejected(self):
        for path in pro.REPLACEMENTS:
            original, expected = self.fixtures()
            marker = pro.REPLACEMENTS[path][0][0]
            original[path] += marker
            with patch.object(tv.core, "git_file", side_effect=lambda repo, revision, path:
                              original[path] if revision == BASE else expected[path]), self.assertRaises(tv.GateError):
                pro.validate_versions(Path("/repo"), REVISION)

    def test_old_entrypoint_remains_pinned_to_its_original_release(self):
        old = load("pro_historical_guard_unchanged", "build-tv-direct-web.py")
        self.assertEqual(old.SOURCE_ID, "sha256:81cb96468427b1d2463c2b41c09b4339e9795befadff369827476580d2dca399")
        self.assertEqual(len(old.PATHS), 16)
        self.assertEqual(old.APK, "apps/ops-web/public/downloads/flixify-tv-1.3.1-test.1.apk")


if AVAILABLE:
    contract = load("pro_reused_direct_contract", "test-tv-direct-web.py")
    contract.tv = tv
    contract.APK, contract.BASE = APK, BASE
    contract.SOURCE_ID, contract.SOURCE_TAG = SOURCE_ID, SOURCE_TAG

    class ApkAndPublicTreeTests(contract.ApkAndPublicTreeTests):
        def expected(self):
            return json.loads(self.original()) + [["file", "downloads/flixify-pro-1.3.2.apk", 420, len(self.apk), self.sha]]

    class BuildAndDownloadTests(contract.BuildAndDownloadTests):
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
            for marker in ("/downloads/flixify-pro-1.3.2.apk", 'method:"HEAD"', 'Range:"bytes=0-31"',
                           "application/vnd.android.package-archive", 'createHash("sha256")'):
                self.assertIn(marker, script)
            self.assertNotIn("test.1", script)
            self.assertEqual(calls[-1][:4], ("docker", "stop", "-t", "10"))

    BuildActionsTests = contract.BuildActionsTests
    release_contract = load("pro_scoped_release_contract", "test-web-release.py")
    release_contract.web, release_contract.guard = release, release.guard
    WebReleaseTests = release_contract.WebReleaseTests

    class ReleasePinsTests(unittest.TestCase):
        def test_only_web_changes_with_exact_current_source_and_protected_services(self):
            release.configure(REVISION, CANDIDATE, release_contract.WORKER_TAG, release_contract.WORKER_ID)
            self.assertEqual(release.guard.SOURCE, {"ops-web": SOURCE_TAG})
            self.assertEqual(release.guard.SOURCE_IDS, {"ops-web": SOURCE_ID})
            self.assertEqual(release.guard.CHANGED, ("ops-web",))
            self.assertEqual(release.guard.PROTECTED, ("db", "api", "worker"))
            self.assertEqual(release.API_ID, "sha256:8cdbf9dba8b15e78a74299a3f612c44b3bed51ee342dd3631cc5b811bdd41e53")
            self.assertEqual(release.guard.PROTECTED_DB_IMAGE_ID, "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea")


if __name__ == "__main__":
    unittest.main()
