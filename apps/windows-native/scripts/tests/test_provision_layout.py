from pathlib import Path
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
import provision


class ProvisionLayoutTests(unittest.TestCase):
    def populate(self, root):
        qt = root / 'Qt' / '6.11.3' / 'msvc2022_64'
        deps = root / 'deps'
        for path in provision.required_layout(qt, deps, '3.0.24', '3.11'):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'checked upstream file')
        return qt, deps

    def test_official_nsis_launcher_and_bin_compiler_are_both_expected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            qt, deps = self.populate(root)
            environment = provision.validate_layout(qt, deps, '3.0.24', '3.11')
            self.assertEqual(environment['NSIS_ROOT'], str(deps / 'nsis' / 'nsis-3.11'))
            self.assertEqual(len(list((deps / 'nsis').rglob('makensis.exe'))), 2)

    def test_missing_qt_tool_reports_exact_path(self):
        with tempfile.TemporaryDirectory() as directory:
            qt, deps = self.populate(Path(directory))
            missing = qt / 'bin' / 'windeployqt.exe'
            missing.unlink()
            with self.assertRaisesRegex(ValueError, 'windeployqt.exe'):
                provision.validate_layout(qt, deps, '3.0.24', '3.11')

    def test_missing_vlc_codec_and_nsis_stub_report_both_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            qt, deps = self.populate(Path(directory))
            codec = deps / 'vlc' / 'vlc-3.0.24' / 'plugins' / 'codec' / 'libavcodec_plugin.dll'
            stub = deps / 'nsis' / 'nsis-3.11' / 'Stubs' / 'zlib-x86-unicode'
            codec.unlink()
            stub.unlink()
            with self.assertRaises(ValueError) as error:
                provision.validate_layout(qt, deps, '3.0.24', '3.11')
            self.assertIn(str(codec), str(error.exception))
            self.assertIn(str(stub), str(error.exception))

    def test_unrelated_recursive_compiler_cannot_replace_versioned_root(self):
        with tempfile.TemporaryDirectory() as directory:
            qt, deps = self.populate(Path(directory))
            expected = deps / 'nsis' / 'nsis-3.11' / 'makensis.exe'
            expected.unlink()
            other = deps / 'nsis' / 'unrelated' / 'makensis.exe'
            other.parent.mkdir()
            other.write_bytes(b'not selected')
            with self.assertRaisesRegex(ValueError, 'nsis-3.11'):
                provision.validate_layout(qt, deps, '3.0.24', '3.11')


if __name__ == '__main__':
    unittest.main()
