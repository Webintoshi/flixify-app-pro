"""Offline exact-leaf and protected-image contracts for the Stripe SDK correction."""
import copy
import hashlib
import importlib.util
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
REVISION = "a" * 40
WEB_CANDIDATE = "sha256:" + "b" * 64
API_CANDIDATE = "sha256:" + "c" * 64


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


api = load("embedded_api_contract", "build-api-embedded.py")
web = load("embedded_web_contract", "build-web-embedded.py")
release_api = load("embedded_api_release_contract", "release-api-embedded.py")
release_web = load("embedded_web_release_contract", "release-web-embedded.py")


class Fixture:
    def __init__(self):
        self.directory = tempfile.TemporaryDirectory(prefix="flixify-embedded-contract-")
        self.repo = Path(self.directory.name)
        self.git("init", "-q")
        self.git("config", "user.email", "offline@example.invalid")
        self.git("config", "user.name", "Offline Contract")
        self.originals = {api.PATHS[0]: b"route 'embedded' 'embedded' 'embedded'\n", api.PATHS[1]: b"api 'embedded'\n"}
        manifest = {"runtimeSources": [], "patchesFile": api.reviewed.API_PATCHES, "patchesSha256": "unchanged"}
        for path, value in self.originals.items():
            source = api.reviewed.API_SOURCE_ROOT + Path(path).name
            self.put(source, value)
            manifest["runtimeSources"].append({"path": path, "source": source, "new": False, "sha256": hashlib.sha256(value).hexdigest()})
        self.put(api.reviewed.API_SOURCE_MANIFEST, json.dumps(manifest).encode())
        self.put(api.reviewed.API_PATCHES, b"[]\n")
        self.put(web.PATHS[0], b"type initEmbeddedCheckout; call.initEmbeddedCheckout; https://js.stripe.com/v3/\n")
        self.base = self.commit()
        for path, value in self.originals.items():
            value = api.corrected_source(path, value)
            self.put(api.reviewed.API_SOURCE_ROOT + Path(path).name, value)
            next(entry for entry in manifest["runtimeSources"] if entry["path"] == path)["sha256"] = hashlib.sha256(value).hexdigest()
        self.put(api.reviewed.API_SOURCE_MANIFEST, json.dumps(manifest).encode())
        self.put(web.PATHS[0], web.corrected_source((self.repo / web.PATHS[0]).read_bytes()))
        self.put("apps/ops-web/app/paketler/embedded-checkout.test.tsx", b"reviewed regression\n")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], stderr=subprocess.DEVNULL).decode().strip()

    def put(self, path, value):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")


