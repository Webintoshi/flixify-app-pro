#!/usr/bin/env python3
"""Pinned Flixify Pro 1.3.2 APK and exact public release wording; preflight by default.

The prior reviewed APK/public-tree/bounded-compiler contracts are reused through
a fresh private adapter instance. Historical entrypoints keep their original pins.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("pro_tv_reviewed_apk_web", Path(__file__).with_name("build-tv-direct-web.py"))
direct = importlib.util.module_from_spec(spec)
spec.loader.exec_module(direct)
SOURCE_TAG = "flixify-ops-web:edge-recovery-4d7cb2940197-20261026"
SOURCE_ID = "sha256:883c2103c3cb8d21b36cf148eaca873c41c21d81caa044944691cf527a0cc21"
BASE_REVISION = "6dd7714f3c7a16cd5acdb2ed02cc1dbab3ee37f9"
DESCRIPTOR = "apps/ops-web/app/platform/tv-download.ts"
SHELL = "apps/ops-web/app/platform/shell.tsx"
DOWNLOAD_PAGE = "apps/ops-web/app/indir/page.tsx"
GRADLE = "apps/tv-android/app/build.gradle"
MANIFEST = "apps/tv-android/app/src/main/AndroidManifest.xml"
BUILD_SCRIPT = "apps/tv-android/scripts/build-test-apk.sh"
PLAYER = "apps/tv-android/app/src/main/java/vip/flixify/tv/PlayerActivity.java"
PLAYER_TEST = "apps/tv-android/app/src/androidTest/java/vip/flixify/tv/PlayerRemoteTest.java"
PATHS = (DESCRIPTOR, SHELL, DOWNLOAD_PAGE)
NEW_PATHS = ()
APK = "apps/ops-web/public/downloads/flixify-pro-1.3.2.apk"
TOOL_PATHS = tuple("coolify/releases/2026-10-26-edge-recovery/" + filename for filename in (
    "build-tv-pro-web.py", "release-tv-pro-web.py", "test-tv-pro-web.py",
))
REPLACEMENTS = {
    GRADLE: ((b"versionCode 6", b"versionCode 7"),
             (b"versionName '1.3.1-test.1'", b"versionName '1.3.2'")),
    MANIFEST: ((b'android:label="Flixify TV Test"', b'android:label="Flixify Pro"'),),
    DESCRIPTOR: ((b"flixify-tv-1.3.1-test.1.apk", b"flixify-pro-1.3.2.apk"),
                 (b'"1.3.1-test.1"', b'"1.3.2"')),
    SHELL: (("Tek APK · Test sürümü".encode(), "Flixify Pro · Tek APK".encode()),),
    DOWNLOAD_PAGE: (("ANDROID TV · TEST SÜRÜMÜ".encode(), "FLIXIFY PRO · ANDROID TV".encode()),
                    ("Flixify TV Test’i aç".encode(), "Flixify Pro’yu aç".encode()),
                    ("Bu ilk test sürümü. Karşılaştığın sorunu".encode(), "Karşılaştığın sorunu".encode())),
    BUILD_SCRIPT: ((b"Test APK:", b"Flixify Pro APK:"),),
}

# All modules below belong to this adapter instance, never to imported historical
# CLI processes. The shared compiler and validators read these exact current pins.
for module in (direct, direct.style, direct.builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = SOURCE_TAG, SOURCE_ID, BASE_REVISION
direct.PATHS, direct.NEW_PATHS, direct.APK = PATHS, NEW_PATHS, APK
direct.builder.PATHS, direct.builder.NEW_PATHS = PATHS, NEW_PATHS
GateError = direct.GateError


def validate_source_scope(repo: Path, revision: str) -> None:
    direct.builder.target(revision)
    changed = direct.command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision).decode().splitlines()
    required = {*PATHS, APK, GRADLE, MANIFEST, PLAYER}
    if not required <= set(changed):
        raise GateError("pro_tv_required_manifest_differs")
    allowed = required | {*TOOL_PATHS, BUILD_SCRIPT, PLAYER_TEST, "apps/tv-android/README.md"}
    for path in changed:
        if path in allowed or (path.startswith("docs/") and path.endswith(".md")):
            continue
        raise GateError("pro_tv_change_outside_allowlist:" + path)


def validate_versions(repo: Path, revision: str) -> None:
    for path, replacements in REPLACEMENTS.items():
        original = direct.core.git_file(repo, BASE_REVISION, path)
        expected = original
        for before, after in replacements:
            count = 2 if path == DESCRIPTOR and before == b"flixify-tv-1.3.1-test.1.apk" else 1
            if original.count(before) != count:
                raise GateError("pro_tv_baseline_marker_differs:" + path)
            expected = expected.replace(before, after)
        actual = direct.core.git_file(repo, revision, path)
        if actual != expected and not (path == BUILD_SCRIPT and actual == original):
            raise GateError("pro_tv_change_outside_reviewed_replacements:" + path)


direct.validate_source_scope = validate_source_scope
direct.validate_versions = validate_versions
direct.__doc__ = __doc__
main = direct.main

if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
