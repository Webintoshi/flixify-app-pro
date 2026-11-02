"""Offline publication guards; no Docker, account or production activity."""
import base64
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


web = load("windows_repair_contract", HERE / "build-web.py")
release = load("windows_repair_release_contract", HERE / "release-web.py")
REVISION, IMAGE = "a" * 40, "sha256:" + "b" * 64


class Fixture:
    def __init__(self, missing_descriptor=False):
        self.temp = tempfile.TemporaryDirectory(prefix="flixify-windows-repair-contract-")
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Offline fixture")
        self.git("config", "user.email", "offline@example.invalid")
        for path in web.PATHS:
            if path not in web.NEW_PATHS and not (missing_descriptor and path == web.DESCRIPTOR):
                self.put(path, b"old source\n")
        self.put(web.TV_MANIFEST, b"retained TV manifest")
        self.put(web.OLD_EXE, b"retained Windows 1.0.0 installer")
        self.put("apps/ops-web/public/downloads/old.apk", b"retained APK")
        for tree in ("apps/api", "apps/worker", "apps/tv-android", "packages"):
            self.put(tree + "/unchanged.txt", b"retained source")
        self.put("apps/macos-native/Package.swift", b"frozen native source\n")
        self.mac = self.commit()
        self.mac_tree = self.git("rev-parse", self.mac + ":apps/macos-native")
        self.put("docs/base.txt", b"base")
        self.base = self.commit()
        self.put("apps/windows-native/CMakeLists.txt", b"frozen Windows source\n")
        self.windows = self.commit()
        self.windows_tree = self.git("rev-parse", self.windows + ":apps/windows-native")
        for path in web.PATHS:
            self.put(path, b"reviewed source\n")
        self.exe = bytearray(1024)
        self.exe[:2] = b"MZ"
        self.exe[60:64] = (128).to_bytes(4, "little")
        self.exe[128:132] = b"PE\0\0"
        self.exe = bytes(self.exe)
        self.sha = hashlib.sha256(self.exe).hexdigest()
        self.put(web.EXE, self.exe)
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
                              MAC_TREE=self.mac_tree, WINDOWS_REVISION=self.windows, WINDOWS_TREE=self.windows_tree, EXE_BYTES=len(self.exe), EXE_SHA256=self.sha)


