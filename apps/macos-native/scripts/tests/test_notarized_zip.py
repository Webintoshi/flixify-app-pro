import contextlib
import json
import os
import plistlib
import shutil
import stat
import struct
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_notarized_zip as packaged
import macos_privacy as privacy
import macos_release as release
from test_individual_identity import certificate, macho, policy


class NotarizedZipTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); (self.root / 'dist').mkdir()
        self.app = self.root / 'Accepted/Flixify Pro.app'
        self.binary = self.app / 'Contents/MacOS/FlixifyMac'; self.binary.parent.mkdir(parents=True)
        self.cert = certificate(); first = macho(self.cert, cpu=0x01000007); second = macho(self.cert)
        entries = struct.pack('>5I', 0x01000007, 0, 48, len(first), 0) + struct.pack('>5I', 0x0100000c, 0, 48 + len(first), len(second), 0)
        self.binary.write_bytes(struct.pack('>II', 0xcafebabe, 2) + entries + first + second); self.binary.chmod(0o755)
        info = {'CFBundleIdentifier': release.BUNDLE_ID, 'CFBundleExecutable': release.PRODUCT,
                'CFBundleShortVersionString': release.VERSION, 'CFBundleVersion': str(release.BUILD),
                'LSMinimumSystemVersion': release.MINIMUM_SYSTEM, 'CFBundlePackageType': 'APPL',
                'FlixifyBuildConfiguration': 'release', 'FlixifyArchitectures': ['arm64', 'x86_64']}
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
        self.resource = self.app / 'Contents/Resources/catalog.json'; self.resource.parent.mkdir(); self.resource.write_text('{"fixture":true}')
        self.policy = self.root / 'approved-policy.json'; self.policy.write_text(json.dumps(policy(self.cert)))
        self.calls = []; self.notary_source = True; self.missing_ticket = False; self.extracted_ticket_missing = False
        self.tamper_extracted = False; self.tamper_source = False; self.bad_certificate = False; self.tamper_attributes = False
        self.archive_attributes = {}; self.xattrs = {}; self.tamper_source_attributes = False; self.unsafe_archive_entry = None; self.extracted_private_note = None
        stack = contextlib.ExitStack(); self.addCleanup(stack.close)
        stack.enter_context(patch.object(packaged, 'ROOT', self.root))
        stack.enter_context(patch.object(packaged, 'run', side_effect=self.command))
        stack.enter_context(patch.object(packaged, 'audit_app', return_value=[]))
        stack.enter_context(patch.object(packaged, 'known_personal_identifiers', return_value={'Private Person'}))
        stack.enter_context(patch.object(privacy, '_signature_command', side_effect=self.command))

    def command(self, args):
        self.calls.append(args)
        self.assertNotIn('--sign', args, 'An accepted app must never be re-signed')
        self.assertNotIn('notarytool', args, 'This flow consumes an already accepted app')
        if args[0] == '/usr/bin/xattr':
            values = self.xattrs.get(args[-1], {})
            return values.get(args[-2], b'').hex().encode() if '-p' in args else '\n'.join(values).encode()
        if args[0] == '/usr/bin/codesign':
            extract = [s for s in args if s.startswith('--extract-certificates=')]
            if extract:
                Path(extract[0].split('=', 1)[1] + '0').write_bytes(certificate(b'wrong') if self.bad_certificate else self.cert)
            return b'Authority=Developer ID Application: Private Person (ABCDEFGHIJ)\nAuthority=Apple Root CA\nTeamIdentifier=ABCDEFGHIJ\n'
        if args[:3] == ['/usr/bin/xcrun', 'stapler', 'validate']:
            self.assertTrue(args[-1].endswith('.app'))
            if self.missing_ticket or self.extracted_ticket_missing and '/extracted/' in args[-1]:
                raise release.ReleaseError('Notarization ticket missing')
            return b'Ticket validated\n'
        if args[0] == '/usr/sbin/spctl':
            return b'accepted\nsource=' + (b'Notarized Developer ID' if self.notary_source else b'Developer ID') + b'\n'
        if args[:4] == ['/usr/bin/ditto', '-c', '-k', '--keepParent']:
            self.assertIn('--sequesterRsrc', args)
            source, archive = Path(args[-2]), Path(args[-1])
            with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
                for f in [source, *sorted(source.rglob('*'))]:
                    z.write(f, (Path(source.name) / f.relative_to(source)).as_posix())
                    self.archive_attributes[f.relative_to(source).as_posix()] = self.xattrs.get(str(f), {}).copy()
                if self.unsafe_archive_entry: z.writestr(self.unsafe_archive_entry, b'unsafe')
            if self.tamper_source: self.resource.write_text('changed during export')
            if self.tamper_source_attributes: self.xattrs[str(source)] = {'com.flixify.fixture': b'changed source metadata'}
            return b''
        if args[:3] == ['/usr/bin/ditto', '-x', '-k']:
            archive, destination = Path(args[-2]), Path(args[-1])
            with zipfile.ZipFile(archive) as z:
                z.extractall(destination)
                for member in z.infolist():
                    os.chmod(destination / member.filename, stat.S_IMODE(member.external_attr >> 16))
            for relative, values in self.archive_attributes.items():
                f = destination / self.app.name / relative
                self.xattrs[str(f)] = values.copy()
            if self.tamper_attributes: self.xattrs[str(destination / self.app.name / 'Contents/MacOS/FlixifyMac')] = {'com.flixify.fixture': b'changed'}
            if self.extracted_private_note is not None:
                self.xattrs[str(destination / self.app.name)] = {'com.flixify.private-note': self.extracted_private_note}
            if self.tamper_extracted: (destination / self.app.name / 'Contents/Resources/catalog.json').write_text('tampered')
            return b''
        self.fail('Unexpected packaging operation: ' + str(args[:3]))

    def package(self):
        return packaged.package_notarized_zip(self.app, self.policy, 'DCA10DBD-0291-4744-AAA8-A594A7B1C61A')

    def assert_no_public_output(self):
        self.assertFalse(any((self.root / 'dist').rglob('*.zip')))
        self.assertFalse(any((self.root / 'dist').rglob('flixify-macos-zip.json')))

    def test_accepted_stapled_app_round_trip_is_unchanged_and_has_zip_only_descriptor(self):
        original = self.binary.read_bytes(); output = self.package()
        self.assertEqual(self.binary.read_bytes(), original)
        descriptor = json.loads((output.parent / 'flixify-macos-zip.json').read_text())
        proof = json.loads((output.parent / 'zip-release-proof.json').read_text())
        self.assertEqual(descriptor['format'], 'zip')
        self.assertEqual(descriptor['zipUrl'], 'https://flixify.vip/downloads/' + output.name)
        self.assertNotIn('dmgUrl', descriptor)
        self.assertFalse((output.parent / 'flixify-macos-update.json').exists())
        self.assertTrue(proof['publicDistributionReady'])
        self.assertTrue(proof['sourceAppUnchanged'])
        self.assertTrue(proof['extractedAppMatchesSource'])
        self.assertEqual(proof['sourceAppManifestSha256'], proof['extractedAppManifestSha256'])
        self.assertNotIn('Private Person', json.dumps(proof))
        self.assertEqual(sum(a[0] == '/usr/sbin/spctl' for a in self.calls), 2)
        self.assertEqual(sum(a[:3] == ['/usr/bin/xcrun', 'stapler', 'validate'] for a in self.calls), 2)

    def test_non_notarized_gatekeeper_source_or_missing_ticket_cannot_publish(self):
        for field in ('notary_source', 'missing_ticket', 'extracted_ticket_missing'):
            setattr(self, field, field != 'notary_source')
            with self.subTest(field=field), self.assertRaises(release.ReleaseError): self.package()
            self.assert_no_public_output()
            setattr(self, field, field == 'notary_source')

    def test_changed_source_or_extracted_resource_cannot_publish(self):
        for field in ('tamper_source', 'tamper_extracted'):
            self.resource.write_text('{"fixture":true}'); setattr(self, field, True)
            with self.subTest(field=field), self.assertRaises(release.ReleaseError): self.package()
            self.assert_no_public_output(); setattr(self, field, False)

    def test_wrong_certificate_and_unapproved_policy_cannot_publish(self):
        self.bad_certificate = True
        with self.assertRaises(release.ReleaseError): self.package()
        self.assert_no_public_output(); self.bad_certificate = False
        self.policy.write_text(json.dumps({**policy(self.cert), 'personalNameVisibilityAccepted': False}))
        with self.assertRaises(release.ReleaseError): self.package()
        self.assert_no_public_output()

    def test_existing_version_output_is_immutable(self):
        output = self.package(); original = output.read_bytes()
        with self.assertRaises(release.ReleaseError): self.package()
        self.assertEqual(output.read_bytes(), original)

    def test_gatekeeper_override_does_not_substitute_for_notarization(self):
        self.notary_source = False
        with self.assertRaises(release.ReleaseError): self.package()
        self.assert_no_public_output()

    def test_extended_attribute_change_cannot_publish(self):
        self.xattrs[str(self.binary)] = {'com.flixify.fixture': b'original ticket metadata'}
        self.tamper_attributes = True
        with self.assertRaises(release.ReleaseError): self.package()
        self.assert_no_public_output()

    def test_distribution_parent_symlink_cannot_redirect_output(self):
        elsewhere = self.root / 'outside'; elsewhere.mkdir()
        (self.root / 'dist/public-zip').symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaises(release.ReleaseError): self.package()
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_source_directory_metadata_must_remain_unchanged(self):
        self.xattrs[str(self.app)] = {'com.flixify.fixture': b'original source metadata'}
        self.tamper_source_attributes = True
        with self.assertRaises(release.ReleaseError): self.package()
        self.assert_no_public_output()

    def test_unsafe_archive_entry_is_rejected_before_extraction(self):
        for entry in ('../escape', '/absolute', 'Flixify Pro.app/../../escape', 'Other.app/payload'):
            self.unsafe_archive_entry = entry; self.calls.clear()
            with self.subTest(entry=entry), self.assertRaises(release.ReleaseError): self.package()
            self.assertFalse(any(args[:3] == ['/usr/bin/ditto', '-x', '-k'] for args in self.calls))
            self.assert_no_public_output()

    def test_publication_error_removes_only_our_partial_outputs(self):
        actual_link = os.link; calls = []
        def fail_second(source, target):
            calls.append(target)
            if len(calls) == 2: raise OSError('Controlled publication failure')
            actual_link(source, target)
        with patch.object(packaged.os, 'link', side_effect=fail_second), self.assertRaises(OSError): self.package()
        self.assert_no_public_output()

    def test_private_source_attribute_values_cannot_be_published(self):
        for value in (b'Private Person', b'/Users/Private Person/private-source personal@example.test', b'/Users/other/source',
                      b'/private/var/folders/private-build', b'/private/tmp/source', b'personal@example.test',
                      b'https://provider.test/live/customer/secret/1.ts',
                      '/Users/other/source'.encode('utf-16-be')):
            self.xattrs = {str(self.resource): {'com.flixify.private-note': value}}
            with self.subTest(valueRole=value[:8]):
                try:
                    with self.assertRaises(release.ReleaseError): self.package()
                    self.assert_no_public_output()
                finally:
                    destination = self.root / 'dist/public-zip'
                    if destination.exists(): shutil.rmtree(destination)

    def test_private_attribute_name_is_not_hidden_by_safe_value(self):
        self.xattrs[str(self.resource)] = {'com.PrivatePerson.note': b'ordinary metadata'}
        with patch.object(packaged, 'known_personal_identifiers', return_value={'PrivatePerson'}), self.assertRaises(release.ReleaseError): self.package()
        self.assert_no_public_output()

    def test_private_extracted_directory_attribute_cannot_bypass_content_manifest(self):
        self.extracted_private_note = b'/Users/Private Person/private-source personal@example.test'
        with self.assertRaises(release.ReleaseError): self.package()
        self.assert_no_public_output()


