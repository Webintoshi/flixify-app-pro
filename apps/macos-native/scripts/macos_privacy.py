"""Release privacy checks; they reduce metadata leaks, not reverse engineering."""
from __future__ import annotations

import getpass
import hashlib
import json
import os
import re
import socket
import subprocess
import struct
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from macos_runtime import ROOT, ReleaseError, macho_architectures

PUBLIC_CONTACTS = {b"support@flixify.vip", b"destek@flixify.vip", b"info@flixify.vip"}
EMAIL = re.compile(rb"(?<![A-Za-z0-9._%+\-])[A-Za-z0-9][A-Za-z0-9._%+\-]{0,63}@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,63}")
CREDENTIAL_URL = re.compile(rb"https?://[^\s\x00\"<>]{1,2048}(?:[?&](?:username|password|access_token|token)=[^\s\x00\"<>]+|/(?:live|movie|series)/[^/\s\x00\"<>]{3,}/[^/\s\x00\"<>]{3,}/)", re.I)
POLICY_KEYS = {"schema", "identityKind", "organizationEnrollmentVerified",
               "publicDistributionApproved", "teamIdentifier", "certificateSha1"}
INDIVIDUAL_POLICY_KEYS = {"schema", "identityKind", "individualEnrollmentVerified",
                         "personalNameVisibilityAccepted", "publicDistributionApproved",
                         "teamIdentifier", "certificateSha1"}


@dataclass(frozen=True)
class SigningIdentityApproval:
    identity_kind: str
    fingerprint: str
    team_identifier: str
    certificate_subject: str
    holder_name: str

    def personal_name_identifiers(self) -> set[str]:
        if self.identity_kind != "individual":
            return set()
        return {self.holder_name, unicodedata.normalize("NFKD", self.holder_name).encode("ascii", "ignore").decode()} - {""}


def private_output(arguments: list[str]) -> str:
    result = subprocess.run(arguments, cwd=ROOT, text=True, capture_output=True, timeout=15)
    return result.stdout.strip() if result.returncode == 0 else ""


def known_personal_identifiers(identity_output: str = "") -> set[str]:
    values = {getpass.getuser(), Path.home().name, socket.gethostname(),
              private_output(["/usr/bin/id", "-F"]),
              private_output(["/usr/bin/git", "config", "user.name"]),
              private_output(["/usr/bin/git", "config", "user.email"]),
              private_output(["/usr/sbin/scutil", "--get", "LocalHostName"]),
              private_output(["/usr/sbin/scutil", "--get", "ComputerName"])}
    if not identity_output:
        identity_output = private_output(["/usr/bin/security", "find-identity", "-p", "codesigning", "-v"])
    values.update(re.findall(r'"Apple Development: (.+?) \([A-Z0-9]{10}\)"', identity_output))
    expanded = set()
    for value in values:
        if not value or value.lower() in {"root", "user", "developer", "runner"}:
            continue
        expanded.add(value)
        expanded.add(value.removesuffix(".local"))
        expanded.add(unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode())
    return {value for value in expanded if len(value) >= 4}


def identifier_hits(data: bytes, identifiers: set[str]) -> int:
    folded = data.lower()
    matches = 0
    for value in identifiers:
        variants = [value.encode("utf-8"), value.encode("utf-16-le"), value.encode("utf-16-be"),
                    json.dumps(value, ensure_ascii=True)[1:-1].encode()]
        matches += int(any(variant.lower() in folded for variant in variants))
    return matches


def _validate_identity_policy(policy: dict) -> dict:
    if not isinstance(policy, dict):
        raise ReleaseError("Reviewed signing identity policy is incomplete")
    kind = policy.get("identityKind")
    expected = POLICY_KEYS if kind == "organization" else INDIVIDUAL_POLICY_KEYS
    enrollment = "organizationEnrollmentVerified" if kind == "organization" else "individualEnrollmentVerified"
    if (not isinstance(kind, str) or kind not in {"organization", "individual"} or set(policy) != expected or
            type(policy.get("schema")) is not int or policy["schema"] != 1 or
            policy.get(enrollment) is not True or policy.get("publicDistributionApproved") is not True or
            (kind == "individual" and policy.get("personalNameVisibilityAccepted") is not True) or
            not isinstance(policy.get("teamIdentifier"), str) or
            not re.fullmatch(r"[A-Z0-9]{10}", policy["teamIdentifier"]) or
            not isinstance(policy.get("certificateSha1"), str) or
            not re.fullmatch(r"[A-Fa-f0-9]{40}", policy["certificateSha1"])):
        raise ReleaseError("Signing identity policy is incomplete or does not permit public distribution")
    return policy


