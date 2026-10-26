"""Offline web adapter checks over the already tested shared release guard."""
import copy
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))
spec = importlib.util.spec_from_file_location("edge_web_release", Path(__file__).with_name("release-web.py"))
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)
guard = web.guard
REVISION = "a" * 40
CANDIDATE_ID = "sha256:" + "b" * 64
WORKER_TAG = "flixify-worker:edge-recovery-7731936e27df-20261026"
WORKER_ID = "sha256:" + "c" * 64


def fixture(stage="source"):
    tags = {"db": guard.PROTECTED_DB_TAG, "ops-web": guard.expected_images(stage)["ops-web"],
            "api": web.API_TAG, "worker": WORKER_TAG}
    raw = {"services": {name: {"image": tag, "environment": {"PRESERVE": "same"}}
                        for name, tag in tags.items()}}
    containers = {name: {"id": "container:" + name, "tag": tag, "image_id": "id:" + tag,
                         "hash": "config", "guard": "config-env-network-mount-start-guard",
                         "running": True, "health": None} for name, tag in tags.items()}
    containers["db"]["image_id"] = guard.PROTECTED_DB_IMAGE_ID
    containers["api"]["image_id"] = web.API_ID
    containers["worker"]["image_id"] = WORKER_ID
    return raw, copy.deepcopy(raw), copy.deepcopy(raw), containers, {"ops-web": tags["ops-web"]}


