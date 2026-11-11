#!/usr/bin/env python3
"""Build isolated SMTP and signup candidates from the staged email images."""
from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile


PARENT = "a942b41b62d2d94b6fda6e65436402dbef8570d5"
RELEASE_SOURCE = "27257ec571b3f56f112e4bf1803773d68896cbea"
STAGED_API_METADATA = {
    "apps/api/package.json": "6f14da315b3ef7bb7aed51e411f850ef7e84fcb5ebcbaf437bd4043904ee1445",
    "package-lock.json": "46b8f1a91152537c912aaacaeaf6204f9100fbb8b7a8ac06a12908ac0ae8a3a9",
}
PROFILE = "coolify/releases/2026-11-11-email-smtp"
HELPER_REVISION = "438ae41ef672df71da7327b821c0de7d896db271"
HELPER_PATH = "coolify/releases/2026-11-08-whatsapp-only/build.py"
HELPER_SHA = "8850cfe18f1cf5180142de1e04b1e44e57de6466c6c1a3e427280e4c064d787e"
STAGED = {
    "api": ("flixify-api:email-auth-a942b41b62d2-20261111",
            "sha256:a883089433660a7f5690f3c2b79dc29fc1e95d1248f2adde997c59f8f6b49f02"),
    "ops-web": ("flixify-ops-web:email-auth-a942b41b62d2-20261111",
                "sha256:9fcfbcfccbf46d5662f86595263c15a2750ed9cf62e8b266111fce968396a75c"),
}
PRODUCTION = {
    "api": ("flixify-api:whatsapp-only-438ae41ef672-20261108",
            "sha256:0258811e30bc371074fbe2c3bcd6edebc07109d8f0e950f2a5a118e505b7a38c"),
    "ops-web": ("flixify-ops-web:otp-recovery-32a7d223b4b5-20261110",
                "sha256:a5a1753fdfe58229f9146c19be02f6107109252994f539d1003b2fbc62337e4a"),
}
RUNTIME = {
    "api": {
        "apps/api/src/server.ts",
        "apps/api/src/email-auth-config.ts", "apps/api/src/email-auth-smtp.ts",
        "apps/api/src/env.ts",
    },
    "ops-web": {"apps/ops-web/app/giris-onizleme/phone-login-preview.tsx"},
}
NEW_SOURCE = "apps/api/src/email-auth-smtp.ts"
DEPENDENCY = {
    "name": "nodemailer", "version": "10.5.0", "bytes": 412406, "files": 165,
    "url": "https://registry.npmjs.org/nodemailer/-/nodemailer-10.5.0.tgz",
    "integrity": "sha512-L/w/HH5MqpzMDuZD7fQdt/+KqymuvrpaApaIjAH2XA3ILePwlcvXCVVvP75xVrXCEt2ggK2marrrHHFB5Qu0kA==",
}
DEPENDENCY_PATH = "node_modules/nodemailer"
MAX_FILE = 2 * 1024**2
API_COMPILER_ARGS = '["run","build","-w","@flixify/api"]'

SOURCE_CHECK = r"""
const fs = require('node:fs'), crypto = require('node:crypto');
for (const [file, expected] of Object.entries(JSON.parse(process.argv[1]))) {
  const path = '/app/' + file;
  let actual = null;
  try {
    if (!fs.lstatSync(path).isFile()) throw Error('unexpected_source_type');
    actual = crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (actual !== expected) throw Error('staged_source_mismatch:' + file);
}
"""