@unittest.skipUnless(sys.platform == 'darwin', 'Checks the real macOS ditto/xattr contract')
class RealDittoRoundTripTests(unittest.TestCase):
    def test_real_attribute_values_are_rejected_without_removing_them(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'Flixify Pro.app'; resource = app / 'Contents/Resources/fixture.json'
            resource.parent.mkdir(parents=True); resource.write_bytes(b'owned privacy fixture')
            values = (b'Private Person', b'/Users/other/source', b'/private/var/folders/private-build',
                      b'/private/tmp/source', b'/tmp/local-source', b'personal@example.test',
                      b'https://provider.test/player_api.php?username=customer&password=secret',
                      '/Users/other/source'.encode('utf-16-le'), '/Users/other/source'.encode('utf-16-be'))
            for target in (app, resource):
                for value in values:
                    packaged.run(['/usr/bin/xattr', '-w', '-x', 'com.flixify.private-note', value.hex(), str(target)])
                    with self.subTest(targetRole='directory' if target == app else 'resource', valueRole=value[:8]), self.assertRaises(release.ReleaseError) as error:
                        packaged.audit_extended_attribute_privacy(app, {'Private Person'})
                    self.assertNotIn('Private Person', str(error.exception))
                    self.assertNotIn('personal@example.test', str(error.exception))
                    self.assertEqual(packaged.extended_attributes(target)['com.flixify.private-note'], value)
                packaged.run(['/usr/bin/xattr', '-d', 'com.flixify.private-note', str(target)])

    def test_real_attribute_names_are_checked_and_brand_contact_is_allowed(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'Flixify Pro.app'; app.mkdir()
            packaged.run(['/usr/bin/xattr', '-w', 'com.PrivatePerson.note', 'ordinary metadata', str(app)])
            with self.assertRaises(release.ReleaseError): packaged.audit_extended_attribute_privacy(app, {'PrivatePerson'})
            packaged.run(['/usr/bin/xattr', '-d', 'com.PrivatePerson.note', str(app)])
            packaged.run(['/usr/bin/xattr', '-w', 'com.flixify.contact', 'destek@flixify.vip', str(app)])
            report = packaged.audit_extended_attribute_privacy(app, {'Private Person'})
            self.assertTrue(report['passed'])
            self.assertFalse(report['certificateSubjectExceptionsApplied'])

    def test_ditto_retains_executable_mode_internal_links_and_extended_attributes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); app = root / 'Flixify Pro.app'; content = app / 'Contents/MacOS'
            content.mkdir(parents=True); executable = content / 'FlixifyMac'
            executable.write_bytes(b'owned archive contract fixture'); executable.chmod(0o755)
            (app / 'Contents/current').symlink_to('MacOS')
            packaged.run(['/usr/bin/xattr', '-w', 'com.flixify.fixture', 'fixture-ticket', str(app)])
            packaged.run(['/usr/bin/xattr', '-w', 'com.flixify.fixture', 'file-ticket', str(executable)])
            source_metadata, _ = packaged.app_manifest(app, include_directory_attributes=True)
            before, size = packaged.app_manifest(app)
            archive = root / 'fixture.zip'; extracted = root / 'extracted'; extracted.mkdir()
            packaged.run(['/usr/bin/ditto', '-c', '-k', '--keepParent', '--sequesterRsrc', str(app), str(archive)])
            packaged.validate_zip_layout(archive, app.name, size)
            packaged.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(extracted)])
            self.assertEqual(packaged.app_manifest(extracted / app.name)[0], before)
            self.assertEqual(packaged.app_manifest(app, include_directory_attributes=True)[0], source_metadata)


if __name__ == '__main__': unittest.main()
