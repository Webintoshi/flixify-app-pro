"""Offline real-Git and mocked-container contracts; never contacts production."""
import contextlib
import copy
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


web = load("live_curation_builder_tests", HERE / "build-web.py") if (HERE / "build-web.py").exists() else None
release = load("live_curation_release_tests", HERE / "release-web.py") if (HERE / "release-web.py").exists() else None
android = load("live_curation_android_tests", HERE / "verify-android.py") if (HERE / "verify-android.py").exists() else None
REVISION = "a" * 40
CANDIDATE = "sha256:" + "b" * 64


class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="flixify-curation-contract-")
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.paths = tuple(sorted((web.DESCRIPTOR, "apps/ops-web/app/platform/session.tsx", "packages/contracts/src/index.ts", "packages/contracts/src/live-catalog-curation.ts")))
        for path in self.paths:
            if path not in web.NEW_PATHS:
                self.put(path, b"export const original='accepted';\n")
        self.descriptor = b'export const tvDownload={href:"/downloads/flixify-pro-1.4.3.apk",filename:"flixify-pro-1.4.3.apk",version:"1.4.3"};\n'
        self.put(web.DESCRIPTOR, self.descriptor)
        self.put(web.builder.CONFIG, b"const nextConfig: NextConfig = {\n};\nexport default nextConfig;\n")
        self.old_apk = b"PK\x03\x04" + b"old signed fixture" * 100
        self.put(web.BASELINE_APK, self.old_apk)
        self.old_manifest = b'{"previous":"accepted"}\n'
        self.put(web.UPDATE_MANIFEST, self.old_manifest)
        self.put(web.GRADLE, b"android { defaultConfig { applicationId 'vip.flixify.tv'\nminSdk 23\ntargetSdk 35\nversionCode 11\nversionName '1.4.3'\n} }\n")
        self.put(web.ANDROID_MANIFEST, b'<manifest><application android:label="Flixify Pro"/></manifest>\n')
        self.native_file = "apps/tv-android/app/src/main/java/vip/flixify/tv/MainActivity.java"
        self.put(self.native_file, b"accepted native\n")
        self.base = self.commit()
        for path in self.paths:
            if path != web.DESCRIPTOR:
                self.put(path, b"export const revised='curated';\n")
        self.put(web.GRADLE, self.read(web.GRADLE).replace(b"versionCode 11", b"versionCode 12").replace(b"'1.4.3'", b"'1.4.4'"))
        self.put(self.native_file, b"curated native\n")
        self.native = self.commit()
        self.native_tree = self.git("rev-parse", self.native + ":apps/tv-android")
        self.apk = b"PK\x03\x04" + b"new signed fixture" * 100
        self.sha = hashlib.sha256(self.apk).hexdigest()
        self.put(web.DESCRIPTOR, self.descriptor.replace(b"1.4.3", b"1.4.4"))
        self.put(web.APK, self.apk)
        self.manifest = {"packageName": "vip.flixify.tv", "versionName": "1.4.4", "versionCode": 12, "minSdk": 23, "apkUrl": web.APK_URL, "sha256": self.sha, "sizeBytes": len(self.apk), "notes": "Kanal isimleri ve kalite seçimi düzenlendi."}
        self.put(web.UPDATE_MANIFEST, json.dumps(self.manifest).encode())
        self.revision = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE).decode().strip()

    def put(self, path, data):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def read(self, path):
        return (self.repo / path).read_bytes()

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "owned fixture")
        return self.git("rev-parse", "HEAD")

    def pins(self):
        return patch.multiple(web, BASE_REVISION=self.base, BASELINE_MANIFEST_BYTES=len(self.old_manifest), BASELINE_MANIFEST_SHA256=hashlib.sha256(self.old_manifest).hexdigest(), BASELINE_APK_BYTES=len(self.old_apk), BASELINE_APK_SHA256=hashlib.sha256(self.old_apk).hexdigest())

    def proof(self):
        return {"schema": 1, "nativeRevision": self.native, "nativeTree": self.native_tree, "packageName": "vip.flixify.tv", "versionName": "1.4.4", "versionCode": 12, "minSdk": 23, "targetSdk": 35, "sha256": self.sha, "sizeBytes": len(self.apk), "certificateSha256": web.SIGNER_SHA256, "baselineApkSha256": hashlib.sha256(self.old_apk).hexdigest(), "baselineApkSizeBytes": len(self.old_apk), "signatureSchemes": ["v1", "v2"], "releaseDebuggable": False}

    def close(self):
        self.temp.cleanup()


