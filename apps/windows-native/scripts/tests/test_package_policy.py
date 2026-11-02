import importlib.util
import json
from pathlib import Path
import tempfile
import struct
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'package_policy.py'
spec = importlib.util.spec_from_file_location('package_policy', SCRIPT)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def minimal_pe(import_name=None):
    data = bytearray(1024)
    data[:2] = b'MZ'
    struct.pack_into('<I', data, 60, 128)
    data[128:132] = b'PE\0\0'
    struct.pack_into('<HH', data, 132, 0x8664, 1)
    struct.pack_into('<H', data, 148, 240)
    struct.pack_into('<H', data, 152, 0x20b)
    section = 152 + 240
    data[section:section + 8] = b'.rdata\0\0'
    struct.pack_into('<IIII', data, section + 8, 512, 4096, 512, 512)
    if import_name:
        struct.pack_into('<II', data, 152 + 112 + 8, 4096, 40)
        struct.pack_into('<I', data, 512 + 12, 4096 + 128)
        name = import_name.encode('ascii') + b'\0'
        data[640:640 + len(name)] = name
    return bytes(data)


class PackagePolicyTests(unittest.TestCase):
    def test_digest_rejects_corrupt_download(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'runtime.7z'
            archive.write_bytes(b'corrupted')
            with self.assertRaises(ValueError):
                policy.verify_digest(archive, '0' * 64)

    def test_absolute_home_paths_found_in_utf8_and_utf16(self):
        for data in [b'C:\\Users\\Builder\\private.cpp', '/Users/person/private.cpp'.encode('utf-16le')]:
            self.assertTrue(policy.privacy_findings(data))
        self.assertFalse(policy.privacy_findings(b'C:\\flixify\\source\\main.cpp'))

    def test_nul_separated_ascii_fragments_do_not_create_fake_paths(self):
        self.assertFalse(policy.privacy_findings(b'C:\\\x00Users\\name'))

    def test_real_utf16_both_byte_orders_and_email_tokens_remain_detected(self):
        for value in ('C:\\Users\\Owner\\private.cpp', 'owner@example.invalid', 'ghp_abcdefghijklmnop'):
            for encoding in ('utf-16le', 'utf-16be'):
                self.assertTrue(policy.privacy_findings(value.encode(encoding)))

    def test_scalar_adjacent_to_dynamic_library_name_keeps_strict_privacy_gate(self):
        scalar = struct.pack('<d', 100.0)
        self.assertEqual(policy.privacy_findings(scalar + b'libvlc.dll\0'), ['3'])
        self.assertFalse(policy.privacy_findings(scalar + 'libvlc.dll'.encode('utf-16le') + b'\0\0'))
        for encoding in ('utf-8', 'utf-16le', 'utf-16be'):
            self.assertEqual(policy.privacy_findings('owner@example.invalid'.encode(encoding)), ['3'])

    def test_safe_privacy_diagnostics_never_include_matched_values(self):
        data = b'C:\\Users\\SecretOwner\\private.cpp'
        report = policy.privacy_diagnostics(data)
        self.assertTrue(report['findings'])
        text = json.dumps(report)
        self.assertNotIn('SecretOwner', text)
        self.assertNotIn('private.cpp', text)
        self.assertIn('offset', text)
        self.assertIn('encoding', text)
        self.assertIn('region', text)

    def test_rejects_missing_runtime_and_debug_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'private.pdb').write_bytes(b'x')
            errors = policy.stage_findings(root)
            self.assertTrue(any('private.pdb' in error for error in errors))
            self.assertTrue(any('libvlc.dll' in error for error in errors))
            self.assertTrue(any('qwindows.dll' in error for error in errors))

    def test_smoke_proof_requires_every_screen_and_actual_playback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'smoke.json').write_text(json.dumps({'passed': True, 'localMediaPlaying': False}))
            with self.assertRaises(ValueError):
                policy.verify_smoke(root)

    def test_smoke_proof_requires_nonempty_pngs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proof = {'passed': True, 'localMediaPlaying': True, 'fixtureHttp': True,
                     'codecFixtures': {'tsMp2': True, 'mkvTracks': True}}
            (root / 'smoke.json').write_text(json.dumps(proof))
            for name in policy.SMOKE_SCREENS:
                (root / (name + '.png')).write_bytes(b'')
            with self.assertRaises(ValueError):
                policy.verify_smoke(root)

    def smoke_proof(self, root, codecs=None, omit=None):
        proof = {'passed': True, 'localMediaPlaying': True, 'fixtureHttp': True}
        if codecs is not None:
            proof['codecFixtures'] = codecs
        (root / 'smoke.json').write_text(json.dumps(proof))
        for name in ('home', 'live', 'search', 'series', 'account', 'player', 'ts-player', 'mkv-player'):
            if name != omit:
                (root / (name + '.png')).write_bytes(b'\x89PNG\r\n\x1a\n' + b'x' * 2048)

    def test_smoke_requires_both_codec_results(self):
        for codecs in (None, {'tsMp2': True, 'mkvTracks': False}, {'tsMp2': False, 'mkvTracks': True}):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.smoke_proof(root, codecs)
                with self.assertRaises(ValueError):
                    policy.verify_smoke(root)

    def test_smoke_requires_each_codec_screenshot(self):
        for missing in ('ts-player', 'mkv-player'):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.smoke_proof(root, {'tsMp2': True, 'mkvTracks': True}, missing)
                with self.assertRaises(ValueError):
                    policy.verify_smoke(root)

    def test_complete_codec_smoke_proof_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.smoke_proof(root, {'tsMp2': True, 'mkvTracks': True})
            self.assertTrue(policy.verify_smoke(root)['passed'])

    def install_proof(self, root):
        report = {
            'passed': True, 'installedExeMatchesStage': True, 'installedWindowStarted': True,
            'userDataPreservedAcrossUpgradeAndUninstall': True, 'uninstallerRemovedApp': True,
            'desktopShortcutCreated': True, 'startMenuShortcutCreated': True,
            'shortcutPropertiesVerified': True, 'desktopShortcutRestoredOnUpgrade': True,
            'ownedShortcutRepairedOnUpgrade': True, 'ownedShortcutsRemovedOnUninstall': True,
            'unrelatedDesktopShortcutPreserved': True,
        }
        (root / 'install-report.json').write_text(json.dumps(report))
        window = {'passed': True, 'closePosted': True, 'exitedWithinTimeout': True,
                  'exitCode': 0, 'cleanupTerminatedProcess': False,
                  'launchMethod': 'desktop shortcut',
                  'closeMethod': 'WM_CLOSE to exact visible unowned Flixify Pro root window'}
        for name in ('installed-window-report.json', 'installed-window-upgrade-report.json'):
            (root / name).write_text(json.dumps(window))
        return report

    def test_install_proof_rejects_missing_desktop_shortcut_even_if_old_checks_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = self.install_proof(root)
            del report['desktopShortcutCreated']
            (root / 'install-report.json').write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError, 'desktopShortcutCreated'):
                policy.verify_install(root)

    def test_install_proof_rejects_skipped_shortcut_properties_upgrade_or_preservation(self):
        for key in ('shortcutPropertiesVerified', 'desktopShortcutRestoredOnUpgrade',
                    'ownedShortcutRepairedOnUpgrade', 'ownedShortcutsRemovedOnUninstall',
                    'unrelatedDesktopShortcutPreserved'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                report = self.install_proof(root)
                report[key] = False
                (root / 'install-report.json').write_text(json.dumps(report))
                with self.assertRaisesRegex(ValueError, key):
                    policy.verify_install(root)

    def test_install_proof_rejects_force_cleanup_or_abnormal_shortcut_launch_exit(self):
        for name in ('installed-window-report.json', 'installed-window-upgrade-report.json'):
            for key, value in (('cleanupTerminatedProcess', True), ('exitCode', 1),
                               ('closePosted', False), ('launchMethod', 'executable')):
                with self.subTest(report=name, key=key), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    self.install_proof(root)
                    window = json.loads((root / name).read_text())
                    window[key] = value
                    (root / name).write_text(json.dumps(window))
                    with self.assertRaises(ValueError):
                        policy.verify_install(root)

    def test_complete_install_shortcut_and_normal_close_proof_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.install_proof(root)
            self.assertTrue(policy.verify_install(root)['passed'])

    def test_codec_fixture_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('h264-mp2.ts', 'two-audio-subtitles.mkv'):
                (root / name).write_bytes(b'corrupt fixture')
            (root / 'provenance.json').write_text(json.dumps({
                'syntheticGeneratedLocally': True,
                'sha256': {'h264-mp2.ts': '0' * 64, 'two-audio-subtitles.mkv': '0' * 64}
            }))
            with self.assertRaises(ValueError):
                policy.verify_codec_fixtures(root)

    def test_lock_is_https_versioned_and_sha256_pinned(self):
        lock = json.loads((SCRIPT.parent / 'dependencies.lock.json').read_text())
        policy.verify_lock(lock)
        lock['archives'][0]['sha256'] = 'wrong'
        with self.assertRaises(ValueError):
            policy.verify_lock(lock)

    def test_prune_qt_test_only_after_smoke_and_without_production_imports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'Flixify Pro.exe').write_bytes(minimal_pe('Qt6Core.dll'))
            (root / 'Qt6Core.dll').write_bytes(minimal_pe())
            (root / 'Qt6Test.dll').write_bytes(minimal_pe())
            self.assertTrue(policy.prune_test_runtime(root))
            self.assertFalse((root / 'Qt6Test.dll').exists())
            self.assertTrue((root / 'Qt6Core.dll').exists())

    def test_prune_rejects_any_remaining_plugin_requiring_qt_test(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'Qt6Test.dll').write_bytes(minimal_pe())
            (root / 'plugin.dll').write_bytes(minimal_pe('Qt6Test.dll'))
            with self.assertRaisesRegex(ValueError, 'plugin.dll'):
                policy.prune_test_runtime(root)
            self.assertTrue((root / 'Qt6Test.dll').exists())

    def test_prune_rejects_live_smoke_harness(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'ui_smoke.exe').write_bytes(minimal_pe('Qt6Test.dll'))
            (root / 'Qt6Test.dll').write_bytes(minimal_pe())
            with self.assertRaises(ValueError):
                policy.prune_test_runtime(root)
            self.assertTrue((root / 'Qt6Test.dll').exists())

    def test_uninstaller_manifest_deletes_only_payload_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'plugins').mkdir()
            (root / 'Flixify Pro.exe').write_bytes(b'app')
            (root / 'plugins' / 'codec.dll').write_bytes(b'codec')
            manifest = policy.uninstall_manifest(root)
            self.assertIn('Delete \"$INSTDIR\\Flixify Pro.exe\"', manifest)
            self.assertIn('Delete \"$INSTDIR\\plugins\\codec.dll\"', manifest)
            self.assertNotIn('RMDir /r', manifest)
            self.assertNotIn('Delete \"$INSTDIR\\*', manifest)
            self.assertNotIn('user-created', manifest)

    def test_uninstaller_manifest_escapes_nsis_variables_in_filenames(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '$PROFILE.txt').write_bytes(b'notice')
            self.assertIn('$$PROFILE.txt', policy.uninstall_manifest(root))

    def test_pe_parser_rejects_non_pe_without_external_command(self):
        with self.assertRaises(ValueError):
            policy.pe_imports(b'not a PE executable')

    def test_zip_path_traversal_rejected(self):
        for name in ['../escape.dll', '/absolute.dll', 'C:/escape.dll', 'foo/../../escape.dll']:
            with self.assertRaises(ValueError):
                policy.safe_archive_name(name)


if __name__ == '__main__':
    unittest.main()
