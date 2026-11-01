"""Release privacy checks; they reduce metadata leaks, not reverse engineering."""
from __future__ import annotations

import getpass
import hashlib
import json
import os
import re
import socket
import subprocess
import unicodedata
from pathlib import Path

from macos_runtime import ROOT, ReleaseError

PUBLIC_CONTACTS = {b"support@flixify.vip", b"destek@flixify.vip", b"info@flixify.vip"}
EMAIL = re.compile(rb"(?<![A-Za-z0-9._%+\-])[A-Za-z0-9][A-Za-z0-9._%+\-]{0,63}@[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,63}")
CREDENTIAL_URL = re.compile(rb"https?://[^\s\x00\"<>]{1,2048}(?:[?&](?:username|password|access_token|token)=[^\s\x00\"<>]+|/(?:live|movie|series)/[^/\s\x00\"<>]{3,}/[^/\s\x00\"<>]{3,}/)", re.I)
POLICY_KEYS = {"schema", "identityKind", "organizationEnrollmentVerified",
               "publicDistributionApproved", "teamIdentifier", "certificateSha1"}


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


def read_organization_policy(path: Path | None) -> dict:
    if path is None:
        raise ReleaseError("Public signing/notarization is suspended until an organization identity is approved")
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
        raise ReleaseError("A reviewed organization identity policy is required")
    policy = json.loads(path.read_text())
    if (not isinstance(policy, dict) or set(policy) != POLICY_KEYS or
            type(policy.get("schema")) is not int or policy["schema"] != 1 or
            policy.get("identityKind") != "organization" or
            policy.get("organizationEnrollmentVerified") is not True or
            policy.get("publicDistributionApproved") is not True or
            not re.fullmatch(r"[A-Z0-9]{10}", policy.get("teamIdentifier", "")) or
            not re.fullmatch(r"[A-Fa-f0-9]{40}", policy.get("certificateSha1", ""))):
        raise ReleaseError("Organization identity policy is incomplete or does not permit public distribution")
    return policy


def validate_organization_subject(identity_output: str, fingerprint: str,
                                  policy: dict, identifiers: set[str]) -> None:
    if fingerprint.upper() != policy["certificateSha1"].upper():
        raise ReleaseError("Signing certificate differs from the approved organization identity")
    match = re.search(r'^\s*\d+\)\s+' + re.escape(fingerprint) +
                      r'\s+"(Developer ID Application: [^"]+)"', identity_output, re.M | re.I)
    if not match:
        raise ReleaseError("Approved Developer ID Application identity is unavailable")
    subject = match[1]
    team = re.search(r"\(([A-Z0-9]{10})\)$", subject)
    if not team or team[1] != policy["teamIdentifier"]:
        raise ReleaseError("Signing team differs from the approved organization enrollment")
    if identifier_hits(subject.encode(), identifiers):
        raise ReleaseError("Certificate subject exposes a known personal identifier; public signing is blocked")


def upstream_file(relative: str) -> bool:
    return (relative.startswith("Contents/Frameworks/VLCKit.framework/") or
            relative in {"Contents/Resources/COPYING-VLCKit.txt", "Contents/Resources/VLCKit-origin.json"})


def audit_release_privacy(app: Path, *, identifiers: set[str] | None = None,
                          raise_on_failure: bool = True) -> dict:
    identifiers = known_personal_identifiers() if identifiers is None else identifiers
    totals = {"filesScanned": 0, "knownPersonalIdentifierMatches": 0,
              "ownedUserPathMatches": 0, "ownedTemporaryPathMatches": 0,
              "ownedEmailPatternMatches": 0, "upstreamUserPathMatches": 0,
              "upstreamTemporaryPathMatches": 0, "upstreamEmailPatternMatches": 0,
              "publicContactEmailMatches": 0, "forbiddenProductFiles": 0,
              "ownedCredentialUrlPatternMatches": 0, "upstreamCredentialUrlPatternMatches": 0}
    findings = []
    for path in sorted(app.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        relative = str(path.relative_to(app))
        third_party = upstream_file(relative)
        data = path.read_bytes()
        totals["filesScanned"] += 1
        personal = identifier_hits(data, identifiers) + identifier_hits(relative.encode(), identifiers)
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
              "organizationIdentityApprovalRequired": True,
              "scope": "Build metadata hygiene and known local identity patterns; not an anonymity or reverse-engineering guarantee",
              "upstreamProvenancePreserved": True, "findings": findings}
    if not passed and raise_on_failure:
        raise ReleaseError("Release privacy audit failed; known identity or owned build metadata remains (matched values suppressed)")
    return report
