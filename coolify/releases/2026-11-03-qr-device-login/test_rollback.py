import contextlib
import copy
import importlib.util
import os
import subprocess
import sys
import unittest
import uuid
from pathlib import Path
from types import ModuleType
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


class RollbackTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            spec = importlib.util.spec_from_file_location('qr_rollback_test', HERE / 'release.py')
            self.release = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.release)
        self.release.configure('b' * 40, {'api': 'sha256:' + 'c' * 64, 'ops-web': 'sha256:' + 'd' * 64})

    def run_rollback(self, *, stop_fails=False, db_fails=False, drift=False, baseline=False, stop_stuck=False, bad_receipt=False, restart=False):
        release = self.release
        events = []
        before = {'api': {'id': 'candidate-api', 'tag': release.guard.TARGET['api'],
                          'image_id': 'sha256:' + 'c' * 64, 'running': True, 'hash': 'api-hash', 'health': 'healthy', 'guard': 'api-guard'},
                  'db': {'id': 'pinned-db', 'image_id': release.DB, 'tag': 'postgres:16-alpine', 'hash': 'db-hash', 'running': True, 'health': 'healthy', 'guard': 'db-guard'},
                  'worker': {'id': 'worker', 'image_id': release.WORKER[1], 'tag': release.WORKER[0], 'hash': 'worker-hash', 'running': True, 'health': 'healthy', 'guard': 'worker-guard'},
                  'ops-web': {'id': 'web', 'image_id': 'sha256:' + 'd' * 64, 'tag': release.guard.TARGET['ops-web'], 'hash': 'web-hash', 'running': True, 'health': 'healthy', 'guard': 'web-guard'}}
        if baseline:
            before['api'].update(id='old-api', tag=release.guard.SOURCE['api'], image_id=release.guard.SOURCE_IDS['api'])
        current = {key: dict(value) for key, value in before.items()}
        if drift:
            current['api']['image_id'] = 'sha256:' + 'e' * 64
        def command(*args, **kwargs):
            if args[:2] == ('docker', 'stop'):
                self.assertEqual(args[-1], 'candidate-api')
                events.append('stop')
                if stop_fails:
                    raise release.api.GateError('stop_failed')
                if not stop_stuck:
                    current['api']['running'] = False
                    current['api']['guard'] = 'api-stopped-network-guard'
                return b''
            self.assertEqual(args[:4], ('docker', 'exec', '-i', 'pinned-db'))
            events.append('transaction')
            sql = kwargs['input_data'].decode()
            self.assertIn("where auth_method='device_link'", sql)
            self.assertIn('envelope=null', sql)
            self.assertNotIn('delete from', sql.lower())
            if db_fails:
                raise release.api.GateError('transaction_failed')
            if restart:
                current['api']['running'] = True
            if bad_receipt:
                return b'not-confirmed'
            return b'qr_rollback_revoked\n'
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(release.guard, 'preflight', return_value=({}, b'compose', b'env', before, {}, {})))
            stack.enter_context(patch.object(release.guard, 'container_snapshot', side_effect=lambda **kw: copy.deepcopy(current)))
            stack.enter_context(patch.object(release.guard, 'candidate_images', return_value={'api': 'sha256:' + 'c' * 64, 'ops-web': 'sha256:' + 'd' * 64}))
            stack.enter_context(patch.object(release.guard, 'verify_source_images'))
            stack.enter_context(patch.object(release.guard, 'verify_recovery_context'))
            stack.enter_context(patch.object(release.guard, 'command', side_effect=command))
            stack.enter_context(patch.object(release.guard, 'rollback', side_effect=lambda: events.append('restore')))
            try:
                release.safe_rollback()
            except Exception:
                self.assertNotIn('restore', events)
                raise
        return events

    def test_candidate_is_stopped_before_revocation_and_restore(self):
        self.assertEqual(self.run_rollback(), ['stop', 'transaction', 'restore'])

    def test_database_failure_never_restores_old_api(self):
        with self.assertRaisesRegex(self.release.api.GateError, 'transaction_failed'):
            self.run_rollback(db_fails=True)

    def test_stop_failure_never_reaches_database_or_restore(self):
        with self.assertRaisesRegex(self.release.api.GateError, 'stop_failed'):
            self.run_rollback(stop_fails=True)

    def test_candidate_identity_drift_fails_before_mutation(self):
        with self.assertRaisesRegex(self.release.api.GateError, 'qr_rollback_api_drift'):
            self.run_rollback(drift=True)

    def test_precreation_rollback_does_not_stop_baseline_api(self):
        self.assertEqual(self.run_rollback(baseline=True), ['transaction', 'restore'])

    def test_candidate_still_running_after_stop_blocks_revocation(self):
        with self.assertRaisesRegex(self.release.api.GateError, 'qr_rollback_api_not_stopped'):
            self.run_rollback(stop_stuck=True)

    def test_candidate_restarted_during_cleanup_blocks_restore(self):
        with self.assertRaisesRegex(self.release.api.GateError, 'qr_rollback_api_restarted'):
            self.run_rollback(restart=True)

    def test_unconfirmed_transaction_blocks_restore(self):
        with self.assertRaisesRegex(self.release.api.GateError, 'qr_rollback_revocation_unconfirmed'):
            self.run_rollback(bad_receipt=True)


