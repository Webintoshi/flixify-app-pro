import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import types
import unittest

spec = importlib.util.spec_from_file_location("job", Path(__file__).with_name("live-channel-audit-job.py"))
job = importlib.util.module_from_spec(spec)
spec.loader.exec_module(job)

ORIGIN = "https://sifiriptvdns.com:2087"
CREDENTIALS = {"providerOrigin": ORIGIN, "username": "fixture-u", "password": "fixture-p"}
CHANNELS = [{"streamId": key, "extension": "ts", "alternateExtension": "m3u8"} for key in ("90", "2", "3", "4")]
REMOTE = {"ssh_socket": "/tmp/fixture-edge/ssh", "ssh_target": "root@87.76.130.17", "directory": "/tmp/fixture-runtime", "unit_name": "flixify-hvzn-audit-probe", "helper_sha256": "a"*64, "runtime_sha256": "b"*64}
MANIFEST = {"schema": 1, "providerOrigin": ORIGIN, "lineFingerprint": job.audit.line_fingerprint(CREDENTIALS), "channels": CHANNELS}

def working():
    return {"status": "working", "httpStatus": None, "firstDecodedFrameMs": 500, "decodedFrames": 1}

def unavailable(code=404):
    return {"status": "http-unavailable", "httpStatus": code, "firstDecodedFrameMs": None, "decodedFrames": 0}

class Clock:
    def __init__(self): self.value = 1720000000
    def __call__(self): return self.value
    def sleep(self, seconds): self.value += seconds

