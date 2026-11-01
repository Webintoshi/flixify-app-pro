"""Offline publication guards; no Docker, account or production activity."""
import contextlib
import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.modules.setdefault("yaml", types.SimpleNamespace(safe_load=json.loads, YAMLError=ValueError))
HERE = Path(__file__).parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


web = load("mac_download_contract", HERE / "build-web.py")
release = load("mac_download_release_contract", HERE / "release-web.py")
REVISION, IMAGE = "a" * 40, "sha256:" + "b" * 64


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="flixify-mac-download-contract-")
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Offline fixture")
        self.git("config", "user.email", "offline@example.invalid")
        for path in web.PATHS:
            if path not in web.NEW_PATHS:
                self.put(path, b"old source\n")
        self.put(web.TV_MANIFEST, b"retained TV manifest")
        self.put("apps/ops-web/public/downloads/old.apk", b"retained APK")
        for tree in ("apps/api", "apps/tv-android", "packages"):
            self.put(tree + "/unchanged.txt", b"retained source")
        self.base = self.commit()
        self.put("apps/macos-native/Package.swift", b"frozen native source\n")
        self.mac = self.commit()
        self.mac_tree = self.git("rev-parse", self.mac + ":apps/macos-native")
        for path in web.PATHS:
            self.put(path, b"reviewed source\n")
        self.dmg = b"synthetic disk image" * 20 + b"koly" + b"\0" * 508
        self.sha = hashlib.sha256(self.dmg).hexdigest()
        self.put(web.DMG, self.dmg)
        self.revision = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def put(self, path, value):
        p = self.repo / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(value)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def pins(self):
        return patch.multiple(web, BASE_REVISION=self.base, MAC_REVISION=self.mac,
                              MAC_TREE=self.mac_tree, DMG_BYTES=len(self.dmg), DMG_SHA256=self.sha)


