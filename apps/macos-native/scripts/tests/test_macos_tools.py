import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_release as release
import macos_runtime as runtime


@unittest.skipUnless(sys.platform == "darwin", "Requires actual Apple command-line tools")
class InstalledMacToolsTests(unittest.TestCase):
    def setUp(self):
        self.binary = runtime.ROOT / "Vendor/VLCKit.xcframework" / runtime.EXECUTABLE_RELATIVE
        if not self.binary.is_file():
            self.skipTest("Prepare the pinned runtime first")

    def test_real_lipo_accepts_universal_runtime(self):
        self.assertEqual(release.verify_architectures(self.binary, {"arm64", "x86_64"}),
                         runtime.REQUIRED_ARCHITECTURES)

    def test_real_lipo_rejects_absent_architecture(self):
        with self.assertRaises(release.ReleaseError):
            release.run(["/usr/bin/lipo", str(self.binary), "-verify_arch", "i386"], capture=True)

    def test_real_runtime_has_supported_macos_targets_and_system_dependencies(self):
        commands = release.run(["/usr/bin/otool", "-l", str(self.binary)], capture=True)
        release.validate_macos_versions(commands)
        dependencies = release.library_dependencies(
            release.run(["/usr/bin/otool", "-L", str(self.binary)], capture=True))
        self.assertTrue(dependencies)
        self.assertEqual(dependencies[0], "@loader_path/../Frameworks/VLCKit.framework/Versions/A/VLCKit")
        self.assertTrue(all(path.startswith(("/System/Library/", "/usr/lib/"))
                            for path in dependencies[1:]))


if __name__ == "__main__":
    unittest.main()