class Contracts(unittest.TestCase):
    def setUp(self):
        self.valid_pins = patch.multiple(web, WINDOWS_REVISION="e" * 40, WINDOWS_TREE="f" * 40,
                                        EXE_BYTES=1024, EXE_SHA256="d" * 64, EXE_SIZE="1,0 MB")
        self.valid_pins.start()
        self.addCleanup(self.valid_pins.stop)

    def test_missing_ci_pins_stop_before_host_or_docker_reads(self):
        with patch.object(web, "WINDOWS_REVISION", "ROOT_FILL_VERIFIED_WINDOWS_REVISION"), patch.object(web, "protected_snapshot") as host, patch.object(web, "command") as command:
            with self.assertRaisesRegex(web.GateError, "ROOT_FILL_VERIFIED"):
                web.preflight(Path("/fixture"), REVISION, "a" * 64, 100)
            host.assert_not_called()
            command.assert_not_called()
        with patch.object(release.build, "WINDOWS_TREE", "ROOT_FILL_VERIFIED_WINDOWS_TREE"), patch.object(release.reviewed, "configure") as configure:
            with self.assertRaisesRegex(release.GateError, "ROOT_FILL_VERIFIED"):
                release.configure(REVISION, IMAGE, web.API_TAG, web.API_ID)
            configure.assert_not_called()
        for action in ("--measure", "--build", "--verify-existing"):
            with self.subTest(action=action), patch.object(web, "WINDOWS_REVISION", "ROOT_FILL_VERIFIED_WINDOWS_REVISION"), patch.object(sys, "argv", ["build-web.py", action]), patch.object(web, "protected_snapshot") as host, patch.object(web, "command") as command:
                with self.assertRaisesRegex(web.GateError, "ROOT_FILL_VERIFIED"):
                    web.main()
                host.assert_not_called()
                command.assert_not_called()
        with patch.object(release.build, "WINDOWS_TREE", "ROOT_FILL_VERIFIED_WINDOWS_TREE"), patch.object(release.reviewed, "main") as publication:
            with self.assertRaisesRegex(release.GateError, "ROOT_FILL_VERIFIED"):
                release.main()
            publication.assert_not_called()

    def fixture(self):
        f = Fixture()
        self.addCleanup(f.temp.cleanup)
        return f

    def public(self):
        name = web.TV_MANIFEST.removeprefix("apps/ops-web/public/")
        return json.dumps([["file", web.DMG.removeprefix("apps/ops-web/public/"), 420, web.DMG_BYTES, web.DMG_SHA256],
                           ["file", web.OLD_EXE.removeprefix("apps/ops-web/public/"), 420, web.OLD_EXE_BYTES, web.OLD_EXE_SHA256],
                           ["file", web.APK.removeprefix("apps/ops-web/public/"), 420, web.APK_BYTES, web.APK_SHA256],
                           ["dir", "", 493], ["dir", "downloads", 493],
                           ["file", name, 420, web.TV_MANIFEST_BYTES, web.TV_MANIFEST_SHA256],
                           ["file", "downloads/old.apk", 420, 100, "c" * 64],
                           ["link", "retained-link", 511, "downloads/old.apk"]]).encode()

    def descriptor(self):
        fields = {
            "href": web.EXE_URL.removeprefix("https://flixify.vip"), "filename": Path(web.EXE).name,
            "pageHref": "/indir#windows", "version": "1.0.1", "minimumWindows": "Windows 10 (1809+) ve Windows 11",
            "architecture": "x64 (64 bit)", "signed": False, "status": "Test sürümü",
            "notice": "Bu test sürümü dijital olarak imzalanmamıştır. Windows SmartScreen veya tarayıcın uyarı gösterebilir; kurulum engellenebilir.",
            "sizeBytes": web.EXE_BYTES, "size": web.EXE_SIZE, "sha256": web.EXE_SHA256,
        }
        return ("export const windowsDownload = {\n" + "".join("  " + key + ": " + json.dumps(value, ensure_ascii=False) + ",\n" for key, value in fields.items()) + "} as const;\n").encode()

    def test_exact_current_baseline_and_scope(self):
        self.assertEqual(web.SOURCE_TAG, "flixify-ops-web:windows-test-download-3af295bf1eac-20261101")
        self.assertEqual(web.SOURCE_ID, "sha256:a2a57bf8cb381a159921344d7e3c9e3165aea2bfebc3733d6f959dc97b4008a3")
        self.assertEqual(web.BASE_REVISION, "3af295bf1eac40974461757757a9ac63e8a016e5")
        self.assertEqual(web.PATHS, ("apps/ops-web/app/platform/windows-download.ts",))
        self.assertEqual(web.NEW_PATHS, ())
        self.assertEqual(set(web.EXCLUDED), {*web.PATHS, web.EXE, "apps/ops-web/.next"})
        self.assertNotIn(web.TV_MANIFEST, web.EXCLUDED)
        self.assertNotIn(web.OLD_EXE, web.EXCLUDED)
        self.assertEqual(web.EXE, "apps/ops-web/public/downloads/flixify-pro-windows-1.0.1-x64-test-setup.exe")
        self.assertEqual(web.target(REVISION), "flixify-ops-web:windows-repair-aaaaaaaaaaaa-20261102")
        for invalid in ("HEAD", "a" * 12, None):
            with self.assertRaises(web.GateError):
                web.target(invalid)

    def test_scope_accepts_frozen_mac_and_only_reviewed_web_download(self):
        f = self.fixture()
        with f.pins():
            web.validate_source_scope(f.repo, f.revision)
        for path in ("apps/api/unchanged.txt", "apps/tv-android/unchanged.txt", "packages/unchanged.txt",
                     "apps/macos-native/Package.swift", "apps/windows-native/CMakeLists.txt", "apps/worker/unchanged.txt", "apps/ops-web/app/platform/mac-download.ts", "apps/ops-web/app/platform/tv-download.ts", web.TV_MANIFEST, web.OLD_EXE, "apps/ops-web/package.json", "apps/ops-web/app/platform/shell.tsx", "apps/ops-web/app/indir/page.tsx"):
            f.put(path, b"outside approved scope")
            changed = f.commit()
            with self.subTest(path=path), f.pins(), self.assertRaises(web.GateError):
                web.validate_source_scope(f.repo, changed)
            f.git("reset", "--hard", f.revision)

    def test_repair_descriptor_must_already_exist_at_the_baseline(self):
        f = Fixture(missing_descriptor=True)
        self.addCleanup(f.temp.cleanup)
        with f.pins(), self.assertRaises(web.GateError):
            web.validate_source_scope(f.repo, f.revision)

    def test_artifact_requires_exact_digest_size_magic_and_new_regular_path(self):
        f = self.fixture()
        with f.pins(), patch.object(web.builder, "require_image_absent"):
            self.assertEqual(web.validate_artifact(f.repo, f.revision), f.exe)
        for contents in (f.exe + b"x", f.exe[:-512] + b"FAIL" + b"\0" * 508):
            f.put(web.EXE, contents)
            changed = f.commit()
            with f.pins(), patch.object(web.builder, "require_image_absent"), self.assertRaises(web.GateError):
                web.validate_artifact(f.repo, changed)
            f.git("reset", "--hard", f.revision)
        f.git("update-index", "--chmod=+x", web.EXE)
        f.git("commit", "-qm", "bad executable public artifact")
        with f.pins(), self.assertRaises(web.GateError):
            web.validate_artifact(f.repo, f.git("rev-parse", "HEAD"))

    def test_pe_magic_and_offset_are_independently_checked(self):
        f = self.fixture()
        self.assertTrue(web.valid_pe(f.exe))
        self.assertFalse(web.valid_pe(b"MZ"))
        for offset in (0, 63, len(f.exe) - 23, 0xffffffff):
            data = bytearray(f.exe)
            data[60:64] = offset.to_bytes(4, "little")
            self.assertFalse(web.valid_pe(data))
        f.put(web.EXE, f.exe[:128] + b"FAIL" + f.exe[132:])
        bad = f.commit()
        with f.pins(), patch.object(web, "EXE_SHA256", hashlib.sha256(f.exe[:128] + b"FAIL" + f.exe[132:]).hexdigest()), patch.object(web.builder, "require_image_absent") as absent:
            with self.assertRaisesRegex(web.GateError, "verified_exe_bytes_required"):
                web.validate_artifact(f.repo, bad)
            absent.assert_not_called()

    def test_every_pending_installer_pin_is_a_hard_gate(self):
        for name, value in (("WINDOWS_REVISION", "ROOT_FILL_VERIFIED_WINDOWS_REVISION"),
                            ("WINDOWS_TREE", "ROOT_FILL_VERIFIED_WINDOWS_TREE"),
                            ("EXE_BYTES", "ROOT_FILL_VERIFIED_EXE_BYTES"), ("EXE_BYTES", True),
                            ("EXE_SHA256", "ROOT_FILL_VERIFIED_EXE_SHA256"), ("EXE_SIZE", "ROOT_FILL_VERIFIED_EXE_DISPLAY_SIZE")):
            with self.subTest(pin=name, value=value), patch.object(web, name, value), self.assertRaisesRegex(web.GateError, "ROOT_FILL_VERIFIED"):
                web.require_verified_pins()

    def test_public_delta_rejects_old_apk_changes_and_new_manifest(self):
        f = self.fixture()
        for path in (web.OLD_EXE, "apps/ops-web/public/downloads/old.apk", "apps/ops-web/public/downloads/flixify-macos-update.json"):
            f.put(path, b"unapproved public mutation")
            changed = f.commit()
            with self.subTest(path=path), f.pins(), self.assertRaises(web.GateError):
                web.validate_artifact(f.repo, changed)
            f.git("reset", "--hard", f.revision)

    def test_public_manifest_adds_only_new_exe_and_retains_all_old_rows(self):
        original = self.public()
        before = json.loads(original)
        result = json.loads(web.expected_public_manifest(original))
        for row in before:
            self.assertIn(row, result)
        self.assertEqual(len(result), len(before) + 1)
        self.assertIn(["file", Path(web.EXE).relative_to("apps/ops-web/public").as_posix(), 420, web.EXE_BYTES, web.EXE_SHA256], result)
        duplicate = json.dumps(result).encode()
        with self.assertRaises(web.GateError):
            web.expected_public_manifest(duplicate)
        before[0][-1] = "f" * 64
        with self.assertRaises(web.GateError):
            web.expected_public_manifest(json.dumps(before).encode())

    def test_old_windows_installer_is_required_and_pinned_in_source_public_tree(self):
        original = json.loads(self.public())
        old_name = web.OLD_EXE.removeprefix("apps/ops-web/public/")
        for change in ("missing", "changed"):
            rows = [row.copy() for row in original]
            old = next(row for row in rows if row[1] == old_name)
            if change == "missing":
                rows.remove(old)
            else:
                old[-1] = "f" * 64
            with self.subTest(change=change), self.assertRaisesRegex(web.GateError, "retained_public_pin_differs"):
                web.expected_public_manifest(json.dumps(rows).encode())

    def test_test_descriptor_cannot_claim_signing_or_change_accepted_bytes(self):
        data = self.descriptor()
        web.validate_descriptor(data)
        for old, new in ((b"signed: false", b"signed: true"),
                         (b"sizeBytes: 1024", b"sizeBytes: true"),
                         (web.EXE_SHA256.encode(), b"f" * 64),
                         (b'version: "1.0.1"', b'version: "1.0.0"'),
                         ("Test sürümü".encode(), b"Stable"),
                         (b'  signed: false,', b'  signed: false,\n  signed: false,'),
                         (b'  signed: false,', b'  signed: Boolean(0),')):
            with self.subTest(old=old), self.assertRaises(web.GateError):
                web.validate_descriptor(data.replace(old, new))

    def test_complete_untouched_fingerprint_excludes_no_apk_dependencies_or_trust_gate(self):
        source = web.snapshot_script()
        for value in (*web.PATHS, web.EXE):
            self.assertIn(value, source)
        for value in (web.OLD_EXE, web.DMG, "apps/ops-web/app/platform/mac-download.ts", "apps/ops-web/app/platform/tv-download.ts", "apps/ops-web/public/downloads/flixify-pro-1.4.7.apk", web.TV_MANIFEST,
                      "node_modules", "apps/api", "apps/macos-native/scripts/package-release.py"):
            self.assertNotIn(value, web.EXCLUDED)
        with self.assertRaises(web.GateError):
            web.reviewed.require_untouched({"sha256": "a", "files": 1}, {"sha256": "b", "files": 1})

    def test_compiler_is_bounded_network_none_and_copies_only_accepted_files(self):
        calls, copied = [], {}
        updated = {path: b"accepted bytes" for path in (*web.PATHS, web.EXE)}

        def fake(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "cp"):
                copied[args[-1].split(":/app/", 1)[1]] = Path(args[2]).read_bytes()
            if args[:3] == ("docker", "inspect", "--format"):
                return b"0"
            return b""

        with patch.object(web.publication, "command", side_effect=fake), contextlib.redirect_stdout(io.StringIO()):
            web.container_compile(REVISION, {"Config": {"Cmd": ["node", "server.js"]}}, updated, {})
        self.assertEqual(copied, updated)
        create = next(args for args in calls if args[:2] == ("docker", "create"))
        for word in ("none", "1280m", "1536m", "256"):
            self.assertIn(word, create)
        self.assertEqual(calls[-1][:3], ("docker", "rm", "--force"))
        self.assertFalse(any("prune" in args for args in calls))

    def test_candidate_download_uses_own_exe_limit_and_retains_tv_manifest(self):
        script = web.download_verification_script()
        for value in (str(web.EXE_BYTES), web.EXE_SHA256, web.OLD_EXE_SHA256, web.TV_MANIFEST_SHA256, "bytes=0-31", "koly", "application/x-apple-diskimage", "application/octet-stream"):
            self.assertIn(value, script)
        self.assertNotIn("flixify-macos-update.json", script)
        self.assertNotIn("notarytool", script)

    def test_candidate_download_script_offline_fetch_contract_and_pe_rejection(self):
        exe = bytearray(1024)
        exe[:2] = b"MZ"
        exe[60:64] = (128).to_bytes(4, "little")
        exe[128:132] = b"PE\0\0"
        dmg = b"x" * 512 + b"koly" + b"\0" * 508
        apk = b"PK\x03\x04" + b"x" * 1020
        old_exe = bytes(exe[:-1]) + b"0"
        manifest = b"{}"
        for broken in (False, True):
            candidate = bytes(exe) if not broken else bytes(exe[:128]) + b"FAIL" + bytes(exe[132:])
            values = {web.EXE.removeprefix("apps/ops-web/public"): candidate,
                      web.OLD_EXE.removeprefix("apps/ops-web/public"): old_exe,
                      web.DMG.removeprefix("apps/ops-web/public"): dmg,
                      web.APK.removeprefix("apps/ops-web/public"): apk,
                      web.TV_MANIFEST.removeprefix("apps/ops-web/public"): manifest}
            pins = {}
            for prefix, data in (("EXE", candidate), ("OLD_EXE", old_exe), ("DMG", dmg), ("APK", apk), ("TV_MANIFEST", manifest)):
                pins[prefix + "_BYTES"] = len(data)
                pins[prefix + "_SHA256"] = hashlib.sha256(data).hexdigest()
            encoded = {path: base64.b64encode(data).decode() for path, data in values.items()}
            setup = 'const files=' + json.dumps(encoded) + ';global.fetch=async(u,o={})=>{const p=new URL(u).pathname;if(!files[p])return new Response("page",{status:200});const b=Buffer.from(files[p],"base64");const type=p.endsWith(".json")?"application/json":"application/octet-stream";if(o.method==="HEAD")return new Response(null,{status:200,headers:{"content-length":String(b.length),"content-type":type}});if(o.headers?.Range)return new Response(b.subarray(0,32),{status:206,headers:{"content-range":"bytes 0-31/"+b.length}});return new Response(b,{status:200,headers:{"content-type":type}})};'
            with self.subTest(broken_pe=broken), patch.multiple(web, **pins):
                result = subprocess.run(["node", "-e", setup + web.download_verification_script()], capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 1 if broken else 0, result.stderr.decode())

    def test_host_environment_and_original_registration_fence_pins_are_retained(self):
        self.assertEqual(web.builder.MIN_FREE_BYTES, 8 * 1024**3)
        self.assertEqual(web.backend.ENV_SHA256, "c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42")
        self.assertEqual(web.backend.reviewed.API_ID, "sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6")
        self.assertEqual(web.publication.MAX_APK_BYTES, 32 * 1024**2)

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
        with patch.multiple(release.build, WINDOWS_REVISION="e" * 40, WINDOWS_TREE="f" * 40, EXE_BYTES=1024, EXE_SHA256="d" * 64, EXE_SIZE="1,0 MB"):
            release.configure(REVISION, IMAGE, web.API_TAG, web.API_ID)
        self.assertEqual(release.guard.CHANGED, ("ops-web",))
        self.assertEqual(set(release.guard.PROTECTED), {"api", "worker", "db"})
        self.assertEqual(release.guard.SOURCE, {"ops-web": web.SOURCE_TAG})
        self.assertEqual(release.guard.SOURCE_IDS, {"ops-web": web.SOURCE_ID})
        self.assertEqual(release.guard.TARGET, {"ops-web": web.target(REVISION)})
        self.assertEqual(release.guard.PROTECTED_IMAGES["api"], (web.API_TAG, web.API_ID))
        self.assertEqual(release.guard.PROTECTED_IMAGES["worker"], (web.WORKER_TAG, web.WORKER_ID))
        with patch.multiple(release.build, WINDOWS_REVISION="e" * 40, WINDOWS_TREE="f" * 40, EXE_BYTES=1024, EXE_SHA256="d" * 64, EXE_SIZE="1,0 MB"), self.assertRaises(release.GateError):
            release.configure(REVISION, IMAGE, web.API_TAG, "sha256:" + "f" * 64)


if __name__ == "__main__":
    unittest.main()
