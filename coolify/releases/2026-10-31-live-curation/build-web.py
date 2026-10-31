#!/usr/bin/env python3
"""Guarded live-channel projection and APK 1.4.4 publication; preflight by default."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import sys
import uuid
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reviewed = load("curation_reviewed_publication", Path(__file__).parents[1] / "2026-10-31-search-activation" / "build-web.py")
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = "flixify-ops-web:home-artwork-d127d5955a26-20261031"
SOURCE_ID = "sha256:943cae7289b064d791b782c0d884f31b3e36c61febc7ca1097cde04efbf777d6"
BASE_REVISION = "d127d5955a26bb3ed345ac2d75b3870e6858f619"
API_TAG, API_ID = reviewed.API_TAG, reviewed.API_ID
WORKER_TAG, WORKER_ID, DB_ID = reviewed.WORKER_TAG, reviewed.WORKER_ID, reviewed.DB_ID
DESCRIPTOR = "apps/ops-web/app/platform/tv-download.ts"
APK = "apps/ops-web/public/downloads/flixify-pro-1.4.4.apk"
APK_URL = "https://flixify.vip/downloads/flixify-pro-1.4.4.apk"
BASELINE_APK = "apps/ops-web/public/downloads/flixify-pro-1.4.3.apk"
BASELINE_APK_SHA256 = "6b60219f5cc91d1d229998e3e42a1a8d5f77c0416768baef22018995ffedf5bb"
BASELINE_APK_BYTES = 1347386
BASELINE_MANIFEST_BYTES = 382
BASELINE_MANIFEST_SHA256 = "85f9bb13d8ed0d9caeca1a003cd5b7aa6b0830c2555ed24d629a5dd39f54ceee"
SIGNER_SHA256 = "158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594"
UPDATE_MANIFEST, GRADLE, ANDROID_MANIFEST = reviewed.UPDATE_MANIFEST, reviewed.GRADLE, reviewed.ANDROID_MANIFEST
MAX_APK_BYTES = reviewed.MAX_APK_BYTES
RUNTIME_ALLOWLIST = frozenset((
    "packages/contracts/src/index.ts",
    "packages/contracts/src/live-catalog-curation.ts",
    *("apps/ops-web/app/platform/" + name for name in (
        "types.ts", "personal-integration.ts", "personal-provider.ts", "session.tsx",
        "live-channel-presentation.ts", "legacy-live-catalog.ts", "live-favorites.ts", "catalog.tsx", "tv-download.ts",
    )),
    "apps/ops-web/app/canli-tv/page.tsx",
    "apps/ops-web/app/canli-tv/live-channel-catalog.ts",
    "apps/ops-web/app/canli-tv/live-recent.ts",
    "apps/ops-web/app/canli-tv/personal-live.ts",
))
NEW_PATHS = ("packages/contracts/src/live-catalog-curation.ts", "apps/ops-web/app/platform/legacy-live-catalog.ts", "apps/ops-web/app/platform/live-favorites.ts", "apps/ops-web/app/platform/live-channel-presentation.ts")
PATHS = ()
EXCLUDED = ()
TOOLS = frozenset("coolify/releases/2026-10-31-live-curation/" + name for name in ("build-web.py", "release-web.py", "verify-android.py", "test-web.py", "README.md"))


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:live-curation-" + revision[:12] + "-20261031"


for module in (reviewed, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION, module.target = SOURCE_TAG, SOURCE_ID, BASE_REVISION, target
reviewed.APK, reviewed.APK_URL = APK, APK_URL
reviewed.BASELINE_MANIFEST_BYTES, reviewed.BASELINE_MANIFEST_SHA256 = BASELINE_MANIFEST_BYTES, BASELINE_MANIFEST_SHA256
protected_snapshot = reviewed.protected_snapshot
public_manifest, canonical_public_manifest = reviewed.public_manifest, reviewed.canonical_public_manifest
validate_source_fingerprint, require_untouched = reviewed.validate_source_fingerprint, reviewed.require_untouched
container_compile = reviewed.container_compile
REVIEWED_DOWNLOAD_SCRIPT = reviewed.download_verification_script


def unique_json(data, error):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise GateError(error)
            result[key] = value
        return result
    try:
        return json.loads(data.decode("utf8"), object_pairs_hook=unique)
    except (ValueError, UnicodeError, AttributeError):
        raise GateError(error) from None


def parse_runtime_paths(data):
    paths = unique_json(data, "reviewed_runtime_paths_invalid")
    if (not isinstance(paths, list) or not paths or any(not isinstance(path, str) or path not in RUNTIME_ALLOWLIST for path in paths)
            or len(set(paths)) != len(paths) or DESCRIPTOR not in paths):
        raise GateError("reviewed_runtime_paths_invalid")
    return tuple(sorted(paths))


def configure_paths(paths):
    global PATHS, EXCLUDED
    PATHS = parse_runtime_paths(json.dumps(list(paths)).encode())
    EXCLUDED = (*PATHS, APK, UPDATE_MANIFEST, "apps/ops-web/.next")
    reviewed.PATHS, reviewed.EXCLUDED = PATHS, EXCLUDED
    builder.PATHS, builder.NEW_PATHS = PATHS, tuple(path for path in NEW_PATHS if path in PATHS)


def test_or_support(path):
    return (path in TOOLS or (path.startswith("docs/") and path.endswith(".md"))
            or bool(re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path))
            or bool(re.fullmatch(r"packages/contracts/src/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path))
            or bool(re.fullmatch(r"packages/contracts/test-fixtures/[A-Za-z0-9_./-]+\.json", path)))


def validate_source_scope(repo, revision, native, native_tree, paths):
    configure_paths(paths)
    target(native_tree)
    for exact in (BASE_REVISION, native, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("curation_revision_not_exact")
    for first, last in ((BASE_REVISION, native), (native, revision)):
        command("git", "-C", str(repo), "merge-base", "--is-ancestor", first, last)
    for exact in (native, revision):
        if command("git", "-C", str(repo), "rev-parse", exact + ":apps/tv-android").decode().strip() != native_tree:
            raise GateError("native_tree_differs_from_independent_freeze")
    changed = command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", BASE_REVISION, revision).decode().splitlines()
    runtime = set()
    for path in changed:
        if path in PATHS or path in (APK, UPDATE_MANIFEST):
            runtime.add(path)
        elif path.startswith("apps/tv-android/") or test_or_support(path):
            builder.require_regular_blob(repo, revision, path)
        else:
            raise GateError("curation_change_outside_reviewed_scope:" + path)
    if runtime != {*PATHS, APK, UPDATE_MANIFEST}:
        raise GateError("curation_runtime_overlay_scope_differs")
    for path in PATHS:
        builder.require_regular_blob(repo, revision, path)
        if path in NEW_PATHS and builder.git_entry(repo, BASE_REVISION, path):
            raise GateError("curation_new_source_exists_in_baseline:" + path)
    published = set(command("git", "-C", str(repo), "diff", "--name-only", native, revision, "--", "apps/ops-web").decode().splitlines())
    if not {DESCRIPTOR, APK, UPDATE_MANIFEST} <= published:
        raise GateError("curation_publication_missing_after_native_freeze")


def validate_versions(repo, revision, native):
    target(revision)
    target(native)
    original = core.git_file(repo, BASE_REVISION, DESCRIPTOR)
    if original.count(b"flixify-pro-1.4.3.apk") != 2 or original.count(b'"1.4.3"') != 1:
        raise GateError("curation_descriptor_baseline_differs")
    if core.git_file(repo, revision, DESCRIPTOR) != original.replace(b"1.4.3", b"1.4.4"):
        raise GateError("curation_descriptor_outside_version_replacement")
    gradle = core.git_file(repo, native, GRADLE)
    for pattern in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]", rb"(?m)^\s*minSdk\s+23\s*$", rb"(?m)^\s*targetSdk\s+35\s*$", rb"(?m)^\s*versionCode\s+12\s*$", rb"(?m)^\s*versionName\s+['\"]1\.4\.4['\"]\s*$"):
        if len(re.findall(pattern, gradle)) != 1:
            raise GateError("curation_native_version_differs")
    if core.git_file(repo, native, ANDROID_MANIFEST).count(b'android:label="Flixify Pro"') != 1:
        raise GateError("curation_native_label_differs")


def parse_manifest(data, sha256, size):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 64 * 1024:
        raise GateError("curation_update_manifest_size_invalid")
    value = unique_json(data, "curation_update_manifest_invalid")
    expected = {"packageName": "vip.flixify.tv", "versionName": "1.4.4", "versionCode": 12, "minSdk": 23, "apkUrl": APK_URL, "sha256": sha256, "sizeBytes": size}
    if (not isinstance(value, dict) or set(value) != set(expected) | {"notes"}
            or any(value[key] != item or type(value[key]) is not type(item) for key, item in expected.items())):
        raise GateError("curation_update_manifest_pin_differs")
    notes = value["notes"]
    if not isinstance(notes, str) or sum(2 if ord(ch) > 0xffff else 1 for ch in notes) > 2048 or re.search(r"[\x00-\x09\x0b-\x1f\x7f-\x9f]", notes):
        raise GateError("curation_update_manifest_notes_invalid")
    return value


def validate_independent_pins(source_sha256, source_files, sha256, size, proof_sha256):
    source_pin = validate_source_fingerprint(source_sha256, source_files)
    if (not isinstance(sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", sha256)
            or type(size) is not int or not 1024 <= size <= MAX_APK_BYTES
            or not isinstance(proof_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", proof_sha256)):
        raise GateError("independent_apk_and_proof_pins_required")
    return source_pin


def validate_apk_proof(data, native, native_tree, sha256, size):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 16 * 1024:
        raise GateError("independent_apk_proof_invalid")
    value = unique_json(data, "independent_apk_proof_invalid")
    expected = {"schema": 1, "nativeRevision": native, "nativeTree": native_tree, "packageName": "vip.flixify.tv", "versionName": "1.4.4", "versionCode": 12, "minSdk": 23, "targetSdk": 35, "sha256": sha256, "sizeBytes": size, "certificateSha256": SIGNER_SHA256, "baselineApkSha256": BASELINE_APK_SHA256, "baselineApkSizeBytes": BASELINE_APK_BYTES, "signatureSchemes": ["v1", "v2"], "releaseDebuggable": False}
    if (not isinstance(value, dict) or set(value) != set(expected)
            or any(value[key] != item or type(value[key]) is not type(item) for key, item in expected.items())):
        raise GateError("independent_apk_proof_differs")
    return value


def validate_artifacts(repo, revision, sha256, size):
    reviewed.BASELINE_MANIFEST_BYTES, reviewed.BASELINE_MANIFEST_SHA256 = BASELINE_MANIFEST_BYTES, BASELINE_MANIFEST_SHA256
    reviewed.regular_public_blob(repo, BASE_REVISION, BASELINE_APK)
    previous = core.git_file(repo, BASE_REVISION, BASELINE_APK)
    if len(previous) != BASELINE_APK_BYTES or hashlib.sha256(previous).hexdigest() != BASELINE_APK_SHA256:
        raise GateError("curation_previous_apk_baseline_differs")
    if core.git_file(repo, revision, BASELINE_APK) != previous:
        raise GateError("curation_previous_apk_changed")
    old_base = reviewed.BASE_REVISION
    try:
        reviewed.BASE_REVISION = BASE_REVISION
        return reviewed.validate_artifacts(repo, revision, sha256, size)
    finally:
        reviewed.BASE_REVISION = old_base


def expected_public_manifest(original, sha256, size, manifest):
    entries = {row[1]: row for row in json.loads(canonical_public_manifest(original))}
    old = BASELINE_APK.removeprefix("apps/ops-web/public/")
    if entries.get(old) != ["file", old, 0o644, BASELINE_APK_BYTES, BASELINE_APK_SHA256]:
        raise GateError("curation_previous_apk_image_differs")
    reviewed.BASELINE_MANIFEST_BYTES, reviewed.BASELINE_MANIFEST_SHA256 = BASELINE_MANIFEST_BYTES, BASELINE_MANIFEST_SHA256
    return reviewed.expected_public_manifest(original, sha256, size, manifest)


reviewed.parse_manifest = parse_manifest


def snapshot_script():
    if not PATHS:
        raise GateError("reviewed_runtime_paths_required")
    return reviewed.snapshot_script()


def untouched(image):
    return json.loads(command("docker", "run", "--rm", "--network", "none", "--memory", "512m", "--memory-swap", "640m", "--pids-limit", "128", "--entrypoint", "node", image, "-e", snapshot_script(), timeout=180))


def source_preflight(repo, revision):
    base = core.image(SOURCE_ID)
    if base["Id"] != SOURCE_ID or core.image(SOURCE_TAG)["Id"] != SOURCE_ID:
        raise GateError("web_base_image_drift")
    current = json.loads(command("docker", "inspect", "ops-web-" + core.UUID))[0]
    if current["Image"] != SOURCE_ID or current["Config"]["Image"] != SOURCE_TAG or not current["State"]["Running"]:
        raise GateError("web_running_image_drift")
    if (current["Config"].get("Labels") or {}).get("com.docker.compose.project") != core.UUID:
        raise GateError("web_project_drift")
    updated = {}
    for path in PATHS:
        if path in NEW_PATHS:
            for ancestor in Path(path).parents:
                if str(ancestor) == ".":
                    continue
                entry = builder.git_entry(repo, BASE_REVISION, str(ancestor))
                if entry and not entry.startswith(b"040000 tree "):
                    raise GateError("curation_new_source_ancestor_not_tree")
            builder.require_image_absent(path)
        else:
            original = core.git_file(repo, BASE_REVISION, path)
            if builder.image_file(SOURCE_ID, path) != original:
                raise GateError("web_base_source_differs:" + path)
        updated[path] = core.git_file(repo, revision, path)
    config = builder.image_file(SOURCE_ID, builder.CONFIG)
    if (config != core.git_file(repo, BASE_REVISION, builder.CONFIG) or config.decode().count(builder.ANCHOR) != 1
            or "webpack" in config.decode() or "experimental" in config.decode()):
        raise GateError("web_next_config_not_reviewed_pure_object")
    env = dict(entry.split("=", 1) for entry in current["Config"].get("Env", []) if "=" in entry)
    if any(key not in env for key in builder.PUBLIC_WEB_KEYS):
        raise GateError("public_web_build_setting_missing")
    return base, updated, {key: env[key] for key in builder.PUBLIC_WEB_KEYS}, config


def preflight(repo, revision, native, native_tree, paths, sha256, size, proof, proof_sha256, api_tag, api_id, source_sha256, source_files):
    source_pin = validate_independent_pins(source_sha256, source_files, sha256, size, proof_sha256)
    if not isinstance(proof, bytes) or hashlib.sha256(proof).hexdigest() != proof_sha256:
        raise GateError("independent_apk_proof_digest_differs")
    validate_apk_proof(proof, native, native_tree, sha256, size)
    validate_source_scope(repo, revision, native, native_tree, paths)
    validate_versions(repo, revision, native)
    protected = protected_snapshot(api_tag, api_id)
    artifacts = validate_artifacts(repo, revision, sha256, size)
    base, updated, web_env, config = source_preflight(repo, revision)
    updated.update(artifacts)
    before = untouched(SOURCE_ID)
    require_untouched(source_pin, before)
    original_public = public_manifest(SOURCE_ID)
    expected_public_manifest(original_public, sha256, size, artifacts[UPDATE_MANIFEST])
    if protected_snapshot(api_tag, api_id) != protected:
        raise GateError("curation_preflight_service_or_environment_drift")
    return base, updated, web_env, config, original_public, before, protected


def download_verification_script(sha256, size, manifest):
    script = REVIEWED_DOWNLOAD_SCRIPT(sha256, size, manifest)
    if script.count("flixify-pro-1.4.3.apk") != 1 or script.count('j.versionName!=="1.4.3"||j.versionCode!==11') != 1:
        raise GateError("reviewed_download_verifier_contract_differs")
    return script.replace("flixify-pro-1.4.3.apk", "flixify-pro-1.4.4.apk").replace('j.versionName!=="1.4.3"||j.versionCode!==11', 'j.versionName!=="1.4.4"||j.versionCode!==12')


def verify_download(candidate, sha256, size, manifest):
    name = "flixify-curation-download-check-" + uuid.uuid4().hex[:12]
    created = False
    try:
        owned = command("docker", "create", "--name", name, "--network", "none", "--memory", "512m", "--memory-swap", "640m", "--pids-limit", "128", candidate).decode().strip()
        created = True
        if not re.fullmatch(r"[0-9a-f]{64}", owned):
            raise GateError("curation_download_check_container_id_invalid")
        if command("docker", "inspect", "--format", "{{.Image}}", owned).decode().strip() != candidate:
            raise GateError("curation_download_check_container_drift")
        command("docker", "start", owned)
        command("docker", "exec", owned, "node", "-e", download_verification_script(sha256, size, manifest), timeout=100)
    finally:
        if created:
            command("docker", "rm", "--force", name)


def verify_candidate(base, revision, updated, web_env, config, original_public, before, sha256, size):
    candidate = builder.verify_candidate(base, revision, updated, web_env, config)
    require_untouched(before, untouched(candidate))
    if canonical_public_manifest(public_manifest(candidate)) != expected_public_manifest(original_public, sha256, size, updated[UPDATE_MANIFEST]):
        raise GateError("curation_candidate_public_tree_differs")
    verify_download(candidate, sha256, size, updated[UPDATE_MANIFEST])
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    for name in ("revision", "native-revision", "native-tree", "apk-sha256", "apk-proof-sha256", "protected-api-tag", "protected-api-id", "source-untouched-sha256"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--runtime-paths-file", type=Path, required=True)
    parser.add_argument("--apk-proof-file", type=Path, required=True)
    parser.add_argument("--apk-bytes", type=int, required=True)
    parser.add_argument("--source-untouched-files", type=int, required=True)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    paths = parse_runtime_paths(args.runtime_paths_file.read_bytes())
    result = preflight(args.source_repo, args.revision, args.native_revision, args.native_tree, paths, args.apk_sha256, args.apk_bytes, args.apk_proof_file.read_bytes(), args.apk_proof_sha256, args.protected_api_tag, args.protected_api_id, args.source_untouched_sha256, args.source_untouched_files)
    base, updated, web_env, config, public, before, protected = result
    if not (args.build or args.verify_existing):
        print("live_curation_preflight_ok; no_mutation; independent_source_native_and_apk_pins_verified")
        return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("curation_build_requires_8GiB")
        if target(args.revision) in command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines():
            raise GateError("curation_candidate_tag_exists_use_verify_existing")
        container_compile(args.revision, base, updated, web_env)
    candidate = verify_candidate(base, args.revision, updated, web_env, config, public, before, args.apk_sha256, args.apk_bytes)
    if protected_snapshot(args.protected_api_tag, args.protected_api_id) != protected:
        raise GateError("curation_build_changed_protected_service_or_environment")
    print("web_candidate_verified:" + candidate)


if __name__ == "__main__":
    try:
        main()
    except GateError as error:
        print("build_stopped:" + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print("build_stopped:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
