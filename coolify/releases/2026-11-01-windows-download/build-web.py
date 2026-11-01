#!/usr/bin/env python3
"""Add one explicitly unsigned Windows test download over the current website."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import sys
import subprocess
import uuid
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
reviewed = load("windows_download_reviewed_web", HERE.parent / "2026-10-31-home-2026" / "build-web.py")
backend = load("windows_download_host_snapshot", HERE.parent / "2026-11-01-welcome-offer" / "build-backend.py")
publication = reviewed.reviewed
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = "flixify-ops-web:macos-test-download-850032567861-20261101"
SOURCE_ID = "sha256:52fc1c2081385e3c61f4b4f5807ef8b32881531b6670e663b989d30d66e6a136"
BASE_REVISION = "85003256786115509bfd95c7ff659a03cb0d379a"
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
    "indir/page.tsx", "indir/page.module.css", "platform/windows-download.ts",
))
NEW_PATHS = (PATHS[-1],)
DMG = "apps/ops-web/public/downloads/flixify-pro-macos-1.0.0-build2-test.dmg"
DMG_URL = "https://flixify.vip/downloads/flixify-pro-macos-1.0.0-build2-test.dmg"
DMG_SHA256 = "ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d"
DMG_BYTES = 44517156
TV_MANIFEST = "apps/ops-web/public/downloads/flixify-tv-update.json"
TV_MANIFEST_SHA256 = "f439fd197839cbc3773dacc226801718c8688a3c438467f74ac87d619a838680"
TV_MANIFEST_BYTES = 462
APK = "apps/ops-web/public/downloads/flixify-pro-1.4.7.apk"
APK_BYTES = 1398255
APK_SHA256 = "4c509e19ed410834a1e93bcf3ea3e57c0895a3f6a2e9fa33a411d56bbcb75284"
EXE = "apps/ops-web/public/downloads/flixify-pro-windows-1.0.0-x64-test-setup.exe"
EXE_URL = "https://flixify.vip/downloads/flixify-pro-windows-1.0.0-x64-test-setup.exe"
# Fill only after accepting the actual native Windows CI installer and frozen source.
WINDOWS_REVISION = "2091b8f675e3ce6dea387c85e1bc2e6ba4746512"
WINDOWS_TREE = "a216267047b82727bfdc71d498feac4f475c6ee1"
EXE_SHA256 = "a77def878ffecb6080d2e80a7db491e2745e8be91b239fbf15be308cfa9e5927"
EXE_BYTES = 70307673
EXE_SIZE = "70,3 MB"
EXCLUDED = (*PATHS, EXE, "apps/ops-web/.next")
DESCRIPTOR = PATHS[-1]


def require_verified_pins():
    for value in (WINDOWS_REVISION, WINDOWS_TREE):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
            raise GateError("windows_download_ROOT_FILL_VERIFIED_native_pins_required")
    if (not isinstance(EXE_SHA256, str) or not re.fullmatch(r"[0-9a-f]{64}", EXE_SHA256)
            or type(EXE_BYTES) is not int or EXE_BYTES < 1024
            or not isinstance(EXE_SIZE, str) or not re.fullmatch(r"[0-9]+(?:,[0-9]+)? MB", EXE_SIZE)):
        raise GateError("windows_download_ROOT_FILL_VERIFIED_installer_pins_required")


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise GateError("exact_revision_required")
    return "flixify-ops-web:windows-test-download-" + revision[:12] + "-20261101"


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
    require_verified_pins()
    for exact in (BASE_REVISION, MAC_REVISION, WINDOWS_REVISION, revision):
        target(exact)
        if command("git", "-C", str(repo), "rev-parse", exact + "^{commit}").decode().strip() != exact:
            raise GateError("windows_download_revision_not_exact")
    for first, last in ((MAC_REVISION, BASE_REVISION), (BASE_REVISION, WINDOWS_REVISION), (WINDOWS_REVISION, revision)):
        command("git", "-C", str(repo), "merge-base", "--is-ancestor", first, last)
    for exact in (BASE_REVISION, WINDOWS_REVISION, revision):
        if command("git", "-C", str(repo), "rev-parse", exact + ":apps/macos-native").decode().strip() != MAC_TREE:
            raise GateError("windows_download_mac_native_freeze_changed")
    for exact in (WINDOWS_REVISION, revision):
        if command("git", "-C", str(repo), "rev-parse", exact + ":apps/windows-native").decode().strip() != WINDOWS_TREE:
            raise GateError("windows_download_native_freeze_changed")
    for tree in ("apps/api", "apps/worker", "apps/tv-android", "packages"):
        if command("git", "-C", str(repo), "rev-parse", BASE_REVISION + ":" + tree) != command("git", "-C", str(repo), "rev-parse", revision + ":" + tree):
            raise GateError("windows_download_protected_source_tree_changed:" + tree)
    changed = command("git", "-C", str(repo), "diff", "--no-renames", "--name-only", BASE_REVISION, revision, "--", "apps/ops-web").decode().splitlines()
    runtime = set()
    for path in changed:
        if re.fullmatch(r"apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?", path):
            builder.require_regular_blob(repo, revision, path)
        else:
            runtime.add(path)
    if runtime != {*PATHS, EXE}:
        raise GateError("windows_download_exact_web_scope_required")
    for path in PATHS:
        builder.require_regular_blob(repo, revision, path)


def regular_public_blob(repo, revision, path):
    entry = builder.git_entry(repo, revision, path)
    if not re.fullmatch(rb"100644 blob [0-9a-f]{40}\t" + re.escape(path.encode()) + rb"\x00", entry):
        raise GateError("windows_download_regular_public_blob_required")


def validate_descriptor(data):
    require_verified_pins()
    expected = {
        "href": EXE_URL.removeprefix("https://flixify.vip"),
        "filename": Path(EXE).name, "sha256": EXE_SHA256,
        "pageHref": "/indir#windows", "status": "Test sürümü",
        "version": "1.0.0", "minimumWindows": "Windows 10 (1809+) ve Windows 11",
        "architecture": "x64 (64 bit)", "size": EXE_SIZE,
        "notice": "Bu test sürümü dijital olarak imzalanmamıştır. Windows SmartScreen veya tarayıcın uyarı gösterebilir; kurulum engellenebilir.",
    }
    # Parse the small static descriptor without evaluating JavaScript or allowing computed values.
    text = data.decode("utf-8")
    if not text.startswith("export const windowsDownload = {\n") or not text.endswith("} as const;\n"):
        raise GateError("windows_download_static_descriptor_required")
    pairs = {}
    for line in text.splitlines()[1:-1]:
        match = re.fullmatch(r"  ([A-Za-z][A-Za-z0-9]*): (.+),", line)
        if not match or match[1] in pairs:
            raise GateError("windows_download_descriptor_shape_invalid")
        raw = match[2]
        if re.fullmatch(r"[0-9]+(?:_[0-9]+)*", raw):
            value = int(raw.replace("_", ""))
        else:
            try:
                value = json.loads(raw)
            except ValueError:
                raise GateError("windows_download_descriptor_literal_required") from None
        pairs[match[1]] = value
    expected.update(sizeBytes=EXE_BYTES, signed=False)
    if pairs != expected or any(type(pairs[key]) is not type(value) for key, value in expected.items()):
        raise GateError("windows_download_test_descriptor_pins_differ")


def read_exact_exe_blob(repo, revision):
    """Bound this installer independently; never increase the shared APK reader limit."""
    require_verified_pins()
    if command("git", "-C", str(repo), "cat-file", "-s", revision + ":" + EXE).decode().strip() != str(EXE_BYTES):
        raise GateError("windows_download_exact_size_required")
    process = subprocess.Popen(["git", "-C", str(repo), "show", revision + ":" + EXE],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        data = process.stdout.read(EXE_BYTES + 1)
        if len(data) != EXE_BYTES:
            raise GateError("windows_download_bounded_exe_read_failed")
        if process.wait(timeout=30) != 0:
            raise GateError("windows_download_exe_git_read_failed")
        return data
    except subprocess.TimeoutExpired:
        raise GateError("windows_download_exe_git_read_timeout") from None
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdout.close()


def valid_pe(data):
    if len(data) < 64 or data[:2] != b"MZ":
        return False
    offset = int.from_bytes(data[60:64], "little")
    return 64 <= offset <= len(data) - 24 and data[offset:offset + 4] == b"PE\0\0"


def validate_artifact(repo, revision):
    require_verified_pins()
    changes = command("git", "-C", str(repo), "diff", "--no-renames", "--name-status", BASE_REVISION, revision, "--", "apps/ops-web/public").decode().splitlines()
    if changes != ["A\t" + EXE] or builder.git_entry(repo, BASE_REVISION, EXE):
        raise GateError("windows_download_only_new_exe_public_delta_required")
    regular_public_blob(repo, revision, EXE)
    for ancestor in Path(EXE).parents:
        if str(ancestor) == ".":
            continue
        entry = builder.git_entry(repo, BASE_REVISION, str(ancestor))
        if entry and not entry.startswith(b"040000 tree "):
            raise GateError("windows_download_ancestor_not_tree")
    data = read_exact_exe_blob(repo, revision)
    if hashlib.sha256(data).hexdigest() != EXE_SHA256 or not valid_pe(data):
        raise GateError("windows_download_verified_exe_bytes_required")
    builder.require_image_absent(EXE)
    return data


def expected_public_manifest(original):
    require_verified_pins()
    rows = json.loads(canonical_public_manifest(original))
    entries = {row[1]: row for row in rows}
    relative = EXE.removeprefix("apps/ops-web/public/")
    if relative in entries or entries.get("downloads", [None])[0] != "dir":
        raise GateError("windows_download_public_destination_must_be_absent")
    for path, size, digest in ((DMG, DMG_BYTES, DMG_SHA256), (TV_MANIFEST, TV_MANIFEST_BYTES, TV_MANIFEST_SHA256), (APK, APK_BYTES, APK_SHA256)):
        name = path.removeprefix("apps/ops-web/public/")
        if entries.get(name) != ["file", name, 0o644, size, digest]:
            raise GateError("windows_download_retained_public_pin_differs:" + name)
    rows.append(["file", relative, 0o644, EXE_BYTES, EXE_SHA256])
    return canonical_public_manifest(json.dumps(rows).encode())


def protected_snapshot():
    services = publication.protected_snapshot(API_TAG, API_ID)
    try:
        return {"services": services, "host": backend.host_snapshot()}
    except backend.GateError as error:
        raise GateError(str(error)) from None


def preflight(repo, revision, source_sha256, source_files):
    require_verified_pins()
    source_pin = reviewed.validate_source_fingerprint(source_sha256, source_files)
    protected = protected_snapshot()
    validate_source_scope(repo, revision)
    data = validate_artifact(repo, revision)
    validate_descriptor(core.git_file(repo, revision, DESCRIPTOR))
    base, updated, web_env, config = builder.preflight(repo, revision)
    updated[EXE] = data
    before = untouched(SOURCE_ID)
    reviewed.require_untouched(source_pin, before)
    public = public_manifest(SOURCE_ID)
    expected_public_manifest(public)
    if protected_snapshot() != protected:
        raise GateError("windows_download_preflight_protected_state_changed")
    return base, updated, web_env, config, public, before, protected


def download_verification_script():
    require_verified_pins()
    pins = [{"path": path.removeprefix("apps/ops-web/public"), "size": size, "sha": sha, "kind": kind}
            for path, size, sha, kind in ((EXE, EXE_BYTES, EXE_SHA256, "exe"), (DMG, DMG_BYTES, DMG_SHA256, "dmg"),
                                         (APK, APK_BYTES, APK_SHA256, "apk"), (TV_MANIFEST, TV_MANIFEST_BYTES, TV_MANIFEST_SHA256, "json"))]
    return ('const crypto=require("node:crypto");(async()=>{const base="http://127.0.0.1:3000";const pins=' + json.dumps(pins) + ';'
        'const mime={exe:["application/vnd.microsoft.portable-executable","application/x-msdownload","application/x-msdos-program","application/x-dosexec","application/octet-stream"],'
        'dmg:["application/x-apple-diskimage","application/octet-stream"],apk:["application/vnd.android.package-archive","application/octet-stream"],json:["application/json"]};'
        'async function bounded(r,size){const chunks=[];let count=0;for await(const chunk of r.body){count+=chunk.length;if(count>size){throw Error("response_too_large")}chunks.push(chunk)}'
        'if(count!==size)throw Error("response_size_invalid");return Buffer.concat(chunks,count)}'
        'for(const p of pins){const u=base+p.path;let h;for(let n=0;n<40;n++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.status===200)break}catch{}await new Promise(r=>setTimeout(r,250))}'
        'if(!h||h.status!==200||Number(h.headers.get("content-length"))!==p.size||!mime[p.kind].includes(h.headers.get("content-type")?.split(";")[0]))throw Error("download_head_invalid");'
        'if(p.kind!=="json"){const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/"+p.size)throw Error("download_range_invalid");await bounded(r,32)}'
        'const full=await fetch(u,{signal:AbortSignal.timeout(120000)});if(full.status!==200)throw Error("download_get_invalid");const data=await bounded(full,p.size);'
        'if(crypto.createHash("sha256").update(data).digest("hex")!==p.sha)throw Error("download_digest_invalid");'
        'if(p.kind==="exe"){if(data.length<64||data.subarray(0,2).toString()!=="MZ")throw Error("exe_mz_invalid");const pe=data.readUInt32LE(60);if(pe<64||pe>data.length-24||!data.subarray(pe,pe+4).equals(Buffer.from([80,69,0,0])))throw Error("exe_pe_invalid")}'
        'if(p.kind==="dmg"&&data.subarray(data.length-512,data.length-508).toString()!=="koly")throw Error("dmg_magic_invalid");'
        'if(p.kind==="apk"&&!data.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw Error("apk_magic_invalid")}'
        'for(const path of ["/","/indir","/paketler"]){const p=await fetch(base+path,{redirect:"manual",signal:AbortSignal.timeout(10000)});if(p.status!==200)throw Error("page_status_invalid")}'
        'console.log("candidate_windows_unsigned_test_and_retained_mac_tv_downloads_verified")})().catch(()=>{console.error("candidate_windows_download_contract_failed");process.exit(1)})')


def verify_download(candidate):
    name = "flixify-windows-test-check-" + uuid.uuid4().hex[:12]
    owned = command("docker", "create", "--name", name, "--network", "none", "--memory", "512m", "--memory-swap", "640m", "--pids-limit", "128", candidate).decode().strip()
    if not re.fullmatch(r"[0-9a-f]{64}", owned):
        raise GateError("windows_download_check_container_id_invalid")
    try:
        command("docker", "start", owned)
        if command("docker", "inspect", "--format", "{{.Image}}", owned).decode().strip() != candidate:
            raise GateError("windows_download_check_container_drift")
        command("docker", "exec", owned, "node", "-e", download_verification_script(), timeout=240)
    finally:
        command("docker", "rm", "--force", owned)


def verify_candidate(result, revision):
    base, updated, web_env, config, public, before, _ = result
    candidate = builder.verify_candidate(base, revision, {path: data for path, data in updated.items() if path != EXE}, web_env, config)
    reviewed.require_untouched(before, untouched(candidate))
    if canonical_public_manifest(public_manifest(candidate)) != expected_public_manifest(public):
        raise GateError("windows_download_candidate_public_tree_differs")
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
    require_verified_pins()
    if args.measure:
        before = protected_snapshot()
        measured = untouched(SOURCE_ID)
        public = public_manifest(SOURCE_ID)
        expected_public_manifest(public)
        if protected_snapshot() != before:
            raise GateError("windows_download_measurement_drift")
        print(json.dumps({"sourceImage": SOURCE_ID, **measured, "publicSha256": hashlib.sha256(canonical_public_manifest(public)).hexdigest(), "protected": before}, sort_keys=True))
        return
    if args.source_repo is None or args.revision is None:
        raise GateError("windows_download_repo_and_exact_revision_required")
    result = preflight(args.source_repo, args.revision, args.source_untouched_sha256, args.source_untouched_files)
    if not (args.build or args.verify_existing):
        print("windows_download_web_preflight_ok; no_mutation")
        return
    if args.build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("windows_download_web_build_requires_8GiB")
        if target(args.revision) in command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", target(args.revision)).decode().splitlines():
            raise GateError("windows_download_candidate_exists_use_verify_existing")
        container_compile(args.revision, result[0], result[1], result[2])
    candidate = verify_candidate(result, args.revision)
    if protected_snapshot() != result[-1]:
        raise GateError("windows_download_build_changed_protected_state")
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
