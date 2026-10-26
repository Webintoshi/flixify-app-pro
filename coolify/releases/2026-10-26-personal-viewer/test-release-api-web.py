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
        "db": "postgres:16-alpine",
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
    containers["db"]["image_id"] = "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
    applications = {name: tags[name] for name in release.CHANGED}
    return raw, rendered, generated, containers, applications


class ReleasePlanTests(unittest.TestCase):
    def setUp(self):
        pin = patch.object(release, "require_final_pin")
        pin.start()
        self.addCleanup(pin.stop)
        self.ids = patch.object(release, "image_id", side_effect=lambda tag: f"id:{tag}")
        self.ids.start()
        self.addCleanup(self.ids.stop)

    def test_known_db_digest_survives_downloaded_floating_tag_drift(self):
        newer = "sha256:f4610795587492cd4fb887c2dc3de301b813278bb6f616992061141b5f15ac36"
        for stage in ("source", "target"):
            with self.subTest(stage=stage), patch.object(release, "image_id", side_effect=lambda tag: newer if tag == "postgres:16-alpine" else f"id:{tag}") as inspect:
                release.validate_plan(*fixture(stage), stage)
                self.assertNotIn(unittest.mock.call("postgres:16-alpine"), inspect.call_args_list)

    def test_unknown_db_digest_rejected(self):
        for stage in ("source", "target"):
            values = fixture(stage)
            values[3]["db"]["image_id"] = "sha256:unexpected"
            with self.subTest(stage=stage), self.assertRaisesRegex(release.GateError, "running_image_differs:db"):
                release.validate_plan(*values, stage)

    def test_unknown_db_config_or_compose_tag_rejected(self):
        for stage in ("source", "target"):
            for change_compose in (False, True):
                values = fixture(stage)
                values[3]["db"]["tag"] = "postgres:other"
                if change_compose:
                    for document in values[:3]:
                        document["services"]["db"]["image"] = "postgres:other"
                with self.subTest(stage=stage, change_compose=change_compose), self.assertRaisesRegex(release.GateError, "running_image_differs:db"):
                    release.validate_plan(*values, stage)

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
             patch.object(release, "verify_recovery_context"), \
             patch.object(release, "rollback") as rollback:
            with self.assertRaisesRegex(release.GateError, "deploy_failed_but_source_restored"):
                release.main()
            rollback.assert_called_once_with()

    def test_non_health_failure_does_not_hide_protected_drift(self):
        empty_preflight = ({}, b"", b"", {}, {}, {})
        with patch.object(sys, "argv", ["release-api-web.py", "--recreate"]), \
             patch.object(release, "preflight", return_value=empty_preflight), \
             patch.object(release, "recreate", side_effect=release.GateError("protected_container_changed:db")), \
             patch.object(release, "verify_recovery_context"), \
             patch.object(release, "rollback") as rollback:
            with self.assertRaisesRegex(release.GateError, "protected_container_changed:db"):
                release.main()
            rollback.assert_not_called()

    def test_explicit_rollback_selects_guarded_recovery(self):
        with patch.object(sys, "argv", ["release-api-web.py", "--rollback"]), \
             patch.object(release, "verify_recovery_context"), \
             patch.object(release, "rollback") as rollback:
            release.main()
            rollback.assert_called_once_with()

    def test_sync_command_exposes_only_a_known_failure_phase(self):
        failed = subprocess.CompletedProcess(
            args=("docker", "exec"), returncode=1, stdout=b"",
            stderr=b"coolify_api_web_source_sync_failed:application_set\n",
        )
        with patch.object(release.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(release.GateError, "^coolify_sync_failed:application_set$"):
                release.command("docker", "exec", "coolify", capture_sync_phase=True)
            with self.assertRaisesRegex(release.GateError, "^command_failed$"):
                release.command("docker", "exec", "coolify")

        for unsafe_stderr in (
            b"coolify_api_web_source_sync_failed:application_set\nTOKEN=secret\n",
            b"coolify_api_web_source_sync_failed:unexpected_secret\n",
        ):
            failed.stderr = unsafe_stderr
            with self.subTest(stderr=unsafe_stderr), \
                 patch.object(release.subprocess, "run", return_value=failed):
                with self.assertRaisesRegex(release.GateError, "^command_failed$"):
                    release.command("docker", "exec", "coolify", capture_sync_phase=True)

    def test_postcheck_reversion_requires_exact_target_metadata(self):
        raw, rendered, _, containers, _ = fixture()
        target_raw, target_rendered = release.expected_swapped(raw, rendered, release.TARGET)
        target_raw["services"]["worker"]["environment"]["SAFE"] = "changed"
        record = {"docker_compose_raw": target_raw, "docker_compose": target_rendered}
        with patch.object(release, "service_record", return_value=record), \
             patch.object(release, "parsed", side_effect=lambda value: value), \
             patch.object(release, "locked_image_swap") as swap:
            with self.assertRaisesRegex(release.GateError, "source_restore_target_metadata_differs"):
                release.restore_prior_images_after_postcheck(
                    b"source", b"env", object(), object(), containers,
                    raw, rendered, release.SOURCE, release.TARGET,
                )
            swap.assert_not_called()

    def test_postcheck_reversion_swaps_back_only_when_target_is_exact(self):
        raw, rendered, _, containers, _ = fixture()
        for name, item in containers.items():
            item.update(id=f"container:{name}", hash=f"config:{name}")
        target_raw, target_rendered = release.expected_swapped(raw, rendered, release.TARGET)
        target_record = {"docker_compose_raw": target_raw, "docker_compose": target_rendered}
        source_record = {"docker_compose_raw": raw, "docker_compose": rendered}
        compose = types.SimpleNamespace(read_bytes=unittest.mock.Mock(
            side_effect=[b"target", b"source", b"source"]),
            stat=unittest.mock.Mock(return_value=object()))
        env = types.SimpleNamespace(read_bytes=unittest.mock.Mock(return_value=b"env"),
            stat=unittest.mock.Mock(return_value=object()))
        with patch.object(release, "service_record", side_effect=[target_record, source_record]), \
             patch.object(release, "parsed", side_effect=lambda value: {
                 b"target": target_rendered, b"source": rendered,
             }.get(value, value) if isinstance(value, bytes) else value), \
             patch.object(release, "application_images", side_effect=[release.TARGET, release.SOURCE]), \
             patch.object(release, "container_snapshot", return_value=containers), \
             patch.object(release, "COMPOSE", compose), patch.object(release, "ENV", env), \
             patch.object(release, "locked_image_swap") as swap, \
             patch.object(release, "command"):
            release.restore_prior_images_after_postcheck(
                b"source", b"env", object(), object(), containers,
                raw, rendered, release.SOURCE, release.TARGET,
            )
            swap.assert_called_once_with(target_record, release.TARGET, release.SOURCE)

    def test_operational_recreate_failures_attempt_guarded_rollback(self):
        for label in ("command_failed", "command_unavailable", "candidate_tag_drift:api"):
            with self.subTest(label=label), patch.object(sys, "argv", ["release", "--recreate"]), \
                 patch.object(release, "preflight", return_value=({}, b"compose", b"env", {}, {}, {})), \
                 patch.object(release, "recreate", side_effect=release.GateError(label)), \
                 patch.object(release, "verify_recovery_context") as guard, \
                 patch.object(release, "rollback") as rollback:
                with self.assertRaisesRegex(release.GateError, "deploy_failed_but_source_restored"):
                    release.main()
                guard.assert_called_once_with({}, b"compose", b"env")
                rollback.assert_called_once_with()

    def test_guard_failure_blocks_operational_rollback(self):
        with patch.object(sys, "argv", ["release", "--recreate"]), \
             patch.object(release, "preflight", return_value=({}, b"", b"", {}, {}, {})), \
             patch.object(release, "recreate", side_effect=release.GateError("command_failed")), \
             patch.object(release, "verify_recovery_context", side_effect=release.GateError("protected_container_changed:worker")), \
             patch.object(release, "rollback") as rollback:
            with self.assertRaisesRegex(release.GateError, "protected_container_changed:worker"):
                release.main()
            rollback.assert_not_called()

    def test_recreate_revalidates_candidate_before_any_mutation(self):
        with patch.object(release, "candidate_images", side_effect=release.GateError("candidate_revision_differs:api")), \
             patch.object(release, "command") as command:
            with self.assertRaisesRegex(release.GateError, "candidate_revision_differs"):
                release.recreate({}, b"")
            command.assert_not_called()

    def test_accepted_candidate_ids_reject_mutable_tag(self):
        accepted = {name: "accepted:" + name for name in release.CHANGED}
        with patch.object(release, "image_id", side_effect=lambda tag: "unrelated"):
            with self.assertRaisesRegex(release.GateError, "candidate_tag_drift"):
                release.verify_candidate_ids(accepted)

    def test_target_retag_does_not_block_rollback_validation(self):
        raw, rendered, generated, containers, applications = fixture("target")
        containers["api"]["image_id"] = "old accepted candidate now untagged"
        with self.assertRaisesRegex(release.GateError, "running_image_id_differs"):
            release.validate_plan(raw, rendered, generated, containers, applications, "target")
        release.validate_plan(raw, rendered, generated, containers, applications, "target", recovering=True)

    def test_health_compares_running_image_to_accepted_id(self):
        item = {"tag": release.TARGET["api"], "image_id": "retagged", "running": True, "health": "healthy", "hash": "same"}
        with patch.object(release, "container_snapshot", return_value={"api": item}), patch.object(release, "urlopen") as request:
            self.assertFalse(release.healthy("api", release.TARGET["api"], "accepted"))
            request.assert_not_called()


class ApiOverlayTests(unittest.TestCase):
    repo = Path(__file__).resolve().parents[3]

    def setUp(self):
        # Pending builds remain blocked; exercise patch mechanics against current
        # committed app until the reviewed immutable revision is supplied.
        revision = build.REVISION if build.REVISION != "PENDING_FINAL_APP_REVISION" else subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.repo).decode().strip()
        pin = patch.object(build, "REVISION", revision)
        pin.start()
        self.addCleanup(pin.stop)

    def test_exact_final_runtime_manifest_and_new_module_absence(self):
        changed = set(build.command("git", "-C", str(self.repo), "diff", "--name-only", build.BASE_REVISION, build.REVISION, "--", "apps/api/src", "apps/ops-web/app").decode().splitlines())
        self.assertEqual({path for path in changed if ".test." not in path}, {path for paths in build.OVERLAYS.values() for path in paths})
        for path in build.NEW_FILES:
            with self.subTest(path=path):
                self.assertTrue(build.git_file(self.repo, build.REVISION, path))
                with self.assertRaises(build.GateError):
                    build.git_file(self.repo, build.BASE_REVISION, path)

    def test_each_live_source_hash_rejects_unknown_bytes(self):
        for path in build.PINNED_API_SOURCES:
            with self.subTest(path=path), self.assertRaises(build.GateError):
                build.verify_pinned_api_source(b"unknown live bytes", path)

    def test_each_reviewed_patch_preserves_live_only_bytes_and_rejects_extra_mutation(self):
        import hashlib
        for path in build.PINNED_API_SOURCES:
            original = build.git_file(self.repo, build.BASE_REVISION, path) + b"\n// live-only adult/catalog marker\n"
            pins = {**build.PINNED_API_SOURCES, path: hashlib.sha256(original).hexdigest()}
            with self.subTest(path=path), patch.object(build, "PINNED_API_SOURCES", pins):
                with TemporaryDirectory() as directory:
                    result = build.apply_api_patch(self.repo, Path(directory), original, path)
                self.assertTrue(result.endswith(b"// live-only adult/catalog marker\n"))
                build.verify_api_patch(self.repo, original, result, path)
                with self.assertRaisesRegex(build.GateError, "api_patch_changed_existing_source"):
                    build.verify_api_patch(self.repo, original, result + b"// extra mutation\n", path)

    def test_source_image_pin_rejects_retagged_image(self):
        with patch.object(release, "image_id", return_value="sha256:unexpected"), self.assertRaisesRegex(release.GateError, "source_image_drift"):
            release.verify_source_images()

    def test_source_image_pin_accepts_exact_images(self):
        ids = {release.SOURCE[name]: value for name, value in release.SOURCE_IDS.items()}
        with patch.object(release, "image_id", side_effect=ids.__getitem__):
            release.verify_source_images()

    def test_generated_config_rejects_unrelated_change(self):
        raw, rendered, generated, containers, applications = fixture()
        import copy
        generated = copy.deepcopy(generated)
        generated["services"]["worker"]["command"] = "changed"
        with patch.object(release, "image_id", side_effect=lambda tag: f"id:{tag}"), self.assertRaises(release.GateError):
            release.validate_plan(raw, rendered, generated, containers, applications, "source")

    def test_identity_includes_db_and_worker_ids(self):
        before = {name: {"id": name, "image_id": "same", "tag": "same", "hash": "same"} for name in ("db", "worker")}
        for name in before:
            import copy
            after = copy.deepcopy(before)
            after[name]["id"] = "recreated"
            self.assertNotEqual(release.container_identity(before), release.container_identity(after))

    def test_candidate_mount_and_root_match_import_layout(self):
        contents = {path: build.git_file(self.repo, build.REVISION, path) for path in build.PERSONAL_API_TESTS}
        with TemporaryDirectory() as directory, patch.object(build, "git_file", side_effect=lambda repo, rev, path: contents[path]), patch.object(build, "command", return_value=b"") as run:
            build.test_candidate_api(self.repo, Path(directory))
            self.assertEqual(run.call_count, 2)
            for call in run.call_args_list:
                args = call.args
                self.assertIn("none", args)
                self.assertIn("/app", args)
            first = run.call_args_list[0].args
            self.assertIn(build.CANDIDATE_API_TEST, first)
            self.assertTrue(any(str(arg).endswith(":/app/" + build.CANDIDATE_API_TEST + ":ro") for arg in first))
            for path in build.PERSONAL_API_TESTS:
                self.assertIn(path, run.call_args_list[1].args)
                self.assertTrue(any(str(arg).endswith(":/app/" + path + ":ro") for arg in run.call_args_list[1].args))


