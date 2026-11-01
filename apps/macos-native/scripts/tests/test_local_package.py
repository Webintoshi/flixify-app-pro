import contextlib
import json
import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_release as release
import macos_local_package as local


class LocalPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / "dist/Flixify Pro.app"
        (self.app / "Contents/MacOS").mkdir(parents=True)
        (self.app / "Contents/Resources").mkdir()
        self.main = self.app / "Contents/MacOS/FlixifyMac"
        self.main.write_bytes(b"local executable fixture")
        self.main.chmod(0o755)
        self.resource = self.app / "Contents/Resources/catalog.json"
        self.resource.write_text('{"items":[]}')
        self.info = {"CFBundleIdentifier": "vip.flixify.mac", "CFBundleExecutable": "FlixifyMac",
                     "CFBundleShortVersionString": release.VERSION, "CFBundleVersion": str(release.BUILD),
                     "LSMinimumSystemVersion": "13.0", "CFBundlePackageType": "APPL",
                     "FlixifyBuildConfiguration": "release", "FlixifyArchitectures": ["arm64", "x86_64"]}
        self.write_info()
        self.created_images = 0
        self.detached = False
        self.verified = False
        self.fail_verify = False
        self.tamper_mounted = False
        self.mutate_source = False
        self.fail_detach = False
        self.unexpected_mount = False
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.object(local, "ROOT", self.root))
        stack.enter_context(patch.object(local, "run", side_effect=self.os_command))
        stack.enter_context(patch.object(local, "audit_app", return_value=[]))
        stack.enter_context(patch.object(local, "require_adhoc_signature"))
        stack.enter_context(patch("macos_privacy.known_personal_identifiers", return_value=set()))

    def write_info(self):
        (self.app / "Contents/Info.plist").write_bytes(plistlib.dumps(self.info))

    def os_command(self, args, **kwargs):
        if args[:2] == ["/usr/bin/codesign", "--verify"]:
            self.assertNotIn("--sign", args)
            return ""
        if args[:2] == ["/usr/bin/hdiutil", "create"]:
            self.image_root = Path(args[args.index("-srcfolder") + 1])
            self.assertEqual((self.image_root / "Applications").readlink(), Path("/Applications"))
            self.assertTrue((self.image_root / "Flixify Pro.app/Contents/MacOS/FlixifyMac").is_file())
            self.assertTrue((self.image_root / "OKU-BENI.txt").is_file())
            self.assertIn("UDZO", args)
            self.created_images += 1
            Path(args[-1]).write_bytes(b"local disk image fixture")
            if self.mutate_source:
                self.resource.write_text('{"changed":true}')
            return ""
        if args[:2] == ["/usr/bin/hdiutil", "verify"]:
            if self.fail_verify:
                raise release.ReleaseError("Disk image verification failed")
            self.verified = True
            return ""
        if args[:2] == ["/usr/bin/hdiutil", "attach"]:
            self.assertTrue(self.verified, "Never mount an image before verifying it")
            self.assertIn("-readonly", args)
            self.assertIn("-nobrowse", args)
            mount = Path(args[args.index("-mountpoint") + 1])
            shutil.copytree(self.image_root, mount, symlinks=True, dirs_exist_ok=True)
            if self.tamper_mounted:
                (mount / "Flixify Pro.app/Contents/Resources/catalog.json").write_text("tampered")
            reported_mount = mount.parent / "unexpected" if self.unexpected_mount else mount
            return plistlib.dumps({"system-entities": [{"dev-entry": "/dev/disk99s1",
                                                        "mount-point": str(reported_mount)}]}).decode()
        if args[:2] == ["/usr/bin/hdiutil", "detach"]:
            self.detached = True
            if self.fail_detach:
                raise release.ReleaseError("Could not detach fixture image")
            shutil.rmtree(args[-1])
            return ""
        self.fail(f"Unexpected local-package OS action: {args[0:2]}")

    def assert_no_output(self):
        destination = self.root / "dist/local-test"
        self.assertFalse(list(destination.glob("*.dmg")))
        self.assertFalse(list(destination.glob("*.json")))
        self.assertFalse(list((self.root / "dist").glob(".local-test-*")))

    def test_image_preserves_app_and_emits_only_explicit_local_proof(self):
        before = {str(p.relative_to(self.app)): p.read_bytes() for p in self.app.rglob("*") if p.is_file()}
        image = local.package_local_test(self.app)
        self.assertEqual(image.parent, self.root / "dist/local-test")
        self.assertIn("-LOCAL-TEST-", image.name)
        self.assertEqual(image.read_bytes(), b"local disk image fixture")
        proof = json.loads(image.with_suffix(".json").read_text())
        self.assertFalse(proof["publicDistributionReady"])
        self.assertEqual(proof["distributionKind"], "local-test")
        self.assertFalse(proof["notarized"])
        self.assertFalse(proof["gatekeeperApprovalClaimed"])
        self.assertTrue(proof["mountedAppMatchesSource"])
        self.assertTrue(self.detached)
        self.assertEqual(before, {str(p.relative_to(self.app)): p.read_bytes() for p in self.app.rglob("*") if p.is_file()})
        self.assertFalse((self.root / "dist/public").exists())
        self.assertFalse(list((self.root / "dist").rglob("flixify-macos-update.json")))
        self.assertFalse(list((self.root / "dist").glob(".local-test-*")))

    def test_debug_and_single_architecture_do_not_produce_installers(self):
        for configuration, arches in [("debug", ["arm64", "x86_64"]), ("release", ["arm64"])]:
            self.info.update(FlixifyBuildConfiguration=configuration, FlixifyArchitectures=arches)
            self.write_info()
            with self.assertRaises(release.ReleaseError):
                local.package_local_test(self.app)
            self.assert_no_output()
        self.assertEqual(self.created_images, 0)

    def test_private_file_stops_packaging_before_image_creation(self):
        (self.app / "Contents/Resources/.env.local").write_text("PRIVATE_TOKEN=fixture")
        with self.assertRaises(release.ReleaseError):
            local.package_local_test(self.app)
        self.assertEqual(self.created_images, 0)
        self.assert_no_output()

    def test_failed_disk_image_verification_has_no_final_artifact(self):
        self.fail_verify = True
        with self.assertRaises(release.ReleaseError):
            local.package_local_test(self.app)
        self.assertFalse(self.detached)
        self.assert_no_output()

    def test_mounted_app_tampering_is_detected_and_disk_is_detached(self):
        self.tamper_mounted = True
        with self.assertRaises(release.ReleaseError):
            local.package_local_test(self.app)
        self.assertTrue(self.detached)
        self.assertEqual(self.resource.read_text(), '{"items":[]}')
        self.assert_no_output()

    def test_unexpected_mount_layout_still_detaches_and_has_no_output(self):
        self.unexpected_mount = True
        with self.assertRaises(release.ReleaseError):
            local.package_local_test(self.app)
        self.assertTrue(self.detached)
        self.assert_no_output()

    def test_failed_detach_never_deletes_a_still_mounted_staging_tree(self):
        self.fail_detach = True
        with patch.object(Path, "is_mount", autospec=True, side_effect=lambda p: p.name == "mounted"):
            with self.assertRaises(release.ReleaseError):
                local.package_local_test(self.app)
        self.assertTrue(self.detached)
        self.assertEqual(len(list((self.root / "dist").glob(".local-test-*"))), 1)
        self.assertFalse(list((self.root / "dist/local-test").glob("*.dmg")))
        self.assertEqual(self.resource.read_text(), '{"items":[]}')

    def test_insufficient_space_does_not_create_or_delete_payloads(self):
        with patch.object(local.shutil, "disk_usage", return_value=SimpleNamespace(free=0)):
            with self.assertRaises(release.ReleaseError):
                local.package_local_test(self.app)
        self.assertEqual(self.created_images, 0)
        self.assertEqual(self.resource.read_text(), '{"items":[]}')
        self.assert_no_output()

    def test_source_changed_during_packaging_cannot_get_current_artifact_claim(self):
        self.mutate_source = True
        with self.assertRaises(release.ReleaseError):
            local.package_local_test(self.app)
        self.assertTrue(self.detached)
        self.assert_no_output()

    def test_existing_local_image_is_never_overwritten(self):
        image = local.package_local_test(self.app)
        original = image.read_bytes()
        count = self.created_images
        with self.assertRaises(release.ReleaseError):
            local.package_local_test(self.app)
        self.assertEqual(image.read_bytes(), original)
        self.assertEqual(self.created_images, count)

    def test_output_directory_symlink_cannot_write_elsewhere(self):
        outside = self.root / "unrelated"
        outside.mkdir()
        (self.root / "dist/local-test").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(release.ReleaseError):
            local.package_local_test(self.app)
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(self.created_images, 0)

    def test_cleanup_rejects_unrelated_directory(self):
        unrelated = self.root / "dist/unrelated"
        unrelated.mkdir()
        sentinel = unrelated / "keep.txt"
        sentinel.write_text("unrelated data")
        with self.assertRaises(release.ReleaseError):
            local.cleanup_staging(unrelated)
        self.assertEqual(sentinel.read_text(), "unrelated data")

    def test_cleanup_rejects_symlink_and_mounted_directory(self):
        target = self.root / "keep"
        target.mkdir()
        (target / "keep.txt").write_text("keep")
        link = self.root / "dist/.local-test-link"
        link.symlink_to(target, target_is_directory=True)
        with self.assertRaises(release.ReleaseError):
            local.cleanup_staging(link)
        self.assertEqual((target / "keep.txt").read_text(), "keep")
        staging = self.root / "dist/.local-test-fixture"
        (staging / "mounted").mkdir(parents=True)
        with patch.object(Path, "is_mount", return_value=True), self.assertRaises(release.ReleaseError):
            local.cleanup_staging(staging)
        self.assertTrue(staging.exists())


class LocalSignatureTests(unittest.TestCase):
    def test_only_existing_adhoc_signature_is_accepted_without_resigning(self):
        app = Path("Fixture.app")
        for text in ["Signature=adhoc\n", "Authority=Developer ID Application: Example Organization\n",
                     "Authority=Apple Development: Example Developer\n", "Signature=invalid\n"]:
            result = subprocess.CompletedProcess([], 0, "", text)
            with patch.object(local.subprocess, "run", return_value=result) as runner:
                if text == "Signature=adhoc\n":
                    local.require_adhoc_signature(app)
                else:
                    with self.assertRaises(release.ReleaseError):
                        local.require_adhoc_signature(app)
                args = runner.call_args.args[0]
                self.assertIn("--display", args)
                self.assertNotIn("--sign", args)


if __name__ == "__main__":
    unittest.main()
