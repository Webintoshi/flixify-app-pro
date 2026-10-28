#!/usr/bin/env python3
"""Pinned TV-style website plus one compatible direct-play APK; preflight by default.

The artifact hash must come from the locally apksigner/aapt2-verified release.
The server checks those exact bytes, source scope, preserved public tree and HTTP
download contract; it does not pretend to reimplement Android signature tooling.
"""
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

spec = importlib.util.spec_from_file_location("direct_tv_reviewed_web", Path(__file__).with_name("build-web-tv-style.py"))
style = importlib.util.module_from_spec(spec)
spec.loader.exec_module(style)
builder, core, GateError, command = style.builder, style.core, style.GateError, style.command
SOURCE_TAG, SOURCE_ID, BASE_REVISION = style.SOURCE_TAG, style.SOURCE_ID, style.BASE_REVISION
DESCRIPTOR = "apps/ops-web/app/platform/tv-download.ts"
GRADLE = "apps/tv-android/app/build.gradle"
PATHS = (*style.PATHS, DESCRIPTOR)
NEW_PATHS = style.NEW_PATHS
APK = "apps/ops-web/public/downloads/flixify-tv-1.3.1-test.1.apk"
MAX_APK_BYTES = 64 * 1024 * 1024
NATIVE_PATHS = tuple("apps/tv-android/app/src/main/java/vip/flixify/tv/" + name for name in (
    "MainActivity.java", "TvLayout.java", "PlayerActivity.java", "PlayerIconButton.java",
    "TvRepository.java", "data/NetworkTvRepository.java",
))
TOOL_PATHS = tuple("coolify/releases/2026-10-26-edge-recovery/" + name for name in (
    "build-tv-direct-web.py", "release-tv-direct-web.py", "test-tv-direct-web.py",
))
builder.PATHS, builder.NEW_PATHS = PATHS, NEW_PATHS
container_compile = style.container_compile
public_manifest_script = style.public_manifest_script


def validate_source_scope(repo: Path, revision: str) -> None:
    builder.target(revision)
    changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision).decode().splitlines()
    if not {*PATHS, APK, GRADLE} <= set(changed):
        raise GateError("direct_tv_required_manifest_differs")
    allowed = {*PATHS, APK, GRADLE, *NATIVE_PATHS, *TOOL_PATHS, *style.TOOL_PATHS, "apps/tv-android/README.md"}
    for path in changed:
        if path in allowed or (path.startswith("docs/") and path.endswith(".md")):
            continue
        if path.startswith("apps/ops-web/app/") and re.fullmatch(r"[A-Za-z0-9_./-]+\.test\.(?:m?[jt]sx?)", path):
            continue
        if re.fullmatch(r"apps/tv-android/app/src/(?:test|androidTest)/java/vip/flixify/tv/(?:[A-Za-z0-9_]+/)*[A-Za-z0-9_]+\.java", path):
            continue
        raise GateError("direct_tv_change_outside_allowlist:" + path)


def validate_versions(repo: Path, revision: str) -> None:
    original = core.git_file(repo, BASE_REVISION, GRADLE)
    if original.count(b"versionCode 5") != 1 or original.count(b"versionName '1.3.0-test.1'") != 1:
        raise GateError("direct_tv_baseline_gradle_version_differs")
    expected = original.replace(b"versionCode 5", b"versionCode 6").replace(b"versionName '1.3.0-test.1'", b"versionName '1.3.1-test.1'")
    if core.git_file(repo, revision, GRADLE) != expected:
        raise GateError("direct_tv_gradle_change_outside_version")
    original = core.git_file(repo, BASE_REVISION, DESCRIPTOR)
    if b"flixify-tv-1.3.0-test.1.apk" not in original:
        raise GateError("direct_tv_baseline_descriptor_differs")
    if core.git_file(repo, revision, DESCRIPTOR) != original.replace(b"1.3.0-test.1", b"1.3.1-test.1"):
        raise GateError("direct_tv_descriptor_change_outside_version")


