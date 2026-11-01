#!/usr/bin/env python3
"""Add one explicitly unnotarized Mac test download over the current website."""
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


HERE = Path(__file__).parent
reviewed = load("mac_download_reviewed_web", HERE.parent / "2026-10-31-home-2026" / "build-web.py")
backend = load("mac_download_host_snapshot", HERE.parent / "2026-11-01-welcome-offer" / "build-backend.py")
publication = reviewed.reviewed
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = "flixify-ops-web:tv-front-parity-7ceb5becb006-20261101"
SOURCE_ID = "sha256:9bd0bd2ad50aef4faec981fbffb4ba6e4d121004d3f6a9dab71b740eee904db4"
BASE_REVISION = "7ceb5becb0060e5d768c24ae2aeb99f9cb9fb981"
MAC_REVISION = "0e00365010566c5291153dcff7cdc451dc7adbd5"
MAC_TREE = "5f3078b1c58a64e01d2596ff462cc43d83345fdd"
API_TAG = "flixify-api:welcome-offer-a052006305ed-20261101"
API_ID = "sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496"
WORKER_TAG = "flixify-worker:packages-8fa66d103053-20261101"
WORKER_ID = "sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57"
DB_ID = "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
PATHS = tuple("apps/ops-web/app/" + name for name in (
    "platform/shell.tsx", "platform/landing.tsx", "platform/icons.tsx",
    "platform/platform.module.css", "platform/landing.module.css",
    "indir/page.tsx", "indir/page.module.css", "platform/mac-download.ts",
))
NEW_PATHS = (PATHS[-1],)
DMG = "apps/ops-web/public/downloads/flixify-pro-macos-1.0.0-build2-test.dmg"
DMG_URL = "https://flixify.vip/downloads/flixify-pro-macos-1.0.0-build2-test.dmg"
DMG_SHA256 = "ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d"
DMG_BYTES = 44517156
TV_MANIFEST = "apps/ops-web/public/downloads/flixify-tv-update.json"
TV_MANIFEST_SHA256 = "f439fd197839cbc3773dacc226801718c8688a3c438467f74ac87d619a838680"
TV_MANIFEST_BYTES = 462
EXCLUDED = (*PATHS, DMG, "apps/ops-web/.next")
DESCRIPTOR = PATHS[-1]


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:macos-test-download-" + revision[:12] + "-20261101"


