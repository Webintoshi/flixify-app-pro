"""Offline catalog-interface APK checks, including the existing build/release guard contracts.

Docker and production boundaries are replaced; these tests never build or deploy.
"""
import contextlib
import hashlib
import importlib.util
import io
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The shared release contract also uses this minimal offline YAML exception stub.
sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))
tv = load("catalog_tv_apk_web_test", "build-android-tv-catalog-web.py")
release = load("catalog_tv_apk_release_test", "release-android-tv-catalog-web.py").release

# Run the established guard behavior against the new entrypoints, not the old
# release's pins. Loading separate modules avoids changing any shared test file.
apk_contract = load("catalog_tv_apk_contract", "test-android-tv-cinematic-web.py")
apk_contract.tv = tv
TvApkGuards = apk_contract.TvApkGuards
release_contract = load("catalog_tv_release_contract", "test-web-release.py")
release_contract.web, release_contract.guard = release, release.guard
WebReleaseTests = release_contract.WebReleaseTests

REVISION = "a" * 40
SOURCE_TAG = "flixify-ops-web:edge-recovery-acb1f7f741ca-20261026"
SOURCE_ID = "sha256:76b82c65b0646dff539faeaed79f22c8f62e716f1b5d484ae80647532abc2d0c"
DESCRIPTOR = "apps/ops-web/app/platform/tv-download.ts"
APK = "apps/ops-web/public/downloads/flixify-tv-1.3.0-test.1.apk"


