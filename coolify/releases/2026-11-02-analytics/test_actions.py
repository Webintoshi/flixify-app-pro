import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))


def module(name, leaf):
    spec = importlib.util.spec_from_file_location(name, HERE / leaf)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


class ActionTests(unittest.TestCase):
    def test_default_build_with_placeholder_never_calls_docker_or_build(self):
        build = module('analytics_build_test', 'build.py')
        calls = []
        with patch.object(build, 'command', side_effect=lambda *a, **k: calls.append(a)):
            with self.assertRaisesRegex(build.p.GateError, 'accepted_'):
                build.main(['/not-used', '--service', 'api'])
        self.assertEqual(calls, [])

    def test_default_release_has_no_file_or_host_mutation(self):
        self.assertTrue((HERE / 'release.py').is_file(), 'guarded release transaction is required')
        release = module('analytics_release_test', 'release.py')
        calls = []
        with patch.object(release.guard, 'command', side_effect=lambda *a, **k: calls.append(a)):
            with self.assertRaisesRegex(release.p.GateError, 'accepted_'):
                release.main(['--api-candidate-id', 'sha256:' + '1' * 64, '--web-candidate-id', 'sha256:' + '2' * 64, '--environment-file', '/not-opened'])
        self.assertEqual(calls, [])

    def test_migration_default_is_inspection_and_rollback_has_no_drop(self):
        self.assertTrue((HERE / 'migrate.py').is_file(), 'additive versioned migration guard is required')
        migration = module('analytics_migration_test', 'migrate.py')
        sql = 'begin; create table if not exists public.analytics_consents (id uuid); commit;'
        migration.validate_sql(sql)
        migration.validate_sql((HERE.parents[2] / 'supabase/migrations/202611020001_analytics.sql').read_text())
        for statement in ('drop table public.users;', 'delete from public.users;', 'alter table public.users add column bad text;', 'truncate public.analytics_outbox;'):
            with self.assertRaises(migration.p.GateError): migration.validate_sql(sql + statement)
        parser = migration.parser()
        self.assertFalse(parser.parse_args(['/not-used']).apply)


if __name__ == '__main__': unittest.main()