for module in (reviewed, publication, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION, module.target = SOURCE_TAG, SOURCE_ID, BASE_REVISION, target
    module.PATHS, module.NEW_PATHS = PATHS, NEW_PATHS
for module in (reviewed, publication):
    module.API_TAG, module.API_ID, module.WORKER_TAG, module.WORKER_ID, module.DB_ID = API_TAG, API_ID, WORKER_TAG, WORKER_ID, DB_ID
    module.EXCLUDED = EXCLUDED
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched
public_manifest, canonical_public_manifest = reviewed.public_manifest, reviewed.canonical_public_manifest
container_compile = reviewed.container_compile


def validate_source_scope(repo, revision):
    for exact in (BASE_REVISION, MAC_REVISION, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("mac_download_revision_not_exact")
    for first, last in ((BASE_REVISION, MAC_REVISION), (MAC_REVISION, revision)):
        command("git", "-C", str(repo), "merge-base", "--is-ancestor", first, last)
    for exact in (MAC_REVISION, revision):
        if command("git", "-C", str(repo), "rev-parse", exact + ":apps/macos-native").decode().strip() != MAC_TREE:
            raise GateError("mac_download_native_freeze_changed")
    for tree in ("apps/api", "apps/tv-android", "packages"):
        if command("git", "-C", str(repo), "rev-parse", BASE_REVISION + ":" + tree) != command("git", "-C", str(repo), "rev-parse", revision + ":" + tree):
            raise GateError("mac_download_protected_source_tree_changed:" + tree)
    changed = command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", BASE_REVISION, revision, "--", "apps/ops-web").decode().splitlines()
    runtime = set()
    for path in changed:
        if re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path):
            builder.require_regular_blob(repo, revision, path)
        else:
            runtime.add(path)
    if runtime != {*PATHS, DMG}:
        raise GateError("mac_download_exact_web_scope_required")


def regular_public_blob(repo, revision, path):
    entry = builder.git_entry(repo, revision, path)
    if not re.fullmatch(rb"100644 blob [0-9a-f]{40}\t" + re.escape(path.encode()) + rb"\x00", entry):
        raise GateError("mac_download_regular_public_blob_required")


def validate_descriptor(data):
    expected = {
        "href": DMG_URL.removeprefix("https://flixify.vip"),
        "filename": Path(DMG).name, "sha256": DMG_SHA256,
        "pageHref": "/indir#macos", "status": "Test sürümü",
        "version": "1.0.0 · Build 2", "minimumMacOS": "macOS 13 ve üzeri",
        "architecture": "Intel ve Apple Silicon", "size": "44,5 MB",
        "notice": "Apple doğrulaması henüz tamamlanmadı. macOS, kurulumda geliştirici doğrulama uyarısı gösterebilir.",
    }
    # Parse the small static descriptor without evaluating JavaScript or allowing computed values.
    text = data.decode("utf-8")
    if not text.startswith("export const macDownload = {\n") or not text.endswith("} as const;\n"):
        raise GateError("mac_download_static_descriptor_required")
    pairs = {}
    for line in text.splitlines()[1:-1]:
        match = re.fullmatch(r"  ([A-Za-z][A-Za-z0-9]*): (.+),", line)
        if not match or match[1] in pairs:
            raise GateError("mac_download_descriptor_shape_invalid")
        raw = match[2]
        if re.fullmatch(r"[0-9]+(?:_[0-9]+)*", raw):
            value = int(raw.replace("_", ""))
        else:
            try:
                value = json.loads(raw)
            except ValueError:
                raise GateError("mac_download_descriptor_literal_required") from None
        pairs[match[1]] = value
    expected.update(sizeBytes=DMG_BYTES, notarized=False)
    if pairs != expected or any(type(pairs[key]) is not type(value) for key, value in expected.items()):
        raise GateError("mac_download_test_descriptor_pins_differ")


def validate_artifact(repo, revision):
    changes = command("git", "-C", str(repo), "diff", "--no-renames", "--name-status", BASE_REVISION, revision, "--", "apps/ops-web/public").decode().splitlines()
    if changes != ["A\t" + DMG] or builder.git_entry(repo, BASE_REVISION, DMG):
        raise GateError("mac_download_only_new_dmg_public_delta_required")
    regular_public_blob(repo, revision, DMG)
    if command("git", "-C", str(repo), "cat-file", "-s", revision + ":" + DMG).decode().strip() != str(DMG_BYTES):
        raise GateError("mac_download_exact_size_required")
    for ancestor in Path(DMG).parents:
        if str(ancestor) == ".":
            continue
        entry = builder.git_entry(repo, BASE_REVISION, str(ancestor))
        if entry and not entry.startswith(b"040000 tree "):
            raise GateError("mac_download_ancestor_not_tree")
    builder.require_image_absent(DMG)
    data = core.git_file(repo, revision, DMG)
    if len(data) != DMG_BYTES or hashlib.sha256(data).hexdigest() != DMG_SHA256 or data[-512:-508] != b"koly":
        raise GateError("mac_download_verified_dmg_bytes_required")
    return data


def expected_public_manifest(original):
    rows = json.loads(canonical_public_manifest(original))
    entries = {row[1]: row for row in rows}
    relative = DMG.removeprefix("apps/ops-web/public/")
    if relative in entries or entries.get("downloads", [None])[0] != "dir":
        raise GateError("mac_download_public_destination_must_be_absent")
    tv = TV_MANIFEST.removeprefix("apps/ops-web/public/")
    if entries.get(tv) != ["file", tv, 0o644, TV_MANIFEST_BYTES, TV_MANIFEST_SHA256]:
        raise GateError("mac_download_current_tv_manifest_differs")
    rows.append(["file", relative, 0o644, DMG_BYTES, DMG_SHA256])
    return canonical_public_manifest(json.dumps(rows).encode())


def protected_snapshot():
    services = publication.protected_snapshot(API_TAG, API_ID)
    try:
        return {"services": services, "host": backend.host_snapshot()}
    except backend.GateError as error:
        raise GateError(str(error)) from None


def preflight(repo, revision, source_sha256, source_files):
    source_pin = reviewed.validate_source_fingerprint(source_sha256, source_files)
    protected = protected_snapshot()
    validate_source_scope(repo, revision)
    data = validate_artifact(repo, revision)
    validate_descriptor(core.git_file(repo, revision, DESCRIPTOR))
    base, updated, web_env, config = builder.preflight(repo, revision)
    updated[DMG] = data
    before = untouched(SOURCE_ID)
    reviewed.require_untouched(source_pin, before)
    public = public_manifest(SOURCE_ID)
    expected_public_manifest(public)
    if protected_snapshot() != protected:
        raise GateError("mac_download_preflight_protected_state_changed")
    return base, updated, web_env, config, public, before, protected


def download_verification_script():
    return ('const crypto=require("node:crypto");(async()=>{const u=' + json.dumps("http://127.0.0.1:3000" + DMG_URL.removeprefix("https://flixify.vip")) + ';let h;'
        'for(let n=0;n<40;n++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.status===200)break}catch{}await new Promise(r=>setTimeout(r,250))}'
        'const mime=h?.headers.get("content-type")?.split(";")[0];'
        'if(!h||h.status!==200||Number(h.headers.get("content-length"))!==' + str(DMG_BYTES) + '||!["application/x-apple-diskimage","application/octet-stream"].includes(mime))throw Error("dmg_head_invalid");'
        'const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});'
        'if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/' + str(DMG_BYTES) + '"||(await r.arrayBuffer()).byteLength!==32)throw Error("dmg_range_invalid");'
        'const full=await fetch(u,{signal:AbortSignal.timeout(30000)});if(full.status!==200)throw Error("dmg_get_invalid");const data=Buffer.from(await full.arrayBuffer());'
        'if(data.length!==' + str(DMG_BYTES) + '||crypto.createHash("sha256").update(data).digest("hex")!==' + json.dumps(DMG_SHA256) + '||data.subarray(data.length-512,data.length-508).toString()!=="koly")throw Error("dmg_digest_invalid");'
        'const tv=await fetch("http://127.0.0.1:3000/downloads/flixify-tv-update.json",{signal:AbortSignal.timeout(10000)});const bytes=Buffer.from(await tv.arrayBuffer());'
        'if(tv.status!==200||bytes.length!==' + str(TV_MANIFEST_BYTES) + '||crypto.createHash("sha256").update(bytes).digest("hex")!==' + json.dumps(TV_MANIFEST_SHA256) + ')throw Error("tv_manifest_changed");'
        'for(const path of ["/","/indir","/paketler"]){const p=await fetch("http://127.0.0.1:3000"+path,{redirect:"manual",signal:AbortSignal.timeout(10000)});if(p.status!==200)throw Error("page_status_invalid")}'
        'console.log("candidate_mac_test_download_and_retained_tv_manifest_verified")})().catch(()=>{console.error("candidate_mac_download_contract_failed");process.exit(1)})')


def verify_download(candidate):
    name = "flixify-mac-test-check-" + uuid.uuid4().hex[:12]
    owned = command("docker", "create", "--name", name, "--network", "none", "--memory", "512m", "--memory-swap", "640m", "--pids-limit", "128", candidate).decode().strip()
    if not re.fullmatch(r"[0-9a-f]{64}", owned):
        raise GateError("mac_download_check_container_id_invalid")
    try:
        command("docker", "start", owned)
        if command("docker", "inspect", "--format", "{{.Image}}", owned).decode().strip() != candidate:
            raise GateError("mac_download_check_container_drift")
        command("docker", "exec", owned, "node", "-e", download_verification_script(), timeout=120)
    finally:
        command("docker", "rm", "--force", owned)


def verify_candidate(result, revision):
    base, updated, web_env, config, public, before, _ = result
    candidate = builder.verify_candidate(base, revision, updated, web_env, config)
    reviewed.require_untouched(before, untouched(candidate))
    if canonical_public_manifest(public_manifest(candidate)) != expected_public_manifest(public):
        raise GateError("mac_download_candidate_public_tree_differs")
    verify_download(candidate)
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path, nargs="?")
    parser.add_argument("--revision")
    parser.add_argument("--source-untouched-sha256")
    parser.add_argument("--source-untouched-files", type=int)
    actions = parser.add_mutually_exclusive_group()
    for name in ("measure", "build", "verify-existing"):
        actions.add_argument("--" + name, action="store_true")
    args = parser.parse_args()
    if args.measure:
        before = protected_snapshot()
        measured = untouched(SOURCE_ID)
        public = public_manifest(SOURCE_ID)
        expected_public_manifest(public)
        if protected_snapshot() != before:
            raise GateError("mac_download_measurement_drift")
        print(json.dumps({"sourceImage": SOURCE_ID, **measured, "publicSha256": hashlib.sha256(canonical_public_manifest(public)).hexdigest(), "protected": before}, sort_keys=True))
        return
    if args.source_repo is None or args.revision is None:
        raise GateError("mac_download_repo_and_exact_revision_required")
    result = preflight(args.source_repo, args.revision, args.source_untouched_sha256, args.source_untouched_files)
    if not (args.build or args.verify_existing):
        print("mac_download_web_preflight_ok; no_mutation")
        return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("mac_download_web_build_requires_8GiB")
        if target(args.revision) in command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines():
            raise GateError("mac_download_candidate_exists_use_verify_existing")
        container_compile(args.revision, result[0], result[1], result[2])
    candidate = verify_candidate(result, args.revision)
    if protected_snapshot() != result[-1]:
        raise GateError("mac_download_build_changed_protected_state")
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
