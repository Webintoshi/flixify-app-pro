"""Distribute an already notarized and stapled app without signing it again."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import shutil
import stat
import subprocess
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

from macos_privacy import (CREDENTIAL_URL, EMAIL, PUBLIC_CONTACTS, _approved_signature_data,
                           audit_release_privacy, known_personal_identifiers,
                           identifier_hits, read_identity_policy, validate_signing_subject)
from macos_release import (APP_NAME, BUNDLE_ID, BUILD, MINIMUM_SYSTEM, PRODUCT,
                           REQUIRED_ARCHITECTURES, ROOT, VERSION, ReleaseError,
                           audit_app, macho_files, sha256, validate_app_metadata)

ZIP_NAME = f"Flixify-Pro-{VERSION}-build{BUILD}-macos-universal.zip"
ZIP_URL = "https://flixify.vip/downloads/" + ZIP_NAME


def run(arguments: list[str]) -> bytes:
    result = subprocess.run(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    if result.returncode:
        raise ReleaseError("Notarized ZIP validation failed: " + Path(arguments[0]).name + " (details suppressed)")
    return result.stdout + result.stderr


def extended_attributes(path: Path) -> dict[str, bytes]:
    result = {}
    for name in run(["/usr/bin/xattr", "-s", str(path)]).decode("utf-8").splitlines():
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,126}", name) or name in result:
            raise ReleaseError("Unsupported extended attribute name in notarized app")
        try:
            result[name] = bytes.fromhex(run(["/usr/bin/xattr", "-s", "-p", "-x", name, str(path)]).decode("ascii"))
        except (ValueError, UnicodeError) as error:
            raise ReleaseError("Could not verify notarized app extended attributes") from error
    return result


def app_manifest(app: Path, *, include_directory_attributes: bool = False) -> tuple[str, int]:
    rows, payload_size = [], 0
    if app.is_symlink() or not app.is_dir():
        raise ReleaseError("A real source app directory is required")
    for path in [app, *sorted(app.rglob("*"))]:
        metadata = path.lstat()
        relative = path.relative_to(app).as_posix()
        attributes = []
        for name, value in sorted(extended_attributes(path).items()):
            if include_directory_attributes or not stat.S_ISDIR(metadata.st_mode):
                attributes.append((name, len(value), hashlib.sha256(value).hexdigest()))
            payload_size += len(value)
        if stat.S_ISLNK(metadata.st_mode):
            if not path.resolve().is_relative_to(app.resolve()):
                raise ReleaseError("An app symlink leaves the signed bundle")
            contents = ["symlink", path.readlink().as_posix()]
        elif stat.S_ISREG(metadata.st_mode):
            contents = ["file", metadata.st_size, sha256(path)]
            payload_size += metadata.st_size
        elif stat.S_ISDIR(metadata.st_mode):
            contents = ["directory"]
        else:
            raise ReleaseError("Unsupported special file in notarized app")
        rows.append([relative, stat.S_IMODE(metadata.st_mode), contents, attributes])
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest(), payload_size


def audit_extended_attribute_privacy(app: Path, identifiers: set[str]) -> dict:
    count, size = 0, 0
    for path in [app, *sorted(app.rglob("*"))]:
        for name, value in extended_attributes(path).items():
            count += 1; size += len(value)
            for data in (name.encode("utf-8"), value):
                variants = [data, *(data.decode(encoding, "ignore").encode("utf-8")
                                    for encoding in ("utf-16-le", "utf-16-be"))]
                private = identifier_hits(data, identifiers) or any(
                    any(pattern in variant.lower() for pattern in
                        (b"/users/", b"/private/var/folders/", b"/private/tmp/", b"/tmp/")) or
                    any(email.lower() not in PUBLIC_CONTACTS for email in EMAIL.findall(variant)) or
                    CREDENTIAL_URL.search(variant)
                    for variant in variants)
                if private:
                    raise ReleaseError("Notarized app extended attributes contain forbidden private metadata (names and values suppressed)")
    return {"schema": 1, "passed": True, "attributesScanned": count, "attributeBytesScanned": size,
            "matchedValuesIncluded": False, "certificateSubjectExceptionsApplied": False,
            "scope": "Known identifiers, user/temporary paths, non-public email and credential URL patterns in attribute names and values"}


def validate_notarized_app(app: Path, policy: dict, identifiers: set[str]) -> dict:
    validate_app_metadata(app, public=True)
    binaries = audit_app(app)
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", "--all-architectures", str(app)])
    details = run(["/usr/bin/codesign", "--display", "--verbose=4", str(app)]).decode("utf-8", "replace")
    authorities = re.findall(r"^Authority=(.+)$", details, re.M)
    if not authorities or not authorities[0].startswith("Developer ID Application: "):
        raise ReleaseError("An existing Developer ID Application signature is required")
    if re.findall(r"^TeamIdentifier=(\S+)$", details, re.M) != [policy["teamIdentifier"]]:
        raise ReleaseError("The accepted app's signing team differs from the reviewed identity")
    approval = validate_signing_subject('1) ' + policy["certificateSha1"] + ' "' + authorities[0] + '"',
                                        policy["certificateSha1"], policy, identifiers)
    signed_files = macho_files(app)
    if not signed_files:
        raise ReleaseError("The notarized app contains no signed executable")
    for binary in signed_files:
        _approved_signature_data(binary, binary.read_bytes(), approval)
    attribute_privacy = audit_extended_attribute_privacy(app, identifiers | approval.personal_name_identifiers())
    run(["/usr/bin/xcrun", "stapler", "validate", str(app)])
    assessment = run(["/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", str(app)])
    if re.findall(rb"^source=([^\r\n]+)\r?$", assessment, re.M) != [b"Notarized Developer ID"]:
        raise ReleaseError("Gatekeeper must identify an accepted Notarized Developer ID app")
    privacy = audit_release_privacy(app, identifiers=identifiers, signing_identity=approval)
    return {"signatureVerifiedAllArchitectures": True, "approvedCertificateAndTeamVerified": True,
            "stapledTicketValidated": True, "gatekeeperSource": "Notarized Developer ID",
            "privacyAudit": privacy, "extendedAttributePrivacyAudit": attribute_privacy, "binaries": binaries}


def validate_zip_layout(archive: Path, app_name: str, payload_size: int) -> None:
    limit = payload_size * 2 + 16 * 1024 * 1024
    if archive.stat().st_size > limit:
        raise ReleaseError("Unexpected notarized ZIP size")
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        if not members or len(members) > 100000 or sum(item.file_size for item in members) > limit:
            raise ReleaseError("Unexpected notarized ZIP payload")
        seen = set()
        for member in members:
            raw = member.filename.rstrip("/")
            parts = raw.split("/")
            if (not raw or "\\" in raw or "\x00" in raw or raw.startswith("/") or
                    any(part in {"", ".", ".."} for part in parts) or raw in seen or member.flag_bits & 1 or
                    member.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}):
                raise ReleaseError("Unsafe notarized ZIP entry")
            seen.add(raw)
            metadata = parts[0] == "__MACOSX"
            if not (parts[0] == app_name or metadata and
                    (len(parts) == 1 and member.is_dir() or len(parts) > 1 and parts[1] in {app_name, "._" + app_name})):
                raise ReleaseError("ZIP contains files outside the notarized app")
            mode = member.external_attr >> 16
            if stat.S_ISLNK(mode):
                if metadata or member.file_size > 4096:
                    raise ReleaseError("Unexpected notarized ZIP symlink")
                target = zipped.read(member).decode("utf-8")
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(raw), target))
                if PurePosixPath(target).is_absolute() or not (resolved == app_name or resolved.startswith(app_name + "/")):
                    raise ReleaseError("ZIP symlink leaves the notarized app")
            elif stat.S_IFMT(mode) not in {0, stat.S_IFREG, stat.S_IFDIR}:
                raise ReleaseError("Unsupported notarized ZIP entry type")


def publish_files(staged: list[Path], destination: Path) -> None:
    published = []
    try:
        for source in staged:
            target = destination / source.name
            os.link(source, target)
            published.append((source, target))
    except Exception:
        for source, target in reversed(published):
            if target.exists() and not target.is_symlink() and target.stat().st_ino == source.stat().st_ino:
                target.unlink()
        raise


def validate_distribution_directories(dist: Path, destination: Path) -> None:
    expected = ROOT.resolve()
    for directory, relative in ((dist, "dist"), (destination.parent, "dist/public-zip"),
                                (destination, "dist/public-zip/" + VERSION + "-build" + str(BUILD))):
        if (directory.is_symlink() or directory.exists() and not directory.is_dir() or
                directory.resolve() != expected / relative):
            raise ReleaseError("ZIP output must use real project distribution directories")


def package_notarized_zip(app: Path, identity_policy: Path,
                          xcode_notarization_id: str | None = None) -> Path:
    if xcode_notarization_id is not None:
        try:
            xcode_notarization_id = str(uuid.UUID(xcode_notarization_id))
        except (ValueError, AttributeError) as error:
            raise ReleaseError("Xcode notarization provenance must be a UUID") from error
    policy = read_identity_policy(identity_policy)
    if app.name != APP_NAME + ".app":
        raise ReleaseError("The notarized app must retain its Flixify Pro app name")
    full_source_manifest, payload_size = app_manifest(app, include_directory_attributes=True)
    source_manifest, _ = app_manifest(app)
    identifiers = known_personal_identifiers()
    source_validation = validate_notarized_app(app, policy, identifiers)
    dist = ROOT / "dist"
    destination = dist / "public-zip" / (VERSION + "-build" + str(BUILD))
    validate_distribution_directories(dist, destination)
    names = [ZIP_NAME, "zip-release-proof.json", "flixify-macos-zip.json"]
    if any((destination / name).exists() or (destination / name).is_symlink() for name in names):
        raise ReleaseError("An immutable notarized ZIP release already exists for this version/build")
    dist.mkdir(exist_ok=True)
    if shutil.disk_usage(dist).free < payload_size * 3 + 64 * 1024 * 1024:
        raise ReleaseError("Insufficient space to archive and independently verify the notarized app")
    with tempfile.TemporaryDirectory(prefix=".notarized-zip-", dir=dist) as temporary:
        working = Path(temporary)
        archive = working / ZIP_NAME
        run(["/usr/bin/ditto", "-c", "-k", "--keepParent", "--sequesterRsrc", str(app), str(archive)])
        validate_zip_layout(archive, app.name, payload_size)
        extracted = working / "extracted"; extracted.mkdir()
        run(["/usr/bin/ditto", "-x", "-k", str(archive), str(extracted)])
        if {path.name for path in extracted.iterdir()} != {app.name}:
            raise ReleaseError("Extracted ZIP has unexpected top-level files")
        extracted_app = extracted / app.name
        extracted_manifest, _ = app_manifest(extracted_app)
        if extracted_manifest != source_manifest:
            raise ReleaseError("ZIP round trip changed signed app bytes, permissions, links or file extended attributes")
        extracted_validation = validate_notarized_app(extracted_app, policy, identifiers)
        if app_manifest(app, include_directory_attributes=True)[0] != full_source_manifest or app_manifest(extracted_app)[0] != source_manifest:
            raise ReleaseError("An accepted app changed while packaging or validation was in progress")
        digest, size = sha256(archive), archive.stat().st_size
        proof = {"schema": 1, "checkedAt": datetime.now(timezone.utc).isoformat(), "format": "zip",
                 "bundleIdentifier": BUNDLE_ID, "versionName": VERSION, "buildNumber": BUILD,
                 "architectures": sorted(REQUIRED_ARCHITECTURES), "signingIdentityKind": policy["identityKind"],
                 "identityFingerprint": policy["certificateSha1"].upper(), "signingTeamIdentifier": policy["teamIdentifier"],
                 "identityPolicySha256": sha256(identity_policy), "sourceAppUnchanged": True,
                 "sourceAppManifestSha256": source_manifest, "extractedAppManifestSha256": extracted_manifest,
                 "sourceAppFullMetadataManifestSha256": full_source_manifest,
                 "archiveManifestScope": "All app file bytes, modes, internal links and file extended attributes; directory extended attributes are not ZIP trust evidence",
                 "extractedAppMatchesSource": True, "sourceValidation": source_validation,
                 "extractedValidation": extracted_validation, "appResigned": False,
                 "zipNotarizationOrStaplingClaimed": False, "publicDistributionReady": True,
                 "sha256": digest, "sizeBytes": size}
        if xcode_notarization_id is not None:
            proof["xcodeNotarizationProvenance"] = {"submissionId": xcode_notarization_id,
                                                   "trustAuthority": False}
        descriptor = {"schema": 1, "format": "zip", "bundleIdentifier": BUNDLE_ID,
                      "versionName": VERSION, "buildNumber": BUILD, "minimumSystemVersion": MINIMUM_SYSTEM,
                      "architectures": sorted(REQUIRED_ARCHITECTURES), "zipUrl": ZIP_URL,
                      "sha256": digest, "sizeBytes": size,
                      "notes": "Apple tarafından noter onayı alınmış Flixify Pro macOS uygulaması."}
        proof_file = working / names[1]; proof_file.write_text(json.dumps(proof, indent=2) + "\n")
        descriptor_file = working / names[2]; descriptor_file.write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n")
        for file in (archive, proof_file, descriptor_file): file.chmod(0o644)
        destination.mkdir(parents=True, exist_ok=True)
        validate_distribution_directories(dist, destination)
        publish_files([archive, proof_file, descriptor_file], destination)
    return destination / ZIP_NAME


def main() -> None:
    parser = argparse.ArgumentParser(description="Archive an already notarized, stapled, Gatekeeper-accepted app; never re-sign it")
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--identity-policy", type=Path, required=True)
    parser.add_argument("--xcode-notarization-id", help="Optional provenance UUID; never substitutes for actual trust checks")
    args = parser.parse_args()
    print(package_notarized_zip(args.app.absolute(), args.identity_policy, args.xcode_notarization_id))
