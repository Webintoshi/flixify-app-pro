"""Offline website theme release scope, public-tree and bounded rollout contracts."""
import contextlib
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


SOURCE_TAG = "flixify-ops-web:edge-recovery-6491e529c6d0-20261026"
SOURCE_ID = "sha256:84942fb59d00e681d4edef6258693da502dfc988ae9da4c25e50d011c9a2e4e5"
BASE = "0c69d74adcf04136f023df09da1bc7eabfc0be7b"
AVAILABLE = Path(__file__).with_name("build-web-apk-theme.py").is_file()
if AVAILABLE:
    theme = load("apk_theme_builder_test", "build-web-apk-theme.py")
    web = theme.style
    release = load("apk_theme_release_test", "release-web-apk-theme.py").release
else:
    web = load("apk_theme_prior_builder_for_red", "build-web-tv-style.py")


class CurrentReleaseTests(unittest.TestCase):
    def test_current_source_pin_and_baseline_do_not_reuse_the_old_theme_release(self):
        self.assertEqual((web.SOURCE_TAG, web.SOURCE_ID, web.BASE_REVISION), (SOURCE_TAG, SOURCE_ID, BASE))
        self.assertRegex(SOURCE_ID, r"^sha256:[0-9a-f]{64}$")
        self.assertRegex(BASE, r"^[0-9a-f]{40}$")


