"""Offline policy checks; no Docker or host actions are invoked."""
import copy
import hashlib
import importlib.util
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = load("edge_worker_build", "build-worker.py")
release = load("edge_worker_release", "release-worker.py")
REVISION = "a" * 40
CANDIDATE_ID = "sha256:" + "b" * 64


def fixture(stage="source"):
    tags = {"db": release.PROTECTED_DB_TAG, "worker": release.expected_images(stage)["worker"]}
    tags.update({name: pin[0] for name, pin in release.PROTECTED_IMAGES.items()})
    raw = {"services": {name: {"image": tag, "environment": {"PRESERVE": "secret-not-output"}}
                        for name, tag in tags.items()}}
    containers = {name: {"id": "container:" + name, "tag": tag, "image_id": "id:" + tag,
                         "hash": "config", "guard": "config-env-network-mount-start-guard",
                         "running": True, "health": None} for name, tag in tags.items()}
    containers["db"]["image_id"] = release.PROTECTED_DB_IMAGE_ID
    for name, pin in release.PROTECTED_IMAGES.items():
        containers[name]["image_id"] = pin[1]
    return raw, copy.deepcopy(raw), copy.deepcopy(raw), containers, {"worker": tags["worker"]}


class WorkerPolicyTests(unittest.TestCase):
    def setUp(self):
        release.REVISION = REVISION
        release.CANDIDATE_ID = CANDIDATE_ID
        release.TARGET = {"worker": build.target(REVISION)}

        def image_id(tag):
            for name, pin in release.PROTECTED_IMAGES.items():
                if tag == pin[0]:
                    return pin[1]
            if tag == release.PROTECTED_DB_TAG:
                return "different-downloaded-postgres-image"
            return "id:" + tag

        self.ids = patch.object(release, "image_id", side_effect=image_id)
        self.image_id_mock = self.ids.start()
        self.addCleanup(self.ids.stop)

    def test_exact_revision_required_and_target_is_revision_derived(self):
        for invalid in ("HEAD", "short", "A" * 40, "a" * 39):
            with self.subTest(invalid=invalid), self.assertRaises(build.GateError):
                build.target(invalid)
        release.require_final_pin()
        release.CANDIDATE_ID = "latest"
        with self.assertRaisesRegex(release.GateError, "exact_candidate_image_id_required"):
            release.require_final_pin()

    def test_only_worker_source_is_copied_and_dist_is_rebuilt_from_pinned_image(self):
        dockerfile = build.dockerfile(REVISION)
        self.assertIn("FROM " + build.SOURCE_TAG, dockerfile)
        self.assertIn("vip.flixify.edge-recovery.base=" + build.SOURCE_ID, dockerfile)
        self.assertEqual([line for line in dockerfile.splitlines() if line.startswith("COPY")],
                         [f"COPY {build.PATH} /app/{build.PATH}"])
        self.assertIn("RUN npm run build -w @flixify/worker", dockerfile)
        self.assertNotIn("package-lock", dockerfile)
        self.assertNotIn("npm ci", dockerfile)

    def test_known_source_and_target_plan_accept_exact_protected_ids(self):
        for stage in ("source", "target"):
            release.validate_plan(*fixture(stage), stage)
        self.assertNotIn(unittest.mock.call(release.PROTECTED_DB_TAG), self.image_id_mock.mock_calls)

    def test_protected_api_web_or_database_drift_rejected(self):
        for stage in ("source", "target"):
            for name in release.PROTECTED:
                values = fixture(stage)
                values[3][name]["image_id"] = "changed"
                with self.subTest(stage=stage, name=name), self.assertRaises(release.GateError):
                    release.validate_plan(*values, stage)

    def test_protected_metadata_image_drift_rejected(self):
        for name in release.PROTECTED:
            values = fixture()
            for document in values[:3]:
                document["services"][name]["image"] = "changed"
            with self.subTest(name=name), self.assertRaises(release.GateError):
                release.validate_plan(*values, "source")

    def test_generated_config_drift_rejected(self):
        values = fixture()
        values[2]["services"]["api"]["environment"]["PRESERVE"] = "changed"
        with self.assertRaisesRegex(release.GateError, "generated_compose_differs"):
            release.validate_plan(*values, "source")

    def test_swap_scope_preserves_all_other_structure(self):
        raw, rendered, _, _, _ = fixture()
        expected_raw, expected_rendered = release.expected_swapped(raw, rendered, release.TARGET)
        raw["services"]["worker"]["image"] = release.TARGET["worker"]
        rendered["services"]["worker"]["image"] = release.TARGET["worker"]
        self.assertEqual(raw, expected_raw)
        self.assertEqual(rendered, expected_rendered)

    def test_guard_detects_restart_config_environment_network_or_mount_change(self):
        before = fixture()[3]
        after = copy.deepcopy(before)
        after["api"]["guard"] = "changed"
        self.assertNotEqual(release.container_identity(before), release.container_identity(after))

    def test_target_allows_pending_or_missing_worker_only(self):
        values = fixture("target")
        values[3]["worker"]["tag"] = release.SOURCE["worker"]
        values[3]["worker"]["image_id"] = "id:" + release.SOURCE["worker"]
        release.validate_plan(*values, "target")
        values[3]["worker"]["tag"] = None
        release.validate_plan(*values, "target")
        values[3]["api"]["tag"] = None
        with self.assertRaises(release.GateError):
            release.validate_plan(*values, "target")

    def test_candidate_requires_reviewed_id_and_base_layers(self):
        base = {"Id": build.SOURCE_ID, "RootFS": {"Layers": ["base"]}}
        candidate = {"Id": CANDIDATE_ID, "RootFS": {"Layers": ["base", "overlay"]}, "Config": {"Labels": {
            "org.opencontainers.image.revision": REVISION,
            "vip.flixify.edge-recovery.base": build.SOURCE_ID,
        }}}
        def image(ref):
            return base if ref == build.SOURCE_ID else candidate
        with patch.object(release, "image", side_effect=image):
            self.assertEqual(release.candidate_images(), {"worker": CANDIDATE_ID})
            candidate["Id"] = "sha256:" + "c" * 64
            with self.assertRaisesRegex(release.GateError, "candidate_id_differs"):
                release.candidate_images()
            candidate["Id"] = CANDIDATE_ID
            candidate["RootFS"]["Layers"] = ["other"]
            with self.assertRaisesRegex(release.GateError, "candidate_not_from_pinned_worker"):
                release.candidate_images()

    def test_protected_application_metadata_checked(self):
        with patch.object(release, "protected_application_images", return_value={name: pin[0] for name, pin in release.PROTECTED_IMAGES.items()}):
            release.verify_protected_applications()
        with patch.object(release, "protected_application_images", return_value={"api": "changed"}):
            with self.assertRaisesRegex(release.GateError, "protected_coolify_application_image_drift"):
                release.verify_protected_applications()

    def test_recreate_revalidates_candidates_before_mutation(self):
        with patch.object(release, "candidate_images", side_effect=release.GateError("candidate_id_differs")), \
             patch.object(release, "command") as command:
            with self.assertRaises(release.GateError):
                release.recreate({}, b"", b"", {}, {})
            command.assert_not_called()

    def test_recreate_mutates_only_worker_with_no_dependencies_or_pulls(self):
        before = fixture()[3]
        updated = fixture("target")[3]
        updated["worker"]["image_id"] = CANDIDATE_ID
        snapshots = iter((before,))
        def snapshot(**kwargs):
            return next(snapshots, updated)
        with patch.object(release, "candidate_images", return_value={"worker": CANDIDATE_ID}), \
             patch.object(release, "verify_candidate_ids"), \
             patch.object(release, "container_snapshot", side_effect=snapshot), \
             patch.object(release, "verify_recreate_context") as context_guard, \
             patch.object(release, "healthy", return_value=True), \
             patch.object(release.time, "sleep"), \
             patch.object(release, "ENV") as env, \
             patch.object(release, "command") as command:
            env.read_bytes.return_value = b"unchanged"
            release.recreate(before, b"compose", b"unchanged", {}, {})
            self.assertEqual(context_guard.call_count, 3)
            command.assert_called_once_with(
                "docker", "compose", "-p", release.UUID, "--project-directory", str(release.DIRECTORY),
                "-f", str(release.COMPOSE), "up", "-d", "--no-deps", "--no-build",
                "--pull", "never", "--force-recreate", "worker", timeout=180,
            )

    def test_recreate_failure_attempts_guarded_worker_rollback(self):
        empty_preflight = ({}, b"", b"", {}, {}, {})
        with patch.object(sys, "argv", ["release-worker.py", "--revision", REVISION,
                                       "--candidate-id", CANDIDATE_ID, "--recreate"]), \
             patch.object(release, "preflight", return_value=empty_preflight), \
             patch.object(release, "recreate", side_effect=release.GateError("new_container_unhealthy:worker")), \
             patch.object(release, "verify_recovery_context") as guard, \
             patch.object(release, "rollback") as rollback:
            with self.assertRaisesRegex(release.GateError, "deploy_failed_but_source_restored"):
                release.main()
            guard.assert_called_once()
            rollback.assert_called_once_with()

    def test_compose_change_blocks_before_docker_recreate(self):
        before = fixture()[3]
        with patch.object(release, "candidate_images", return_value={"worker": CANDIDATE_ID}), \
             patch.object(release, "verify_candidate_ids"), \
             patch.object(release, "container_snapshot", return_value=before), \
             patch.object(release, "COMPOSE") as compose, \
             patch.object(release, "command") as command:
            compose.read_bytes.return_value = b"changed configuration"
            with self.assertRaisesRegex(release.GateError, "config_changed_during_recreate"):
                release.recreate(before, b"reviewed configuration", b"env", {}, {})
            command.assert_not_called()

    def test_candidate_regressions_mount_exact_commit_without_network(self):
        with patch.object(build, "git_file", return_value=b"reviewed test") as git_file, \
             patch.object(build, "command") as command:
            build.test_candidate(Path("/repo"), REVISION, CANDIDATE_ID)
            git_file.assert_called_once_with(Path("/repo"), REVISION, build.TEST_PATH)
            arguments = command.call_args.args
            self.assertEqual(arguments[:6], ("docker", "run", "--rm", "--network", "none", "-v"))
            self.assertIn(CANDIDATE_ID, arguments)
            self.assertIn("npx", arguments)
            self.assertEqual(arguments[-6:], ("--no-install", "vitest", "run", "--root", "/app", build.TEST_PATH))

    def test_rollback_compose_drift_blocks_before_container_mutation(self):
        raw, rendered, _, before, _ = fixture("target")
        with patch.object(release, "preflight", return_value=({}, b"target", b"env", before, raw, rendered)), \
             patch.object(release, "sync_images"), \
             patch.object(release, "COMPOSE") as compose, \
             patch.object(release, "parsed", return_value={"changed": True}), \
             patch.object(release, "command") as command:
            compose.read_bytes.return_value = b"changed source compose"
            with self.assertRaisesRegex(release.GateError, "source_compose_changed_after_rollback_sync"):
                release.rollback()
            command.assert_not_called()

    def test_rollback_recreates_only_pinned_worker_and_rechecks_context(self):
        raw, rendered, _, before, _ = fixture("target")
        restored = fixture()[3]
        restored["worker"]["image_id"] = release.SOURCE_IDS["worker"]
        _, expected_rendered = release.expected_swapped(raw, rendered, release.SOURCE)
        snapshots = iter((before,))
        with patch.object(release, "preflight", return_value=({}, b"target", b"env", before, raw, rendered)), \
             patch.object(release, "sync_images"), \
             patch.object(release, "COMPOSE") as compose, \
             patch.object(release, "parsed", return_value=expected_rendered), \
             patch.object(release, "verify_recreate_context") as guard, \
             patch.object(release, "verify_source_images"), \
             patch.object(release, "container_snapshot", side_effect=lambda **kwargs: next(snapshots, restored)), \
             patch.object(release, "healthy", return_value=True) as healthy, \
             patch.object(release, "ENV") as env, \
             patch.object(release, "command") as command:
            compose.read_bytes.return_value = b"source"
            env.read_bytes.return_value = b"env"
            release.rollback()
            self.assertEqual(guard.call_count, 3)
            self.assertEqual(command.call_count, 1)
            self.assertEqual(command.call_args.args[-1], "worker")
            self.assertIn("--no-deps", command.call_args.args)
            healthy.assert_called_with("worker", release.SOURCE["worker"], release.SOURCE_IDS["worker"])

    def test_command_errors_do_not_expose_secret_stderr(self):
        failed = subprocess.CompletedProcess(("docker",), 1, stdout=b"", stderr=b"TOKEN=secret")
        with patch.object(build.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(build.GateError, "^command_failed:external_command:exit_1:unclassified_output_withheld$"):
                build.command("docker")
        with patch.object(release.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(release.GateError, "^command_failed$"):
                release.command("docker", capture_sync_phase=True)

    def test_build_diagnostics_are_fixed_labels_without_urls_or_secrets(self):
        failed = subprocess.CompletedProcess(("docker", "build"), 1, stdout=b"pull access denied\nTOKEN=secret\nhttps://private.invalid/key",
                                             stderr=b"failed to resolve source metadata username=private")
        with patch.object(build.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(build.GateError, "^command_failed:docker_build:exit_1:base_image_resolution$"):
                build.command("docker", "build", "--build-arg", "KEY=secret", "/private/path")
        killed = build.safe_failure_summary(137, b"heap out of memory secret", b"https://private.invalid")
        self.assertEqual(killed, "exit_137:memory_exhausted,process_killed")
        missing = build.safe_failure_summary(1, b"", b"Error: Cannot find module 'secret-package' https://secret.invalid")
        self.assertEqual(missing, "exit_1:dependency_missing")

    def test_candidate_failure_phase_is_distinct_from_build(self):
        failed = subprocess.CompletedProcess(("docker", "run"), 1, stdout=b"", stderr=b"Cannot find module 'vitest'")
        with patch.object(build.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(build.GateError, "^command_failed:candidate_regressions:exit_1:dependency_missing$"):
                build.command("docker", "run", "--entrypoint", "npx", "candidate", "vitest")

    def test_base_reseller_hash_is_observed_pre_fix_git_bytes(self):
        repo = Path(__file__).resolve().parents[3]
        previous = subprocess.run(("git", "-C", str(repo), "show", f"{build.BASE_REVISION}:{build.PATH}"), capture_output=True, check=True).stdout
        self.assertEqual(hashlib.sha256(previous).hexdigest(), build.SOURCE_SHA)


if __name__ == "__main__":
    unittest.main()