class AdapterPresenceTests(unittest.TestCase):
    def test_adapter_files_exist(self):
        self.assertIsNotNone(web)
        self.assertIsNotNone(release)
        self.assertIsNotNone(android)


@unittest.skipIf(web is None, "builder not written yet")
class SourceAndArtifactTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.close)

    def scope(self, revision=None, native=None, tree=None, paths=None):
        f = self.f
        with f.pins():
            return web.validate_source_scope(f.repo, revision or f.revision, native or f.native, tree or f.native_tree, paths or f.paths)

    def test_exact_reviewed_scope_shared_source_and_native_tree_are_accepted(self):
        self.scope()
        with self.f.pins():
            web.validate_versions(self.f.repo, self.f.revision, self.f.native)

    def test_rejects_unreviewed_runtime_api_worker_dependencies_and_old_public_apk(self):
        f = self.f
        for path in ("apps/ops-web/app/platform/other.ts", "apps/api/src/server.ts", "apps/worker/src/worker.ts", "packages/contracts/src/access.ts", "packages/contracts/package.json", "apps/ops-web/package.json", web.BASELINE_APK):
            f.put(path, b"unreviewed\n")
            revision = f.commit()
            with self.subTest(path=path), self.assertRaises(web.GateError):
                self.scope(revision)
            f.git("reset", "--hard", f.revision)

    def test_native_freeze_and_independent_tree_pin_cannot_drift(self):
        with self.assertRaises(web.GateError):
            self.scope(tree="f" * 40)
        self.f.put(self.f.native_file, b"late native\n")
        with self.assertRaises(web.GateError):
            self.scope(self.f.commit())

    def test_exact_refs_and_runtime_allowlist_are_mandatory(self):
        for value in ("HEAD", "main", "a" * 12):
            with self.subTest(value=value), self.assertRaises(web.GateError):
                self.scope(native=value)
        for paths in ([], [web.DESCRIPTOR, "apps/api/src/server.ts"], list(self.f.paths) + [self.f.paths[0]]):
            with self.subTest(paths=paths), self.assertRaises(web.GateError):
                web.parse_runtime_paths(json.dumps(paths).encode())

    def test_source_paths_must_be_regular_and_new_policy_must_be_new(self):
        f = self.f
        target = f.repo / "packages/contracts/src/live-catalog-curation.ts"
        target.unlink()
        target.symlink_to("index.ts")
        with self.assertRaises(web.GateError):
            self.scope(f.commit())

    def test_descriptor_only_replaces_version_and_native_version_is_144_code12(self):
        f = self.f
        f.put(web.DESCRIPTOR, f.read(web.DESCRIPTOR) + b"unreviewed\n")
        with f.pins(), self.assertRaises(web.GateError):
            web.validate_versions(f.repo, f.commit(), f.native)
        with f.pins():
            for value in (f.base, "HEAD"):
                with self.subTest(value=value), self.assertRaises(web.GateError):
                    web.validate_versions(f.repo, f.revision, value)

    def test_pinned_artifacts_and_independent_proof_are_accepted(self):
        f = self.f
        with f.pins(), patch.object(web.builder, "require_image_absent") as absent:
            artifacts = web.validate_artifacts(f.repo, f.revision, f.sha, len(f.apk))
            web.validate_apk_proof(json.dumps(f.proof()).encode(), f.native, f.native_tree, f.sha, len(f.apk))
        self.assertEqual(set(artifacts), {web.APK, web.UPDATE_MANIFEST})
        absent.assert_called_once_with(web.APK)

    def test_wrong_signer_artifact_native_or_debuggable_proof_is_rejected(self):
        f = self.f
        for key, value in (("certificateSha256", "0" * 64), ("sha256", "0" * 64), ("nativeTree", "a" * 40), ("nativeRevision", "a" * 40), ("releaseDebuggable", True), ("versionCode", 11), ("versionCode", True), ("baselineApkSha256", "0" * 64), ("signatureSchemes", ["v2"])):
            proof = f.proof()
            proof[key] = value
            with self.subTest(key=key), f.pins(), self.assertRaises(web.GateError):
                web.validate_apk_proof(json.dumps(proof).encode(), f.native, f.native_tree, f.sha, len(f.apk))

    def test_public_artifact_modes_bytes_and_old_apk_are_protected(self):
        f = self.f
        for path in (web.BASELINE_APK, "apps/ops-web/public/unreviewed.js"):
            f.put(path, b"wrong")
            revision = f.commit()
            with f.pins(), patch.object(web.builder, "require_image_absent"), self.assertRaises(web.GateError):
                web.validate_artifacts(f.repo, revision, f.sha, len(f.apk))
            f.git("reset", "--hard", f.revision)
        (f.repo / web.APK).chmod(0o755)
        with f.pins(), patch.object(web.builder, "require_image_absent"), self.assertRaises(web.GateError):
            web.validate_artifacts(f.repo, f.commit(), f.sha, len(f.apk))

    def test_manifest_rejects_duplicate_key_bool_integer_and_unpinned_download(self):
        f = self.f
        for key, value in (("versionCode", 11), ("sizeBytes", True), ("apkUrl", "https://other.invalid/a.apk"), ("extra", True)):
            manifest = dict(f.manifest)
            manifest[key] = value
            with self.subTest(key=key), self.assertRaises(web.GateError):
                web.parse_manifest(json.dumps(manifest).encode(), f.sha, len(f.apk))
        with self.assertRaises(web.GateError):
            web.parse_manifest(json.dumps(f.manifest).replace("{", '{"versionCode":12,', 1).encode(), f.sha, len(f.apk))

    def test_public_projection_preserves_old_apk_every_mode_link_and_asset(self):
        f = self.f
        old = [["dir", "", 493], ["dir", "downloads", 493], ["file", "downloads/flixify-pro-1.4.3.apk", 420, len(f.old_apk), hashlib.sha256(f.old_apk).hexdigest()], ["link", "logo", 511, "target"], ["file", "downloads/flixify-tv-update.json", 420, len(f.old_manifest), hashlib.sha256(f.old_manifest).hexdigest()]]
        with f.pins():
            result = json.loads(web.expected_public_manifest(json.dumps(old).encode(), f.sha, len(f.apk), f.read(web.UPDATE_MANIFEST)))
        self.assertIn(old[2], result)
        self.assertIn(old[3], result)
        self.assertIn(["file", "downloads/flixify-pro-1.4.4.apk", 420, len(f.apk), f.sha], result)
        old[2][4] = "0" * 64
        with f.pins(), self.assertRaises(web.GateError):
            web.expected_public_manifest(json.dumps(old).encode(), f.sha, len(f.apk), f.read(web.UPDATE_MANIFEST))


