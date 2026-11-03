import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_privacy as privacy
from macos_runtime import ReleaseError


def der(tag, value):
    size = len(value)
    encoded = size.to_bytes(max(1, (size.bit_length() + 7) // 8), 'big')
    length = bytes([size]) if size < 128 else bytes([0x80 | len(encoded)]) + encoded
    return bytes([tag]) + length + value


def certificate(extra=b''):
    subject = der(0x30, b''.join(der(0x31, der(0x30, der(6, oid) + der(12, value))) for oid, value in [
        (b'\x55\x04\x03', b'Developer ID Application: Private Person (ABCDEFGHIJ)'),
        (b'\x55\x04\x0a', b'Private Person')]))
    tbs = der(0x30, der(0xa0, der(2, b'\x02')) + der(2, b'\x01') + der(0x30, b'') +
              der(0x30, b'') + der(0x30, b'') + subject + der(0x30, b'') +
              (der(0xa3, der(0x30, der(4, extra))) if extra else b''))
    return der(0x30, tbs + der(0x30, b'') + der(3, b'\x00'))


def policy(cert):
    return {'schema': 1, 'identityKind': 'individual', 'individualEnrollmentVerified': True,
            'personalNameVisibilityAccepted': True, 'publicDistributionApproved': True,
            'teamIdentifier': 'ABCDEFGHIJ', 'certificateSha1': hashlib.sha1(cert).hexdigest().upper()}


def macho(cert, outside=b'', cpu=0x0100000c):
    cms = b'CMS fixture:' + cert
    wrapper = struct.pack('>II', 0xfade0b01, 8 + len(cms)) + cms
    signature = struct.pack('>IIIII', 0xfade0cc0, 20 + len(wrapper), 1, 0x10000, 20) + wrapper
    header = struct.pack('<8I', 0xfeedfacf, cpu, 0, 2, 1, 16, 0, 0)
    return header + struct.pack('<4I', 0x1d, 16, 48 + len(outside), len(signature)) + outside + signature


class IndividualIdentityTests(unittest.TestCase):
    def approval(self, cert):
        approved = policy(cert)
        identities = f'1) {approved["certificateSha1"]} "Developer ID Application: Private Person (ABCDEFGHIJ)"'
        return privacy.validate_signing_subject(identities, approved['certificateSha1'], approved, {'Private Person'})

    def signer(self, cert, *, team='ABCDEFGHIJ', invalid=False):
        def run(args):
            if '--verify' in args and invalid:
                raise ReleaseError('Signature verification failed')
            if '--extract-certificates' in args:
                raise ReleaseError('codesign optional extract argument must use equals syntax')
            extract = [value for value in args if value.startswith('--extract-certificates=')]
            if extract:
                prefix = extract[0].split('=', 1)[1]
                Path(prefix + '0').write_bytes(cert)
            return ('TeamIdentifier=' + team + '\n').encode()
        return run

    def test_individual_policy_requires_explicit_name_and_public_distribution_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'reviewed.json'
            approved = policy(certificate()); path.write_text(json.dumps(approved))
            self.assertEqual(privacy.read_identity_policy(path), approved)
            for field in ('individualEnrollmentVerified', 'personalNameVisibilityAccepted', 'publicDistributionApproved'):
                for bad in (False, 1, 'true', None):
                    path.write_text(json.dumps({**approved, field: bad}))
                    with self.subTest(field=field, bad=bad), self.assertRaises(ReleaseError):
                        privacy.read_identity_policy(path)
            path.write_text(json.dumps({**approved, 'unexpected': True}))
            with self.assertRaises(ReleaseError): privacy.read_identity_policy(path)
            with self.assertRaises(ReleaseError): privacy.read_identity_policy(None)

    def test_individual_approval_still_binds_real_developer_id_fingerprint_and_team(self):
        cert = certificate(); approved = policy(cert)
        self.assertEqual(self.approval(cert).identity_kind, 'individual')
        for output, fingerprint in [
            (f'1) {approved["certificateSha1"]} "Apple Development: Private Person (ABCDEFGHIJ)"', approved['certificateSha1']),
            (f'1) {approved["certificateSha1"]} "Developer ID Application: Private Person (ZZZZZZZZZZ)"', approved['certificateSha1']),
            (f'1) {approved["certificateSha1"]} "Developer ID Application: Private Person (ABCDEFGHIJ)"', 'B' * 40)]:
            with self.assertRaises(ReleaseError):
                privacy.validate_signing_subject(output, fingerprint, approved, {'Private Person'})

    def test_only_verified_certificate_subject_values_in_actual_signature_are_exempt(self):
        cert = certificate()
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'App.app'; app.mkdir()
            binary = app / 'main'; binary.write_bytes(macho(cert))
            with patch.object(privacy, '_signature_command', side_effect=self.signer(cert)):
                report = privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert))
            self.assertTrue(report['passed'])
            self.assertGreater(report['approvedCertificateSubjectBytesExcluded'], 0)
            self.assertNotIn('Private Person', json.dumps(report))
            for outside in (b'Private Person', cert):
                binary.write_bytes(macho(cert, outside))
                with patch.object(privacy, '_signature_command', side_effect=self.signer(cert)):
                    report = privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert), raise_on_failure=False)
                self.assertFalse(report['passed'])
                self.assertGreater(report['knownPersonalIdentifierMatches'], 0)

    def test_resource_copy_of_certificate_cannot_bypass_personal_metadata_scan(self):
        cert = certificate()
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'App.app'; app.mkdir(); (app / 'resource').write_bytes(cert)
            with self.assertRaises(ReleaseError):
                privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert))

    def test_wrong_certificate_team_or_invalid_signature_blocks_exception(self):
        cert = certificate()
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'App.app'; app.mkdir(); (app / 'main').write_bytes(macho(cert))
            for runner in [self.signer(certificate(b'other')), self.signer(cert, team='ZZZZZZZZZZ'), self.signer(cert, invalid=True)]:
                with patch.object(privacy, '_signature_command', side_effect=runner), self.assertRaises(ReleaseError):
                    privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert))

    def test_individual_signature_does_not_exempt_paths_email_or_credentials(self):
        for extra in (b'/Users/Private Person/source', b'personal@example.test', b'https://example.test/live/customer/secret/1.ts'):
            cert = certificate(extra)
            with tempfile.TemporaryDirectory() as temp:
                app = Path(temp) / 'App.app'; app.mkdir(); (app / 'main').write_bytes(macho(cert))
                with patch.object(privacy, '_signature_command', side_effect=self.signer(cert)):
                    report = privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert), raise_on_failure=False)
                self.assertFalse(report['passed'])
                self.assertGreater(sum(report[key] for key in ('ownedUserPathMatches', 'ownedEmailPatternMatches', 'ownedCredentialUrlPatternMatches')), 0)

    def test_both_universal_slices_require_the_approved_certificate(self):
        cert = certificate(); first = macho(cert, cpu=0x01000007); second = macho(cert)
        header = struct.pack('>II', 0xcafebabe, 2)
        entries = struct.pack('>5I', 0x01000007, 0, 48, len(first), 0) + struct.pack('>5I', 0x0100000c, 0, 48 + len(first), len(second), 0)
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / 'App.app'; app.mkdir(); binary = app / 'main'; binary.write_bytes(header + entries + first + second)
            with patch.object(privacy, '_signature_command', side_effect=self.signer(cert)):
                report = privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert))
            self.assertTrue(report['passed'])
            approved_signer = self.signer(cert)
            other_signer = self.signer(certificate(b'different leaf'))
            def mixed_signer(args):
                return (other_signer if 'x86_64' in args else approved_signer)(args)
            with patch.object(privacy, '_signature_command', side_effect=mixed_signer), self.assertRaises(ReleaseError):
                privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert))
            duplicate_entries = entries[:20] + struct.pack('>I', 0x01000007) + entries[24:]
            binary.write_bytes(header + duplicate_entries + first + second)
            with patch.object(privacy, '_signature_command', side_effect=self.signer(cert)), self.assertRaises(ReleaseError):
                privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert))
            binary.write_bytes(header + entries + first + second[:-1])
            with patch.object(privacy, '_signature_command', side_effect=self.signer(cert)), self.assertRaises(ReleaseError):
                privacy.audit_release_privacy(app, identifiers={'Private Person'}, signing_identity=self.approval(cert))


if __name__ == '__main__': unittest.main()