def read_identity_policy(path: Path | None) -> dict:
    if path is None:
        raise ReleaseError("Public signing/notarization requires an explicitly reviewed identity policy")
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
        raise ReleaseError("A reviewed signing identity policy is required")
    return _validate_identity_policy(json.loads(path.read_text()))


def read_organization_policy(path: Path | None) -> dict:
    policy = read_identity_policy(path)
    if policy["identityKind"] != "organization":
        raise ReleaseError("The organization policy option requires reviewed organization enrollment")
    return policy


def validate_organization_subject(identity_output: str, fingerprint: str,
                                  policy: dict, identifiers: set[str]) -> None:
    if policy.get("identityKind") != "organization":
        raise ReleaseError("Organization identity approval is required")
    validate_signing_subject(identity_output, fingerprint, policy, identifiers)


def validate_signing_subject(identity_output: str, fingerprint: str,
                             policy: dict, identifiers: set[str]) -> SigningIdentityApproval:
    _validate_identity_policy(policy)
    if fingerprint.upper() != policy["certificateSha1"].upper():
        raise ReleaseError("Signing certificate differs from the reviewed identity")
    match = re.search(r'^\s*\d+\)\s+' + re.escape(fingerprint) +
                      r'\s+"(Developer ID Application: [^"]+)"', identity_output, re.M | re.I)
    if not match:
        raise ReleaseError("Approved Developer ID Application identity is unavailable")
    subject = match[1]
    team = re.search(r"\(([A-Z0-9]{10})\)$", subject)
    if not team or team[1] != policy["teamIdentifier"]:
        raise ReleaseError("Signing team differs from the reviewed enrollment")
    if policy["identityKind"] == "organization" and identifier_hits(subject.encode(), identifiers):
        raise ReleaseError("Certificate subject exposes a known personal identifier; public signing is blocked")
    holder = subject[:team.start()].removeprefix("Developer ID Application: ").strip()
    if not holder:
        raise ReleaseError("Developer ID Application subject is malformed")
    return SigningIdentityApproval(policy["identityKind"], fingerprint.upper(), team[1], subject, holder)


def _signature_command(arguments: list[str]) -> bytes:
    result = subprocess.run(arguments, capture_output=True, timeout=60)
    if result.returncode:
        raise ReleaseError("Approved signature verification failed (certificate values suppressed)")
    return result.stdout + result.stderr


def _der_value(data: bytes, offset: int, end: int) -> tuple[int, int, int]:
    if offset < 0 or offset + 2 > end:
        raise ReleaseError("Malformed signing certificate")
    tag, length = data[offset], data[offset + 1]
    start = offset + 2
    if length & 0x80:
        count = length & 0x7f
        if not 1 <= count <= 4 or start + count > end or data[start] == 0:
            raise ReleaseError("Malformed signing certificate length")
        length = int.from_bytes(data[start:start + count], "big")
        start += count
        if length < 128:
            raise ReleaseError("Noncanonical signing certificate length")
    stop = start + length
    if stop > end:
        raise ReleaseError("Signing certificate exceeds its container")
    return tag, start, stop


def _der_children(data: bytes, start: int, end: int) -> list[tuple[int, int, int]]:
    result = []
    while start < end:
        value = _der_value(data, start, end)
        result.append(value)
        start = value[2]
        if len(result) > 128:
            raise ReleaseError("Signing certificate container is oversized")
    return result