@unittest.skipIf(web is None, "builder not written yet")
class BuildSafetyTests(unittest.TestCase):
    def test_new_bridge_is_absent_in_baseline_and_image_symlink_ancestors_are_rejected(self):
        bridge = "apps/ops-web/app/platform/live-channel-presentation.ts"
        self.assertIn(bridge, web.NEW_PATHS)
        f = Fixture()
        self.addCleanup(f.close)
        paths = tuple(sorted((*f.paths, bridge)))
        f.put(bridge, b"export const bridge='curation';\n")
        revision = f.commit()
        with f.pins():
            web.validate_source_scope(f.repo, revision, f.native, f.native_tree, paths)
        current = {"Image": web.SOURCE_ID, "State": {"Running": True}, "Config": {"Image": web.SOURCE_TAG, "Labels": {"com.docker.compose.project": web.core.UUID}, "Env": [key + "=fixture" for key in web.builder.PUBLIC_WEB_KEYS]}}
        def image_file(image, path):
            self.assertNotEqual(path, bridge, "new bridge must use absence guard, not read a nonexistent baseline blob")
            return web.core.git_file(f.repo, f.base, path)
        with f.pins(), patch.object(web.core, "image", return_value={"Id": web.SOURCE_ID}), patch.object(web, "command", return_value=json.dumps([current]).encode()), patch.object(web.builder, "image_file", side_effect=image_file), patch.object(web.builder, "require_image_absent") as absent:
            web.source_preflight(f.repo, revision)
            self.assertIn(bridge, [call.args[0] for call in absent.call_args_list])
        with patch.object(web.builder, "command") as command:
            web.builder.require_image_absent(bridge)
        args = command.call_args.args
        script = args[args.index("-c") + 1]
        with tempfile.TemporaryDirectory(prefix="flixify-bridge-absence-") as directory:
            root = Path(directory).resolve()
            leaf = root / "new-bridge.ts"
            self.assertEqual(subprocess.run(["sh", "-c", script, "sh", str(leaf)]).returncode, 0)
            leaf.symlink_to(root / "missing")
            self.assertNotEqual(subprocess.run(["sh", "-c", script, "sh", str(leaf)]).returncode, 0)
            leaf.unlink()
            (root / "linked").symlink_to(root, target_is_directory=True)
            self.assertNotEqual(subprocess.run(["sh", "-c", script, "sh", str(root / "linked" / "new-bridge.ts")]).returncode, 0)

    def test_current_source_pins_budget_and_target(self):
        self.assertEqual(web.BASE_REVISION, "d127d5955a26bb3ed345ac2d75b3870e6858f619")
        self.assertEqual(web.SOURCE_ID, "sha256:943cae7289b064d791b782c0d884f31b3e36c61febc7ca1097cde04efbf777d6")
        self.assertEqual(web.target(REVISION), "flixify-ops-web:live-curation-aaaaaaaaaaaa-20261031")
        self.assertEqual((web.builder.MIN_FREE_BYTES, web.builder.RUN_MEMORY_MIB, web.builder.RUN_TOTAL_MEMORY_MIB), (8 * 1024**3, 1280, 1536))

    def test_missing_independent_source_or_artifact_pins_stop_before_host_read(self):
        for sha, count in ((None, 1), ("HEAD", 1), ("a" * 64, 0), ("a" * 64, True)):
            with self.subTest(sha=sha, count=count), patch.object(web, "protected_snapshot") as host, self.assertRaises(web.GateError):
                web.validate_independent_pins(sha, count, "b" * 64, 1024, "c" * 64)
            host.assert_not_called()

    def test_compile_is_bounded_offline_and_cleans_only_owned_container_on_failure(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:3] == ("docker", "start", "--attach"):
                raise web.GateError("fixture compile failure")
            return b""
        with patch.object(web.reviewed, "command", side_effect=command), self.assertRaises(web.GateError):
            web.container_compile(REVISION, {"Config": {"Cmd": ["node", "server.js"]}}, {web.DESCRIPTOR: b"fixture"}, {})
        create = next(args for args in calls if args[:2] == ("docker", "create"))
        for flag, expected in (("--network", "none"), ("--memory", "1280m"), ("--memory-swap", "1536m"), ("--pids-limit", "256")):
            self.assertEqual(create[create.index(flag) + 1], expected)
        owned = create[create.index("--name") + 1]
        self.assertEqual([args for args in calls if args[:3] == ("docker", "rm", "--force")], [("docker", "rm", "--force", owned)])

    def test_source_fingerprint_includes_old_apks_and_dependencies(self):
        paths = web.parse_runtime_paths(json.dumps([web.DESCRIPTOR, "packages/contracts/src/live-catalog-curation.ts"]).encode())
        web.configure_paths(paths)
        self.assertEqual(set(web.EXCLUDED), {*paths, web.APK, web.UPDATE_MANIFEST, "apps/ops-web/.next"})
        self.assertNotIn(web.BASELINE_APK, web.EXCLUDED)
        self.assertNotIn("packages/contracts", web.EXCLUDED)
        self.assertIn("packages/contracts/src/live-catalog-curation.ts", web.snapshot_script())

    def test_wrong_protected_api_pin_is_rejected_without_docker(self):
        with patch.object(web.reviewed, "command") as command, self.assertRaises(web.GateError):
            web.protected_snapshot("unreviewed", "sha256:" + "f" * 64)
        command.assert_not_called()

    def test_preflight_rejects_missing_source_fingerprint_or_wrong_proof_before_host_reads(self):
        paths = (web.DESCRIPTOR,)
        proof = b"{}"
        arguments = (Path("/unread"), REVISION, REVISION, "c" * 40, paths, "d" * 64, 1024, proof, hashlib.sha256(proof).hexdigest(), web.API_TAG, web.API_ID)
        with patch.object(web, "protected_snapshot") as protected, patch.object(web, "validate_source_scope") as scope:
            for source_hash, source_count in ((None, 1), ("e" * 64, 0), ("e" * 64, True)):
                with self.subTest(source_hash=source_hash, source_count=source_count), self.assertRaises(web.GateError):
                    web.preflight(*arguments, source_hash, source_count)
            with self.assertRaises(web.GateError):
                web.preflight(*arguments, "e" * 64, 1)
            protected.assert_not_called()
            scope.assert_not_called()

    def arguments(self, paths, proof, action=None):
        return ["build-web.py", "/owned/repo", "--revision", REVISION, "--native-revision", "c" * 40, "--native-tree", "d" * 40, "--runtime-paths-file", str(paths), "--apk-proof-file", str(proof), "--apk-proof-sha256", "e" * 64, "--apk-sha256", "f" * 64, "--apk-bytes", "2048", "--protected-api-tag", web.API_TAG, "--protected-api-id", web.API_ID, "--source-untouched-sha256", "0" * 64, "--source-untouched-files", "123"] + ([action] if action else [])

    def test_default_read_only_and_disk_floor_prevent_compilation(self):
        result = ({}, {}, {}, b"config", b"[]", {"sha256": "0" * 64, "files": 123}, {"protected": "same"})
        with tempfile.TemporaryDirectory(prefix="flixify-curation-cli-") as directory:
            paths, proof = Path(directory) / "paths.json", Path(directory) / "proof.json"
            paths.write_text(json.dumps([web.DESCRIPTOR]))
            proof.write_text("{}")
            for action in (None, "--build"):
                with self.subTest(action=action), patch.object(sys, "argv", self.arguments(paths, proof, action)), patch.object(web, "preflight", return_value=result), patch.object(web.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8 * 1024**3 - 1)), patch.object(web, "container_compile") as compile, patch.object(web, "verify_candidate") as verify, contextlib.redirect_stdout(io.StringIO()):
                    if action:
                        with self.assertRaisesRegex(web.GateError, "requires_8GiB"):
                            web.main()
                    else:
                        web.main()
                    compile.assert_not_called()
                    verify.assert_not_called()

    def test_actual_download_script_targets_only_144_code12_and_pinned_manifest(self):
        sha, size = "a" * 64, 2048
        manifest = {"packageName": "vip.flixify.tv", "versionName": "1.4.4", "versionCode": 12, "minSdk": 23, "apkUrl": web.APK_URL, "sha256": sha, "sizeBytes": size, "notes": "Kanal düzenlemesi."}
        script = web.download_verification_script(sha, size, json.dumps(manifest).encode())
        self.assertNotIn("1.4.3", script)
        self.assertIn('j.versionName!=="1.4.4"||j.versionCode!==12', script)
        for required in ("Range", "content-range", "application/vnd.android.package-archive", "sha256", "manifest_digest_invalid"):
            self.assertIn(required, script)

    def test_candidate_rejects_untouched_source_or_public_drift_before_http_check(self):
        before = {"sha256": "a" * 64, "files": 1}
        updated = {web.UPDATE_MANIFEST: b"manifest"}
        for drift in ("none", "untouched", "public"):
            with self.subTest(drift=drift), patch.object(web.builder, "verify_candidate", return_value=CANDIDATE), patch.object(web, "untouched", return_value=before if drift != "untouched" else {"sha256": "b" * 64, "files": 1}), patch.object(web, "public_manifest", return_value=b"[]" if drift != "public" else b'[["dir","",493]]'), patch.object(web, "expected_public_manifest", return_value=b"[]"), patch.object(web, "verify_download") as download:
                if drift == "none":
                    self.assertEqual(web.verify_candidate({}, REVISION, updated, {}, b"config", b"[]", before, "c" * 64, 2048), CANDIDATE)
                    download.assert_called_once()
                else:
                    with self.assertRaises(web.GateError):
                        web.verify_candidate({}, REVISION, updated, {}, b"config", b"[]", before, "c" * 64, 2048)
                    download.assert_not_called()

    def test_original_image_bytes_are_required_for_shared_existing_sources(self):
        f = Fixture()
        self.addCleanup(f.close)
        web.configure_paths(f.paths)
        current = {"Image": web.SOURCE_ID, "State": {"Running": True}, "Config": {"Image": web.SOURCE_TAG, "Labels": {"com.docker.compose.project": web.core.UUID}, "Env": [key + "=fixture" for key in web.builder.PUBLIC_WEB_KEYS]}}
        drift = None
        def image_file(image, path):
            value = web.core.git_file(f.repo, f.base, path)
            return value + b"drift" if path == drift else value
        with f.pins(), patch.object(web.core, "image", return_value={"Id": web.SOURCE_ID}), patch.object(web, "command", return_value=json.dumps([current]).encode()), patch.object(web.builder, "image_file", side_effect=image_file), patch.object(web.builder, "require_image_absent") as absent:
            web.source_preflight(f.repo, f.revision)
            absent.assert_called_once_with("packages/contracts/src/live-catalog-curation.ts")
            drift = "packages/contracts/src/index.ts"
            with self.assertRaisesRegex(web.GateError, "web_base_source_differs"):
                web.source_preflight(f.repo, f.revision)

    def test_full_preflight_accepts_pinned_source_and_rejects_fingerprint_or_service_drift(self):
        f = Fixture()
        self.addCleanup(f.close)
        source_pin = {"sha256": "c" * 64, "files": 321}
        proof = json.dumps(f.proof()).encode()
        public = json.dumps([["dir", "", 493], ["dir", "downloads", 493], ["file", "downloads/flixify-pro-1.4.3.apk", 420, len(f.old_apk), hashlib.sha256(f.old_apk).hexdigest()], ["file", "downloads/flixify-tv-update.json", 420, len(f.old_manifest), hashlib.sha256(f.old_manifest).hexdigest()]]).encode()
        for drift in ("none", "fingerprint", "service"):
            with self.subTest(drift=drift), f.pins(), patch.object(web.builder, "require_image_absent"), patch.object(web, "source_preflight", return_value=({}, {}, {}, b"config")), patch.object(web, "protected_snapshot", side_effect=[{"protected": "same"}, {"protected": "changed" if drift == "service" else "same"}]), patch.object(web, "untouched", return_value=source_pin if drift != "fingerprint" else {"sha256": "d" * 64, "files": 321}), patch.object(web, "public_manifest", return_value=public):
                args = (f.repo, f.revision, f.native, f.native_tree, f.paths, f.sha, len(f.apk), proof, hashlib.sha256(proof).hexdigest(), web.API_TAG, web.API_ID, source_pin["sha256"], source_pin["files"])
                if drift == "none":
                    result = web.preflight(*args)
                    self.assertEqual(set(result[1]), {web.APK, web.UPDATE_MANIFEST})
                else:
                    with self.assertRaises(web.GateError):
                        web.preflight(*args)

    def test_download_checker_failure_or_invalid_id_cleans_only_owned_container(self):
        for kind in ("invalid-id", "http-failed"):
            calls = []
            def command(*args, **kwargs):
                calls.append(args)
                if args[:2] == ("docker", "create"):
                    return b"invalid" if kind == "invalid-id" else ("c" * 64).encode()
                if args[:2] == ("docker", "inspect"):
                    return CANDIDATE.encode()
                if args[:2] == ("docker", "exec"):
                    raise web.GateError("fixture HTTP failure")
                return b""
            with self.subTest(kind=kind), patch.object(web, "command", side_effect=command), patch.object(web, "download_verification_script", return_value="verified-script"), self.assertRaises(web.GateError):
                web.verify_download(CANDIDATE, "d" * 64, 2048, b"manifest")
            create = next(args for args in calls if args[:2] == ("docker", "create"))
            owned = create[create.index("--name") + 1]
            self.assertEqual(create[create.index("--network") + 1], "none")
            self.assertEqual([args for args in calls if args[:3] == ("docker", "rm", "--force")], [("docker", "rm", "--force", owned)])

    def test_candidate_ancestry_revision_environment_and_config_are_immutable(self):
        b = web.builder
        config = b"unchanged config"
        base = {"Id": web.SOURCE_ID, "RootFS": {"Layers": ["source"]}, "Config": {"Env": ["KEEP=accepted"], "Labels": {}}}
        accepted = {"Id": CANDIDATE, "RootFS": {"Layers": ["source", "overlay"]}, "Config": {"Env": ["KEEP=accepted"], "Labels": {"org.opencontainers.image.revision": REVISION, "vip.flixify.edge-recovery.base": web.SOURCE_ID}}}
        updated = {"packages/contracts/src/live-catalog-curation.ts": b"curation source"}
        for drift in ("none", "ancestry", "revision", "environment", "config", "source"):
            candidate = copy.deepcopy(accepted)
            if drift == "ancestry": candidate["RootFS"]["Layers"] = ["unrelated", "overlay"]
            if drift == "revision": candidate["Config"]["Labels"]["org.opencontainers.image.revision"] = "f" * 40
            if drift == "environment": candidate["Config"]["Env"].append("OTHER=unreviewed")
            def image_file(image, path):
                if path == b.CONFIG:
                    return b"drift" if drift == "config" else config
                return b"drift" if drift == "source" else b"curation source"
            with self.subTest(drift=drift), patch.object(b.core, "image", return_value=candidate), patch.object(b, "image_file", side_effect=image_file), patch.object(b, "command"):
                if drift == "none":
                    self.assertEqual(b.verify_candidate(base, REVISION, updated, {}, config), CANDIDATE)
                else:
                    with self.assertRaises(web.GateError):
                        b.verify_candidate(base, REVISION, updated, {}, config)