class Contracts(unittest.TestCase):
    def fixture(self):
        f = Fixture()
        self.addCleanup(f.temp.cleanup)
        return f

    def public(self):
        name = web.TV_MANIFEST.removeprefix("apps/ops-web/public/")
        return json.dumps([["dir", "", 493], ["dir", "downloads", 493],
                           ["file", name, 420, web.TV_MANIFEST_BYTES, web.TV_MANIFEST_SHA256],
                           ["file", "downloads/old.apk", 420, 100, "c" * 64],
                           ["link", "retained-link", 511, "downloads/old.apk"]]).encode()

    def descriptor(self):
        return (HERE.parents[2] / "apps/ops-web/app/platform/mac-download.ts").read_bytes()

    def test_exact_current_baseline_and_scope(self):
        self.assertEqual(web.SOURCE_ID, "sha256:9bd0bd2ad50aef4faec981fbffb4ba6e4d121004d3f6a9dab71b740eee904db4")
        self.assertEqual(web.BASE_REVISION, "7ceb5becb0060e5d768c24ae2aeb99f9cb9fb981")
        self.assertEqual(web.NEW_PATHS, (web.DESCRIPTOR,))
        self.assertEqual(set(web.EXCLUDED), {*web.PATHS, web.DMG, "apps/ops-web/.next"})
        self.assertNotIn(web.TV_MANIFEST, web.EXCLUDED)
        self.assertEqual(web.target(REVISION), "flixify-ops-web:macos-test-download-aaaaaaaaaaaa-20261101")
        for invalid in ("HEAD", "a" * 12, None):
            with self.assertRaises(web.GateError):
                web.target(invalid)

    def test_scope_accepts_frozen_mac_and_only_reviewed_web_download(self):
        f = self.fixture()
        with f.pins():
            web.validate_source_scope(f.repo, f.revision)
        for path in ("apps/api/unchanged.txt", "apps/tv-android/unchanged.txt", "packages/unchanged.txt",
                     "apps/macos-native/Package.swift", web.TV_MANIFEST, "apps/ops-web/package.json"):
            f.put(path, b"outside approved scope")
            changed = f.commit()
            with self.subTest(path=path), f.pins(), self.assertRaises(web.GateError):
                web.validate_source_scope(f.repo, changed)
            f.git("reset", "--hard", f.revision)

    def test_artifact_requires_exact_digest_size_magic_and_new_regular_path(self):
        f = self.fixture()
        with f.pins(), patch.object(web.builder, "require_image_absent"):
            self.assertEqual(web.validate_artifact(f.repo, f.revision), f.dmg)
        for contents in (f.dmg + b"x", f.dmg[:-512] + b"FAIL" + b"\0" * 508):
            f.put(web.DMG, contents)
            changed = f.commit()
            with f.pins(), patch.object(web.builder, "require_image_absent"), self.assertRaises(web.GateError):
                web.validate_artifact(f.repo, changed)
            f.git("reset", "--hard", f.revision)
        f.git("update-index", "--chmod=+x", web.DMG)
        f.git("commit", "-qm", "bad executable public artifact")
        with f.pins(), self.assertRaises(web.GateError):
            web.validate_artifact(f.repo, f.git("rev-parse", "HEAD"))

    def test_public_delta_rejects_old_apk_changes_and_new_manifest(self):
        f = self.fixture()
        for path in ("apps/ops-web/public/downloads/old.apk", "apps/ops-web/public/downloads/flixify-macos-update.json"):
            f.put(path, b"unapproved public mutation")
            changed = f.commit()
            with self.subTest(path=path), f.pins(), self.assertRaises(web.GateError):
                web.validate_artifact(f.repo, changed)
            f.git("reset", "--hard", f.revision)

    def test_public_manifest_adds_only_new_dmg_and_retains_all_old_rows(self):
        original = self.public()
        before = json.loads(original)
        result = json.loads(web.expected_public_manifest(original))
        for row in before:
            self.assertIn(row, result)
        self.assertEqual(len(result), len(before) + 1)
        self.assertIn(["file", Path(web.DMG).relative_to("apps/ops-web/public").as_posix(), 420, web.DMG_BYTES, web.DMG_SHA256], result)
        duplicate = json.dumps(result).encode()
        with self.assertRaises(web.GateError):
            web.expected_public_manifest(duplicate)
        before[2][-1] = "f" * 64
        with self.assertRaises(web.GateError):
            web.expected_public_manifest(json.dumps(before).encode())

    def test_test_descriptor_cannot_claim_notarization_or_change_accepted_bytes(self):
        data = self.descriptor()
        web.validate_descriptor(data)
        for old, new in ((b"notarized: false", b"notarized: true"),
                         (b"44_517_156", b"true"),
                         (web.DMG_SHA256.encode(), b"f" * 64),
                         ("Test sürümü".encode(), b"Stable"),
                         (b'  notarized: false,', b'  notarized: false,\n  notarized: false,'),
                         (b'  notarized: false,', b'  notarized: Boolean(0),')):
            with self.subTest(old=old), self.assertRaises(web.GateError):
                web.validate_descriptor(data.replace(old, new))

    def test_complete_untouched_fingerprint_excludes_no_apk_dependencies_or_trust_gate(self):
        source = web.snapshot_script()
        for value in (*web.PATHS, web.DMG):
            self.assertIn(value, source)
        for value in ("apps/ops-web/public/downloads/flixify-pro-1.4.7.apk", web.TV_MANIFEST,
                      "node_modules", "apps/api", "apps/macos-native/scripts/package-release.py"):
            self.assertNotIn(value, web.EXCLUDED)
        with self.assertRaises(web.GateError):
            web.reviewed.require_untouched({"sha256": "a", "files": 1}, {"sha256": "b", "files": 1})

    def test_compiler_is_bounded_network_none_and_copies_only_accepted_files(self):
        calls, copied = [], {}
        updated = {path: b"accepted bytes" for path in (*web.PATHS, web.DMG)}

        def fake(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "cp"):
                copied[args[-1].split(":/app/", 1)[1]] = Path(args[2]).read_bytes()
            if args[:3] == ("docker", "inspect", "--format"):
                return b"0"
            return b""

        with patch.object(web.publication, "command", side_effect=fake):
            web.container_compile(REVISION, {"Config": {"Cmd": ["node", "server.js"]}}, updated, {})
        self.assertEqual(copied, updated)
        create = next(args for args in calls if args[:2] == ("docker", "create"))
        for word in ("none", "1280m", "1536m", "256"):
            self.assertIn(word, create)
        self.assertEqual(calls[-1][:3], ("docker", "rm", "--force"))
        self.assertFalse(any("prune" in args for args in calls))

    def test_candidate_download_uses_own_dmg_limit_and_retains_tv_manifest(self):
        script = web.download_verification_script()
        for value in (str(web.DMG_BYTES), web.DMG_SHA256, web.TV_MANIFEST_SHA256, "bytes=0-31", "koly", "application/x-apple-diskimage", "application/octet-stream"):
            self.assertIn(value, script)
        self.assertNotIn("flixify-macos-update.json", script)
        self.assertNotIn("notarytool", script)

    def test_download_check_removes_only_its_owned_container_on_error(self):
        calls = []

        def fake(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "create"):
                return ("c" * 64).encode()
            if args[:2] == ("docker", "inspect"):
                return IMAGE.encode()
            if args[:2] == ("docker", "exec"):
                raise web.GateError("fixture failed check")
            return b""

        with patch.object(web, "command", side_effect=fake), self.assertRaises(web.GateError):
            web.verify_download(IMAGE)
        self.assertEqual(calls[-1], ("docker", "rm", "--force", "c" * 64))

    def test_candidate_rejects_mutation_of_retained_public_files(self):
        changed = json.loads(web.expected_public_manifest(self.public()))
        changed[0][-1] = 0
        result = ({}, {}, {}, b"config", self.public(), {"sha256": "a", "files": 1}, {})
        with patch.object(web.builder, "verify_candidate", return_value=IMAGE), patch.object(web, "untouched", return_value=result[5]), patch.object(web, "public_manifest", return_value=json.dumps(changed).encode()), patch.object(web, "verify_download") as download:
            with self.assertRaises(web.GateError):
                web.verify_candidate(result, REVISION)
            download.assert_not_called()

    def test_measure_is_readonly_and_default_is_preflight(self):
        measured = {"sha256": "a" * 64, "files": 18000}
        with patch.object(sys, "argv", ["build-web.py", "--measure"]), patch.object(web, "protected_snapshot", return_value={"same": "state"}), patch.object(web, "untouched", return_value=measured), patch.object(web, "public_manifest", return_value=self.public()), patch.object(web, "container_compile") as compile_job, contextlib.redirect_stdout(io.StringIO()) as out:
            web.main()
            self.assertEqual(json.loads(out.getvalue())["sha256"], measured["sha256"])
            compile_job.assert_not_called()
        with patch.object(sys, "argv", ["build-web.py", "/fixture", "--revision", REVISION, "--source-untouched-sha256", "a" * 64, "--source-untouched-files", "18000"]), patch.object(web, "preflight", return_value=()), patch.object(web, "container_compile") as compile_job, contextlib.redirect_stdout(io.StringIO()) as out:
            web.main()
            self.assertIn("no_mutation", out.getvalue())
            compile_job.assert_not_called()

    def test_web_cutover_protects_backend_and_refuses_wrong_api_pins(self):
        release.configure(REVISION, IMAGE, web.API_TAG, web.API_ID)
        self.assertEqual(release.guard.CHANGED, ("ops-web",))
        self.assertEqual(set(release.guard.PROTECTED), {"api", "worker", "db"})
        self.assertEqual(release.guard.SOURCE, {"ops-web": web.SOURCE_TAG})
        self.assertEqual(release.guard.TARGET, {"ops-web": web.target(REVISION)})
        self.assertEqual(release.guard.PROTECTED_IMAGES["api"], (web.API_TAG, web.API_ID))
        self.assertEqual(release.guard.PROTECTED_IMAGES["worker"], (web.WORKER_TAG, web.WORKER_ID))
        with self.assertRaises(release.GateError):
            release.configure(REVISION, IMAGE, web.API_TAG, "sha256:" + "f" * 64)


if __name__ == "__main__":
    unittest.main()