def _certificate_name_ranges(certificate: bytes, approval: SigningIdentityApproval) -> list[tuple[int, int]]:
    tag, start, end = _der_value(certificate, 0, len(certificate))
    if tag != 0x30 or end != len(certificate):
        raise ReleaseError("Signing certificate is not a DER sequence")
    outer = _der_children(certificate, start, end)
    if not outer or outer[0][0] != 0x30:
        raise ReleaseError("Signing certificate has no certificate body")
    fields = _der_children(certificate, outer[0][1], outer[0][2])
    index = 5 if fields and fields[0][0] == 0xa0 else 4
    if len(fields) <= index or fields[index][0] != 0x30:
        raise ReleaseError("Signing certificate has no subject")
    names = {b"\x55\x04\x03": approval.certificate_subject,
             b"\x55\x04\x0a": approval.holder_name}
    result = []
    for tag, begin, stop in _der_children(certificate, fields[index][1], fields[index][2]):
        if tag != 0x31:
            raise ReleaseError("Signing certificate subject is malformed")
        for tag, begin, stop in _der_children(certificate, begin, stop):
            values = _der_children(certificate, begin, stop) if tag == 0x30 else []
            if len(values) != 2 or values[0][0] != 6:
                raise ReleaseError("Signing certificate subject attribute is malformed")
            expected = names.get(certificate[values[0][1]:values[0][2]])
            if expected is None:
                continue
            value_tag, value_start, value_end = values[1]
            encodings = {12: "utf-8", 19: "ascii", 30: "utf-16-be"}
            try:
                decoded = certificate[value_start:value_end].decode(encodings[value_tag])
            except (KeyError, UnicodeError) as error:
                raise ReleaseError("Unsupported signing certificate subject encoding") from error
            if decoded != expected:
                raise ReleaseError("Certificate subject differs from the reviewed Developer ID")
            result.append((value_start, value_end))
    if not result:
        raise ReleaseError("Approved certificate subject was not found")
    return result


def _cms_regions(data: bytes) -> list[tuple[int, int]]:
    magic = data[:4]
    fat = {b"\xca\xfe\xba\xbe": (">", 20), b"\xbe\xba\xfe\xca": ("<", 20),
           b"\xca\xfe\xba\xbf": (">", 32), b"\xbf\xba\xfe\xca": ("<", 32)}
    slices = [(0, len(data))]
    if magic in fat:
        endian, stride = fat[magic]
        count = struct.unpack_from(endian + "I", data, 4)[0] if len(data) >= 8 else 0
        if not 1 <= count <= 64 or 8 + count * stride > len(data):
            raise ReleaseError("Malformed universal signing container")
        slices, cpu_types = [], set()
        for index in range(count):
            entry = 8 + index * stride
            cpu_type = struct.unpack_from(endian + "I", data, entry)[0]
            if cpu_type in cpu_types:
                raise ReleaseError("Ambiguous duplicate architecture in signing container")
            cpu_types.add(cpu_type)
            position = entry + 8
            offset, size = struct.unpack_from(endian + ("II" if stride == 20 else "QQ"), data, position)
            if offset < 8 + count * stride or size < 28 or offset + size > len(data) or any(offset < prior + length and prior < offset + size for prior, length in slices):
                raise ReleaseError("Universal signing slice is out of bounds")
            slices.append((offset, size))
    thin = {b"\xce\xfa\xed\xfe": ("<", 28), b"\xcf\xfa\xed\xfe": ("<", 32),
            b"\xfe\xed\xfa\xce": (">", 28), b"\xfe\xed\xfa\xcf": (">", 32)}
    regions = []
    for base, size in slices:
        endian, header = thin.get(data[base:base + 4], ("", 0))
        if not header or size < header:
            raise ReleaseError("Malformed Mach-O signing container")
        count, commands_size = struct.unpack_from(endian + "II", data, base + 16)
        end, cursor = base + header + commands_size, base + header
        if count > 4096 or end > base + size:
            raise ReleaseError("Mach-O signing commands exceed the slice")
        signatures = []
        for _ in range(count):
            if cursor + 8 > end:
                raise ReleaseError("Truncated Mach-O signing command")
            command, length = struct.unpack_from(endian + "II", data, cursor)
            if length < 8 or cursor + length > end:
                raise ReleaseError("Invalid Mach-O signing command size")
            if command == 0x1d:
                if length != 16:
                    raise ReleaseError("Invalid code signature load command")
                offset, length = struct.unpack_from(endian + "II", data, cursor + 8)
                signatures.append((base + offset, length))
            cursor += struct.unpack_from(endian + "I", data, cursor + 4)[0]
        if cursor != end or len(signatures) != 1:
            raise ReleaseError("A single embedded Mach-O signature is required")
        offset, length = signatures[0]
        if offset < end or length < 20 or offset + length > base + size:
            raise ReleaseError("Embedded signature exceeds its Mach-O slice")
        signature_magic, total, entries = struct.unpack_from(">III", data, offset)
        if signature_magic != 0xfade0cc0 or total > length or entries > 64 or 12 + entries * 8 > total:
            raise ReleaseError("Malformed embedded signature superblob")
        cms = []
        for index in range(entries):
            slot, relative = struct.unpack_from(">II", data, offset + 12 + index * 8)
            if slot != 0x10000:
                continue
            if relative < 12 + entries * 8 or relative + 8 > total:
                raise ReleaseError("CMS signature slot exceeds the superblob")
            tag, blob_length = struct.unpack_from(">II", data, offset + relative)
            if tag != 0xfade0b01 or blob_length < 8 or relative + blob_length > total:
                raise ReleaseError("Malformed CMS signature slot")
            cms.append((offset + relative + 8, offset + relative + blob_length))
        if len(cms) != 1:
            raise ReleaseError("A single Developer ID CMS signature is required")
        regions += cms
    return regions