class WebReleaseTests(unittest.TestCase):
    def setUp(self):
        web.configure(REVISION, CANDIDATE_ID, WORKER_TAG, WORKER_ID)
        def image_id(tag):
            if tag == web.API_TAG:
                return web.API_ID
            if tag == WORKER_TAG:
                return WORKER_ID
            return "id:" + tag
        self.ids = patch.object(guard, "image_id", side_effect=image_id)
        self.image_mock = self.ids.start()
        self.addCleanup(self.ids.stop)

    def test_only_web_is_changed_and_worker_is_explicitly_pinned(self):
        self.assertEqual(guard.CHANGED, ("ops-web",))
        self.assertEqual(guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(guard.SOURCE, {"ops-web": web.SOURCE_TAG})
        self.assertEqual(guard.SOURCE_IDS, {"ops-web": web.SOURCE_ID})
        self.assertEqual(guard.PROTECTED_IMAGES["worker"], (WORKER_TAG, WORKER_ID))
        self.assertEqual(guard.TARGET, {"ops-web": web.target(REVISION)})

    def test_worker_pin_and_exact_revision_are_required(self):
        for revision, candidate, worker_tag, worker_id in (
            ("HEAD", CANDIDATE_ID, WORKER_TAG, WORKER_ID),
            (REVISION, "latest", WORKER_TAG, WORKER_ID),
            (REVISION, CANDIDATE_ID, "", WORKER_ID),
            (REVISION, CANDIDATE_ID, WORKER_TAG, ""),
        ):
            with self.subTest(worker_tag=worker_tag, worker_id=worker_id), self.assertRaises(web.GateError):
                web.configure(revision, candidate, worker_tag, worker_id)

    def test_exact_source_and_target_preserve_pinned_worker_api_db(self):
        for stage in ("source", "target"):
            guard.validate_plan(*fixture(stage), stage)
        self.assertNotIn(unittest.mock.call(guard.PROTECTED_DB_TAG), self.image_mock.mock_calls)

    def test_worker_or_protected_service_drift_rejected(self):
        for stage in ("source", "target"):
            for name in guard.PROTECTED:
                values = fixture(stage)
                values[3][name]["image_id"] = "changed"
                with self.subTest(stage=stage, name=name), self.assertRaises(web.GateError):
                    guard.validate_plan(*values, stage)

    def test_web_swap_changes_no_other_compose_values(self):
        raw, rendered, _, _, _ = fixture()
        expected_raw, expected_rendered = guard.expected_swapped(raw, rendered, guard.TARGET)
        raw["services"]["ops-web"]["image"] = guard.TARGET["ops-web"]
        rendered["services"]["ops-web"]["image"] = guard.TARGET["ops-web"]
        self.assertEqual(raw, expected_raw)
        self.assertEqual(rendered, expected_rendered)

    def test_protected_application_query_is_api_and_worker(self):
        with patch.object(guard, "command", return_value=b"{}") as command:
            web.protected_application_images()
            php = command.call_args.args[-1]
            self.assertIn("foreach (['api', 'worker'] as $name)", php)
            self.assertIn("foreach (['ops-web'] as $name)", guard.PHP_READ_APPLICATIONS)

    def test_health_checks_this_exact_web_container(self):
        current = fixture("target")[3]
        current["ops-web"]["image_id"] = CANDIDATE_ID
        with patch.object(guard, "container_snapshot", return_value=current), \
             patch.object(guard, "compose_hash", return_value="config"), \
             patch.object(guard, "command") as command:
            self.assertTrue(web.healthy("ops-web", guard.TARGET["ops-web"], CANDIDATE_ID))
            self.assertEqual(command.call_args.args[:4], ("docker", "exec", f"ops-web-{guard.UUID}", "node"))
            self.assertIn("http://127.0.0.1:3000/", command.call_args.args[-1])

    def test_recreate_mutates_only_web_without_dependencies_or_pulls(self):
        before = fixture()[3]
        updated = fixture("target")[3]
        updated["ops-web"]["image_id"] = CANDIDATE_ID
        snapshots = iter((before,))
        with patch.object(guard, "candidate_images", return_value={"ops-web": CANDIDATE_ID}), \
             patch.object(guard, "verify_candidate_ids"), \
             patch.object(guard, "container_snapshot", side_effect=lambda **kwargs: next(snapshots, updated)), \
             patch.object(guard, "verify_recreate_context") as context_guard, \
             patch.object(guard, "healthy", return_value=True), \
             patch.object(guard.time, "sleep"), \
             patch.object(guard, "ENV") as env, \
             patch.object(guard, "command") as command:
            env.read_bytes.return_value = b"env"
            web.quiet_recreate(before, b"compose", b"env", {}, {})
            self.assertEqual(context_guard.call_count, 3)
            command.assert_called_once_with(
                "docker", "compose", "-p", guard.UUID, "--project-directory", str(guard.DIRECTORY),
                "-f", str(guard.COMPOSE), "up", "-d", "--no-deps", "--no-build",
                "--pull", "never", "--force-recreate", "ops-web", timeout=180,
            )

    def test_compose_drift_stops_before_web_mutation(self):
        before = fixture()[3]
        with patch.object(guard, "candidate_images", return_value={"ops-web": CANDIDATE_ID}), \
             patch.object(guard, "verify_candidate_ids"), \
             patch.object(guard, "container_snapshot", return_value=before), \
             patch.object(guard, "COMPOSE") as compose, \
             patch.object(guard, "command") as command:
            compose.read_bytes.return_value = b"changed config"
            with self.assertRaisesRegex(web.GateError, "config_changed_during_recreate"):
                web.quiet_recreate(before, b"reviewed config", b"env", {}, {})
            command.assert_not_called()

    def test_apply_passes_only_web_to_transaction(self):
        args = ["release-web.py", "--revision", REVISION, "--candidate-id", CANDIDATE_ID,
                "--protected-worker-tag", WORKER_TAG, "--protected-worker-id", WORKER_ID, "--apply"]
        preflight = ({}, b"compose", b"env", {}, {}, {})
        with patch.object(sys, "argv", args), \
             patch.object(guard, "preflight", return_value=preflight), \
             patch.object(guard, "sync_images") as sync:
            web.main()
            self.assertEqual(sync.call_args.args[-2:], (guard.SOURCE, guard.TARGET))
            self.assertEqual(set(sync.call_args.args[-1]), {"ops-web"})


if __name__ == "__main__":
    unittest.main()