class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.directory.chmod(0o700)
        self.clock = Clock()

    def run_job(self, probe, **options):
        return job.run_job(CREDENTIALS, MANIFEST, REMOTE, self.directory, probe, expected_count=4, clock=self.clock, sleep=self.clock.sleep, **options)

    def test_one_probe_at_a_time_across_bounded_cohorts(self):
        calls = []
        def probe(credentials, channel, remote, timeout=15):
            calls.append(channel["streamId"])
            return {"status": "working", "httpStatus": None, "firstDecodedFrameMs": 500, "decodedFrames": 1}
        state = self.run_job(probe, batch_size=2)
        self.assertEqual(calls, ["90", "2", "3", "90", "4"])
        self.assertEqual(state["status"], "completed")
        self.assertEqual(state["checkedTargets"], 3)

    def test_access_and_control_failure_halt_without_sql(self):
        for blocked_control in (True, False):
            with self.subTest(control=blocked_control), tempfile.TemporaryDirectory() as path:
                calls, sql = [], []
                def probe(credentials, channel, remote, timeout):
                    calls.append(channel["streamId"])
                    return {"status": "blocked", "httpStatus": 403, "firstDecodedFrameMs": None, "decodedFrames": 0} if blocked_control or channel["streamId"] == "2" else working()
                state = job.run_job(CREDENTIALS, MANIFEST, REMOTE, path, probe, expected_count=4, apply_sql=lambda value: sql.append(value), clock=self.clock)
                self.assertEqual(state["status"], "halted")
                self.assertEqual(calls, ["90"] if blocked_control else ["90", "2"])
                self.assertEqual(sql, [])

    def test_stop_waits_for_current_probe_and_checkpoint_then_reconciles(self):
        events, stop = [], {"value": False}
        def probe(credentials, channel, remote, timeout):
            events.append(channel["streamId"])
            if channel["streamId"] == "2": stop["value"] = True
            return working()
        def reconcile(remote): events.append("reaped"); return True
        state = self.run_job(probe, stop_requested=lambda: stop["value"], reconcile=reconcile)
        self.assertEqual(events, ["90", "2", "reaped"])
        self.assertEqual((state["status"], state["checkedTargets"]), ("paused", 1))
        report = job.private_json(self.directory / "checkpoint.json")
        self.assertEqual(set(report["results"]), {"2"})

    def test_deadline_is_original_and_resume_never_opens_another_probe(self):
        calls = []
        def probe(credentials, channel, remote, timeout):
            calls.append(channel["streamId"])
            if channel["streamId"] == "2": self.clock.sleep(5)
            return working()
        state = self.run_job(probe, max_seconds=3)
        deadline = state["deadlineUnix"]
        self.assertEqual(state["status"], "expired")
        resumed = self.run_job(probe)
        self.assertEqual(resumed["deadlineUnix"], deadline)
        self.assertEqual(resumed["status"], "expired")
        self.assertEqual(calls, ["90", "2"])

    def test_pilot_resume_allows_socket_change_but_rejects_manifest_or_artifact_drift(self):
        state = self.run_job(lambda *a, **k: working(), max_targets=1)
        self.assertEqual((state["status"], state["reason"]), ("paused", "pilot-limit"))
        changed = {**REMOTE, "ssh_socket": "/tmp/reconnected-master/ssh"}
        resumed = job.run_job(CREDENTIALS, MANIFEST, changed, self.directory, lambda *a, **k: working(), expected_count=4, max_targets=1, clock=self.clock)
        self.assertEqual((resumed["status"], resumed["checkedTargets"]), ("paused", 2))
        with self.assertRaisesRegex(ValueError, "resume-identity"):
            job.run_job(CREDENTIALS, MANIFEST, {**changed, "helper_sha256": "c"*64}, self.directory, lambda *a, **k: working(), expected_count=4)
        with self.assertRaisesRegex(ValueError, "manifest-line"):
            job.run_job({**CREDENTIALS, "password": "other-fixture"}, MANIFEST, changed, self.directory, lambda *a, **k: working(), expected_count=4)

    def test_fresh_dual_format_proof_applies_once_and_state_has_no_credentials(self):
        calls, applied = [], []
        def probe(credentials, channel, remote, timeout):
            calls.append((channel["streamId"], channel["extension"]))
            return unavailable() if channel["streamId"] == "2" else working()
        def apply(sql): applied.append(sql); return True
        state = self.run_job(probe, apply_sql=apply, batch_size=1)
        self.assertEqual(state["status"], "completed")
        self.assertEqual(set(state["appliedProofs"]), {"2"})
        self.assertEqual(calls.count(("2", "ts")), 2)
        self.assertEqual(calls.count(("2", "m3u8")), 2)
        self.assertEqual(len(applied), 1)
        self.assertIn("insert into public.live_channel_exclusions", applied[0])
        self.assertNotIn(CREDENTIALS["password"], applied[0])
        self.assertNotIn(CREDENTIALS["username"], (self.directory / "state.json").read_text())
        count = len(calls)
        self.run_job(probe, apply_sql=apply)
        self.assertEqual((len(calls), len(applied)), (count, 1))
        for name in ("state.json", "checkpoint.json"):
            self.assertEqual((self.directory / name).stat().st_mode & 0o777, 0o600)

    def test_stale_or_tampered_unapplied_proof_halts_before_media_or_sql(self):
        for tamper in (True, False):
            with self.subTest(tamper=tamper), tempfile.TemporaryDirectory() as path:
                directory = Path(path)
                def probe(credentials, channel, remote, timeout): return unavailable() if channel["streamId"] == "2" else working()
                first = job.run_job(CREDENTIALS, MANIFEST, REMOTE, directory, probe, expected_count=4, max_targets=1, clock=self.clock, sleep=self.clock.sleep)
                self.assertEqual(first["preparedProofIds"], ["2"])
                if tamper:
                    report = job.private_json(directory / "checkpoint.json")
                    report["results"]["2"]["proofSha256"] = "0"*64
                    job.audit.atomic_json(directory / "checkpoint.json", report)
                else: self.clock.sleep(6*3600+1)
                later_calls, applied = [], []
                state = job.run_job(CREDENTIALS, MANIFEST, REMOTE, directory, lambda *a, **k: later_calls.append(a), expected_count=4, clock=self.clock, apply_sql=lambda sql: applied.append(sql))
                self.assertEqual((state["status"], state["reason"]), ("halted", "invalid-or-stale-proof-recheck-required"))
                self.assertEqual((later_calls, applied), ([], []))

    def test_transient_and_event_only_failures_never_apply(self):
        for result in ({"status": "unverified", "httpStatus": 503, "firstDecodedFrameMs": None, "decodedFrames": 0}, {"status": "timeout", "httpStatus": None, "firstDecodedFrameMs": None, "decodedFrames": 0}, unavailable()):
            with self.subTest(result=result), tempfile.TemporaryDirectory() as path:
                channels = [{**row, "eventOnly": True} if row["streamId"] == "2" else row for row in CHANNELS]
                applied = []
                state = job.run_job(CREDENTIALS, {**MANIFEST, "channels": channels}, REMOTE, path, lambda credentials, channel, remote, timeout: working() if channel["streamId"] == "90" else result, expected_count=4, clock=self.clock, sleep=self.clock.sleep, apply_sql=lambda sql: applied.append(sql) or True)
                self.assertEqual(state["status"], "completed")
                # Only channel2 is event-only; hard failures on3/4 remain legitimate proofs.
                self.assertNotIn("2", state["appliedProofs"])
                if result["status"] != "http-unavailable": self.assertEqual(applied, [])

    def test_database_failure_and_uncertain_cleanup_are_terminal(self):
        calls = []
        def probe(credentials, channel, remote, timeout):
            calls.append(channel["streamId"])
            return unavailable() if channel["streamId"] == "2" else working()
        def fail(sql): raise RuntimeError("fixture error with secret must never be saved")
        state = self.run_job(probe, apply_sql=fail, batch_size=1)
        self.assertEqual((state["status"], state["reason"]), ("halted", "database-apply-failed"))
        self.assertEqual(state["appliedProofs"], {})
        self.assertNotIn("3", calls)
        self.assertNotIn("fixture error", (self.directory / "state.json").read_text())
        with tempfile.TemporaryDirectory() as path:
            state = job.run_job(CREDENTIALS, MANIFEST, REMOTE, path, lambda *a, **k: working(), expected_count=4, reconcile=lambda remote: False)
            self.assertEqual((state["status"], state["reason"]), ("halted", "remote-cleanup-unconfirmed"))

    def test_origin_keepalive_rechecks_without_exclusions_and_blocks_drift(self):
        checks, calls = [], []
        def scope(): checks.append(self.clock()); return len(checks) < 2
        def probe(credentials, channel, remote, timeout):
            calls.append(channel["streamId"])
            self.clock.sleep(601)
            return working()
        state = self.run_job(probe, scope_check=scope)
        self.assertEqual((state["status"], state["reason"]), ("halted", "production-scope-check-failed"))
        self.assertEqual(calls, ["90"])
        self.assertEqual(len(checks), 2)

    def test_private_state_and_global_line_lock(self):
        self.directory.chmod(0o755)
        with self.assertRaisesRegex(ValueError, "private-state"):
            self.run_job(lambda *a, **k: working())
        self.directory.chmod(0o700)
        with job.audit.operator_line_lock(job.audit.line_fingerprint(CREDENTIALS)):
            with self.assertRaisesRegex(ValueError, "already-in-use"):
                self.run_job(lambda *a, **k: working())

    def test_missing_original_deadline_cannot_be_recreated_on_resume(self):
        self.run_job(lambda *a, **k: working(), max_targets=1, max_seconds=3)
        state = job.private_json(self.directory / "state.json")
        del state["deadlineUnix"]
        job.audit.atomic_json(self.directory / "state.json", state)
        with self.assertRaisesRegex(ValueError, "missing-persisted-deadline"):
            self.run_job(lambda *a, **k: working())

    def test_uncertain_probe_halts_without_retry_and_reconciles(self):
        events = []
        def probe(*args, **kwargs): events.append("probe"); raise RuntimeError("uncertain SSH")
        def reconcile(remote): events.append("reconcile"); return True
        state = self.run_job(probe, reconcile=reconcile)
        self.assertEqual((state["status"], state["reason"]), ("halted", "probe-or-remote-state-uncertain"))
        self.assertEqual(events, ["probe", "reconcile"])

    def test_stop_mid_proof_does_not_checkpoint_incomplete_target(self):
        stop, calls = {"value": False}, []
        def probe(credentials, channel, remote, timeout):
            calls.append(channel["streamId"])
            return working() if channel["streamId"] == "90" else unavailable()
        def sleep(seconds): self.clock.sleep(seconds); stop["value"] = True
        state = job.run_job(CREDENTIALS, MANIFEST, REMOTE, self.directory, probe, expected_count=4, clock=self.clock, sleep=sleep, stop_requested=lambda: stop["value"])
        self.assertEqual((state["status"], state["checkedTargets"]), ("paused", 0))
        self.assertEqual(calls, ["90", "2"])
        later = []
        resumed = self.run_job(lambda credentials, channel, remote, timeout: later.append(channel["streamId"]) or working(), max_targets=1)
        self.assertEqual((resumed["status"], resumed["checkedTargets"]), ("paused", 1))
        self.assertEqual(later, ["90", "2"])


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.inspect = "|".join((job.API_CONTAINER, job.API_IMAGE, job.API_PROJECT, job.API_SERVICE, job.API_TAG, "true"))
        def run(args, **options):
            self.calls.append((shlex.split(args[-1]), options))
            return types.SimpleNamespace(returncode=0, stdout=self.inspect.encode() if self.calls[-1][0][1] == "inspect" else b'{"ok":true}', stderr=b"")
        self.db = job.PinnedDatabase({"ssh_socket": "/tmp/fixture-origin/ssh", "ssh_target": "root@87.76.130.252"}, ORIGIN, runner=run)

    def test_readonly_scope_and_generated_sql_use_only_pinned_container(self):
        self.assertTrue(self.db.check())
        self.assertEqual(self.calls[0][0][-1], job.API_CONTAINER)
        command, options = self.calls[1]
        self.assertEqual(command[:4], ["docker", "exec", "-i", job.API_CONTAINER])
        self.assertEqual(json.loads(options["input"]), {"origin": ORIGIN, "sql": None})
        self.assertIn("await client.query('begin')", command[-1])
        self.assertIn("await client.query('rollback')", command[-1])
        self.assertIn(" for share", command[-1])
        self.assertNotIn("PASSWORD", str(self.calls))

    def test_image_drift_and_raw_sql_are_rejected_before_database(self):
        self.inspect = self.inspect.replace(job.API_IMAGE, "sha256:"+"0"*64)
        with self.assertRaisesRegex(ValueError, "accepted-api"):
            self.db.check()
        self.assertEqual(len(self.calls), 1)
        self.inspect = self.inspect.replace("sha256:"+"0"*64, job.API_IMAGE)
        with self.assertRaisesRegex(ValueError, "operator-sql"):
            self.db.apply("begin;\ndelete from public.users;\ncommit;\n")
        self.assertEqual(len(self.calls), 2)

    def test_remote_credentials_are_captured_once_not_in_command(self):
        commands = []
        def run(args, **options):
            commands.append(args)
            return types.SimpleNamespace(returncode=0, stdout=json.dumps(CREDENTIALS).encode(), stderr=b"")
        value = job.remote_credentials(REMOTE, "/tmp/flixify-live-audit-fixture/credentials.json", runner=run)
        self.assertEqual(value, CREDENTIALS)
        self.assertEqual(len(commands), 1)
        self.assertNotIn(CREDENTIALS["password"], str(commands))
        self.assertIn("O_NOFOLLOW", commands[0][-1])
        self.assertIn("ProxyCommand=false", commands[0])

    def test_sql_literal_quotes_stay_in_generated_proof_value(self):
        self.assertEqual(job.audit.sql_literal("provider's value"), "'provider''s value'")