def _approved_signature_data(path: Path, data: bytes, approval: SigningIdentityApproval) -> tuple[bytes, int]:
    _signature_command(["/usr/bin/codesign", "--verify", "--all-architectures", "--strict", str(path)])
    certificate = None
    with tempfile.TemporaryDirectory(prefix="flixify-signature-audit-") as directory:
        for architecture in sorted(macho_architectures(data[:4096])):
            select = ["/usr/bin/codesign", "--display", "--architecture", architecture]
            details = _signature_command([*select, "--verbose=4", str(path)]).decode("utf-8", "replace")
            if re.findall(r"^TeamIdentifier=(\S+)$", details, re.M) != [approval.team_identifier]:
                raise ReleaseError("Actual signature team differs from the reviewed enrollment")
            prefix = str(Path(directory) / ("certificate-" + architecture + "-"))
            _signature_command([*select, "--extract-certificates=" + prefix, str(path)])
            leaf = Path(prefix + "0")
            if leaf.is_symlink() or not leaf.is_file() or not 1 <= leaf.stat().st_size <= 32768:
                raise ReleaseError("Actual signing certificate is unavailable")
            actual = leaf.read_bytes()
            if hashlib.sha1(actual).hexdigest().upper() != approval.fingerprint or certificate is not None and certificate != actual:
                raise ReleaseError("Actual signature certificate differs from the reviewed identity")
            certificate = actual
    if certificate is None:
        raise ReleaseError("No signed architecture was found")
    ranges = _certificate_name_ranges(certificate, approval)
    masked, excluded = bytearray(data), 0
    for start, end in _cms_regions(data):
        position = data.find(certificate, start, end)
        if position < 0 or data.find(certificate, position + len(certificate), end) >= 0:
            raise ReleaseError("Reviewed certificate is not unique in the actual CMS signature")
        for begin, stop in ranges:
            masked[position + begin:position + stop] = b" " * (stop - begin)
            excluded += stop - begin
    return bytes(masked), excluded


def upstream_file(relative: str) -> bool:
    return (relative.startswith("Contents/Frameworks/VLCKit.framework/") or
            relative in {"Contents/Resources/COPYING-VLCKit.txt", "Contents/Resources/VLCKit-origin.json"})