class ExactSourceTests(unittest.TestCase):
    def test_pinned_baselines_are_live_packages_and_exclusions_are_exact_leaves(self):
        self.assertEqual(api.SOURCE_ID, web.API_ID)
        self.assertEqual(release_web.SOURCE_ID, web.SOURCE_ID)
        self.assertEqual(release_api.WEB_ID, web.SOURCE_ID)
        self.assertEqual(release_api.WORKER_ID, web.WORKER_ID)
        self.assertEqual(len(api.configuration("api")["paths"]), 2)
        self.assertEqual(api.configuration("api")["new"], ())
        self.assertEqual(web.EXCLUDED, (*web.PATHS, "apps/ops-web/.next"))
        for value in ("HEAD", "main", "a" * 12):
            with self.assertRaises(api.GateError): api.target("api", value)
            with self.assertRaises(web.GateError): web.target(value)
        with self.assertRaises(api.GateError): api.configuration("worker")

    def test_api_overlay_accepts_only_four_literal_mode_changes_and_two_manifest_digests(self):
        f = Fixture()
        self.addCleanup(f.directory.cleanup)
        revision = f.commit()
        pin = {"sourceHashes": {key: hashlib.sha256(value).hexdigest() for key, value in f.originals.items()}, "untouched": api.SOURCE_UNTOUCHED}
        with patch.object(api, "BASE_REVISION", f.base), patch.object(api, "SOURCE_HASHES", pin["sourceHashes"]), patch.object(api.reviewed.helpers, "image_file", side_effect=lambda image, path: f.originals[path]):
            actual = api.updated_sources(f.repo, revision, "api", pin)
        self.assertEqual(actual, {path: value.replace(b"'embedded'", b"'embedded_page'") for path, value in f.originals.items()})

    def test_api_overlay_rejects_extra_payload_application_server_or_manifest_changes(self):
        for mutation in ("extra_payload", "worker", "server_patch", "manifest", "same_file_logic"):
            with self.subTest(mutation=mutation):
                f = Fixture()
                self.addCleanup(f.directory.cleanup)
                if mutation == "extra_payload": f.put(api.reviewed.API_SOURCE_ROOT + "stripe-payment.ts", b"changed\n")
                if mutation == "worker": f.put("apps/worker/src/other.ts", b"changed\n")
                if mutation == "server_patch": f.put(api.reviewed.API_PATCHES, b"[{}]\n")
                if mutation == "manifest":
                    file = f.repo / api.reviewed.API_SOURCE_MANIFEST
                    data = json.loads(file.read_bytes()); data["patchesSha256"] = "changed"; file.write_text(json.dumps(data))
                if mutation == "same_file_logic": f.put(api.reviewed.API_SOURCE_ROOT + "stripe-billing-api.ts", b"api 'embedded_page'; unrelated();\n")
                revision = f.commit()
                pin = {"sourceHashes": {key: hashlib.sha256(value).hexdigest() for key, value in f.originals.items()}, "untouched": api.SOURCE_UNTOUCHED}
                with patch.object(api, "BASE_REVISION", f.base), patch.object(api, "SOURCE_HASHES", pin["sourceHashes"]), patch.object(api.reviewed.helpers, "image_file", side_effect=lambda image, path: f.originals[path]), self.assertRaises(api.GateError):
                    api.updated_sources(f.repo, revision, "api", pin)

    def test_web_scope_allows_one_component_and_regressions_rejects_public_dependencies_and_other_components(self):
        f = Fixture()
        self.addCleanup(f.directory.cleanup)
        revision = f.commit()
        with patch.object(web, "BASE_REVISION", f.base): web.validate_source_scope(f.repo, revision)
        for path in ("apps/ops-web/public/downloads/new.apk", "apps/ops-web/package.json", "apps/ops-web/components/ui/pricing.tsx", "apps/api/src/demo-store.ts"):
            f.put(path, b"unreviewed\n")
            revision = f.commit()
            with patch.object(web, "BASE_REVISION", f.base), self.assertRaises(web.GateError): web.validate_source_scope(f.repo, revision)

    def test_source_replacements_reject_missing_or_extra_anchors(self):
        for path in api.PATHS:
            with self.assertRaises(api.GateError): api.corrected_source(path, b"unexpected 'embedded' 'embedded'\n")
        with self.assertRaises(web.GateError): web.corrected_source(b"initEmbeddedCheckout https://js.stripe.com/v3/")
        value = b"initEmbeddedCheckout initEmbeddedCheckout https://js.stripe.com/v3/"
        self.assertEqual(web.corrected_source(value), b"createEmbeddedCheckoutPage createEmbeddedCheckoutPage https://js.stripe.com/endive/stripe.js")