def validate_apk(repo: Path, revision: str, sha256: str, size: int) -> bytes:
    if not re.fullmatch(r"[0-9a-f]{64}", sha256) or not 1024 <= size <= MAX_APK_BYTES:
        raise GateError("apk_pin_invalid")
    builder.require_regular_blob(repo, revision, APK)
    if builder.git_entry(repo, BASE_REVISION, APK):
        raise GateError("apk_exists_in_baseline")
    if not re.fullmatch(rb"100644 blob [0-9a-f]{40}\t" + re.escape(APK.encode()) + rb"\x00",
                        builder.git_entry(repo, revision, APK)):
        raise GateError("apk_mode_invalid")
    for ancestor in Path(APK).parents:
        if str(ancestor) == ".":
            continue
        entry = builder.git_entry(repo, BASE_REVISION, str(ancestor))
        if entry and not entry.startswith(b"040000 tree "):
            raise GateError("apk_baseline_ancestor_not_tree")
    builder.require_image_absent(APK)
    changed = command("git", "-C", str(repo), "diff", "--name-only", BASE_REVISION, revision,
                      "--", "apps/ops-web/public").decode().splitlines()
    if changed != [APK]:
        raise GateError("apk_public_scope_differs")
    value = core.git_file(repo, revision, APK)
    if len(value) != size or hashlib.sha256(value).hexdigest() != sha256 or not value.startswith(b"PK\x03\x04"):
        raise GateError("apk_bytes_differ_from_pin")
    return value


def canonical_public_manifest(value: bytes) -> bytes:
    rows = json.loads(value)
    if not isinstance(rows, list):
        raise GateError("public_manifest_invalid")
    paths = set()
    for row in rows:
        if (not isinstance(row, list) or len(row) < 3 or row[0] not in ("file", "dir", "link") or
                not isinstance(row[1], str) or row[1] in paths):
            raise GateError("public_manifest_invalid")
        paths.add(row[1])
    return json.dumps(sorted(rows, key=lambda row: row[1]), separators=(",", ":")).encode()


def expected_public_manifest(original: bytes, sha256: str, size: int) -> bytes:
    rows = json.loads(canonical_public_manifest(original))
    entries = {row[1]: row for row in rows}
    relative = APK.removeprefix("apps/ops-web/public/")
    if relative in entries or entries.get("downloads", [None])[0] != "dir":
        raise GateError("public_apk_addition_not_absent_regular_path")
    rows.append(["file", relative, 0o644, size, sha256])
    return canonical_public_manifest(json.dumps(rows).encode())


def public_manifest(image_id: str) -> bytes:
    return command("docker", "run", "--rm", "--network", "none", "--memory", "256m", "--memory-swap", "320m",
                   "--pids-limit", "128", "--entrypoint", "node", image_id, "-e", public_manifest_script())


def preflight(repo: Path, revision: str, sha256: str, size: int) -> tuple[dict, dict, dict, bytes, bytes]:
    validate_source_scope(repo, revision)
    validate_versions(repo, revision)
    base, updated, web_env, config = builder.preflight(repo, revision)
    updated[APK] = validate_apk(repo, revision, sha256, size)
    original_public = public_manifest(SOURCE_ID)
    expected_public_manifest(original_public, sha256, size)
    return base, updated, web_env, config, original_public


def dockerfile(revision: str) -> str:
    value = builder.dockerfile(revision)
    if value.count("\nRUN node -e ") != 1:
        raise GateError("web_compile_layer_differs")
    return value.replace("\nRUN node -e ", f"\nCOPY {APK} /app/{APK}\nRUN node -e ", 1)