def audit_release_privacy(app: Path, *, identifiers: set[str] | None = None,
                          raise_on_failure: bool = True,
                          signing_identity: SigningIdentityApproval | None = None) -> dict:
    identifiers = known_personal_identifiers() if identifiers is None else identifiers
    if signing_identity is not None and not isinstance(signing_identity, SigningIdentityApproval):
        raise ReleaseError("A validated signing identity is required")
    if signing_identity is not None:
        identifiers = identifiers | signing_identity.personal_name_identifiers()
    totals = {"filesScanned": 0, "knownPersonalIdentifierMatches": 0,
              "ownedUserPathMatches": 0, "ownedTemporaryPathMatches": 0,
              "ownedEmailPatternMatches": 0, "upstreamUserPathMatches": 0,
              "upstreamTemporaryPathMatches": 0, "upstreamEmailPatternMatches": 0,
              "publicContactEmailMatches": 0, "forbiddenProductFiles": 0,
              "ownedCredentialUrlPatternMatches": 0, "upstreamCredentialUrlPatternMatches": 0,
              "approvedCertificateSubjectBytesExcluded": 0}
    findings = []
    for path in sorted(app.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        relative = str(path.relative_to(app))
        third_party = upstream_file(relative)
        data = path.read_bytes()
        identifier_data = data
        if (signing_identity is not None and signing_identity.identity_kind == "individual" and
                macho_architectures(data[:4096])):
            identifier_data, excluded = _approved_signature_data(path, data, signing_identity)
            totals["approvedCertificateSubjectBytesExcluded"] += excluded
        totals["filesScanned"] += 1
        personal = identifier_hits(identifier_data, identifiers) + identifier_hits(relative.encode(), identifiers)
        users = data.count(b"/Users/")
        temporary = data.count(b"/private/var/folders/") + data.count(b"/private/tmp/")
        contacts = [value.lower() for value in EMAIL.findall(data)]
        public_contacts = sum(value in PUBLIC_CONTACTS for value in contacts)
        emails = len(contacts) - public_contacts
        credential_urls = len(CREDENTIAL_URL.findall(data))
        forbidden = (not third_party and (path.suffix in {".p12", ".p8", ".key", ".swift", ".o", ".mobileprovision", ".swiftmodule"} or
                     any(part in {".git", ".build", ".swiftpm"} or part.startswith(".env") or part.endswith(".dSYM") for part in path.relative_to(app).parts)))
        prefix = "upstream" if third_party else "owned"
        totals["knownPersonalIdentifierMatches"] += personal
        totals[prefix + "UserPathMatches"] += users
        totals[prefix + "TemporaryPathMatches"] += temporary
        totals[prefix + "EmailPatternMatches"] += emails
        totals[prefix + "CredentialUrlPatternMatches"] += credential_urls
        totals["publicContactEmailMatches"] += public_contacts
        totals["forbiddenProductFiles"] += int(forbidden)
        if personal or users or temporary or emails or forbidden or credential_urls:
            findings.append({"fileRole": "upstream VideoLAN" if third_party else "application",
                             "relativePathSha256": hashlib.sha256(relative.encode()).hexdigest(),
                             "knownIdentifierMatches": personal, "userPathMatches": users,
                             "temporaryPathMatches": temporary, "emailPatternMatches": emails,
                             "credentialUrlPatternMatches": credential_urls,
                             "forbiddenProductFile": bool(forbidden)})
    passed = not any(totals[key] for key in ["knownPersonalIdentifierMatches", "ownedUserPathMatches",
                                           "ownedTemporaryPathMatches", "ownedEmailPatternMatches", "forbiddenProductFiles", "ownedCredentialUrlPatternMatches"])
    report = {"schema": 1, **totals, "passed": passed, "matchedValuesIncluded": False,
              "certificateSubjectVisibility": "A Developer ID certificate subject is public and cannot be hidden",
              "organizationIdentityApprovalRequired": signing_identity is None or signing_identity.identity_kind == "organization",
              "signingIdentityApprovalRequired": True,
              "individualNameVisibilityAccepted": signing_identity is not None and signing_identity.identity_kind == "individual",
              "scope": "Build metadata hygiene and known local identity patterns; not an anonymity or reverse-engineering guarantee",
              "upstreamProvenancePreserved": True, "findings": findings}
    if not passed and raise_on_failure:
        raise ReleaseError("Release privacy audit failed; known identity or owned build metadata remains (matched values suppressed)")
    return report
