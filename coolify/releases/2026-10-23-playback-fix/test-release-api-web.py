"""Local policy tests for the guarded Coolify release plan."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


# Production uses PyYAML, already required by the prior Coolify release.
# The pure policy checks below do not need YAML parsing.
sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))
location = Path(__file__).with_name("release-api-web.py")
spec = importlib.util.spec_from_file_location("release_api_web", location)
assert spec and spec.loader
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
build_location = Path(__file__).with_name("build-api-web.py")
build_spec = importlib.util.spec_from_file_location("build_api_web", build_location)
assert build_spec and build_spec.loader
build = importlib.util.module_from_spec(build_spec)
build_spec.loader.exec_module(build)


def fixture(stage: str = "source"):
    tags = {
        "db": "postgres:16",
        "api": release.expected_images(stage)["api"],
        "worker": "flixify-worker:trial-20261013",
        "ops-web": release.expected_images(stage)["ops-web"],
    }
    raw = {"services": {name: {"image": tag, "environment": {"SAFE": "same"}}
                        for name, tag in tags.items()}}
    rendered = {"services": {name: dict(config)
                             for name, config in raw["services"].items()}}
    generated = {"services": {name: dict(config)
                              for name, config in raw["services"].items()}}
    containers = {name: {"tag": tag, "image_id": f"id:{tag}"}
                  for name, tag in tags.items()}
    applications = {name: tags[name] for name in release.CHANGED}
    return raw, rendered, generated, containers, applications


class ReleasePlanTests(unittest.TestCase):
    def setUp(self):
        self.ids = patch.object(release, "image_id", side_effect=lambda tag: f"id:{tag}")
        self.ids.start()
        self.addCleanup(self.ids.stop)

    def test_source_dry_run_accepts_exact_baseline(self):
        release.validate_plan(*fixture(), "source")

    def test_apply_plan_rejects_worker_image_change(self):
        raw, rendered, generated, containers, applications = fixture()
        raw["services"]["worker"]["image"] = "unexpected"
        with self.assertRaises(release.GateError):
            release.validate_plan(raw, rendered, generated, containers, applications, "source")

    def test_apply_plan_rejects_web_application_drift(self):
        raw, rendered, generated, containers, applications = fixture()
        applications["ops-web"] = "unexpected"
        with self.assertRaises(release.GateError):
            release.validate_plan(raw, rendered, generated, containers, applications, "source")

    def test_apply_plan_rejects_changed_container_image_id(self):
        raw, rendered, generated, containers, applications = fixture()
        containers["api"]["image_id"] = "different"
        with self.assertRaises(release.GateError):
            release.validate_plan(raw, rendered, generated, containers, applications, "source")

    def test_recreate_accepts_api_updated_web_pending(self):
        raw, rendered, generated, containers, applications = fixture("target")
        containers["ops-web"]["tag"] = release.SOURCE["ops-web"]
        containers["ops-web"]["image_id"] = f"id:{release.SOURCE['ops-web']}"
        release.validate_plan(raw, rendered, generated, containers, applications, "target")

    def test_recreate_rejects_unrelated_web_image(self):
        raw, rendered, generated, containers, applications = fixture("target")
        containers["ops-web"]["tag"] = "flixify-ops-web:unknown"
        containers["ops-web"]["image_id"] = "id:flixify-ops-web:unknown"
        with self.assertRaises(release.GateError):
            release.validate_plan(raw, rendered, generated, containers, applications, "target")

    def test_recreate_or_rollback_can_recover_missing_api_container(self):
        raw, rendered, generated, containers, applications = fixture("target")
        containers["api"]["tag"] = None
        containers["api"]["image_id"] = None
        release.validate_plan(raw, rendered, generated, containers, applications, "target")

    def test_candidate_requires_exact_commit_label(self):
        def inspect(tag):
            return {"Id": f"id:{tag}", "Config": {"Labels": {
                "org.opencontainers.image.revision": "wrong"
            }}}
        with patch.object(release, "image", side_effect=inspect):
            with self.assertRaisesRegex(release.GateError, "candidate_revision_differs"):
                release.candidate_images()

    def test_unhealthy_recreate_attempts_rollback(self):
        empty_preflight = ({}, b"", b"", {}, {}, {})
        with patch.object(sys, "argv", ["release-api-web.py", "--recreate"]), \
             patch.object(release, "preflight", return_value=empty_preflight), \
             patch.object(release, "recreate", side_effect=release.GateError("new_container_unhealthy:api")), \
             patch.object(release, "rollback") as rollback:
            with self.assertRaisesRegex(release.GateError, "deploy_failed_but_source_restored"):
                release.main()
            rollback.assert_called_once_with()

    def test_non_health_failure_does_not_hide_protected_drift(self):
        empty_preflight = ({}, b"", b"", {}, {}, {})
        with patch.object(sys, "argv", ["release-api-web.py", "--recreate"]), \
             patch.object(release, "preflight", return_value=empty_preflight), \
             patch.object(release, "recreate", side_effect=release.GateError("protected_container_changed:db")), \
             patch.object(release, "rollback") as rollback:
            with self.assertRaisesRegex(release.GateError, "protected_container_changed:db"):
                release.main()
            rollback.assert_not_called()

    def test_explicit_rollback_selects_guarded_recovery(self):
        with patch.object(sys, "argv", ["release-api-web.py", "--rollback"]), \
             patch.object(release, "rollback") as rollback:
            release.main()
            rollback.assert_called_once_with()

    def test_sync_command_exposes_only_a_known_failure_phase(self):
        failed = subprocess.CompletedProcess(
            args=("docker", "exec"), returncode=1, stdout=b"",
            stderr=b"coolify_api_web_source_sync_failed:service_parse\n",
        )
        with patch.object(release.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(release.GateError, "^coolify_sync_failed:service_parse$"):
                release.command("docker", "exec", "coolify", capture_sync_phase=True)
            with self.assertRaisesRegex(release.GateError, "^command_failed$"):
                release.command("docker", "exec", "coolify")

        for unsafe_stderr in (
            b"coolify_api_web_source_sync_failed:service_parse\nTOKEN=secret\n",
            b"coolify_api_web_source_sync_failed:unexpected_secret\n",
        ):
            failed.stderr = unsafe_stderr
            with self.subTest(stderr=unsafe_stderr), \
                 patch.object(release.subprocess, "run", return_value=failed):
                with self.assertRaisesRegex(release.GateError, "^command_failed$"):
                    release.command("docker", "exec", "coolify", capture_sync_phase=True)


class ApiOverlayTests(unittest.TestCase):
    def setUp(self):
        self.repo = Path(__file__).resolve().parents[3]
        self.previous = build.git_file(self.repo, build.REVISION + "^", build.API_SERVER)

    def test_git_patch_keeps_live_only_source_bytes(self):
        live_only = b"// Catalog guard from the pinned live API image.\n"
        original = live_only + self.previous
        with TemporaryDirectory() as directory:
            patched = build.apply_api_patch(self.repo, Path(directory), original)
        helper, branch = build.api_insertions(self.repo)
        self.assertTrue(patched.startswith(live_only))
        self.assertEqual(patched.count(helper), 1)
        self.assertEqual(patched.count(branch), 1)
        self.assertEqual(patched.replace(helper, b"", 1).replace(branch, b"", 1), original)

    def test_pinned_source_rejects_unknown_live_api(self):
        with self.assertRaisesRegex(build.GateError, "api_source_hash_differs"):
            build.verify_pinned_api_source(self.previous)

    def test_candidate_bundle_requires_compiled_direct_branch(self):
        with patch.object(build, "command", return_value=b"compiled old API"), \
             self.assertRaisesRegex(build.GateError, "api_candidate_bundle_missing_direct_branch"):
            build.verify_candidate_api_bundle()

    def test_patch_check_rejects_changed_playback_context(self):
        original = self.previous.replace(
            b"      let resolved: Awaited<ReturnType<typeof resolveVodSourceUrl>>;",
            b"      let changed: Awaited<ReturnType<typeof resolveVodSourceUrl>>;",
            1,
        )
        with TemporaryDirectory() as directory, self.assertRaises(build.GateError):
            build.apply_api_patch(self.repo, Path(directory), original)

    def test_patch_verifier_rejects_any_existing_source_change(self):
        with TemporaryDirectory() as directory:
            patched = build.apply_api_patch(self.repo, Path(directory), self.previous)
        tampered = patched.replace(b"function guessVodTransportFromPath(",
                                   b"function alteredVodTransportFromPath(", 1)
        with self.assertRaisesRegex(build.GateError, "api_patch_changed_existing_source"):
            build.verify_api_patch(self.repo, self.previous, tampered)


if __name__ == "__main__":
    unittest.main()
