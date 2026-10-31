"""Offline homepage source, candidate and website-only transaction contracts."""
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

web = load("home_2026_builder_contract", HERE / "build-web.py") if (HERE / "build-web.py").exists() else None
release = load("home_2026_release_contract", HERE / "release-web.py") if (HERE / "release-web.py").exists() else None
REVISION = "a" * 40
CANDIDATE = "sha256:" + "b" * 64

class Fixture:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="flixify-home-web-contract-")
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        for path in web.PATHS:
            if path not in web.NEW_PATHS:
                self.put(path, b"export const previous='accepted';\n")
        self.put(web.builder.CONFIG, b"const nextConfig: NextConfig = {\n};\nexport default nextConfig;\n")
        self.put("apps/ops-web/public/downloads/flixify-pro-1.4.3.apk", b"accepted-public-apk")
        self.put("apps/ops-web/public/downloads/flixify-tv-update.json", b'{"accepted":"unchanged"}\n')
        self.put("apps/tv-android/app/build.gradle", b"accepted native\n")
        self.base = self.commit()
        for path in web.PATHS:
            self.put(path, b"export const homepage='2026';\n")
        self.put("apps/ops-web/app/platform/homepage-showcase.test.ts", b"test-only fixture\n")
        self.revision = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.PIPE).decode().strip()

    def put(self, path, data):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "owned fixture")
        return self.git("rev-parse", "HEAD")

    def close(self):
        self.temp.cleanup()

class SourceTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(web, "homepage-only build adapter must exist")
        self.f = Fixture()
        self.addCleanup(self.f.close)

    def validate(self, revision=None):
        with patch.object(web, "BASE_REVISION", self.f.base):
            web.validate_source_scope(self.f.repo, revision or self.f.revision)

    def test_real_git_allows_exact_runtime_scope_and_test_changes(self):
        self.validate()

    def test_rejects_public_dependency_unreviewed_runtime_and_native_changes(self):
        for path in ("apps/ops-web/public/downloads/flixify-pro-1.4.3.apk", "apps/ops-web/package.json", "apps/ops-web/app/platform/unreviewed.ts", "apps/tv-android/app/build.gradle"):
            f = Fixture()
            self.addCleanup(f.close)
            f.put(path, b"outside allowed source\n")
            revision = f.commit()
            with self.subTest(path=path), patch.object(web, "BASE_REVISION", f.base), self.assertRaises(web.GateError):
                web.validate_source_scope(f.repo, revision)

    def test_rejects_missing_runtime_and_symlink_disguised_as_test(self):
        for kind in ("runtime-deleted", "test-symlink"):
            f = Fixture()
            self.addCleanup(f.close)
            target = f.repo / (web.PATHS[0] if kind == "runtime-deleted" else "apps/ops-web/app/platform/homepage-showcase.test.ts")
            target.unlink()
            if kind == "test-symlink":
                target.symlink_to("catalog.tsx")
            revision = f.commit()
            with self.subTest(kind=kind), patch.object(web, "BASE_REVISION", f.base), self.assertRaises(web.GateError):
                web.validate_source_scope(f.repo, revision)

    def test_existing_image_source_drift_is_rejected_and_new_paths_check_image_absence(self):
        b = web.builder
        original_command = b.command
        calls = []
        current = {"Image": web.SOURCE_ID, "State": {"Running": True}, "Config": {"Image": web.SOURCE_TAG, "Labels": {"com.docker.compose.project": b.UUID}, "Env": [key + "=fixture" for key in b.PUBLIC_WEB_KEYS]}}
        drift = None
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ("docker", "inspect"):
                return json.dumps([current]).encode()
            if args[:2] == ("docker", "run"):
                return b""
            return original_command(*args, **kwargs)
        def image_file(image, path):
            value = b.core.git_file(self.f.repo, self.f.base, path)
            return value + b"drift" if path == drift else value
        with patch.object(b, "BASE_REVISION", self.f.base), patch.object(b, "command", side_effect=command), patch.object(b.core, "image", return_value={"Id": web.SOURCE_ID}), patch.object(b, "image_file", side_effect=image_file):
            b.preflight(self.f.repo, self.f.revision)
            for path in set(web.PATHS) - set(web.NEW_PATHS):
                drift = path
                with self.subTest(path=path), self.assertRaisesRegex(web.GateError, "web_base_source_differs"):
                    b.preflight(self.f.repo, self.f.revision)
        for path in web.NEW_PATHS:
            self.assertTrue(any(args[:2] == ("docker", "run") and args[-1] == "/app/" + path for args in calls))
        self.assertFalse(any(args[:2] in (("docker", "create"), ("docker", "start"), ("docker", "commit")) for args in calls))

class BuildTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(web, "homepage-only build adapter must exist")

    def test_pins_and_exclusions_keep_apks_public_and_dependencies_untouched(self):
        self.assertEqual(web.BASE_REVISION, "50e3bd7af5a476e5e6ac5dd013be148e942c5c0b")
        self.assertEqual(web.SOURCE_ID, "sha256:ddc80c1fac256161fbf6d61099021200e9271e1af37a6688fe614fd11f19150f")
        self.assertEqual(web.target(REVISION), "flixify-ops-web:home-2026-aaaaaaaaaaaa-20261031")
        self.assertEqual(set(web.EXCLUDED), set((*web.PATHS, "apps/ops-web/.next")))
        self.assertEqual((web.builder.MIN_FREE_BYTES, web.builder.RUN_MEMORY_MIB, web.builder.RUN_TOTAL_MEMORY_MIB), (8 * 1024**3, 1280, 1536))
        for value in ("HEAD", "main", "a" * 12):
            with self.assertRaises(web.GateError):
                web.target(value)

    def test_independent_fingerprint_required_before_any_host_read(self):
        for sha, count in ((None, 1), ("HEAD", 1), ("a" * 64, 0), ("a" * 64, True)):
            with self.subTest(sha=sha, count=count), patch.object(web, "protected_snapshot") as host, self.assertRaisesRegex(web.GateError, "independent_source_fingerprint_required"):
                web.preflight(Path("/not-read"), REVISION, web.API_TAG, web.API_ID, sha, count)
            host.assert_not_called()

    def test_candidate_must_preserve_full_public_tree_and_untouched_fingerprint(self):
        before = {"sha256": "c" * 64, "files": 9}
        original_public = b'[["dir","",493],["file","logo.png",420,3,"' + b"d" * 64 + b'"]]'
        accepted_manifest = b"accepted manifest"
        for changed in ("none", "public", "untouched"):
            public = original_public if changed != "public" else b'[["dir","",493]]'
            untouched = before if changed != "untouched" else {"sha256": "e" * 64, "files": 9}
            with self.subTest(changed=changed), patch.object(web.builder, "verify_candidate", return_value=CANDIDATE), patch.object(web, "untouched", return_value=untouched), patch.object(web, "public_manifest", return_value=public), patch.object(web, "verify_download") as download:
                if changed == "none":
                    self.assertEqual(web.verify_candidate({}, REVISION, {}, {}, b"config", original_public, before, accepted_manifest), CANDIDATE)
                    download.assert_called_once()
                else:
                    with self.assertRaises(web.GateError):
                        web.verify_candidate({}, REVISION, {}, {}, b"config", original_public, before, accepted_manifest)
                    download.assert_not_called()

    def arguments(self, action=None):
        return ["build-web.py", "/owned/repo", "--revision", REVISION, "--protected-api-tag", web.API_TAG, "--protected-api-id", web.API_ID, "--source-untouched-sha256", "c" * 64, "--source-untouched-files", "9"] + ([action] if action else [])

    def result(self):
        return ({}, {}, {}, b"config", b"[]", {"sha256": "c" * 64, "files": 9}, {"protected": "same"}, b"manifest")

    def test_default_is_read_only_and_low_disk_prevents_compilation(self):
        for action in (None, "--build"):
            with self.subTest(action=action), patch.object(sys, "argv", self.arguments(action)), patch.object(web, "preflight", return_value=self.result()), patch.object(web.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8 * 1024**3 - 1)), patch.object(web, "container_compile") as compile, patch.object(web, "verify_candidate") as verify, contextlib.redirect_stdout(io.StringIO()):
                if action:
                    with self.assertRaisesRegex(web.GateError, "requires_8GiB"):
                        web.main()
                else:
                    web.main()
                compile.assert_not_called()
                verify.assert_not_called()

    def test_protected_state_drift_after_verification_stops_acceptance(self):
        with patch.object(sys, "argv", self.arguments("--verify-existing")), patch.object(web, "preflight", return_value=self.result()), patch.object(web, "verify_candidate", return_value=CANDIDATE), patch.object(web, "protected_snapshot", return_value={"protected": "changed"}), self.assertRaisesRegex(web.GateError, "changed_protected_service_or_environment"):
            web.main()

    def test_builder_rejects_caller_selected_api_pin_before_docker_reads(self):
        with patch.object(web.reviewed, "command") as host, self.assertRaisesRegex(web.GateError, "accepted_protected_api_pins_required"):
            web.protected_snapshot("unreviewed", "sha256:" + "f" * 64)
        host.assert_not_called()

    def test_compiler_failure_removes_only_owned_bounded_network_none_container(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:3] == ("docker", "start", "--attach"):
                raise web.GateError("fixture compile failure")
            return b""
        with patch.object(web.reviewed, "command", side_effect=command), self.assertRaises(web.GateError):
            web.container_compile(REVISION, {"Config": {"Cmd": ["node", "server.js"]}}, {web.PATHS[0]: b"fixture"}, {})
        create = next(args for args in calls if args[:2] == ("docker", "create"))
        self.assertEqual(create[create.index("--network") + 1], "none")
        self.assertEqual(create[create.index("--memory") + 1], "1280m")
        self.assertEqual(create[create.index("--memory-swap") + 1], "1536m")
        owned = create[create.index("--name") + 1]
        self.assertEqual([args for args in calls if args[:3] == ("docker", "rm", "--force")], [("docker", "rm", "--force", owned)])

    def test_new_image_paths_reject_existing_leaves_and_symlink_ancestors(self):
        with patch.object(web.builder, "command") as command:
            web.builder.require_image_absent(web.NEW_PATHS[0])
        args = command.call_args.args
        script = args[args.index("-c") + 1]
        with tempfile.TemporaryDirectory(prefix="flixify-home-absence-contract-") as directory:
            root = Path(directory).resolve()
            leaf = root / "leaf"
            self.assertEqual(subprocess.run(["sh", "-c", script, "sh", str(leaf)]).returncode, 0)
            for kind in ("file", "directory", "symlink", "dangling"):
                if kind == "file":
                    leaf.touch()
                elif kind == "directory":
                    leaf.mkdir()
                else:
                    leaf.symlink_to(root if kind == "symlink" else root / "missing")
                self.assertNotEqual(subprocess.run(["sh", "-c", script, "sh", str(leaf)]).returncode, 0, kind)
                leaf.rmdir() if kind == "directory" else leaf.unlink()
            (root / "linked").symlink_to(root, target_is_directory=True)
            self.assertNotEqual(subprocess.run(["sh", "-c", script, "sh", str(root / "linked" / "absent")]).returncode, 0)

    def test_candidate_source_ancestry_labels_and_environment_remain_immutable(self):
        b = web.builder
        config = b"unchanged Next config"
        base = {"Id": web.SOURCE_ID, "RootFS": {"Layers": ["source"]}, "Config": {"Env": ["KEEP=original"], "Labels": {}}}
        accepted = {"Id": CANDIDATE, "RootFS": {"Layers": ["source", "overlay"]}, "Config": {"Env": ["KEEP=original"], "Labels": {"org.opencontainers.image.revision": REVISION, "vip.flixify.edge-recovery.base": web.SOURCE_ID}}}
        updated = dict.fromkeys(web.PATHS, b"accepted overlay")
        for drift in (None, "ancestry", "label", "environment", *web.PATHS):
            candidate = copy.deepcopy(accepted)
            if drift == "ancestry": candidate["RootFS"]["Layers"] = ["unrelated", "overlay"]
            if drift == "label": candidate["Config"]["Labels"]["org.opencontainers.image.revision"] = "c" * 40
            if drift == "environment": candidate["Config"]["Env"].append("UNREVIEWED=value")
            def image_file(image, path):
                return config if path == b.CONFIG else (b"drift" if path == drift else b"accepted overlay")
            with self.subTest(drift=drift), patch.object(b.core, "image", return_value=candidate), patch.object(b, "image_file", side_effect=image_file), patch.object(b, "command"):
                if drift is None:
                    self.assertEqual(b.verify_candidate(base, REVISION, updated, {}, config), CANDIDATE)
                else:
                    with self.assertRaises(web.GateError):
                        b.verify_candidate(base, REVISION, updated, {}, config)

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(release, "homepage-only release adapter must exist")

    def test_only_web_can_change_and_existing_isolation_cannot_transition(self):
        release.configure(REVISION, CANDIDATE, release.API_TAG, release.API_ID)
        g = release.guard
        self.assertEqual(g.CHANGED, ("ops-web",))
        self.assertEqual(g.PROTECTED, ("db", "api", "worker"))
        self.assertEqual(g.SOURCE_IDS, {"ops-web": web.SOURCE_ID})
        self.assertEqual(g.TARGET, {"ops-web": web.target(REVISION)})
        self.assertEqual(g.PHP_APPLY, release.reviewed.reviewed.ORIGINAL_PHP_APPLY)
        self.assertNotIn("isolateRegistrationGuard", g.PHP_APPLY)
        document = {"services": {name: {"image": "preserve", "environment": {"KEEP": name, "REGISTRATION_GUARD_SECRET": ""}} for name in ("ops-web", "worker", "db")}}
        original = copy.deepcopy(document)
        new, rendered = g.expected_swapped(document, document, g.TARGET)
        self.assertEqual(document, original)
        original["services"]["ops-web"]["image"] = g.TARGET["ops-web"]
        self.assertEqual(new, original)
        self.assertEqual(rendered, original)
        del document["services"]["worker"]["environment"]["REGISTRATION_GUARD_SECRET"]
        with self.assertRaises(release.GateError):
            g.expected_swapped(document, document, g.TARGET)

    def test_rejects_any_caller_selected_api_pin_before_reconfigure(self):
        with patch.object(release.reviewed, "configure") as configure, self.assertRaises(release.GateError):
            release.configure(REVISION, CANDIDATE, "unreviewed", "sha256:" + "f" * 64)
        configure.assert_not_called()