class BuildTests(unittest.TestCase):
    def test_web_compile_failure_cleans_only_owned_bounded_network_none_container(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:3] == ("docker", "start", "--attach"): raise web.GateError("fixture")
            return b""
        with patch.object(web.reviewed.reviewed, "command", side_effect=command), self.assertRaises(web.GateError):
            web.container_compile(REVISION, {"Config": {"Cmd": ["node", "server"]}}, {web.PATHS[0]: b"reviewed"}, {})
        create = next(row for row in calls if row[:2] == ("docker", "create"))
        self.assertEqual([create[create.index(key) + 1] for key in ("--network", "--memory", "--memory-swap", "--pids-limit")], ["none", "1280m", "1536m", "256"])
        owned = create[create.index("--name") + 1]
        self.assertEqual([row for row in calls if row[:3] == ("docker", "rm", "--force")], [("docker", "rm", "--force", owned)])
        self.assertEqual(sum(row[:2] == ("docker", "cp") for row in calls), 1)
        self.assertFalse(any("prune" in row for row in calls))

    def test_extra_compile_leaf_and_wrong_independent_fingerprint_rejected_before_docker(self):
        with self.assertRaises(web.GateError): web.container_compile(REVISION, {}, {**dict.fromkeys(web.PATHS, b"reviewed"), "extra": b"bad"}, {})
        with patch.object(web, "original_reviewed_preflight") as preflight, self.assertRaises(web.GateError):
            web.preflight(Path("/unused"), REVISION, web.API_TAG, web.API_ID, "f" * 64, web.SOURCE_UNTOUCHED["files"])
        preflight.assert_not_called()

    def test_protected_web_build_snapshot_includes_all_host_containers_and_registration_fence(self):
        with patch.object(web, "original_protected_snapshot", return_value={"services": "exact"}), patch.object(web.backend, "host_snapshot", return_value={"registrationFence": "same", "external": "pinned"}):
            self.assertEqual(web.protected_snapshot(web.API_TAG, web.API_ID), {"services": {"services": "exact"}, "host": {"registrationFence": "same", "external": "pinned"}})


class ReleaseTests(unittest.TestCase):
    def test_web_changes_only_web_protects_current_backend_and_keeps_original_fence(self):
        release_web.configure(REVISION, WEB_CANDIDATE, web.API_TAG, web.API_ID)
        guard = release_web.guard
        self.assertEqual(guard.CHANGED, ("ops-web",))
        self.assertEqual(guard.SOURCE_IDS, {"ops-web": web.SOURCE_ID})
        self.assertEqual(guard.PROTECTED_IMAGES, {"api": (web.API_TAG, web.API_ID), "worker": (web.WORKER_TAG, web.WORKER_ID)})
        self.assertEqual(release_web.reviewed.builder.API_ID, "sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6")
        self.assertIs(guard.validate_plan, release_web.reviewed.validate_plan)
        with self.assertRaises(release_web.GateError): release_web.configure(REVISION, WEB_CANDIDATE, "stale", web.API_ID)

    def test_api_requires_matching_web_revision_exact_tag_id_and_current_web_ancestry(self):
        tag = web.target(REVISION)
        original = {"Id": web.SOURCE_ID, "RootFS": {"Layers": ["base"]}}
        candidate = {"Id": WEB_CANDIDATE, "RootFS": {"Layers": ["base", "overlay"]}, "Config": {"Labels": {"org.opencontainers.image.revision": REVISION, "vip.flixify.edge-recovery.base": web.SOURCE_ID}}}
        for mutation in (None, "revision", "base", "layers", "tag_id"):
            value = copy.deepcopy(candidate)
            if mutation == "revision": value["Config"]["Labels"]["org.opencontainers.image.revision"] = "d" * 40
            if mutation == "base": value["Config"]["Labels"]["vip.flixify.edge-recovery.base"] = "sha256:" + "d" * 64
            if mutation == "layers": value["RootFS"]["Layers"] = ["wrong"]
            with patch.object(release_api.guard, "image", side_effect=lambda identifier: original if identifier == web.SOURCE_ID else value), patch.object(release_api.guard, "image_id", return_value=(WEB_CANDIDATE if mutation != "tag_id" else "sha256:" + "d" * 64)):
                if mutation:
                    with self.assertRaises(release_api.GateError): release_api.configure("api", REVISION, API_CANDIDATE, tag, WEB_CANDIDATE)
                else:
                    release_api.configure("api", REVISION, API_CANDIDATE, tag, WEB_CANDIDATE)
                    self.assertEqual(release_api.guard.CHANGED, ("api",))
                    self.assertEqual(release_api.guard.SOURCE_IDS, {"api": api.SOURCE_ID})
                    self.assertEqual(release_api.guard.PROTECTED_IMAGES["worker"], (web.WORKER_TAG, web.WORKER_ID))
        with self.assertRaises(release_api.GateError): release_api.configure("api", REVISION, API_CANDIDATE, web.SOURCE_TAG, web.SOURCE_ID)
        with self.assertRaises(release_api.GateError): release_api.configure("worker", REVISION, API_CANDIDATE, tag, WEB_CANDIDATE)


if __name__ == "__main__":
    unittest.main()
