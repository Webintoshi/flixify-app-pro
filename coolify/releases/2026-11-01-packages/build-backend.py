#!/usr/bin/env python3
"""Bounded API or worker overlays retaining the actual immutable production source."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import uuid
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
legacy = load("packages_backend_actual_source_helpers", HERE.parent / "2026-10-31-live-registration" / "build-api.py")
helpers, core = legacy.helpers, legacy.core
command, GateError = core.command, core.GateError
BASE_REVISION = "2f39237f8200d8258c9d662b2a45c0ff5a1e3a58"
API_TAG = "flixify-api:live-registration-8645860e0552-20261031"
API_ID = "sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6"
WORKER_TAG = "flixify-worker:edge-recovery-539e01cff3c3-20261026"
WORKER_ID = "sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee"
WEB_TAG = "flixify-ops-web:tvplus-lineup-2f39237f8200-20261031"
WEB_ID = "sha256:94078bed2ba04e00ddef43a358b4c1526f4e5c58c636d0954f86f2e833de979a"
DB_ID = "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
API_NAMES = (
    "stripe-billing-policy.ts", "stripe-billing-runtime.ts", "stripe-billing-routes.ts",
    "stripe-billing-api.ts", "stripe-price-validation.ts", "stripe-entitlement.ts",
    "entitlement-provider.ts", "stripe-billing-store.ts", "stripe-billing-schema.ts",
    "stripe-webhook.ts", "referral-store.ts", "stripe-sales-catalog.ts", "stripe-payment.ts",
    "stripe-payment-store.ts", "stripe-payment-api.ts",
)
API_PATHS = tuple("apps/api/src/" + name for name in API_NAMES) + ("apps/api/src/server.ts",)
WORKER_PATHS = tuple("apps/worker/src/" + name for name in ("provider-entitlement.ts", "provider-entitlement-store.ts"))
API_SOURCE_ROOT = "coolify/releases/2026-11-01-packages/api-source/"
API_PATCHES = "coolify/releases/2026-11-01-packages/api-patches.json"
API_SOURCE_MANIFEST = "coolify/releases/2026-11-01-packages/api-source-manifest.json"
SERVER_PATCH_COUNT = 3
API_NEW_PATHS = tuple("apps/api/src/" + name for name in ("stripe-sales-catalog.ts", "stripe-payment.ts", "stripe-payment-store.ts", "stripe-payment-api.ts"))
API_TEST_ROOT = "coolify/releases/2026-11-01-packages/"
API_TEST_FILES = tuple(API_TEST_ROOT + path for path in (
    "billing-vitest.config.ts", "billing-tests/api-price.test.ts", "billing-tests/checkout.test.ts",
    "billing-tests/entitlement.test.ts", "billing-tests/sales-catalog.test.ts", "billing-tests/store-provider.test.ts",
    "billing-tests/one-time-payment.test.ts", "billing-tests/webhook-payment.test.ts", "billing-tests/payment-postgres.test.ts",
    "billing-tests/referral-payment.test.ts",
    "billing-tests/fixtures.ts", "billing-tests/referral-store.fixture.ts",
))
MIN_FREE_BYTES, MEMORY_MIB, TOTAL_MEMORY_MIB = 8 * 1024**3, 1280, 1536
EXTERNAL_CRASHLOOP_ID = "91799af64ea846ab5d34eb06b6fe2d52427862363818bef201085032a93ff9dd"
EXTERNAL_CRASHLOOP_NAME = "/keycloak-ofkjsgfd5e6zy6h13sainlyf-20261030T162523"
EXTERNAL_CRASHLOOP_IMAGE = "sha256:09a381c715ab0b111835b70f2905955274843a219c6f27efb348e4d9f4086858"
EXTERNAL_CRASHLOOP_PROJECT = "ofkjsgfd5e6zy6h13sainlyf"
EXTERNAL_CRASHLOOP_MIN_RESTARTS = 8300
EPHEMERAL_ENDPOINT_FIELDS = frozenset(("EndpointID", "IPAddress", "IPPrefixLen", "Gateway", "MacAddress", "IPv6Gateway", "GlobalIPv6Address", "GlobalIPv6PrefixLen"))
EXTERNAL_RUNTIME_OBSERVATIONS = []


def configuration(service):
    if service == "api":
        return {"tag": API_TAG, "id": API_ID, "paths": API_PATHS, "new": API_NEW_PATHS, "dist": "apps/api/dist", "entry": "server.js"}
    if service == "worker":
        return {"tag": WORKER_TAG, "id": WORKER_ID, "paths": WORKER_PATHS, "new": (), "dist": "apps/worker/dist", "entry": "index.js"}
    raise GateError("backend_service_must_be_api_or_worker")


def target(service, revision):
    configuration(service)
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-" + service + ":packages-" + revision[:12] + "-20261101"


def snapshot_script(service):
    c = configuration(service)
    return ("const fs=require('node:fs');" + legacy.snapshot_function()
        + "const root='/app/';const paths=" + json.dumps(c["paths"]) + ";const sourceHashes={};for(const p of paths){const q=root+p;try{const s=fs.lstatSync(q);if(!s.isFile()||s.isSymbolicLink())throw Error('source_not_regular');sourceHashes[p]=crypto.createHash('sha256').update(fs.readFileSync(q)).digest('hex')}catch(e){if(e.code!=='ENOENT')throw e;sourceHashes[p]=null}}"
        + "const directory='/app/" + c["dist"] + "';const distEntries={};for(const name of fs.readdirSync(directory).sort()){const p=directory+'/'+name,s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())throw Error('dist_not_regular');const b=fs.readFileSync(p);distEntries[name]={bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')}}"
        + "console.log(JSON.stringify({sourceHashes,distEntries,dist:snapshot(directory),untouched:snapshot('/app'," + json.dumps((*c["paths"], c["dist"])) + ")}));")


def snapshot(image, service):
    return json.loads(command("docker", "run", "--rm", "--network", "none", "--memory", "512m", "--memory-swap", "640m", "--pids-limit", "128", "--read-only", "--entrypoint", "node", image, "-e", snapshot_script(service), timeout=180))


def validate_source_pin(value, service):
    c = configuration(service)
    if not isinstance(value, dict) or set(value) != {"sourceHashes", "distEntries", "dist", "untouched"}:
        raise GateError("independent_backend_source_pin_required")
    for key in ("dist", "untouched"):
        item = value[key]
        if not isinstance(item, dict) or set(item) != {"sha256", "files"} or not re.fullmatch(r"[0-9a-f]{64}", str(item["sha256"])) or type(item["files"]) is not int or item["files"] < 1:
            raise GateError("backend_source_fingerprint_invalid")
    if set(value["sourceHashes"]) != set(c["paths"]):
        raise GateError("backend_source_hash_scope_differs")
    for path, digest in value["sourceHashes"].items():
        if (path in c["new"] and digest is not None) or (path not in c["new"] and not re.fullmatch(r"[0-9a-f]{64}", str(digest))):
            raise GateError("backend_existing_or_new_source_pin_differs")
    if not isinstance(value["distEntries"], dict) or not value["distEntries"] or c["entry"] not in value["distEntries"]:
        raise GateError("backend_dist_pin_invalid")
    for name, entry in value["distEntries"].items():
        if not re.fullmatch(r"[A-Za-z0-9_-]+\.js", name) or not isinstance(entry, dict) or set(entry) != {"bytes", "sha256"} or type(entry["bytes"]) is not int or entry["bytes"] < 1 or not re.fullmatch(r"[0-9a-f]{64}", str(entry["sha256"])):
            raise GateError("backend_dist_entry_invalid")
    return value


def patch_server(original, description):
    if not isinstance(description, dict) or set(description) != {"path", "sourceSha256", "replacements"} or description["path"] != "apps/api/src/server.ts" or hashlib.sha256(original).hexdigest() != description["sourceSha256"]:
        raise GateError("backend_server_patch_source_differs")
    edits = description["replacements"]
    if not isinstance(edits, list) or len(edits) != SERVER_PATCH_COUNT:
        raise GateError("backend_server_reviewed_patch_count_required")
    replacements = []
    for item in edits:
        if not isinstance(item, dict) or set(item) != {"old", "new"}:
            raise GateError("backend_server_patch_shape_invalid")
        before, after = item["old"], item["new"]
        if not all(isinstance(x, str) and 1 <= len(x.encode()) <= 65536 and "\x00" not in x for x in (before, after)) or before == after or original.count(before.encode()) != 1:
            raise GateError("backend_server_patch_anchor_not_unique")
        start = original.index(before.encode())
        replacements.append((start, start + len(before.encode()), after.encode()))
    replacements.sort()
    if any(first[1] > second[0] for first, second in zip(replacements, replacements[1:])):
        raise GateError("backend_server_patch_anchors_overlap")
    updated = original
    for start, end, value in reversed(replacements):
        updated = updated[:start] + value + updated[end:]
    return updated


def updated_sources(repo, revision, service, pin):
    c = configuration(service)
    target(service, revision)
    for ref in (BASE_REVISION, revision):
        if command("git", "-C", str(repo), "rev-parse", ref + "^{commit}").decode().strip() != ref:
            raise GateError("backend_revision_not_exact")
    command("git", "-C", str(repo), "merge-base", "--is-ancestor", BASE_REVISION, revision)
    if service == "worker":
        changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision, "--", "apps/worker").decode().splitlines()
        if {p for p in changed if ".test." not in p} != set(WORKER_PATHS):
            raise GateError("worker_runtime_overlay_scope_differs")
    updates = {}
    for path in c["paths"]:
        original = None if path in c["new"] else helpers.image_file(c["id"], path)
        if original is not None and hashlib.sha256(original).hexdigest() != pin["sourceHashes"][path]:
            raise GateError("backend_existing_source_hash_differs:" + path)
        if path in c["new"]:
            previous = helpers.SOURCE_ID
            helpers.SOURCE_ID = c["id"]
            try:
                helpers.require_image_absent(path)
            finally:
                helpers.SOURCE_ID = previous
        if service == "api" and path.endswith("/server.ts"):
            helpers.require_regular_blob(repo, revision, API_PATCHES)
            updates[path] = patch_server(original, json.loads(core.git_file(repo, revision, API_PATCHES)))
            continue
        source = API_SOURCE_ROOT + Path(path).name if service == "api" else path
        helpers.require_regular_blob(repo, revision, source)
        updates[path] = core.git_file(repo, revision, source)
        if original == updates[path]:
            raise GateError("backend_overlay_unchanged:" + path)
        if service == "worker" and original != core.git_file(repo, BASE_REVISION, path):
            raise GateError("worker_actual_source_not_git_baseline")
    if service == "api":
        helpers.require_regular_blob(repo, revision, API_SOURCE_MANIFEST)
        manifest = json.loads(core.git_file(repo, revision, API_SOURCE_MANIFEST))
        if not isinstance(manifest, dict) or set(manifest) != {"runtimeSources", "patchesFile", "patchesSha256"} or manifest["patchesFile"] != API_PATCHES or manifest["patchesSha256"] != hashlib.sha256(core.git_file(repo, revision, API_PATCHES)).hexdigest():
            raise GateError("backend_reviewed_source_manifest_invalid")
        entries = manifest["runtimeSources"]
        if not isinstance(entries, list) or len(entries) != len(API_NAMES) or {entry.get("path") for entry in entries if isinstance(entry, dict)} != set(API_PATHS) - {"apps/api/src/server.ts"}:
            raise GateError("backend_reviewed_source_manifest_scope_differs")
        for entry in entries:
            path = entry["path"]
            if set(entry) != {"path", "source", "new", "sha256"} or entry["source"] != API_SOURCE_ROOT + Path(path).name or entry["new"] is not (path in API_NEW_PATHS) or entry["sha256"] != hashlib.sha256(updates[path]).hexdigest():
                raise GateError("backend_reviewed_source_manifest_entry_differs")
    return updates


def compile_script(service, expected_dist=None):
    c = configuration(service)
    script = legacy.cgroup() + 'cp.execFileSync("npm",["run","build","-w","@flixify/' + service + '"],{stdio:"inherit"});'
    if expected_dist is not None:
        script += legacy.snapshot_function() + "if(JSON.stringify(snapshot('/app/" + c["dist"] + "'))!==" + json.dumps(json.dumps(expected_dist, separators=(",", ":"))) + ")throw Error('baseline_source_dist_mismatch');"
    return script


def compile_checked(name, service, expected_dist=None):
    command("docker", "exec", name, "node", "-e", compile_script(service, expected_dist), timeout=360)


def compile_overlay(service, revision, base, updates, before, publish=True):
    c = configuration(service)
    if not base.get("Config", {}).get("Cmd") or base["Config"].get("Volumes") or set(updates) != set(c["paths"]):
        raise GateError("backend_compile_manifest_or_base_config_differs")
    name, created = "flixify-packages-" + service + "-build-" + uuid.uuid4().hex[:12], False
    try:
        command("docker", "create", "--name", name, "--network", "none", "--memory", "1280m", "--memory-swap", "1536m", "--pids-limit", "256", c["id"], "node", "-e", "setInterval(()=>{},2147483647)")
        created = True
        command("docker", "start", name)
        compile_checked(name, service, before["dist"])
        print("backend_actual_baseline_source_dist_verified:" + service)
        with tempfile.TemporaryDirectory(prefix="flixify-packages-backend-overlay-") as directory:
            for index, (path, value) in enumerate(updates.items()):
                source = Path(directory) / str(index)
                source.write_bytes(value)
                source.chmod(0o644)
                command("docker", "cp", str(source), name + ":/app/" + path)
        compile_checked(name, service)
        expected = json.loads(command("docker", "exec", name, "node", "-e", snapshot_script(service), timeout=180))
        if expected["untouched"] != before["untouched"] or set(expected["sourceHashes"]) != set(c["paths"]):
            raise GateError("backend_compile_changed_untouched_runtime")
        if any(expected["sourceHashes"][path] != hashlib.sha256(value).hexdigest() for path, value in updates.items()):
            raise GateError("backend_compiled_source_differs")
        if publish:
            command("docker", "commit", "--change", "CMD " + json.dumps(base["Config"]["Cmd"]), "--change", "LABEL org.opencontainers.image.revision=" + revision, "--change", "LABEL vip.flixify.edge-recovery.base=" + c["id"], name, target(service, revision), timeout=300)
        return expected
    finally:
        if created:
            command("docker", "rm", "--force", name)


def verify_candidate(service, revision, base, updates, before, expected):
    c = configuration(service)
    candidate = core.image(target(service, revision))
    labels = candidate.get("Config", {}).get("Labels") or {}
    layers = base.get("RootFS", {}).get("Layers") or []
    if candidate["Id"] == c["id"] or labels.get("org.opencontainers.image.revision") != revision or labels.get("vip.flixify.edge-recovery.base") != c["id"] or not layers or candidate.get("RootFS", {}).get("Layers", [])[:len(layers)] != layers:
        raise GateError("backend_candidate_identity_or_ancestry_differs")
    config = dict(base["Config"])
    config["Labels"] = dict(config.get("Labels") or {}) | {"org.opencontainers.image.revision": revision, "vip.flixify.edge-recovery.base": c["id"]}
    for key in ("Env", "Cmd", "Entrypoint", "WorkingDir", "User", "Healthcheck", "Volumes", "ExposedPorts", "StopSignal", "Shell", "Labels"):
        if candidate["Config"].get(key) != config.get(key):
            raise GateError("backend_candidate_config_differs:" + key)
    if snapshot(candidate["Id"], service) != expected or expected["untouched"] != before["untouched"]:
        raise GateError("backend_candidate_source_dist_or_untouched_tree_differs")
    for path, value in updates.items():
        if helpers.image_file(candidate["Id"], path) != value:
            raise GateError("backend_candidate_source_differs:" + path)
    command("docker", "run", "--rm", "--network", "none", "--memory", "512m", "--memory-swap", "640m", "--pids-limit", "128", "--read-only", "--entrypoint", "node", candidate["Id"], "--check", "/app/" + c["dist"] + "/" + c["entry"])
    return candidate["Id"]


def test_sources(repo, revision, service):
    if service == "api":
        paths = {path: path for path in API_TEST_FILES}
    else:
        paths = {"apps/worker/src/" + name: "apps/worker/src/" + name for name in ("provider-entitlement.test.ts", "provider-entitlement-store.test.ts", "provider-package.test.ts")}
    result = {}
    for source, destination in paths.items():
        helpers.require_regular_blob(repo, revision, source)
        value = core.git_file(repo, revision, source)
        if not 1 <= len(value) <= 1024 * 1024:
            raise GateError("backend_regression_file_size_invalid")
        result[destination] = value
    return result


def test_candidate(repo, revision, service, candidate):
    tests = test_sources(repo, revision, service)
    environment = dict(legacy.TEST_ENV)
    environment.update({"STRIPE_SECRET_KEY": "", "STRIPE_WEBHOOK_SECRET": "", "STRIPE_BILLING_ENABLED": "false", "TEST_DATABASE_URL": "", "PG_TEST_DATABASE_URL": "", "PACKAGE_CATALOG_TEST_DATABASE_URL": "", "PACKAGE_PAYMENT_TEST_DATABASE_URL": ""})
    with tempfile.TemporaryDirectory(prefix="flixify-packages-backend-regressions-") as directory:
        args = ["docker", "run", "--rm", "--network", "none", "--memory", "1280m", "--memory-swap", "1536m", "--pids-limit", "256"]
        for key, value in environment.items():
            args.extend(("-e", key + "=" + value))
        for index, (path, value) in enumerate(tests.items()):
            file = Path(directory) / str(index)
            file.write_bytes(value)
            args.extend(("-v", str(file) + ":/app/" + path + ":ro"))
        if service == "api":
            # Tests import the actual verified candidate source, not duplicate overlay files.
            setup = "for(const path of ['referral-policy.ts','time.ts','user-route-error.ts']){const s=fs.lstatSync('/app/apps/api/src/'+path);if(!s.isFile()||s.isSymbolicLink())throw Error('candidate_untouched_test_dependency_missing')}const alias='/app/" + API_TEST_ROOT + "api-source';if(fs.existsSync(alias)||fs.lstatSync('/app/" + API_TEST_ROOT.rstrip('/') + "').isSymbolicLink())throw Error('candidate_test_source_alias_exists');fs.symlinkSync('/app/apps/api/src',alias,'dir');"
            arguments = ["--no-install", "vitest", "run", "--root", "/app", "--config", "/app/" + API_TEST_ROOT + "billing-vitest.config.ts"]
        else:
            setup = ""
            arguments = ["--no-install", "vitest", "run", "--root", "/app", *tests]
        script = legacy.cgroup() + setup + 'cp.execFileSync("npx",' + json.dumps(arguments) + ',{stdio:"inherit"});'
        command(*args, "--entrypoint", "node", candidate, "-e", script, timeout=300)
    print("backend_candidate_regressions_passed:" + service + "; network_none; fixture_environment")


def host_container_identity(row):
    stable = {key: row.get(key) for key in ("Config", "HostConfig", "Mounts")}
    networks = (row.get("NetworkSettings") or {}).get("Networks")
    stable["Networks"] = networks
    result = {"name": row["Name"], "image": row["Image"], "startedAt": row["State"].get("StartedAt"), "running": row["State"]["Running"], "restarts": row["RestartCount"]}
    if row["Id"] == EXTERNAL_CRASHLOOP_ID or row["Name"] == EXTERNAL_CRASHLOOP_NAME:
        labels = (row.get("Config") or {}).get("Labels") or {}
        restarts = row.get("RestartCount")
        if (row["Id"] != EXTERNAL_CRASHLOOP_ID or row["Name"] != EXTERNAL_CRASHLOOP_NAME or row["Image"] != EXTERNAL_CRASHLOOP_IMAGE or
                labels.get("com.docker.compose.project") != EXTERNAL_CRASHLOOP_PROJECT or type(restarts) is not int or restarts < EXTERNAL_CRASHLOOP_MIN_RESTARTS or
                row["State"].get("OOMKilled") is not False or type(row["State"].get("Running")) is not bool):
            raise GateError("pinned_external_crashloop_identity_or_safety_drift")
        if not isinstance(networks, dict) or any(not isinstance(entry, dict) for entry in networks.values()) or not isinstance(stable["Mounts"], list):
            raise GateError("pinned_external_crashloop_configuration_shape_drift")
        # This already-failing external service may reconnect endpoints; its configured attachments remain protected.
        stable["Networks"] = {name: {key: value for key, value in entry.items() if key not in EPHEMERAL_ENDPOINT_FIELDS} for name, entry in networks.items()}
        stable["Mounts"] = sorted(stable["Mounts"], key=lambda value: json.dumps(value, sort_keys=True, separators=(",", ":")))
        for key in ("startedAt", "running", "restarts"):
            result.pop(key)
        dynamic = {name: {key: value for key, value in entry.items() if key in EPHEMERAL_ENDPOINT_FIELDS} for name, entry in networks.items()}
        EXTERNAL_RUNTIME_OBSERVATIONS.append({"containerId": row["Id"], "image": row["Image"], "startedAt": row["State"].get("StartedAt"), "running": row["State"]["Running"], "restarts": restarts, "oomKilled": False,
            "ephemeralNetworkSha256": hashlib.sha256(json.dumps(dynamic, sort_keys=True, separators=(",", ":")).encode()).hexdigest()})
        del EXTERNAL_RUNTIME_OBSERVATIONS[:-16]
    result["config"] = hashlib.sha256(json.dumps(stable, sort_keys=True).encode()).hexdigest()
    return result


def emit_runtime_observations():
    if EXTERNAL_RUNTIME_OBSERVATIONS:
        print("pinned_external_crashloop_runtime_observations:" + json.dumps(EXTERNAL_RUNTIME_OBSERVATIONS, sort_keys=True, separators=(",", ":")))


def host_snapshot():
    ids = command("docker", "ps", "--all", "--quiet", "--no-trunc").decode().splitlines()
    rows = json.loads(command("docker", "inspect", *ids)) if ids else []
    result = {}
    for row in rows:
        result[row["Id"]] = host_container_identity(row)
    if EXTERNAL_CRASHLOOP_ID not in result:
        raise GateError("pinned_external_crashloop_container_missing")
    service_dir = Path("/data/coolify/services") / core.UUID
    result["environment"] = hashlib.sha256((service_dir / ".env").read_bytes()).hexdigest()
    result["registrationFence"] = hashlib.sha256((service_dir / ".live-registration-rollout.json").read_bytes()).hexdigest()
    return result


def preflight(repo, revision, service, source_pin):
    c = configuration(service)
    pin = validate_source_pin(source_pin, service)
    base = core.image(c["id"])
    if base["Id"] != c["id"] or core.image(c["tag"])["Id"] != c["id"]:
        raise GateError("backend_source_image_drift")
    current = json.loads(command("docker", "inspect", service + "-" + core.UUID))[0]
    if current["Image"] != c["id"] or current["Config"]["Image"] != c["tag"] or not current["State"]["Running"]:
        raise GateError("backend_running_source_drift")
    if (current["Config"].get("Labels") or {}).get("com.docker.compose.project") != core.UUID:
        raise GateError("backend_source_project_drift")
    before = snapshot(c["id"], service)
    if before != pin:
        raise GateError("independently_measured_backend_pin_differs")
    return base, updated_sources(repo, revision, service, before), before, host_snapshot()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--service", choices=("api", "worker"), required=True)
    parser.add_argument("--source-pin", required=True, type=Path)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--build", action="store_true")
    actions.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    base, updates, before, protected = preflight(args.source_repo, args.revision, args.service, json.loads(args.source_pin.read_bytes()))
    if not (args.build or args.verify_existing):
        emit_runtime_observations()
        print("backend_preflight_ok; no_mutation; independently_pinned_actual_source")
        return
    if shutil.disk_usage("/var/lib/docker").free < MIN_FREE_BYTES:
        raise GateError("backend_build_requires_8GiB")
    if args.build and target(args.service, args.revision) in command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.service, args.revision)).decode().splitlines():
        raise GateError("backend_candidate_tag_exists_use_verify_existing")
    expected = compile_overlay(args.service, args.revision, base, updates, before, publish=args.build)
    candidate = verify_candidate(args.service, args.revision, base, updates, before, expected)
    test_candidate(args.source_repo, args.revision, args.service, candidate)
    after = host_snapshot()
    emit_runtime_observations()
    if after != protected:
        raise GateError("backend_build_changed_existing_host_or_service_environment")
    print("backend_candidate_verified:" + candidate)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