@unittest.skipUnless(shutil.which("node"), "Node is required for executing the embedded PG transaction boundary")
class TransactionTests(unittest.TestCase):
    def test_real_node_boundary_commits_or_rolls_back_on_same_client(self):
        for fail, source in ((False, ORIGIN), (True, ORIGIN), (False, "https://wrong.invalid")):
            with self.subTest(fail=fail, source=source), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                module = directory / "node_modules" / "pg"
                module.mkdir(parents=True)
                trace = directory / "trace.json"
                (module / "index.js").write_text(r'''
const fs=require('fs'); const calls=[];
function save(){fs.writeFileSync(process.env.TRACE,JSON.stringify(calls));}
const client={async query(sql){calls.push(sql);save();if(sql.startsWith('select'))return {rows:[{shared_source_base_url:process.env.SOURCE}]};if(sql.startsWith('insert')&&process.env.FAIL==='yes')throw Error('fixture');return {rows:[]};},release(){calls.push('release');save();}};
module.exports.Pool=class{async connect(){calls.push('connect');save();return client;}async end(){calls.push('end');save();}};
''')
                environment = {**os.environ, "NODE_PATH": str(directory / "node_modules"), "DATABASE_URL": "postgresql://fixture@localhost/test", "TRACE": str(trace), "SOURCE": source, "FAIL": "yes" if fail else "no"}
                result = subprocess.run([shutil.which("node"), "-e", job.NODE_DATABASE], input=json.dumps({"origin": ORIGIN, "sql": "insert into public.live_channel_exclusions fixture;"}).encode(), env=environment, cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                calls = json.loads(trace.read_text())
                self.assertEqual(calls[:2], ["connect", "begin"])
                self.assertTrue(calls[2].endswith("for share"))
                self.assertEqual(calls[-2:], ["release", "end"])
                if fail or source != ORIGIN:
                    self.assertEqual(result.returncode, 70)
                    self.assertIn("rollback", calls)
                    self.assertNotIn("commit", calls)
                    self.assertEqual(result.stdout, b"")
                else:
                    self.assertEqual(result.returncode, 0)
                    self.assertIn("commit", calls)
                    self.assertNotIn("rollback", calls)
                    self.assertEqual(json.loads(result.stdout), {"ok": True})

if __name__ == "__main__":
    unittest.main()
