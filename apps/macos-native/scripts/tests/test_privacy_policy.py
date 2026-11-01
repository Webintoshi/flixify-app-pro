import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_privacy as privacy
import macos_release as release


def policy():
    return {"schema": 1, "identityKind": "organization", "organizationEnrollmentVerified": True,
            "publicDistributionApproved": True, "teamIdentifier": "ABCDEFGHIJ", "certificateSha1": "A" * 40}


class PrivacyPolicyTests(unittest.TestCase):
    def test_public_pipeline_suspended_without_organization_approval(self):
        with patch.object(release, "run") as run, self.assertRaises(release.ReleaseError):
            release.package_release(Path("Absent.app"), None, "Profile")
        run.assert_not_called()

    def test_individual_or_unapproved_policy_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "policy.json"
            for field, value in [("identityKind", "individual"), ("organizationEnrollmentVerified", False),
                                 ("publicDistributionApproved", False), ("teamIdentifier", "wrong"),
                                 ("certificateSha1", "wrong")]:
                changed = policy(); changed[field] = value; path.write_text(json.dumps(changed))
                with self.subTest(field=field), self.assertRaises(release.ReleaseError):
                    privacy.read_organization_policy(path)

    def test_policy_must_bind_available_certificate_and_team(self):
        output = '1) ' + 'A' * 40 + ' "Developer ID Application: Example Limited (ABCDEFGHIJ)"'
        privacy.validate_organization_subject(output, "A" * 40, policy(), {"Private Person"})
        for changed in [{**policy(), "certificateSha1": "B" * 40}, {**policy(), "teamIdentifier": "ZZZZZZZZZZ"}]:
            with self.assertRaises(release.ReleaseError):
                privacy.validate_organization_subject(output, "A" * 40, changed, set())

    def test_known_personal_certificate_subject_is_rejected_without_printing_it(self):
        subject = "Private Person"
        output = '1) ' + 'A' * 40 + f' "Developer ID Application: {subject} (ABCDEFGHIJ)"'
        with self.assertRaises(release.ReleaseError) as result:
            privacy.validate_organization_subject(output, "A" * 40, policy(), {subject})
        self.assertNotIn(subject, str(result.exception))

    def test_owned_build_paths_and_email_fail_redacted_audit(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "App.app"
            app.mkdir()
            data = b"/Users/PrivatePerson/source /private/var/folders/secret personal@example.test"
            (app / "payload").write_bytes(data)
            report = privacy.audit_release_privacy(app, identifiers={"PrivatePerson", "personal@example.test"}, raise_on_failure=False)
            self.assertFalse(report["passed"])
            serialized = json.dumps(report)
            for secret in ["PrivatePerson", "personal@example.test", "/private/var/folders/secret"]:
                self.assertNotIn(secret, serialized)
            self.assertFalse(report["matchedValuesIncluded"])

    def test_upstream_provenance_does_not_hide_our_known_personal_identifier(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "App.app"
            binary = app / "Contents/Frameworks/VLCKit.framework/VLCKit"
            binary.parent.mkdir(parents=True)
            binary.write_bytes(b"/Users/upstream/compiler vendor@example.test")
            report = privacy.audit_release_privacy(app, identifiers={"PrivatePerson"})
            self.assertTrue(report["passed"])
            self.assertEqual(report["upstreamUserPathMatches"], 1)
            self.assertEqual(report["upstreamEmailPatternMatches"], 1)
            binary.write_bytes(b"PrivatePerson")
            with self.assertRaises(release.ReleaseError):
                privacy.audit_release_privacy(app, identifiers={"PrivatePerson"})

    def test_private_key_and_product_source_files_cannot_be_shipped(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "App.app"
            app.mkdir()
            for filename in ["token.p8", "local.swift"]:
                path = app / filename; path.write_text("fixture")
                with self.assertRaises(release.ReleaseError):
                    privacy.audit_release_privacy(app, identifiers=set())
                path.unlink()

    def test_brand_contact_is_distinguished_from_personal_email(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "App.app"
            app.mkdir(); (app / "contact").write_bytes(b"destek@flixify.vip")
            report = privacy.audit_release_privacy(app, identifiers=set())
            self.assertTrue(report["passed"])
            self.assertEqual(report["publicContactEmailMatches"], 1)

    def test_account_credentials_and_environment_files_are_not_shippable(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "App.app"
            app.mkdir()
            payload = app / "metadata.json"
            for data in [b"https://provider.example/player_api.php?username=customer&password=secret",
                         b"https://provider.example/live/customer/secret/1.ts"]:
                payload.write_bytes(data)
                report = privacy.audit_release_privacy(app, identifiers=set(), raise_on_failure=False)
                self.assertFalse(report["passed"])
                self.assertGreater(report["ownedCredentialUrlPatternMatches"], 0)
                self.assertNotIn("customer", json.dumps(report))
            payload.unlink()
            (app / ".env.production").write_text("fixture")
            with self.assertRaises(release.ReleaseError):
                privacy.audit_release_privacy(app, identifiers=set())

    def test_release_prefix_maps_cover_swift_c_and_no_debug_serialization(self):
        flags = release.release_privacy_flags(Path("/Users/Private/build"), Path("/Users/Private"))
        self.assertIn("/Users/Private/build=/Flixify", flags)
        self.assertIn("/Users/Private=/BuildHome", flags)
        self.assertIn("-ffile-prefix-map=/Users/Private/build=/Flixify", flags)
        self.assertIn("-no-serialize-debugging-options", flags)

    def test_known_identifiers_are_checked_in_utf16_and_json_escaped_forms(self):
        identifier = "Private Person"
        self.assertEqual(privacy.identifier_hits(identifier.encode("utf-16-le"), {identifier}), 1)
        self.assertEqual(privacy.identifier_hits(identifier.encode("utf-16-be"), {identifier}), 1)
        unicode_identifier = "Private Ç"
        encoded = json.dumps(unicode_identifier, ensure_ascii=True)[1:-1].encode()
        self.assertEqual(privacy.identifier_hits(encoded, {unicode_identifier}), 1)


if __name__ == "__main__":
    unittest.main()
