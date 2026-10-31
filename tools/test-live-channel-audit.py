import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import sys

spec = importlib.util.spec_from_file_location("audit", Path(__file__).with_name("live-channel-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

ORIGIN = "https://provider.example"
LINE = "f" * 64
CHANNELS = [{"streamId": "1", "extension": "ts", "alternateExtension": "m3u8"}, {"streamId": "2", "extension": "ts", "alternateExtension": "m3u8"}, {"streamId": "3", "extension": "ts", "alternateExtension": "m3u8"}]

class Clock:
    def __init__(self): self.seconds = 0
    def now(self):
        self.seconds += 1
        return "2026-10-31T09:00:%02d.000Z" % self.seconds

def probe_result(status, code=200, first=500):
    return {"status": status, "httpStatus": code, "firstDecodedFrameMs": first if status == "working" else None, "decodedFrames": 1 if status == "working" else 0}

class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "checkpoint.json"
        self.clock = Clock()

    def scan(self, probe, **kwargs):
        return audit.scan_channels(ORIGIN, LINE, CHANNELS, "1", self.path, probe,
                                   now=self.clock.now, sleep=lambda seconds: None, **kwargs)

    def test_repeated_top_level_404_with_healthy_controls_produces_one_exclusion(self):
        calls = []
        def probe(channel):
            calls.append(channel["streamId"])
            return probe_result("working") if channel["streamId"] != "2" else probe_result("http-unavailable", 404)
        report = self.scan(probe, limit=1)
        self.assertEqual(calls, ["1", "2", "2", "1", "1", "2", "2", "1"])
        proofs = audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z")
        self.assertEqual([p["streamId"] for p in proofs], ["2"])
        self.assertEqual(report["results"]["2"]["classification"], "confirmed-http-unavailable")
        self.assertNotIn("password", json.dumps(report))

    def test_auth_geography_connection_and_transient_errors_never_exclude(self):
        for status, code in [("blocked", 401), ("blocked", 403), ("blocked", 429), ("unverified", 500), ("unverified", 503), ("timeout", None)]:
            with self.subTest(code=code):
                self.path.unlink(missing_ok=True)
                report = self.scan(lambda channel: probe_result("working") if channel["streamId"] == "1" else probe_result(status, code), limit=1)
                self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])

    def test_failed_control_halts_before_opening_target(self):
        calls = []
        def probe(channel):
            calls.append(channel["streamId"])
            return probe_result("blocked", 403)
        report = self.scan(probe, limit=2)
        self.assertEqual(calls, ["1"])
        self.assertEqual(report["halted"], "control-unavailable")
        self.assertEqual(report["results"], {})

    def test_recovery_on_repeat_does_not_exclude_and_failed_post_control_does_not_confirm(self):
        target_calls = 0
        control_calls = 0
        def recovered(channel):
            nonlocal target_calls
            if channel["streamId"] == "1": return probe_result("working")
            target_calls += 1
            return probe_result("http-unavailable", 404) if target_calls == 1 else probe_result("working")
        report = self.scan(recovered, limit=1)
        self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])
        self.path.unlink()
        def failed_control(channel):
            nonlocal control_calls
            if channel["streamId"] != "1": return probe_result("http-unavailable", 410)
            control_calls += 1
            return probe_result("working") if control_calls == 1 else probe_result("timeout", None)
        report = self.scan(failed_control, limit=1)
        self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])

    def test_repeated_http_200_undecodable_is_proposed_only(self):
        report = self.scan(lambda channel: probe_result("working") if channel["streamId"] == "1" else probe_result("undecodable"), limit=1)
        self.assertEqual(len(report["results"]["2"]["attempts"]), 3)
        self.assertEqual(report["results"]["2"]["classification"], "proposed-undecodable")
        self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])

    def test_resume_skips_completed_targets_and_rejects_different_origin_line_or_manifest(self):
        report = self.scan(lambda channel: probe_result("working"), limit=1)
        calls = []
        resumed = self.scan(lambda channel: calls.append(channel["streamId"]) or probe_result("working"), limit=1)
        self.assertEqual(set(resumed["results"]), {"2", "3"})
        self.assertEqual(calls, ["1", "3"])
        for origin, line, channels in [("https://other.example", LINE, CHANNELS), (ORIGIN, "e"*64, CHANNELS), (ORIGIN, LINE, CHANNELS[:2])]:
            with self.subTest(origin=origin, line=line), self.assertRaises(ValueError):
                audit.scan_channels(origin, line, channels, "1", self.path, lambda channel: probe_result("working"), now=self.clock.now, sleep=lambda seconds: None)

    def test_sql_only_contains_valid_recent_repeated_hard_proof_and_does_not_delete_data(self):
        report = self.scan(lambda channel: probe_result("working") if channel["streamId"] == "1" else probe_result("http-unavailable", 404), limit=1)
        sql = audit.render_sql(report, now="2026-10-31T10:00:00.000Z")
        self.assertIn("insert into public.live_channel_exclusions", sql)
        self.assertIn("on conflict (provider_origin, stream_id)", sql)
        self.assertNotIn("delete", sql.lower())
        self.assertNotIn("shared_live_channels", sql)
        self.assertNotIn("password", sql)
        bad = json.loads(json.dumps(report))
        bad["results"]["2"]["attempts"][1]["httpStatus"] = 403
        with self.assertRaises(ValueError): audit.render_sql(bad, now="2026-10-31T10:00:00.000Z")
        with self.assertRaises(ValueError): audit.render_sql(report, now="2026-11-01T10:00:00.000Z")

    def test_credential_permissions_are_checked_and_no_secrets_are_accepted_on_cli(self):
        path = Path(self.temp.name) / "credentials.json"
        path.write_text(json.dumps({"providerOrigin": ORIGIN, "username": "fixture-u", "password": "fixture-p"}))
        path.chmod(0o644)
        with self.assertRaises(ValueError): audit.read_credentials(path)
        path.chmod(0o600)
        self.assertEqual(audit.read_credentials(path)["providerOrigin"], ORIGIN)
        link = path.with_name("link.json"); link.symlink_to(path)
        with self.assertRaises(ValueError): audit.read_credentials(link)

    def test_decode_requires_an_actual_frame_and_preserves_one_user_agent_between_requests(self):
        credentials = {"providerOrigin": ORIGIN, "username": "fixture-u", "password": "fixture-p"}
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, count): return b"x"
        with patch.object(audit, "open_media_http", return_value=Response()) as http, patch.object(audit, "run_bounded", return_value=SimpleNamespace(returncode=0, stdout=b"frame=1\nprogress=end\n", stderr=b"")) as child:
            result = audit.decode_probe(credentials, CHANNELS[1])
            self.assertEqual(result["status"], "working")
            self.assertEqual(result["decodedFrames"], 1)
            self.assertGreaterEqual(result["firstDecodedFrameMs"], 0)
            self.assertIsNone(result["httpStatus"])
            args = child.call_args.args[0]
            self.assertIn("-user_agent", args)
            self.assertEqual(args[args.index("-user_agent")+1], audit.USER_AGENT)
            self.assertEqual(args[args.index("-protocol_whitelist")+1], "https,tls,tcp,crypto")
            http.assert_not_called()
        with patch.object(audit, "open_media_http", return_value=Response()), patch.object(audit, "run_bounded", return_value=SimpleNamespace(returncode=0, stdout=b"frame=0\nprogress=end\n", stderr=b"password=fixture-p")):
            result = audit.decode_probe(credentials, CHANNELS[1])
            self.assertEqual(result["status"], "undecodable")
            self.assertNotIn("fixture-p", json.dumps(result))

    def test_one_second_analysis_is_an_input_option_and_does_not_shorten_decode_deadline(self):
        credentials = {"providerOrigin": ORIGIN, "username": "fixture-u", "password": "fixture-p"}
        with patch.object(audit, "run_bounded", return_value=SimpleNamespace(returncode=0, stdout=b"frame=1\nprogress=end\n", stderr=b"")) as child:
            result = audit.decode_probe(credentials, CHANNELS[1], timeout=15)
        args, timeout = child.call_args.args
        self.assertEqual(args.count("-analyzeduration"), 1)
        self.assertEqual(args[args.index("-analyzeduration")+1], "1000000")
        self.assertLess(args.index("-analyzeduration"), args.index("-i"))
        self.assertNotIn("-probesize", args)
        self.assertNotIn("nobuffer", args)
        self.assertEqual(timeout, 15)
        self.assertEqual(args[args.index("-rw_timeout")+1], "15000000")
        self.assertEqual(args[args.index("-frames:v")+1], "1")
        self.assertEqual(result["status"], "working")
        self.assertEqual(result["decodedFrames"], 1)
        self.assertIsNone(result["httpStatus"])

    def test_blocked_http_does_not_launch_a_second_media_connection(self):
        credentials = {"providerOrigin": ORIGIN, "username": "fixture-u", "password": "fixture-p"}
        for code in [401, 403, 429]:
            with self.subTest(code=code), patch.object(audit, "open_media_http") as http, patch.object(audit, "run_bounded", return_value=SimpleNamespace(returncode=1, stdout=b"", stderr=("HTTP error %s fixture-p" % code).encode())):
                result = audit.decode_probe(credentials, CHANNELS[1])
                self.assertEqual(result["status"], "blocked")
                http.assert_not_called()
                self.assertNotIn("fixture-p", json.dumps(result))

    def test_segment_404_is_not_quarantined_without_top_level_http_confirmation(self):
        credentials = {"providerOrigin": ORIGIN, "username": "fixture-u", "password": "fixture-p"}
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
        failed = SimpleNamespace(returncode=1, stdout=b"", stderr=b"HTTP error 404 Not Found\nhttps://provider.example/live/fixture-u/fixture-p/segment.ts")
        with patch.object(audit, "open_media_http", return_value=Response()) as http, patch.object(audit, "run_bounded", return_value=failed) as child:
            result = audit.decode_probe(credentials, CHANNELS[1])
            self.assertEqual(result["status"], "undecodable")
            self.assertEqual(result["httpStatus"], 200)
            self.assertEqual(http.call_args.args[0].get_header("User-agent"), audit.USER_AGENT)
        unavailable = audit.urllib.error.HTTPError("https://example.invalid/fixture-p", 404, "secret", {}, io.BytesIO(b"fixture"))
        with patch.object(audit, "open_media_http", side_effect=unavailable), patch.object(audit, "run_bounded", return_value=failed):
            result = audit.decode_probe(credentials, CHANNELS[1])
            self.assertEqual(result["status"], "http-unavailable")
            self.assertEqual(result["httpStatus"], 404)
            self.assertNotIn("fixture-p", json.dumps(result))

    def test_bounded_process_output_and_owned_timeout_cleanup(self):
        result = audit.run_bounded([sys.executable, "-c", "import sys;sys.stdout.write('a'*200000);sys.stderr.write('b'*200000)"], 3)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(len(result.stdout), 65536)
        self.assertEqual(len(result.stderr), 65536)
        with self.assertRaises(audit.subprocess.TimeoutExpired):
            audit.run_bounded([sys.executable, "-c", "import time;time.sleep(2)"], 0.05)

    def test_invalid_repeat_window_and_proof_digest_are_rejected(self):
        report = self.scan(lambda channel: probe_result("working") if channel["streamId"] == "1" else probe_result("http-unavailable", 404), limit=1)
        row = report["results"]["2"]
        row["attempts"][1]["checkedAt"] = row["attempts"][0]["checkedAt"]
        with self.assertRaises(ValueError): audit.render_sql(report, now="2026-10-31T10:00:00.000Z")
        row.pop("proofSha256"); row["proofSha256"] = audit.digest(row)
        with self.assertRaises(ValueError): audit.render_sql(report, now="2026-10-31T10:00:00.000Z")

    def test_two_operator_scanners_cannot_share_a_provider_line(self):
        with audit.operator_line_lock(LINE, Path(self.temp.name)):
            with self.assertRaisesRegex(ValueError, "operator-line-already-in-use"):
                with audit.operator_line_lock(LINE, Path(self.temp.name)): pass
            with audit.operator_line_lock("e"*64, Path(self.temp.name)): pass
        with audit.operator_line_lock(LINE, Path(self.temp.name)): pass

    def test_ts_404_with_working_hls_never_excludes_the_global_id(self):
        calls = []
        def probe(channel):
            calls.append((channel["streamId"], channel["extension"]))
            return probe_result("http-unavailable", 404) if channel["streamId"] == "2" and channel["extension"] == "ts" else probe_result("working")
        report = self.scan(probe, limit=1)
        self.assertEqual(report["results"]["2"]["classification"], "working")
        self.assertIn(("2", "m3u8"), calls)
        self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])

    def test_global_exclusion_requires_two_formats_each_with_its_own_working_control(self):
        report = self.scan(lambda channel: probe_result("working") if channel["streamId"] == "1" else probe_result("http-unavailable", 410), limit=1)
        row = report["results"]["2"]
        self.assertEqual([check["extension"] for check in row["formatChecks"]], ["ts", "m3u8"])
        self.assertEqual([len(check["attempts"]) for check in row["formatChecks"]], [2, 2])
        self.assertEqual(len(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z")), 1)
        row["formatChecks"].pop()
        row.pop("proofSha256"); row["proofSha256"] = audit.digest(row)
        with self.assertRaises(ValueError): audit.render_sql(report, now="2026-10-31T10:00:00.000Z")

    def test_event_only_unavailable_channels_are_proposed_not_globally_excluded(self):
        channels = [CHANNELS[0], {**CHANNELS[1], "title": "VIP BEINSPORT 1 [MAÇTA AKTİF]"}]
        report = audit.scan_channels(ORIGIN, LINE, channels, "1", self.path, lambda channel: probe_result("working") if channel["streamId"] == "1" else probe_result("http-unavailable", 404), now=self.clock.now, sleep=lambda seconds: None)
        self.assertEqual(report["results"]["2"]["classification"], "proposed-event-only")
        self.assertTrue(report["results"]["2"]["eventOnly"])
        self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])

    def test_missing_format_uses_ts_but_explicit_provider_format_is_retained(self):
        credentials = {"providerOrigin": ORIGIN, "username": "fixture-u", "password": "fixture-p"}
        class Response:
            def __init__(self, value): self.value = value
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, maximum): return json.dumps(self.value).encode()
        opener = SimpleNamespace(open=lambda request, timeout: Response([{"category_id":"1", "category_name":"TR:SPOR"}] if "get_live_categories" in request.full_url else [{"stream_id": 1, "name": "Ordinary", "category_id":"1"}, {"stream_id":2, "name":"Explicit", "container_extension":"m3u8"}, {"stream_id":3, "name":"Match [MAÇTA AKTİF]"}]))
        with patch.object(audit.urllib.request, "build_opener", return_value=opener): manifest = audit.fetch_catalog(credentials)
        first, second, event = manifest["channels"]
        self.assertEqual((first["extension"], first["alternateExtension"]), ("ts", "m3u8"))
        self.assertEqual(second["extension"], "m3u8")
        self.assertTrue(event["eventOnly"])

    def test_failed_hls_control_never_turns_a_ts_only_failure_into_global_exclusion(self):
        def probe(channel):
            if channel["streamId"] == "1": return probe_result("working") if channel["extension"] == "ts" else probe_result("blocked", 403)
            return probe_result("http-unavailable", 404)
        report = self.scan(probe, limit=1)
        self.assertEqual(report["results"]["2"]["classification"], "unverified")
        self.assertEqual(report["halted"], "control-unavailable")
        self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])

    def test_explicit_hls_stays_primary_but_working_ts_still_protects_the_id(self):
        channels = [CHANNELS[0], {"streamId": "2", "extension": "m3u8"}]
        def probe(channel):
            return probe_result("http-unavailable", 410) if channel["streamId"] == "2" and channel["extension"] == "m3u8" else probe_result("working")
        report = audit.scan_channels(ORIGIN, LINE, channels, "1", self.path, probe, now=self.clock.now, sleep=lambda seconds: None)
        self.assertEqual(report["results"]["2"]["extension"], "m3u8")
        self.assertEqual(report["results"]["2"]["classification"], "working")
        self.assertEqual([check["extension"] for check in report["results"]["2"]["formatChecks"]], ["m3u8", "ts"])
        self.assertEqual(audit.validated_exclusions(report, now="2026-10-31T10:00:00.000Z"), [])

if __name__ == "__main__": unittest.main()
