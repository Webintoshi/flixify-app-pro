"""Offline backend source, compiler and real Coolify transaction contracts."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import re
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


build = load("packages_backend_build_contract", HERE / "build-backend.py")
release = load("packages_backend_release_contract", HERE / "release-backend.py")
REV, CANDIDATE = "a" * 40, "sha256:" + "b" * 64


def pin(service):
    c = build.configuration(service)
    return {"sourceHashes": {path: None if path in c["new"] else "c" * 64 for path in c["paths"]},
            "distEntries": {c["entry"]: {"bytes": 10, "sha256": "d" * 64}},
            "dist": {"sha256": "e" * 64, "files": 1}, "untouched": {"sha256": "f" * 64, "files": 100}}


class SourceTests(unittest.TestCase):
    def test_exact_services_revision_source_images_and_scopes(self):
        self.assertEqual(build.configuration("api")["id"], build.API_ID)
        self.assertEqual(build.configuration("worker")["id"], build.WORKER_ID)
        self.assertEqual(len(build.API_PATHS), 16)
        self.assertEqual(len(build.WORKER_PATHS), 2)
        self.assertEqual(len(build.API_TEST_FILES), 12)
        self.assertEqual(build.API_NEW_PATHS, tuple("apps/api/src/" + name for name in ("stripe-sales-catalog.ts", "stripe-payment.ts", "stripe-payment-store.ts", "stripe-payment-api.ts")))
        for service in ("api", "worker"):
            self.assertEqual(build.target(service, REV), "flixify-" + service + ":packages-aaaaaaaaaaaa-20261101")
            self.assertEqual(build.validate_source_pin(pin(service), service), pin(service))
            for ref in ("HEAD", "a" * 12, "A" * 40):
                with self.assertRaises(build.GateError): build.target(service, ref)
        with self.assertRaises(build.GateError): build.configuration("db")

    def test_independent_pin_rejects_omitted_new_dist_or_untouched_information(self):
        for service in ("api", "worker"):
            for kind in ("missing", "source", "dist", "untouched"):
                value = pin(service)
                if kind == "missing": value.pop("sourceHashes")
                elif kind == "source": value["sourceHashes"][next(iter(value["sourceHashes"]))] = "bad"
                elif kind == "dist": value["distEntries"] = {"../outside.js": {"bytes": 1, "sha256": "a" * 64}}
                else: value["untouched"]["files"] = True
                with self.subTest(service=service, kind=kind), self.assertRaises(build.GateError):
                    build.validate_source_pin(value, service)
        value = pin("api")
        value["sourceHashes"][build.API_NEW_PATHS[0]] = "a" * 64
        with self.assertRaises(build.GateError): build.validate_source_pin(value, "api")

    def test_snapshot_excludes_only_named_source_leaves_and_dist(self):
        for service in ("api", "worker"):
            script = build.snapshot_script(service)
            c = build.configuration(service)
            self.assertIn(json.dumps((*c["paths"], c["dist"])), script)
            self.assertNotIn('"node_modules"', script)
            self.assertNotIn("REGISTRATION_GUARD_SECRET", script)
            self.assertIn("source_not_regular", script)

    def test_server_patch_requires_whole_source_hash_and_three_unique_nonoverlapping_anchors(self):
        source = b"production import;\nproduction store;\nproduction registration;\nprovider callback one;\nproduction playback;\n"
        spec = {"path": "apps/api/src/server.ts", "sourceSha256": hashlib.sha256(source).hexdigest(), "replacements": [
            {"old": "production import;", "new": "production import; new payment import;"},
            {"old": "production store;", "new": "production store; new payment store;"},
            {"old": "provider callback one", "new": "provider callback two"}]}
        self.assertEqual(build.patch_server(source, spec), source.replace(b"production import;", b"production import; new payment import;").replace(b"production store;", b"production store; new payment store;").replace(b"callback one", b"callback two"))
        for kind in ("sha", "path", "duplicate", "missing", "two-edits", "same", "overlap"):
            value, original = copy.deepcopy(spec), source
            if kind == "sha": value["sourceSha256"] = "f" * 64
            elif kind == "path": value["path"] = "apps/api/src/repository.ts"
            elif kind == "duplicate":
                original += b"production import;"
                value["sourceSha256"] = hashlib.sha256(original).hexdigest()
            elif kind == "missing": value["replacements"][0]["old"] = "not present"
            elif kind == "two-edits": value["replacements"] = value["replacements"][:2]
            elif kind == "overlap": value["replacements"][0]["old"] = "provider callback"
            else: value["replacements"][0]["new"] = value["replacements"][0]["old"]
            with self.subTest(kind=kind), self.assertRaises(build.GateError): build.patch_server(original, value)

    def test_invalid_pin_stops_before_reading_host(self):
        with patch.object(build.core, "image") as host, self.assertRaises(build.GateError):
            build.preflight(Path("/not-read"), REV, "api", {})
        host.assert_not_called()


class BuildTests(unittest.TestCase):
    def test_compiler_reproduces_actual_baseline_dist_before_overlay(self):
        for service in ("api", "worker"):
            script = build.compile_script(service, pin(service)["dist"])
            self.assertIn("baseline_source_dist_mismatch", script)
            self.assertIn('"@flixify/' + service + '"', script)
            self.assertIn("build_cgroup_limit_exceeds_cap", script)

    def test_failed_baseline_compile_always_removes_only_owned_offline_container(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            return b""
        for service in ("api", "worker"):
            calls.clear()
            c = build.configuration(service)
            with patch.object(build, "command", side_effect=command), patch.object(build, "compile_checked", side_effect=build.GateError("baseline mismatch")), self.assertRaises(build.GateError):
                build.compile_overlay(service, REV, {"Config": {"Cmd": ["node", "entry.js"]}}, dict.fromkeys(c["paths"], b"source"), pin(service))
            create = calls[0]
            self.assertEqual(create[create.index("--network") + 1], "none")
            self.assertEqual(create[create.index("--memory") + 1], "1280m")
            self.assertEqual(create[create.index("--memory-swap") + 1], "1536m")
            name = create[create.index("--name") + 1]
            self.assertEqual(calls[-1], ("docker", "rm", "--force", name))
            self.assertFalse(any(args[:2] in (("docker", "cp"), ("docker", "commit")) or "prune" in args for args in calls))

    def test_candidate_exact_config_ancestry_sources_and_untouched_fingerprint_required(self):
        for service in ("api", "worker"):
            c = build.configuration(service)
            base = {"Id": c["id"], "RootFS": {"Layers": ["source"]}, "Config": {"Env": ["KEEP=original"], "Cmd": ["node", "entry.js"], "Labels": {}}}
            candidate = {"Id": CANDIDATE, "RootFS": {"Layers": ["source", "overlay"]}, "Config": {**base["Config"], "Labels": {"org.opencontainers.image.revision": REV, "vip.flixify.edge-recovery.base": c["id"]}}}
            updates = dict.fromkeys(c["paths"], b"reviewed source")
            expected = pin(service)
            for kind in (None, "ancestry", "env", "label", "source", "untouched"):
                value = copy.deepcopy(candidate)
                if kind == "ancestry": value["RootFS"]["Layers"] = ["different"]
                elif kind == "env": value["Config"]["Env"] = ["KEEP=changed"]
                elif kind == "label": value["Config"]["Labels"]["org.opencontainers.image.revision"] = "f" * 40
                actual = copy.deepcopy(expected)
                if kind == "untouched": actual["untouched"]["sha256"] = "0" * 64
                with self.subTest(service=service, kind=kind), patch.object(build.core, "image", return_value=value), patch.object(build, "snapshot", return_value=actual), patch.object(build.helpers, "image_file", return_value=b"changed" if kind == "source" else b"reviewed source"), patch.object(build, "command"):
                    if kind is None: self.assertEqual(build.verify_candidate(service, REV, base, updates, expected, expected), CANDIDATE)
                    else:
                        with self.assertRaises(build.GateError): build.verify_candidate(service, REV, base, updates, expected, expected)

    def arguments(self, action):
        return ["build-backend.py", "/owned/repo", "--revision", REV, "--service", "api", "--source-pin", "/owned/pin.json"] + ([action] if action else [])

    def test_read_only_default_and_low_disk_do_not_compile(self):
        for action in (None, "--build"):
            with patch.object(sys, "argv", self.arguments(action)), patch.object(build.Path, "read_bytes", return_value=b'{}'), patch.object(build, "preflight", return_value=({}, {}, {}, {})), patch.object(build.shutil, "disk_usage", return_value=types.SimpleNamespace(free=8 * 1024**3 - 1)), patch.object(build, "compile_overlay") as compile, contextlib.redirect_stdout(io.StringIO()):
                if action:
                    with self.assertRaisesRegex(build.GateError, "requires_8GiB"): build.main()
                else: build.main()
                compile.assert_not_called()

    def test_regressions_are_offline_bounded_readonly_mounted_and_never_receive_live_secrets(self):
        calls = []
        files = {"apps/api/src/stripe-sales-catalog.test.ts": b"reviewed test"}
        with patch.object(build, "test_sources", return_value=files), patch.object(build, "command", side_effect=lambda *args, **kwargs: calls.append(args) or b""):
            build.test_candidate(Path("/owned/repo"), REV, "api", CANDIDATE)
        args = calls[0]
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertEqual(args[args.index("--memory") + 1], "1280m")
        self.assertEqual(args[args.index("--memory-swap") + 1], "1536m")
        self.assertIn("STRIPE_SECRET_KEY=", args)
        self.assertIn("PACKAGE_PAYMENT_TEST_DATABASE_URL=", args)
        self.assertTrue(any(item.endswith(":/app/apps/api/src/stripe-sales-catalog.test.ts:ro") for item in args))
        self.assertNotIn("--env-file", args)
        self.assertIn("DATABASE_URL=postgresql://127.0.0.1:9/unused", args)
        self.assertIn("fs.symlinkSync('/app/apps/api/src'", args[-1])
        self.assertIn("--config", args[-1])


class ExternalCrashloopTests(unittest.TestCase):
    def setUp(self):
        build.EXTERNAL_RUNTIME_OBSERVATIONS.clear()

    def tearDown(self):
        build.EXTERNAL_RUNTIME_OBSERVATIONS.clear()

    def row(self):
        return {"Id": build.EXTERNAL_CRASHLOOP_ID, "Name": build.EXTERNAL_CRASHLOOP_NAME, "Image": build.EXTERNAL_CRASHLOOP_IMAGE,
            "Config": {"Image": "external-keycloak:pinned", "Env": ["KEEP=fixture-private"], "Labels": {"com.docker.compose.project": build.EXTERNAL_CRASHLOOP_PROJECT}},
            "HostConfig": {"RestartPolicy": {"Name": "unless-stopped"}, "Memory": 1073741824},
            "Mounts": [{"Type": "bind", "Source": "/fixture/config", "Destination": "/config", "RW": False, "Propagation": "rprivate"}, {"Type": "volume", "Name": "fixture-data", "Source": "/fixture/data", "Destination": "/data", "RW": True, "Driver": "local"}],
            "State": {"StartedAt": "before", "Running": True, "OOMKilled": False}, "RestartCount": 8360,
            "NetworkSettings": {"Networks": {"external": {"NetworkID": "network-pinned", "IPAMConfig": {"IPv4Address": ""}, "Aliases": ["keycloak"], "Links": ["db"], "DriverOpts": {"configured": "value"}, "DNSNames": ["keycloak-pinned"],
                "EndpointID": "endpoint-before", "IPAddress": "172.20.0.2", "IPPrefixLen": 16, "Gateway": "172.20.0.1", "MacAddress": "00:00:00:00:00:01", "IPv6Gateway": "", "GlobalIPv6Address": "", "GlobalIPv6PrefixLen": 0}}}}

    def test_only_exact_preexisting_crashloop_can_change_runtime_and_ephemeral_endpoint_state(self):
        before = self.row()
        after = copy.deepcopy(before)
        after["State"].update({"StartedAt": "after", "Running": False})
        after["RestartCount"] = 8374
        endpoint = after["NetworkSettings"]["Networks"]["external"]
        for field in build.EPHEMERAL_ENDPOINT_FIELDS:
            endpoint[field] = 0 if field.endswith("PrefixLen") else ""
        first, second = build.host_container_identity(before), build.host_container_identity(after)
        self.assertEqual(first, second)
        self.assertNotIn("startedAt", first)
        self.assertNotIn("restarts", first)
        self.assertNotIn("running", first)
        self.assertEqual([row["restarts"] for row in build.EXTERNAL_RUNTIME_OBSERVATIONS], [8360, 8374])
        self.assertNotIn("fixture-private", json.dumps(build.EXTERNAL_RUNTIME_OBSERVATIONS))

    def test_pin_identity_safety_and_minimum_restart_evidence_cannot_change(self):
        for kind in ("id", "name", "image", "project", "oom", "missing-oom", "minimum"):
            row = self.row()
            if kind == "id": row["Id"] = "replacement-container"
            elif kind == "name": row["Name"] = "/different-name"
            elif kind == "image": row["Image"] = "sha256:" + "f" * 64
            elif kind == "project": row["Config"]["Labels"]["com.docker.compose.project"] = build.core.UUID
            elif kind == "oom": row["State"]["OOMKilled"] = True
            elif kind == "missing-oom": row["State"].pop("OOMKilled")
            else: row["RestartCount"] = 8299
            with self.subTest(kind=kind), self.assertRaisesRegex(build.GateError, "identity_or_safety_drift"):
                build.host_container_identity(row)

    def test_every_static_environment_image_mount_and_configured_network_field_remains_protected(self):
        before = self.row()
        accepted = build.host_container_identity(before)
        for kind in ("env", "tag", "host", "mount-source", "mount-mode", "network-name", "network-id", "ipam", "aliases", "links", "driver", "dns", "unknown-static"):
            row = copy.deepcopy(before)
            endpoint = row["NetworkSettings"]["Networks"]["external"]
            if kind == "env": row["Config"]["Env"].append("UNREVIEWED=value")
            elif kind == "tag": row["Config"]["Image"] = "external:other"
            elif kind == "host": row["HostConfig"]["Memory"] *= 2
            elif kind == "mount-source": row["Mounts"][0]["Source"] = "/other-source"
            elif kind == "mount-mode": row["Mounts"][0]["RW"] = True
            elif kind == "network-name": row["NetworkSettings"]["Networks"]["another"] = row["NetworkSettings"]["Networks"].pop("external")
            elif kind == "network-id": endpoint["NetworkID"] = "different-network"
            elif kind == "ipam": endpoint["IPAMConfig"]["IPv4Address"] = "172.20.0.99"
            elif kind == "aliases": endpoint["Aliases"].append("different-alias")
            elif kind == "links": endpoint["Links"] = []
            elif kind == "driver": endpoint["DriverOpts"]["configured"] = "different"
            elif kind == "dns": endpoint["DNSNames"] = ["different-dns"]
            else: endpoint["future-static-option"] = "unreviewed"
            with self.subTest(kind=kind):
                self.assertNotEqual(build.host_container_identity(row), accepted)

    def test_mount_order_is_losslessly_canonicalized_only_for_the_pinned_exception(self):
        row = self.row()
        reversed_row = copy.deepcopy(row)
        reversed_row["Mounts"].reverse()
        self.assertEqual(build.host_container_identity(row), build.host_container_identity(reversed_row))
        reversed_row["Mounts"][0]["future-mount-option"] = "different"
        self.assertNotEqual(build.host_container_identity(row), build.host_container_identity(reversed_row))

    def test_all_flixify_services_and_unpinned_external_containers_remain_strict(self):
        for name in ("api", "worker", "db", "ops-web", "another-external-service"):
            row = self.row()
            row["Id"], row["Name"] = "original-" + name, "/" + name + "-" + build.core.UUID
            row["Config"]["Labels"]["com.docker.compose.project"] = build.core.UUID if name != "another-external-service" else build.EXTERNAL_CRASHLOOP_PROJECT
            original = build.host_container_identity(row)
            for kind in ("started", "restart", "running", "endpoint", "ip", "network", "environment", "image"):
                after = copy.deepcopy(row)
                if kind == "started": after["State"]["StartedAt"] = "different"
                elif kind == "restart": after["RestartCount"] += 1
                elif kind == "running": after["State"]["Running"] = False
                elif kind == "endpoint": after["NetworkSettings"]["Networks"]["external"]["EndpointID"] = "different"
                elif kind == "ip": after["NetworkSettings"]["Networks"]["external"]["IPAddress"] = "172.20.0.22"
                elif kind == "network": after["NetworkSettings"]["Networks"]["external"]["NetworkID"] = "different"
                elif kind == "environment": after["Config"]["Env"].append("UNREVIEWED=value")
                else: after["Image"] = "different"
                with self.subTest(name=name, kind=kind):
                    self.assertNotEqual(build.host_container_identity(after), original)
        self.assertEqual(build.EXTERNAL_RUNTIME_OBSERVATIONS, [])

    def test_a_missing_or_replaced_pinned_container_cannot_establish_a_new_baseline(self):
        row = self.row()
        row["Id"], row["Name"] = "replacement", "/unrecognized-replacement"
        def command(*args, **kwargs):
            return b"replacement\n" if args[:2] == ("docker", "ps") else json.dumps([row]).encode()
        with patch.object(build, "command", side_effect=command), self.assertRaisesRegex(build.GateError, "pinned_external_crashloop_container_missing"):
            build.host_snapshot()


class TransactionFixture:
    def __init__(self, service):
        self.service = service
        self.temp = tempfile.TemporaryDirectory(prefix="flixify-packages-backend-contract-")
        self.root = Path(self.temp.name)
        self.stack = contextlib.ExitStack()
        self.g = g = release.guard
        with patch.object(release, "protected_pin", side_effect=lambda name, tag, image_id: (tag, image_id)):
            release.configure(service, REV, CANDIDATE, build.WEB_TAG, build.WEB_ID, *(() if service == "api" else (build.API_TAG, build.API_ID)))
        self.tags = {"api": (build.API_TAG, build.API_ID), "worker": (build.WORKER_TAG, build.WORKER_ID), "ops-web": (build.WEB_TAG, build.WEB_ID), "db": ("postgres:16-alpine", build.DB_ID)}
        self.doc = {"services": {name: {"image": values[0], "environment": {"KEEP": name, "REGISTRATION_GUARD_SECRET": ""}} for name, values in self.tags.items()}}
        self.doc["services"]["api"]["environment"].update({"REGISTRATION_GUARD_SECRET": "${REGISTRATION_GUARD_SECRET}", "TRUSTED_PROXY_CIDRS": "10.0.2.4/32,127.0.0.1/32,::1/128", "AUTO_TRIAL_DAILY_IP_LIMIT": "2"})
        self.compose, self.env = self.root / "docker-compose.yml", self.root / ".env"
        self.compose.write_bytes(json.dumps(self.doc).encode())
        self.env.write_bytes(b"# preserved formatting\r\nKEEP=fixture-private\r\n")
        self.fence = self.root / ".live-registration-rollout.json"
        self.fence.write_text(json.dumps({"version": 1, "phase": "complete", "candidate_id": build.API_ID}))
        self.record = {"id": 1, "uuid": g.UUID, "docker_compose_raw": json.dumps(self.doc), "docker_compose": json.dumps(self.doc)}
        self.apps = {name: values[0] for name, values in self.tags.items() if name != "db"}
        self.containers = {name: self.container(name, *values) for name, values in self.tags.items()}
        self.images = {}
        for name, (tag, identity) in self.tags.items():
            self.images[tag] = self.images[identity] = {"Id": identity, "RootFS": {"Layers": [name + "-base"]}, "Config": {"Labels": {}}}
        source_id = self.tags[service][1]
        candidate = {"Id": CANDIDATE, "RootFS": {"Layers": [service + "-base", "overlay"]}, "Config": {"Labels": {"org.opencontainers.image.revision": REV, "vip.flixify.edge-recovery.base": source_id}}}
        self.images[g.TARGET[service]] = self.images[CANDIDATE] = candidate
        self.events, self.fail_target_health = [], False
        self.outside_project = {"id": "unrelated-project", "running": True}
        for key, value in (("DIRECTORY", self.root), ("COMPOSE", self.compose), ("ENV", self.env), ("command", self.command)):
            self.stack.enter_context(patch.object(g, key, value))
        self.stack.enter_context(patch.object(g.time, "sleep"))
        self.stack.enter_context(patch.object(release, "FENCE", self.fence))
        self.stack.enter_context(patch.object(release, "LOCK", self.root / ".packages-release.lock"))
        self.stack.enter_context(patch.object(release, "protected_host_snapshot", side_effect=self.host))

    def close(self):
        self.stack.close()
        self.temp.cleanup()

    def container(self, name, tag, identity):
        return {"Id": "original-" + name, "Image": identity, "RestartCount": 0, "Config": {"Image": tag, "Env": ["KEEP=fixture"], "Labels": {"com.docker.compose.project": self.g.UUID, "com.docker.compose.config-hash": "hash:" + tag}}, "State": {"Running": True, "StartedAt": "original", "Health": {"Status": "healthy"}}, "HostConfig": {}, "Mounts": [], "NetworkSettings": {"Networks": {}}}

    def host(self):
        return copy.deepcopy({**{name: value for name, value in self.containers.items() if name != self.service}, "outside": self.outside_project, "env": self.env.read_bytes().hex(), "fence": self.fence.read_bytes().hex()})

    def command(self, *args, input_data=None, **kwargs):
        self.events.append(args)
        if args[:3] == ("docker", "image", "inspect"): return json.dumps([self.images[args[3]]]).encode()
        if args[:2] == ("docker", "inspect"):
            name = args[2].removesuffix("-" + self.g.UUID)
            return json.dumps([self.containers[name]]).encode()
        if args[:3] == ("docker", "exec", "coolify-db"): return json.dumps(self.record).encode()
        if args[:3] in (("docker", "exec", "coolify"), ("docker", "exec", "-i")):
            if input_data is None:
                match = re.search(r"foreach \(\[([^\]]+)\] as \$name\)", args[-1])
                names = re.findall(r"'([^']+)'", match[1])
                return json.dumps({name: self.apps[name] for name in names}).encode()
            payload = json.loads(input_data)
            assert payload["old"] == {self.service: self.apps[self.service]}
            assert set(payload["new"]) == {self.service}
            assert payload["protected"] == {name: self.apps[name] for name in self.g.PROTECTED_IMAGES}
            for field in ("docker_compose_raw", "docker_compose"):
                document = json.loads(self.record[field])
                document["services"][self.service]["image"] = payload["new"][self.service]
                self.record[field] = json.dumps(document)
            self.apps.update(payload["new"])
            self.compose.write_bytes(self.record["docker_compose"].encode())
            return b"coolify_api_web_source_synced\n"
        if args[:2] == ("docker", "compose"):
            if "--hash" in args: return ("hash:" + json.loads(self.record["docker_compose"])["services"][args[-1]]["image"]).encode()
            if "up" in args:
                assert args[-1] == self.service
                assert all(flag in args for flag in ("--no-deps", "--no-build", "--force-recreate"))
                assert args[args.index("--pull") + 1] == "never"
                tag = self.apps[self.service]
                self.containers[self.service] = self.container(self.service, tag, self.images[tag]["Id"])
                self.containers[self.service]["Id"] = "recreated-" + self.service + "-" + str(len(self.events))
                self.containers[self.service]["State"]["StartedAt"] = "new-start"
            return b""
        if args[:2] == ("docker", "exec") and args[2] in ("api-" + self.g.UUID, "worker-" + self.g.UUID):
            if self.fail_target_health and self.containers[self.service]["Image"] == CANDIDATE:
                raise release.GateError("command_failed")
            return b""
        raise AssertionError("Unexpected external boundary: " + repr(args[:3]))

    def invoke(self, action=None):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            release.invoke(action)
        return output.getvalue()


class TransactionTests(unittest.TestCase):
    def test_default_apply_recreate_rollback_preserve_other_projects_env_and_fence(self):
        for service in ("api", "worker"):
            f = TransactionFixture(service)
            try:
                before = f.host()
                self.assertIn("dry_run", f.invoke())
                self.assertFalse(any(args[:3] == ("docker", "exec", "-i") or args[:2] == ("docker", "compose") and "up" in args for args in f.events))
                f.invoke("apply")
                self.assertEqual(f.containers[service]["Image"], f.tags[service][1])
                f.invoke("recreate")
                self.assertEqual(f.containers[service]["Image"], CANDIDATE)
                self.assertEqual(f.host(), before)
                f.invoke("rollback")
                self.assertEqual(f.containers[service]["Image"], f.tags[service][1])
                self.assertEqual(f.host(), before)
            finally: f.close()

    def test_health_failure_restores_only_current_registration_compatible_source(self):
        for service in ("api", "worker"):
            f = TransactionFixture(service)
            try:
                before = f.host()
                f.invoke("apply")
                f.fail_target_health = True
                with self.assertRaisesRegex(release.GateError, "current_compatible_source_restored"):
                    f.invoke("recreate")
                self.assertEqual(f.containers[service]["Image"], f.tags[service][1])
                self.assertEqual(f.host(), before)
                self.assertTrue(all(args[-1] == service for args in f.events if args[:2] == ("docker", "compose") and "up" in args))
            finally: f.close()

    def test_missing_or_changed_registration_profile_and_fence_are_rejected(self):
        f = TransactionFixture("api")
        try:
            for name in ("worker", "db", "ops-web"):
                document = copy.deepcopy(f.doc)
                del document["services"][name]["environment"]["REGISTRATION_GUARD_SECRET"]
                with self.subTest(name=name), self.assertRaises(release.GateError): release.require_registration_profile(document)
            f.fence.write_text(json.dumps({"version": 1, "phase": "stopped", "candidate_id": build.API_ID}))
            with self.assertRaisesRegex(release.GateError, "incomplete_or_legacy"): f.invoke()
        finally: f.close()

    def test_lock_is_exclusive_and_default_does_not_create_it(self):
        f = TransactionFixture("worker")
        try:
            f.invoke()
            self.assertFalse(release.LOCK.exists())
            with release.release_lock():
                with self.assertRaisesRegex(release.GateError, "another_package_release_running"):
                    with release.release_lock(): pass
        finally: f.close()


if __name__ == "__main__":
    unittest.main()