def verify_download(candidate_id: str, sha256: str, size: int) -> None:
    name = "flixify-tv-direct-apk-check-" + uuid.uuid4().hex[:12]
    command("docker", "run", "--rm", "-d", "--name", name, "--network", "none", "--memory", "512m",
            "--memory-swap", "640m", "--pids-limit", "128", candidate_id)
    try:
        url = "http://127.0.0.1:3000/" + APK.removeprefix("apps/ops-web/public/")
        script = (
            'const crypto=require("node:crypto");(async()=>{const u=' + json.dumps(url) + ';let h;'
            'for(let n=0;n<40;n++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});'
            'if(h.ok)break}catch{}await new Promise(r=>setTimeout(r,250))}'
            'if(!h||h.status!==200||Number(h.headers.get("content-length"))!==' + str(size) +
            '||!h.headers.get("content-type")?.includes("application/vnd.android.package-archive"))throw Error("apk_head_invalid");'
            'const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});'
            'if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/' + str(size) +
            '"||(await r.arrayBuffer()).byteLength!==32)throw Error("apk_range_invalid");'
            'const response=await fetch(u,{signal:AbortSignal.timeout(10000)});if(response.status!==200)throw Error("apk_get_status_invalid");'
            'const b=Buffer.from(await response.arrayBuffer());if(b.length!==' + str(size) +
            '||crypto.createHash("sha256").update(b).digest("hex")!==' + json.dumps(sha256) + ')throw Error("apk_get_digest_invalid");'
            'console.log("candidate_apk_head_mime_get_range_verified")})()'
            '.catch(()=>{console.error("candidate_apk_download_failed");process.exit(1)})'
        )
        command("docker", "exec", name, "node", "-e", script, timeout=100)
        print("candidate_apk_head_mime_get_range_verified; network_disabled")
    finally:
        if command("docker", "inspect", "--format", "{{.Image}}", name).decode().strip() != candidate_id:
            raise GateError("apk_check_container_drift")
        command("docker", "stop", "-t", "10", name)


def verify_candidate(base: dict, revision: str, updated: dict, web_env: dict, config: bytes,
                     original_public: bytes, sha256: str, size: int) -> str:
    candidate = builder.verify_candidate(base, revision, updated, web_env, config)
    if canonical_public_manifest(public_manifest(candidate)) != expected_public_manifest(original_public, sha256, size):
        raise GateError("web_candidate_public_tree_differs")
    print("candidate_public_tree_verified; only_pinned_new_apk_added")
    verify_download(candidate, sha256, size)
    return candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_repo", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--apk-sha256", required=True)
    parser.add_argument("--apk-bytes", type=int, required=True)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--build", action="store_true")
    action.add_argument("--container-build", action="store_true")
    action.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()
    base, updated, web_env, config, original_public = preflight(args.source_repo, args.revision, args.apk_sha256, args.apk_bytes)
    if not (args.build or args.container_build or args.verify_existing):
        print("tv_direct_web_preflight_ok; no_live_mutation; old_public_tree_pinned")
        return
    if args.build or args.container_build:
        if shutil.disk_usage("/var/lib/docker").free < builder.MIN_FREE_BYTES:
            raise GateError("insufficient_disk_web_build_requires_8GiB")
        tags = command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}", builder.target(args.revision)).decode().splitlines()
        if builder.target(args.revision) in tags:
            raise GateError("candidate_tag_already_exists_use_verify_existing")
        if args.container_build:
            container_compile(args.revision, base, updated, web_env)
        else:
            with tempfile.TemporaryDirectory(prefix="flixify-tv-direct-web-") as directory:
                root = Path(directory)
                for path, value in updated.items():
                    file = root / path
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(value)
                    if path == APK:
                        file.chmod(0o644)
                (root / "Dockerfile").write_text(dockerfile(args.revision))
                build_args = [argument for key, value in web_env.items() for argument in ("--build-arg", key + "=" + value)]
                command("docker", "build", "--load", "--no-cache", "--rm", "--force-rm", "--pull=false", "--network=none",
                        "--resource", f"memory={builder.RUN_MEMORY_MIB}m", "--resource", f"memory-swap={builder.RUN_TOTAL_MEMORY_MIB}m",
                        "-t", builder.target(args.revision), *build_args, str(root), timeout=1200)
    candidate = verify_candidate(base, args.revision, updated, web_env, config, original_public, args.apk_sha256, args.apk_bytes)
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