@unittest.skipUnless(os.environ.get('QR_ROLLBACK_TEST_DATABASE_URL'), 'disposable PostgreSQL fixture URL required')
class RollbackPostgresTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(sys.modules, {'yaml': ModuleType('yaml')}):
            spec = importlib.util.spec_from_file_location('qr_rollback_pg_test', HERE / 'release.py')
            self.release = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.release)
        self.schema = 'qr_rollback_' + uuid.uuid4().hex
        self.psql = os.environ.get('QR_ROLLBACK_TEST_PSQL', 'psql')
        self.execute('create schema ' + self.schema + '; create table ' + self.schema + '.device_sessions (id integer primary key, revoked_at timestamptz, expires_at timestamptz);')

    def tearDown(self):
        self.execute('drop schema ' + self.schema + ' cascade;')

    def execute(self, sql, *, success=True):
        result = subprocess.run([self.psql, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                                 os.environ['QR_ROLLBACK_TEST_DATABASE_URL']], input=sql.encode(), capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr.decode())
        else:
            self.assertNotEqual(result.returncode, 0)
        return result.stdout.decode().strip()

    def rollback(self, allow_absent, **kwargs):
        sql = self.release.rollback_sql(allow_absent).decode().replace('public.', self.schema + '.')
        return self.execute(sql, **kwargs)

    def test_wholly_absent_schema_is_safe_only_with_baseline_api(self):
        self.assertEqual(self.rollback(True), 'qr_rollback_revoked')
        self.rollback(False, success=False)

    def test_partial_schema_fails_without_touching_manual_sessions(self):
        self.execute('alter table ' + self.schema + ".device_sessions add auth_method text default 'account_code'; insert into " + self.schema + '.device_sessions(id) values (1);')
        self.rollback(True, success=False)
        self.assertEqual(self.execute('select revoked_at is null from ' + self.schema + '.device_sessions'), 't')

    def test_all_linked_sessions_revoked_while_manual_and_business_rows_survive(self):
        s = self.schema
        self.execute(f"""alter table {s}.device_sessions add auth_method text default 'account_code', add family_id integer;
create table {s}.device_login_requests(id integer, state text, envelope text);
create table {s}.business_fixture(id integer, package text, trial boolean);
insert into {s}.business_fixture values (1,'owner-package',true);
insert into {s}.device_sessions values
 (1,null,now()+interval '1 day','account_code',null),
 (2,null,now()+interval '1 day','device_link',10),
 (3,null,now()-interval '1 day','device_link',null),
 (4,'2020-01-01',now()+interval '1 day','device_link',11);
insert into {s}.device_login_requests values (10,'issued','sealed'),(11,'completed',null),(12,'pending',null);""")
        self.assertEqual(self.rollback(False), 'qr_rollback_revoked')
        self.assertEqual(self.execute(f"select id, revoked_at is null from {s}.device_sessions order by id"), '1|t\n2|f\n3|f\n4|f')
        self.assertEqual(self.execute(f"select revoked_at::date from {s}.device_sessions where id=4"), '2020-01-01')
        self.assertEqual(self.execute(f"select count(*) from {s}.device_login_requests where state='cancelled' and envelope is null"), '3')
        self.assertEqual(self.execute(f"select * from {s}.business_fixture"), '1|owner-package|t')
        self.assertEqual(self.rollback(False), 'qr_rollback_revoked')

    def test_verification_failure_rolls_back_revocations_and_envelopes(self):
        s = self.schema
        self.execute(f"""alter table {s}.device_sessions add auth_method text, add family_id integer;
create table {s}.device_login_requests(id integer, state text, envelope text);
insert into {s}.device_sessions values (1,null,now(),'device_link',1);
insert into {s}.device_login_requests values (1,'issued','sealed');
create function {s}.ignore_cancel() returns trigger language plpgsql as $$begin return old; end$$;
create trigger prevent_cancel before update on {s}.device_login_requests for each row execute function {s}.ignore_cancel();""")
        self.rollback(False, success=False)
        self.assertEqual(self.execute(f'select revoked_at is null from {s}.device_sessions'), 't')
        self.assertEqual(self.execute(f'select state,envelope from {s}.device_login_requests'), 'issued|sealed')


if __name__ == '__main__':
    unittest.main()