SMTP_IMPORT_CHECK = r"""
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const serverPath = '/app/apps/api/dist/server.js';
const bundle = readFileSync(serverPath, 'utf8');
const load = createRequire(serverPath);
if (!bundle.includes('from "nodemailer/lib/mail-composer"') ||
    !bundle.includes('from "nodemailer/lib/smtp-connection"') ||
    load('nodemailer/package.json').version !== '10.5.0' ||
    typeof load('nodemailer/lib/mail-composer') !== 'function' ||
    typeof load('nodemailer/lib/smtp-connection') !== 'function')
  throw Error('smtp_dependency_unavailable');
"""


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_sha(data):
    return sha(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def blob(repo, ref, path):
    return git(repo, "show", f"{ref}:{path}")


def validate_manifest(manifest):
    require(set(manifest) == {"schemaVersion", "parent", "dependency", "runtime"}
            and manifest["schemaVersion"] == 1 and manifest["parent"] == PARENT
            and manifest["dependency"] == DEPENDENCY
            and set(manifest["runtime"]) == set(RUNTIME), "invalid SMTP manifest")
    for service, paths in RUNTIME.items():
        seen = set()
        for entry in manifest["runtime"][service]:
            require(set(entry) == {"path", "beforeSha256", "sha256", "bytes"},
                    "invalid SMTP source record")
            path, before = entry["path"], entry["beforeSha256"]
            require(path in paths and path not in seen and
                    ((path == NEW_SOURCE and before is None) or
                     (path != NEW_SOURCE and re.fullmatch("[a-f0-9]{64}", str(before)))) and
                    re.fullmatch("[a-f0-9]{64}", str(entry["sha256"])) and
                    type(entry["bytes"]) is int and 0 < entry["bytes"] < MAX_FILE,
                    "invalid SMTP source record")
            seen.add(path)
        require(seen == paths, f"incomplete SMTP source list for {service}")
    return manifest


def dependency_payload(data):
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    require(len(data) == DEPENDENCY["bytes"] and integrity == DEPENDENCY["integrity"],
            "SMTP dependency archive identity differs")
    files = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            require(member.isfile() and len(path.parts) > 1 and path.parts[0] == "package"
                    and ".." not in path.parts and path.as_posix() == member.name and
                    "\\" not in member.name and 0 <= member.size < MAX_FILE,
                    "unexpected SMTP dependency archive member")
            target = f"{DEPENDENCY_PATH}/{PurePosixPath(*path.parts[1:])}"
            total += member.size
            require(target not in files and len(files) < DEPENDENCY["files"] and
                    total < 8 * 1024**2, "SMTP dependency archive exceeds reviewed contents")
            files[target] = archive.extractfile(member).read()
    require(len(files) == DEPENDENCY["files"], "incomplete SMTP dependency archive")
    package = json.loads(files[f"{DEPENDENCY_PATH}/package.json"])
    require(package["name"] == DEPENDENCY["name"] and package["version"] == DEPENDENCY["version"]
            and not package.get("dependencies") and not package.get("optionalDependencies")
            and not package.get("peerDependencies"), "unexpected SMTP dependency package metadata")
    return files


def smtp_compiler(original):
    def compile_service(service, public):
        code = original(service, public)
        if service == "api":
            require(code.count(API_COMPILER_ARGS) == 1, "frozen API compiler command changed")
            args = json.loads(API_COMPILER_ARGS) + ["--", "--external", "nodemailer"]
            return code.replace(API_COMPILER_ARGS, json.dumps(args, separators=(",", ":")), 1)
        return code
    return compile_service


def read_inputs(repo, ref, dependency):
    require(re.fullmatch("[a-f0-9]{40}", ref) and
            git(repo, "rev-list", "--parents", "-n", "1", ref).decode().split() == [ref, RELEASE_SOURCE],
            "reviewed release revision required")
    manifest = validate_manifest(json.loads(blob(repo, ref, f"{PROFILE}/runtime-manifest.json")))
    runtime = {}
    for service, entries in manifest["runtime"].items():
        runtime[service] = {}
        for entry in entries:
            content = blob(repo, ref, entry["path"])
            require(len(content) == entry["bytes"] and sha(content) == entry["sha256"],
                    f"SMTP release source digest differs for {entry['path']}")
            runtime[service][entry["path"]] = content
    lock = json.loads(blob(repo, RELEASE_SOURCE, "package-lock.json"))["packages"]
    package = json.loads(blob(repo, RELEASE_SOURCE, "apps/api/package.json"))
    locked = lock[DEPENDENCY_PATH]
    require(package["dependencies"][DEPENDENCY["name"]] == DEPENDENCY["version"]
            and locked["version"] == DEPENDENCY["version"] and locked["resolved"] == DEPENDENCY["url"]
            and locked["integrity"] == DEPENDENCY["integrity"], "SMTP lockfile identity differs")
    with dependency.open("rb") as archive:
        smtp_files = dependency_payload(archive.read(DEPENDENCY["bytes"] + 1))
    runtime["api"].update(smtp_files)
    helper = blob(repo, HELPER_REVISION, HELPER_PATH)
    require(sha(helper) == HELPER_SHA, "SMTP build helper digest differs")
    return manifest, runtime, helper


def production_state(builder, helper):
    staged = builder.SOURCES
    builder.SOURCES = PRODUCTION
    try:
        rows = builder.assert_source()
    finally:
        builder.SOURCES = staged
    active = {}
    for service in PRODUCTION:
        row = rows[service]
        active[service] = {
            "id": row["Id"], "image": row["Image"],
            "config": canonical_sha(row["Config"]), "hostConfig": canonical_sha(row["HostConfig"]),
            "mounts": canonical_sha(row["Mounts"]),
            "networks": canonical_sha(row["NetworkSettings"].get("Networks", {})),
            "startedAt": row["State"]["StartedAt"], "running": row["State"]["Running"],
            "paused": row["State"]["Paused"], "restartCount": row["RestartCount"],
        }
    return active, helper.protected_snapshot(builder), rows


def node_probe(builder, image, source, *args):
    builder.command("docker", "run", "--rm", "--network", "none", "--read-only",
                    "--memory", "256m", "--memory-swap", "320m", "--cpus", "1",
                    "--pids-limit", "64", "--entrypoint", "node", image, "-e", source,
                    *args, timeout=90)


def build(repo, ref, dependency, work):
    manifest, runtime, helper_source = read_inputs(repo, ref, dependency)
    with tempfile.TemporaryDirectory(prefix="flixify-email-smtp-build-helper-") as temp:
        path = Path(temp) / "build.py"
        path.write_bytes(helper_source)
        spec = importlib.util.spec_from_file_location("flixify_email_smtp_build", path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        helper.SOURCES = STAGED.copy()
        helper.API_PATHS = frozenset(runtime["api"])
        helper.WEB_PATHS = frozenset(runtime["ops-web"])
        helper.target = lambda service, revision: f"flixify-{service}:email-smtp-{revision[:12]}-20261111"
        with helper.helpers(repo) as release:
            builder = release.b
            builder.compiler_script = smtp_compiler(builder.compiler_script)
            active, protected, rows = production_state(builder, helper)
            for service, (tag, identity) in STAGED.items():
                info = builder.image_info(tag)
                require(info["Id"] == identity and
                        info["Config"]["Labels"]["org.opencontainers.image.revision"] == PARENT,
                        f"staged email image identity differs for {service}")
                expected = {entry["path"]: entry["beforeSha256"] for entry in manifest["runtime"][service]}
                if service == "api":
                    expected.update(STAGED_API_METADATA)
                    expected[DEPENDENCY_PATH] = None
                node_probe(builder, identity, SOURCE_CHECK, json.dumps(expected))
            builder.require_disk()
            work.mkdir(mode=0o700)
            public = {}
            for value in rows["ops-web"]["Config"].get("Env", []):
                key, entry = value.split("=", 1)
                if key.startswith("NEXT_PUBLIC_") or key in {"PUBLIC_API_BASE_URL", "NODE_ENV"}:
                    public[key] = entry
            built = {}
            try:
                for service in STAGED:
                    builder.require_disk()
                    proof = builder.candidate(service, ref, runtime[service], work,
                                              public if service == "ops-web" else {})
                    helper.verify_proof(builder, proof)
                    builder.smoke(proof)
                    if service == "api":
                        node_probe(builder, proof["candidateId"], SMTP_IMPORT_CHECK)
                        helper.smoke_api(builder, proof)
                    built[service] = proof["candidateId"]
            finally:
                after_active, after_protected, _ = production_state(builder, helper)
                require(after_active == active and after_protected == protected,
                        "production service changed while building candidates")
            receipt = {"revision": ref, "candidateImages": built, "servicesUntouched": True}
            (work / "candidate-images.json").write_text(json.dumps(receipt, indent=2) + "\n")
            print(json.dumps(receipt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--dependency", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    args = parser.parse_args()
    build(args.repo, args.revision, args.dependency, args.work_dir)


if __name__ == "__main__":
    main()