class CombinedReleaseGates(unittest.TestCase):
    def test_pending_pin_blocks_build_and_release(self):
        for module in (build, release):
            with patch.object(module, "REVISION", "PENDING_FINAL_APP_REVISION"), self.assertRaisesRegex(module.GateError, "final_app_revision_pending"):
                module.require_final_pin()

    def test_valid_pin_requires_matching_targets(self):
        for module in (build, release):
            revision = "a" * 40
            targets = {name: f"flixify-{name}:personal-viewer-{revision[:7]}-20261026" for name in ("api", "ops-web")}
            with patch.object(module, "REVISION", revision), patch.object(module, "TARGET", targets):
                module.require_final_pin()
            with patch.object(module, "REVISION", revision), self.assertRaisesRegex(module.GateError, "target_revision_tag_differs"):
                module.require_final_pin()

    def test_low_disk_blocks_before_docker(self):
        import types
        with patch.object(build.shutil, "disk_usage", return_value=types.SimpleNamespace(free=build.MIN_FREE_BYTES - 1)), patch.object(build, "command") as command, self.assertRaisesRegex(build.GateError, "insufficient_build_disk"):
            build.build_one(Path("."), "ops-web", {}, Path("."))
        command.assert_not_called()

    def test_web_cache_removed_in_same_build_layer(self):
        text = build_location.read_text()
        self.assertIn("RUN rm -rf /app/apps/ops-web/.next && npm run build -w @flixify/ops-web && rm -rf /app/apps/ops-web/.next/cache", text)


if __name__ == "__main__":
    unittest.main()