class CatalogWebReleaseTests(unittest.TestCase):
    def test_build_context_pins_current_web_and_copies_exactly_descriptor_and_new_apk(self):
        dockerfile = tv.dockerfile(REVISION)
        self.assertEqual(dockerfile.splitlines()[0], "FROM " + SOURCE_TAG)
        self.assertIn("LABEL vip.flixify.edge-recovery.base=" + SOURCE_ID, dockerfile.splitlines())
        self.assertEqual(
            [line for line in dockerfile.splitlines() if line.startswith("COPY ")],
            [f"COPY {DESCRIPTOR} /app/{DESCRIPTOR}", f"COPY {APK} /app/{APK}"],
        )
        self.assertEqual(tv.BASE_REVISION, "b5683785e91d1504aed11315d2bdd34e986ab050")

    def test_release_configures_current_source_and_only_web_with_protected_services(self):
        release.configure(REVISION, "sha256:" + "b" * 64,
                          release_contract.WORKER_TAG, release_contract.WORKER_ID)
        self.assertEqual(release.guard.SOURCE, {"ops-web": SOURCE_TAG})
        self.assertEqual(release.guard.SOURCE_IDS, {"ops-web": SOURCE_ID})
        self.assertEqual(release.guard.CHANGED, ("ops-web",))
        self.assertEqual(release.guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(release.guard.PROTECTED_IMAGES, {
            "api": (release.API_TAG, release.API_ID),
            "worker": (release_contract.WORKER_TAG, release_contract.WORKER_ID),
        })

    def test_download_verifies_new_version_without_network_or_unbounded_container(self):
        calls = []
        candidate = "sha256:" + "b" * 64
        def command(*args, **kwargs):
            calls.append(args)
            return (candidate + "\n").encode() if args[:3] == ("docker", "inspect", "--format") else b""
        with patch.object(tv, "command", side_effect=command), contextlib.redirect_stdout(io.StringIO()):
            tv.verify_download(candidate, "c" * 64, 2048)
        run = calls[0]
        self.assertEqual(run[:4], ("docker", "run", "--rm", "-d"))
        for flag, value in (("--network", "none"), ("--memory", "512m"),
                            ("--memory-swap", "640m"), ("--pids-limit", "128")):
            self.assertEqual(run[run.index(flag) + 1], value)
        script = next(call[-1] for call in calls if call[:2] == ("docker", "exec"))
        self.assertIn("http://127.0.0.1:3000/downloads/flixify-tv-1.3.0-test.1.apk", script)
        self.assertNotIn("1.2.1", script)
        self.assertIn('method:"HEAD"', script)
        self.assertIn('Range:"bytes=0-31"', script)
        self.assertIn('application/vnd.android.package-archive', script)
        self.assertIn('createHash("sha256")', script)
        self.assertEqual(calls[-1][:4], ("docker", "stop", "-t", "10"))

    def test_download_cleanup_refuses_to_stop_a_drifted_container(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return b"sha256:wrong\n" if args[:3] == ("docker", "inspect", "--format") else b""
        with patch.object(tv, "command", side_effect=command), \
             self.assertRaisesRegex(tv.GateError, "apk_check_container_drift"):
            tv.verify_download("sha256:" + "b" * 64, "c" * 64, 2048)
        self.assertFalse(any(call[:2] == ("docker", "stop") for call in calls))

    def test_container_compile_failure_removes_only_its_owned_disposable_container(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "start"):
                raise tv.GateError("compile_failed")
            return b""
        base = {"Config": {"Cmd": ["node", "server.js"], "Volumes": None}}
        with patch.object(tv, "command", side_effect=command), \
             self.assertRaisesRegex(tv.GateError, "compile_failed"):
            tv.container_compile(REVISION, base, {APK: b"apk"}, {})
        created_name = calls[0][calls[0].index("--name") + 1]
        self.assertEqual(calls[-1], ("docker", "rm", "--force", created_name))
        self.assertFalse(any(call[:2] == ("docker", "commit") for call in calls))


class CatalogBuildActionsTests(unittest.TestCase):
    def setUp(self):
        self.apk = b"PK\x03\x04" + b"x" * 2048
        self.sha = hashlib.sha256(self.apk).hexdigest()
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)
        self.preflight = patch.object(tv.builder, "preflight", return_value=(
            {"Config": {"Cmd": ["node", "server.js"], "Volumes": None}},
            {DESCRIPTOR: b"reviewed descriptor"}, {}, b"original config",
        )).start()
        patch.object(tv, "validate_apk", return_value=self.apk).start()
        self.disk = patch.object(tv.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8 * 1024**3)).start()
        self.command = patch.object(tv, "command", return_value=b"").start()
        self.candidate = patch.object(tv.builder, "verify_candidate", return_value="sha256:" + "b" * 64).start()
        self.download = patch.object(tv, "verify_download").start()
        self.compile = patch.object(tv, "container_compile").start()
        self.addCleanup(patch.stopall)

    def run_main(self, action=None):
        argv = ["build-android-tv-catalog-web.py", "/repo", "--revision", REVISION,
                "--apk-sha256", self.sha, "--apk-bytes", str(len(self.apk))]
        if action:
            argv.append(action)
        with patch.object(sys, "argv", argv):
            tv.main()

    def test_default_preflight_performs_no_build_or_verification_mutation(self):
        self.run_main()
        self.command.assert_not_called()
        self.disk.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_not_called()
        self.download.assert_not_called()

    def test_both_build_modes_stop_below_eight_gib_before_creating_a_candidate(self):
        self.disk.return_value.free = 8 * 1024**3 - 1
        for action in ("--build", "--container-build"):
            with self.subTest(action=action), self.assertRaisesRegex(tv.GateError, "requires_8GiB"):
                self.run_main(action)
        self.command.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_not_called()

    def test_build_at_floor_has_exact_context_and_enforced_memory_network_caps(self):
        captured = {}
        def command(*args, **kwargs):
            if args[:2] == ("docker", "build"):
                root = Path(args[-1])
                captured.update({str(path.relative_to(root)): path.read_bytes()
                                 for path in root.rglob("*") if path.is_file()})
            return b""
        self.command.side_effect = command
        self.run_main("--build")
        self.assertEqual(set(captured), {"Dockerfile", DESCRIPTOR, APK})
        self.assertEqual(captured[APK], self.apk)
        args = self.command.call_args.args
        self.assertEqual(args[:2], ("docker", "build"))
        for flag in ("--load", "--pull=false", "--network=none", "--no-cache",
                     "memory=1280m", "memory-swap=1536m"):
            self.assertIn(flag, args)
        self.assertEqual(set(self.candidate.call_args.args[2]), {DESCRIPTOR, APK})
        self.download.assert_called_once()

    def test_container_build_at_floor_receives_only_descriptor_and_new_apk(self):
        self.run_main("--container-build")
        self.assertEqual(set(self.compile.call_args.args[2]), {DESCRIPTOR, APK})
        self.assertEqual(self.compile.call_args.args[2][APK], self.apk)
        self.assertFalse(any(call.args[:2] == ("docker", "build")
                             for call in self.command.call_args_list))
        self.download.assert_called_once()

    def test_existing_candidate_tag_is_never_overwritten(self):
        self.command.return_value = ("flixify-ops-web:edge-recovery-" + REVISION[:12] + "-20261026\n").encode()
        for action in ("--build", "--container-build"):
            with self.subTest(action=action), self.assertRaisesRegex(tv.GateError, "candidate_tag_already_exists"):
                self.run_main(action)
        self.compile.assert_not_called()
        self.candidate.assert_not_called()
        self.download.assert_not_called()

    def test_verify_existing_checks_download_without_build_or_disk_allocation(self):
        self.run_main("--verify-existing")
        self.command.assert_not_called()
        self.disk.assert_not_called()
        self.compile.assert_not_called()
        self.candidate.assert_called_once()
        self.download.assert_called_once_with("sha256:" + "b" * 64, self.sha, len(self.apk))


if __name__ == "__main__":
    unittest.main()
