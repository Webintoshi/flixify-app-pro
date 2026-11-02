import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE / 'policy.py').is_file(), 'analytics profile policy must exist before deployment')
        spec = importlib.util.spec_from_file_location('analytics_release_policy', HERE / 'policy.py')
        self.p = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.p)

    def test_unaccepted_publication_is_closed(self):
        with self.assertRaisesRegex(self.p.GateError, 'accepted_'):
            self.p.pins(json.loads((HERE / 'release-pins.json').read_text()))

    def test_actual_current_web_pin_is_full_and_correct(self):
        self.assertEqual(self.p.WEB_ID, 'sha256:3f882fa9bc2029bc4cad6cd4635fb6d304900085e89e0e97ddba900ad040bfd3')
        self.assertEqual(len(self.p.WEB_ID), 71)

    def test_environment_rejects_unknown_and_secret_interpolation(self):
        for values in ({'DATABASE_URL': 'private'}, {'GA4_WEB_API_SECRET': '${DATABASE_URL}'}, {'GA4_ENABLED': 'true\nDATABASE_URL=bad'}):
            with self.assertRaises(self.p.GateError):
                self.p.analytics_environment(values)

    def test_environment_requires_all_streams_stable_hash_and_no_debug(self):
        valid = self.p.analytics_environment(self.env())
        self.assertEqual(set(valid), set(self.env()))
        for key in self.env():
            invalid = self.env(); del invalid[key]
            with self.assertRaises(self.p.GateError): self.p.analytics_environment(invalid)
        invalid = self.env() | {'GA4_DEBUG_MODE': 'true'}
        with self.assertRaises(self.p.GateError): self.p.analytics_environment(invalid)

    def env(self):
        return {'GA4_ENABLED': 'true', 'GA4_WEB_MEASUREMENT_ID': 'G-ABC1234567', 'GA4_WEB_API_SECRET': 'fixture_web_secret', 'GA4_WINDOWS_MEASUREMENT_ID': 'G-DEF1234567', 'GA4_WINDOWS_API_SECRET': 'fixture_windows_secret', 'GA4_ANALYTICS_HASH_SECRET': 'x' * 40}

    def document(self, list_env=False):
        api = {'DATABASE_URL': 'not-logged', 'REGISTRATION_GUARD_SECRET': '${REGISTRATION_GUARD_SECRET}', 'AUTO_TRIAL_DAILY_IP_LIMIT': '2'}
        return {'services': {'api': {'image': 'old', 'environment': [k + '=' + v for k, v in api.items()] if list_env else api}, 'worker': {'image': 'protected', 'environment': {'REGISTRATION_GUARD_SECRET': ''}}, 'ops-web': {'image': 'protected', 'environment': {'REGISTRATION_GUARD_SECRET': ''}}, 'db': {'image': 'postgres:16-alpine', 'environment': {'REGISTRATION_GUARD_SECRET': ''}}}, 'networks': {'private': {}}}

    def test_environment_apply_and_rollback_preserve_every_unowned_field(self):
        for list_env in (False, True):
            source = self.document(list_env)
            baseline = copy.deepcopy(source)
            target = self.p.with_analytics(source, self.env())
            self.assertEqual(source, baseline)
            self.assertEqual(self.p.with_analytics(target, {}), baseline)
            for service in ('db', 'worker', 'ops-web'): self.assertEqual(source['services'][service], target['services'][service])
            self.assertEqual(self.p.environment(target, 'api')['DATABASE_URL'], 'not-logged')

    def test_rollback_requires_exact_owned_values_and_preserves_new_unrelated_values(self):
        target = self.p.with_analytics(self.document(), self.env())
        target['services']['api']['environment']['UNRELATED_NEW_KEY'] = 'retain'
        restored = self.p.restore_analytics(target, self.env(), {})
        self.assertEqual(restored['services']['api']['environment']['UNRELATED_NEW_KEY'], 'retain')
        tampered = copy.deepcopy(target); tampered['services']['api']['environment']['GA4_WEB_API_SECRET'] = 'another_operator'
        with self.assertRaisesRegex(self.p.GateError, 'owned_environment_drift'):
            self.p.restore_analytics(tampered, self.env(), {})

    def test_backend_scope_never_copies_canonical_server(self):
        expected = {'analytics-policy.ts', 'analytics-delivery.ts', 'analytics-routes.ts', 'analytics-store.ts', 'analytics-runtime.ts', 'stripe-billing-routes.ts', 'stripe-billing-store.ts', 'stripe-payment.ts', 'stripe-payment-store.ts'}
        self.assertEqual(set(self.p.API_NAMES), expected)
        self.assertNotIn('repository.ts', self.p.API_NAMES)
        self.assertEqual(len(self.p.SERVER_REPLACEMENTS), 2)

    def test_web_scope_is_exact_and_tests_are_never_payload(self):
        runtime = set(self.p.WEB_PATHS)
        tests = {'apps/ops-web/app/platform/analytics-provider.test.tsx'}
        self.p.validate_web_delta(runtime | tests, set())
        for changed in (runtime - {next(iter(runtime))}, runtime | {'apps/ops-web/lib/api.ts'}, runtime | {'apps/ops-web/public/evil.exe'}):
            with self.assertRaises(self.p.GateError): self.p.validate_web_delta(changed, set())

    def test_public_retention_permits_only_three_new_files_and_manifest(self):
        old = [['dir', 'downloads', 493], ['file', 'favicon.ico', 420, 100, 'a' * 64]]
        old += [['file', p.removeprefix('apps/ops-web/public/'), 420, n, sha] for p, n, sha in self.p.RETAINED]
        old += [['file', 'downloads/flixify-tv-update.json', 420, 462, self.p.OLD_UPDATE_SHA]]
        additions = {'apps/ops-web/public/downloads/flixify-pro-1.4.8.apk': b'PK\x03\x04fixture', 'apps/ops-web/public/downloads/flixify-pro-macos-1.0.1-build3-test.dmg': b'dmgfixture', 'apps/ops-web/public/downloads/flixify-pro-windows-1.0.2-x64-test-setup.exe': b'MZfixture', self.p.UPDATE: b'{}'}
        expected = self.p.expected_public(old, additions)
        self.assertIn(old[1], expected)
        for row in old[2:-1]: self.assertIn(row, expected)
        with self.assertRaises(self.p.GateError): self.p.expected_public(old, additions | {'apps/ops-web/public/other': b'x'})

    def test_private_environment_file_has_no_symlink_or_group_access(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'env.json'; path.write_text(json.dumps(self.env())); path.chmod(0o600)
            self.assertEqual(self.p.read_private_environment(path), self.env())
            path.chmod(0o644)
            with self.assertRaises(self.p.GateError): self.p.read_private_environment(path)
            path.chmod(0o600); link = Path(directory) / 'link'; link.symlink_to(path)
            with self.assertRaises(self.p.GateError): self.p.read_private_environment(link)


if __name__ == '__main__': unittest.main()