@unittest.skipIf(android is None, "Android verifier not written yet")
class AndroidProofTests(unittest.TestCase):
    def test_actual_tool_output_requires_existing_signer_versions_and_release(self):
        signing = "Verified using v1 scheme (JAR signing): true\nVerified using v2 scheme (APK Signature Scheme v2): true\nSigner #1 certificate SHA-256 digest: " + android.SIGNER_SHA256 + "\n"
        badging = "package: name='vip.flixify.tv' versionCode='12' versionName='1.4.4'\nminSdkVersion:'23'\ntargetSdkVersion:'35'\n"
        android.validate_tool_output(signing, badging)
        for sign, badge in ((signing.replace(android.SIGNER_SHA256, "0" * 64), badging), (signing.replace("v1 scheme (JAR signing): true", "v1 scheme (JAR signing): false"), badging), (signing, badging.replace("'12'", "'11'")), (signing, badging + "application-debuggable\n")):
            with self.assertRaises(android.GateError):
                android.validate_tool_output(sign, badge)


@unittest.skipIf(release is None, "release adapter not written yet")
class ReleasePinsTests(unittest.TestCase):
    def test_only_web_current_rollback_and_existing_empty_isolation_are_preserved(self):
        release.configure(REVISION, CANDIDATE, release.API_TAG, release.API_ID)
        self.assertEqual(release.guard.CHANGED, ("ops-web",))
        self.assertEqual(release.guard.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(release.guard.SOURCE_IDS, {"ops-web": web.SOURCE_ID})
        self.assertEqual(release.guard.TARGET, {"ops-web": web.target(REVISION)})
        self.assertNotIn("isolateRegistrationGuard", release.guard.PHP_APPLY)
        with self.assertRaises(release.GateError):
            release.configure(REVISION, CANDIDATE, "unreviewed", "sha256:" + "f" * 64)


if release is not None:
    reviewed_transactions = load("live_curation_reviewed_transaction_tests", HERE.parent / "2026-10-31-home-2026" / "test-web.py")
    reviewed_transactions.release = release
    class TransactionTests(reviewed_transactions.TransactionTests):
        pass


if __name__ == "__main__":
    unittest.main()
