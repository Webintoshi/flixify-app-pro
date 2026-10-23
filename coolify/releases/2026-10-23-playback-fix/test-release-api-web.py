"""Local policy tests for the guarded Coolify release plan."""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


# Production uses PyYAML, already required by the prior Coolify release.
# The pure policy checks below do not need YAML parsing.
sys.modules.setdefault("yaml", types.SimpleNamespace(YAMLError=Exception))
location = Path(__file__).with_name("release-api-web.py")
spec = importlib.util.spec_from_file_location("release_api_web", location)
assert spec and spec.loader
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


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


if __name__ == "__main__":
    unittest.main()
