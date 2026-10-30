#!/usr/bin/env python3
"""Pinned website-only APK-theme candidate with an entirely unchanged public tree.

Uses the reviewed bounded compiler and immutable candidate checks through a fresh
adapter instance. The APK, native application, provider policy and services are
inherited without source or artifact changes. Default action is read-only preflight.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("apk_theme_reviewed_web", Path(__file__).with_name("build-web-tv-style.py"))
style = importlib.util.module_from_spec(spec)
spec.loader.exec_module(style)
SOURCE_TAG = "flixify-ops-web:edge-recovery-6491e529c6d0-20261026"
SOURCE_ID = "sha256:84942fb59d00e681d4edef6258693da502dfc988ae9da4c25e50d011c9a2e4e5"
BASE_REVISION = "0c69d74adcf04136f023df09da1bc7eabfc0be7b"
LAYOUT = "apps/ops-web/app/layout.tsx"
PATHS = (
    "apps/ops-web/app/globals.css",
    LAYOUT,
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
)
NEW_PATHS = ()
TOOL_PATHS = tuple("coolify/releases/2026-10-26-edge-recovery/" + filename for filename in (
    "build-web-apk-theme.py", "release-web-apk-theme.py", "test-web-apk-theme.py",
))
TEST_PATHS = (
    "apps/ops-web/app/platform/catalog-composition-ui.test.tsx",
    "apps/ops-web/app/components/player-chrome-focus.test.tsx",
    "apps/ops-web/app/platform/vod-controls-theme.test.tsx",
    "apps/ops-web/app/canli-tv/live-directory-ui.test.tsx",
)
for module in (style, style.builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
    module.PATHS, module.NEW_PATHS = PATHS, NEW_PATHS
style.TOOL_PATHS = TOOL_PATHS
GateError = style.GateError


def validate_source_scope(repo: Path, revision: str) -> None:
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", SOURCE_ID) or not re.fullmatch(r"[0-9a-f]{40}", BASE_REVISION):
        raise GateError("apk_theme_source_pin_invalid")
    style.builder.target(revision)
    changed = style.command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision).decode().splitlines()
    if set(changed) & set(PATHS) != set(PATHS):
        raise GateError("apk_theme_runtime_manifest_differs")
    allowed = {*PATHS, *TOOL_PATHS, *TEST_PATHS}
    for path in changed:
        if path in allowed or (path.startswith("docs/superpowers/") and path.endswith(".md")):
            continue
        raise GateError("apk_theme_change_outside_allowlist:" + path)


def validate_layout(repo: Path, revision: str) -> None:
    original = style.core.git_file(repo, BASE_REVISION, LAYOUT)
    before, after = b'themeColor: "#060708"', b'themeColor: "#07090c"'
    if original.count(before) != 1:
        raise GateError("apk_theme_layout_baseline_marker_differs")
    if style.core.git_file(repo, revision, LAYOUT) != original.replace(before, after):
        raise GateError("apk_theme_layout_change_outside_theme_color")


def preflight(repo: Path, revision: str) -> tuple[dict, dict, dict, bytes, bytes]:
    style.validate_source_scope(repo, revision)
    validate_layout(repo, revision)
    base, updated, web_env, config = style.builder.preflight(repo, revision)
    return base, updated, web_env, config, style.public_manifest(SOURCE_ID)


style.validate_source_scope = validate_source_scope
style.preflight = preflight
style.__doc__ = __doc__
main = style.main

if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