if AVAILABLE:
    contracts = load("apk_theme_reviewed_contracts", "test-web-tv-style.py")
    contracts.web, contracts.release = web, release
    contracts.SOURCE_TAG, contracts.SOURCE_ID = SOURCE_TAG, SOURCE_ID
    contracts.release_contract.web, contracts.release_contract.guard = release, release.guard
    WebReleaseTests = contracts.WebReleaseTests
    PublicTreeTests = contracts.PublicTreeTests
    ContainerCompileTests = contracts.ContainerCompileTests
    BuildActionsTests = contracts.BuildActionsTests
    ReleaseActionsTests = contracts.ReleaseActionsTests

    class SourceScopeTests(contracts.SourceScopeTests):
        def test_reviewed_runtime_tests_docs_and_tools_are_the_only_accepted_changes(self):
            self.scope((*theme.TEST_PATHS, "docs/superpowers/specs/apk-theme.md", *theme.TOOL_PATHS))

    class SharedBuilderTests(contracts.SharedBuilderTests):
        def test_only_reviewed_runtime_files_are_copied(self):
            dockerfile = web.dockerfile(contracts.REVISION)
            copies = [line for line in dockerfile.splitlines() if line.startswith("COPY ")]
            self.assertEqual(copies, [f"COPY {path} /app/{path}" for path in theme.PATHS])
            self.assertEqual(set(theme.PATHS), {
                "apps/ops-web/app/globals.css",
                "apps/ops-web/app/layout.tsx",
                "apps/ops-web/app/platform/platform.module.css",
                "apps/ops-web/app/platform/catalog.tsx",
                "apps/ops-web/app/platform/shell.tsx",
                "apps/ops-web/app/platform/artwork.tsx",
                "apps/ops-web/app/platform/catalog-panels.module.css",
                "apps/ops-web/app/platform/categories.module.css",
                "apps/ops-web/app/platform/series-catalog.module.css",
                "apps/ops-web/app/platform/series-detail.module.css",
                "apps/ops-web/app/canli-tv/page.tsx",
                "apps/ops-web/app/canli-tv/live-tv-app.module.css",
                "apps/ops-web/app/components/player-chrome.tsx",
                "apps/ops-web/app/components/player-chrome.module.css",
                "apps/ops-web/app/platform/detail.tsx",
                "apps/ops-web/app/platform/vod-player.module.css",
                "apps/ops-web/app/platform/vod-episode-drawer.tsx",
                "apps/ops-web/app/platform/vod-episode-drawer.module.css",
                "apps/ops-web/app/account/account.module.css",
                "apps/ops-web/app/platform/landing.module.css",
            })
            self.assertEqual(theme.NEW_PATHS, ())
            self.assertEqual(dockerfile.splitlines()[0], "FROM " + SOURCE_TAG)
            self.assertIn("LABEL vip.flixify.edge-recovery.base=" + SOURCE_ID, dockerfile)
            self.assertEqual(sum(line.startswith("RUN ") for line in dockerfile.splitlines()), 1)
            self.assertNotIn("COPY package", dockerfile)
            self.assertNotIn("public/", dockerfile)
            self.assertNotIn("npm ci", dockerfile)

    class PinsAndPreflightTests(contracts.PinsAndPreflightTests):
        def setUp(self):
            patch.object(theme, "validate_layout").start()
            self.addCleanup(patch.stopall)

        def test_exact_current_source_and_baseline_are_isolated_from_old_entrypoints(self):
            self.assertEqual((web.SOURCE_TAG, web.SOURCE_ID, web.BASE_REVISION), (SOURCE_TAG, SOURCE_ID, BASE))
            self.assertEqual(web.builder.PATHS, theme.PATHS)
            self.assertEqual(web.builder.NEW_PATHS, ())
            old = load("apk_theme_historical_builder_unchanged", "build-web-tv-style.py")
            self.assertEqual(old.SOURCE_ID, "sha256:81cb96468427b1d2463c2b41c09b4339e9795befadff369827476580d2dca399")
            self.assertEqual(old.BASE_REVISION, "120b35f77f2ea52c03a7179e1cbea556d477b65c")
            self.assertEqual(len(old.PATHS), 15)

    class ThemeSpecificScopeTests(unittest.TestCase):
        def scope(self, extra=(), omitted=()):
            changed = [path for path in theme.PATHS if path not in omitted]
            with patch.object(web, "command", return_value=("\n".join(changed + list(extra)) + "\n").encode()):
                theme.validate_source_scope(Path("/repo"), contracts.REVISION)

        def test_no_apk_descriptor_registration_provider_or_network_policy_change_is_allowed(self):
            for path in ("apps/ops-web/app/platform/tv-download.ts", "apps/ops-web/app/platform/onboarding.tsx",
                         "apps/ops-web/app/platform/personal-provider.ts", "apps/ops-web/app/platform/session.tsx",
                         "apps/ops-web/app/components/player-chrome-policy.ts",
                         "apps/ops-web/app/platform/live-recovery.ts", "apps/tv-android/app/build.gradle",
                         "apps/ops-web/public/downloads/flixify-pro-1.3.2.apk"):
                with self.subTest(path=path), self.assertRaises(web.GateError):
                    self.scope((path,))

        def test_tests_and_documents_are_limited_to_the_reviewed_theme_scope(self):
            self.scope((*theme.TEST_PATHS, "docs/superpowers/specs/web-apk-theme.md", *theme.TOOL_PATHS))
            for path in ("apps/ops-web/app/platform/personal-provider.test.ts", "docs/unrelated.md",
                         "apps/ops-web/app/platform/catalog-showcase-ui.test.tsx",
                         "apps/ops-web/app/canli-tv/live-stall-recovery.test.tsx",
                         "apps/ops-web/app/platform/cosmetic.test.tsx/runtime.ts",
                         "coolify/releases/2026-10-26-edge-recovery/build-tv-pro-web.py"):
                with self.subTest(path=path), self.assertRaises(web.GateError):
                    self.scope((path,))

        def test_malformed_configured_source_pin_stops_before_git_or_image_reads(self):
            with patch.object(theme, "SOURCE_ID", "sha256:" + "a" * 65), patch.object(web, "command") as command, \
                 self.assertRaisesRegex(web.GateError, "source_pin_invalid"):
                theme.validate_source_scope(Path("/repo"), contracts.REVISION)
            command.assert_not_called()

        def test_layout_change_beyond_theme_color_stops_before_image_reads(self):
            original = b'export const viewport = { themeColor: "#060708", width: "device-width" };\n'
            changed = original.replace(b"#060708", b"#07090c").replace(b"device-width", b"unsafe-width")
            with patch.object(web, "validate_source_scope"), \
                 patch.object(web.core, "git_file", side_effect=lambda repo, revision, path: original if revision == BASE else changed), \
                 patch.object(web.builder, "preflight", return_value=({}, {}, {}, b"config")) as shared, \
                 patch.object(web, "public_manifest", return_value=b"public") as public, \
                 self.assertRaisesRegex(web.GateError, "layout_change_outside_theme_color"):
                web.preflight(Path("/repo"), contracts.REVISION)
            shared.assert_not_called()
            public.assert_not_called()

        def test_layout_accepts_only_one_exact_theme_color_replacement(self):
            original = b'export const viewport = { themeColor: "#060708", width: "device-width" };\n'
            with patch.object(web.core, "git_file", side_effect=lambda repo, revision, path:
                              original if revision == BASE else original.replace(b"#060708", b"#07090c")):
                theme.validate_layout(Path("/repo"), contracts.REVISION)
            for original in (b'export const viewport = {};', original + b' themeColor: "#060708"'):
                with patch.object(web.core, "git_file", return_value=original), self.assertRaises(web.GateError):
                    theme.validate_layout(Path("/repo"), contracts.REVISION)


if __name__ == "__main__":
    unittest.main()
