"""Offline guarded live-incident release checks; no server or provider access."""
import importlib.util
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


SOURCE_TAG = "flixify-ops-web:edge-recovery-5f8014386833-20261026"
SOURCE_ID = "sha256:58b46c80e4579be67f8adfe2666d835f533d616ab57f7ce3ed9ac98215992afd"
BASE = "9eea15954fc1749836fedad8a0a573dc84031c5c"
AVAILABLE = Path(__file__).with_name("build-live-incident-web.py").is_file()
if AVAILABLE:
    incident = load("live_incident_builder_test", "build-live-incident-web.py")
    web = incident.style
    release = load("live_incident_release_test", "release-live-incident-web.py").release
else:
    web = load("live_incident_prior_builder_for_red", "build-web-tv-style.py")


class CurrentSourceTests(unittest.TestCase):
    def test_incident_release_uses_the_current_verified_image_and_baseline(self):
        self.assertEqual((web.SOURCE_TAG, web.SOURCE_ID, web.BASE_REVISION), (SOURCE_TAG, SOURCE_ID, BASE))
        self.assertRegex(SOURCE_ID, r"^sha256:[0-9a-f]{64}$")


if AVAILABLE:
    contract = load("live_incident_reviewed_contracts", "test-web-tv-style.py")
    contract.web, contract.release = web, release
    contract.SOURCE_TAG, contract.SOURCE_ID = SOURCE_TAG, SOURCE_ID
    contract.release_contract.web, contract.release_contract.guard = release, release.guard
    WebReleaseTests = contract.WebReleaseTests
    PublicTreeTests = contract.PublicTreeTests
    ContainerCompileTests = contract.ContainerCompileTests
    BuildActionsTests = contract.BuildActionsTests
    ReleaseActionsTests = contract.ReleaseActionsTests

    class SharedBuilderTests(contract.SharedBuilderTests):
        def test_only_reviewed_runtime_files_are_copied(self):
            value = web.dockerfile(contract.REVISION)
            self.assertEqual(value.splitlines()[0], "FROM " + SOURCE_TAG)
            self.assertEqual([line for line in value.splitlines() if line.startswith("COPY ")],
                             [f"COPY {path} /app/{path}" for path in incident.PATHS])
            self.assertEqual(set(incident.PATHS), {
                "apps/ops-web/app/canli-tv/page.tsx",
            })
            self.assertEqual(incident.TEST_PATHS, ("apps/ops-web/app/canli-tv/live-stall-recovery.test.tsx",))
            self.assertEqual(incident.NEW_PATHS, ())
            self.assertNotIn("public/", value)
            self.assertNotIn("npm ci", value)
            self.assertEqual(sum(line.startswith("RUN ") for line in value.splitlines()), 1)

    class PinsAndPreflightTests(contract.PinsAndPreflightTests):
        def test_exact_current_source_and_baseline_are_isolated_from_old_entrypoints(self):
            self.assertEqual((web.SOURCE_TAG, web.SOURCE_ID, web.BASE_REVISION), (SOURCE_TAG, SOURCE_ID, BASE))
            self.assertEqual(web.builder.PATHS, incident.PATHS)
            self.assertEqual(web.builder.NEW_PATHS, ())
            old = load("live_incident_unchanged_historical_builder", "build-web-tv-style.py")
            self.assertEqual(len(old.PATHS), 15)
            self.assertNotEqual(old.SOURCE_ID, SOURCE_ID)

    class SourceScopeTests(contract.SourceScopeTests):
        def test_reviewed_runtime_tests_docs_and_tools_are_the_only_accepted_changes(self):
            self.scope((*incident.TEST_PATHS, "docs/superpowers/live-incident.md", *incident.TOOL_PATHS))

    class IncidentScopeTests(unittest.TestCase):
        def scope(self, extra=()):
            with patch.object(web, "command", return_value=("\n".join((*incident.PATHS, *extra)) + "\n").encode()):
                incident.validate_source_scope(Path("/repo"), contract.REVISION)

        def test_current_ui_native_artifact_config_and_other_provider_policies_are_blocked(self):
            for path in ("apps/ops-web/app/globals.css", "apps/ops-web/app/canli-tv/live-tv-app.module.css",
                         "apps/ops-web/app/platform/catalog.tsx", "apps/ops-web/app/platform/detail.tsx",
                         "apps/ops-web/app/platform/session.tsx", "apps/ops-web/app/platform/tv-download.ts",
                         "apps/ops-web/app/platform/personal-provider.ts",
                         "apps/ops-web/app/canli-tv/live-playback-policy.ts",
                         "apps/ops-web/app/platform/direct-playback-deadline.ts",
                         "apps/ops-web/app/platform/playback-transport.ts",
                         "apps/ops-web/public/downloads/flixify-pro-1.3.2.apk",
                         "apps/tv-android/app/build.gradle", "apps/worker/src/index.ts",
                         "package-lock.json", "coolify/releases/2026-10-26-edge-recovery/build-web.py"):
                with self.subTest(path=path), self.assertRaises(web.GateError):
                    self.scope((path,))

        def test_nonincident_tests_and_docs_are_not_in_the_release_scope(self):
            for path in ("apps/ops-web/app/platform/catalog-composition-ui.test.tsx", "docs/other.md"):
                with self.subTest(path=path), self.assertRaises(web.GateError):
                    self.scope((path,))


if __name__ == "__main__":
    unittest.main()