class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(release, "homepage-only release adapter must exist")
        prior_tests = load("home_2026_prior_transaction_fixture", HERE.parent / "2026-10-31-search-activation" / "test-web.py")
        prior_tests.release = release
        self.fixture = f = prior_tests.WebTransactionFixture()
        self.addCleanup(f.close)
        old_tag, old_id = f.tags["ops-web"]
        base = f.images.pop(old_tag)
        f.images.pop(old_id)
        base["Id"] = release.SOURCE_ID
        f.images[release.SOURCE_TAG] = f.images[release.SOURCE_ID] = base
        f.images[CANDIDATE]["Config"]["Labels"]["vip.flixify.edge-recovery.base"] = release.SOURCE_ID
        f.doc["services"]["ops-web"]["image"] = release.SOURCE_TAG
        f.record["docker_compose_raw"] = f.record["docker_compose"] = json.dumps(f.doc)
        f.compose.write_bytes(f.record["docker_compose"].encode())
        f.apps["ops-web"] = release.SOURCE_TAG
        f.tags["ops-web"] = release.SOURCE_TAG, release.SOURCE_ID
        f.containers["ops-web"] = f.container("ops-web", release.SOURCE_TAG, release.SOURCE_ID)
        for name in ("ops-web", "worker", "db"):
            f.containers[name]["Config"]["Env"].append("REGISTRATION_GUARD_SECRET=")

    def test_read_only_then_apply_recreate_rollback_preserve_all_other_services_and_env(self):
        f = self.fixture
        protected = {name: copy.deepcopy(f.containers[name]) for name in ("api", "worker", "db")}
        original_web = copy.deepcopy(f.containers["ops-web"])
        original_env = f.env.read_bytes()
        self.assertIn("no_mutation", f.invoke())
        self.assertEqual(f.mutations(), [])
        f.invoke("--apply")
        self.assertEqual(f.containers["ops-web"], original_web)
        f.invoke("--recreate")
        self.assertEqual(f.containers["ops-web"]["Image"], CANDIDATE)
        self.assertEqual({name: f.containers[name] for name in protected}, protected)
        f.invoke("--rollback")
        self.assertEqual(f.containers["ops-web"]["Image"], release.SOURCE_ID)
        self.assertEqual({name: f.containers[name] for name in protected}, protected)
        self.assertEqual(f.env.read_bytes(), original_env)
        self.assertTrue(all(args[-1] == "ops-web" for args in f.events if args[:2] == ("docker", "compose") and "up" in args))

    def test_failed_candidate_health_rolls_back_to_current_search_website_only(self):
        f = self.fixture
        protected = {name: copy.deepcopy(f.containers[name]) for name in ("api", "worker", "db")}
        original_env = f.env.read_bytes()
        f.invoke("--apply")
        f.fail_target_health = True
        with self.assertRaisesRegex(release.GateError, "deploy_failed_but_source_restored"):
            f.invoke("--recreate")
        self.assertEqual(f.containers["ops-web"]["Image"], release.SOURCE_ID)
        self.assertEqual({name: f.containers[name] for name in protected}, protected)
        self.assertEqual(f.env.read_bytes(), original_env)

if __name__ == "__main__":
    unittest.main()
