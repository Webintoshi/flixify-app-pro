from pathlib import Path
import re
import unittest

HERE=Path(__file__).parent
REPO=HERE.parents[2]


class MigrationParentTypeTests(unittest.TestCase):
    def test_checkout_foreign_key_and_fixture_match_actual_billing_parent_type(self):
        billing=(REPO/'coolify/releases/2026-11-01-packages/api-source/stripe-billing-schema.ts').read_text()
        fixture=(REPO/'coolify/releases/2026-11-01-welcome-offer/welcome-tests/analytics-postgres-fixture.ts').read_text()
        migration=(REPO/'supabase/migrations/202611020001_analytics.sql').read_text()
        parent=re.search(r'create table if not exists public\.stripe_checkout_sessions\s*\(\s*operation_id\s+(\w+)\s+primary key',billing)
        self.assertIsNotNone(parent);self.assertEqual(parent[1],'text')
        self.assertRegex(fixture,r'create table public\.stripe_checkout_sessions\(operation_id text primary key')
        child=re.search(r'operation_id\s+(\w+)\s+primary key references public\.stripe_checkout_sessions\(operation_id\)',migration)
        self.assertIsNotNone(child);self.assertEqual(child[1],parent[1])


if __name__=='__main__':unittest.main()
