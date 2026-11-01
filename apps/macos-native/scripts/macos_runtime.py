"""Pinned, project-local playback runtime preparation."""
from __future__ import annotations

import hashlib
import json
import os
import plistlib
import shutil
import struct
import tarfile
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_URL = "https://download.videolan.org/cocoapods/prod/VLCKit-3.7.3-319ed2c0-79128878.tar.xz"
RUNTIME_SHA256 = "019afdae4e2e2d0f3ac325fac8f7ba0af25dca70b9d157df7d60db88e0be8e5d"
RUNTIME_BYTES = 88_186_488
FRAMEWORK_PREFIX = PurePosixPath("VLCKit - binary package/VLCKit.xcframework")
LIBRARY_ID = "macos-arm64_x86_64"
FRAMEWORK_RELATIVE = Path(LIBRARY_ID) / "VLCKit.framework"
EXECUTABLE_RELATIVE = FRAMEWORK_RELATIVE / "Versions/A/VLCKit"
REQUIRED_ARCHITECTURES = frozenset({"arm64", "x86_64"})


class ReleaseError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(data)
    return digest.hexdigest()


def macho_architectures(header: bytes) -> frozenset[str]:
    names = {0x01000007: "x86_64", 0x0100000C: "arm64"}
    if len(header) < 8:
        return frozenset()
    magic = header[:4]
    if magic in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        count = struct.unpack(">I", header[4:8])[0]
        step = 32 if magic == b"\xca\xfe\xba\xbf" else 20
        if not 1 <= count <= 16 or len(header) < 8 + count * step:
            raise ReleaseError("Invalid universal Mach-O header")
        values = [struct.unpack(">I", header[8 + i * step:12 + i * step])[0] for i in range(count)]
    elif magic in (b"\xce\xfa\xed\xfe", b"\xcf\xfa\xed\xfe"):
        values = [struct.unpack("<I", header[4:8])[0]]
    elif magic in (b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf"):
        values = [struct.unpack(">I", header[4:8])[0]]
    else:
        return frozenset()
    return frozenset(names.get(value, hex(value)) for value in values)


def validate_runtime_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "download.videolan.org" or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ReleaseError("Runtime download must stay on the fixed VideoLAN HTTPS origin")


class FixedOriginRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        validate_runtime_url(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def validate_relative_path(value: str) -> PurePosixPath:
    result = PurePosixPath(value)
    if result.is_absolute() or ".." in result.parts or "\\" in value:
        raise ReleaseError("Unsafe archive path")
    return result


def extract_runtime(archive_path: Path, destination: Path) -> None:
    links = []
    copied_license = False
    with tarfile.open(archive_path, "r:xz") as archive:
        for entry in archive:
            source = validate_relative_path(entry.name)
            if any(part.startswith("._") for part in source.parts):
                continue
            license_entry = source == PurePosixPath("VLCKit - binary package/COPYING.txt")
            if license_entry:
                relative = PurePosixPath("COPYING.txt")
            elif source.is_relative_to(FRAMEWORK_PREFIX):
                relative = source.relative_to(FRAMEWORK_PREFIX)
                if relative != PurePosixPath("Info.plist") and not relative.is_relative_to(PurePosixPath(LIBRARY_ID) / "VLCKit.framework"):
                    continue
                relative = PurePosixPath("VLCKit.xcframework") / relative
            else:
                continue
            target = destination.joinpath(*relative.parts)
            if entry.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if entry.issym():
                link = PurePosixPath(entry.linkname)
                if link.is_absolute() or "\\" in entry.linkname:
                    raise ReleaseError("Unsafe archive symlink")
                resolved = (target.parent / entry.linkname).resolve()
                if not resolved.is_relative_to(destination.resolve()):
                    raise ReleaseError("Archive symlink leaves the runtime")
                links.append((target, entry.linkname))
            elif entry.isfile():
                handle = archive.extractfile(entry)
                if handle is None:
                    raise ReleaseError("Missing archive contents")
                with target.open("xb") as output:
                    shutil.copyfileobj(handle, output)
                target.chmod(0o755 if entry.mode & 0o111 else 0o644)
                copied_license |= license_entry
            else:
                raise ReleaseError("Unsupported archive entry")
    for target, linkname in links:
        target.symlink_to(linkname)
    if not copied_license:
        raise ReleaseError("VideoLAN license missing")
    metadata = destination / "VLCKit.xcframework/Info.plist"
    info = plistlib.loads(metadata.read_bytes())
    libraries = info.get("AvailableLibraries", [])
    if len(libraries) != 1 or libraries[0].get("LibraryIdentifier") != LIBRARY_ID or libraries[0].get("SupportedPlatform") != "macos" or set(libraries[0].get("SupportedArchitectures", [])) != REQUIRED_ARCHITECTURES:
        raise ReleaseError("Unexpected runtime platform or architectures")
    libraries[0].pop("DebugSymbolsPath", None)
    metadata.write_bytes(plistlib.dumps(info))
    executable = destination / "VLCKit.xcframework" / EXECUTABLE_RELATIVE
    with executable.open("rb") as handle:
        if macho_architectures(handle.read(4096)) != REQUIRED_ARCHITECTURES:
            raise ReleaseError("Playback runtime must contain Intel and Apple Silicon code")


def prepare_runtime() -> Path:
    vendor = ROOT / "Vendor"
    runtime = vendor / "VLCKit.xcframework"
    proof_path = vendor / "runtime-proof.json"
    if runtime.exists():
        if not proof_path.is_file():
            raise ReleaseError("Existing runtime has no verified preparation proof")
        proof = json.loads(proof_path.read_text())
        binary = runtime / EXECUTABLE_RELATIVE
        if proof.get("archiveSha256") != RUNTIME_SHA256 or proof.get("executableSha256") != sha256(binary) or not (vendor / "COPYING.txt").is_file():
            raise ReleaseError("Existing runtime does not match its pinned proof")
        return runtime
    vendor.mkdir(parents=True, exist_ok=True)
    scratch = ROOT / ".build"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="runtime-", dir=scratch) as temp:
        stage = Path(temp)
        archive = stage / "VLCKit.tar.xz"
        validate_runtime_url(RUNTIME_URL)
        opener = urllib.request.build_opener(FixedOriginRedirect())
        with opener.open(RUNTIME_URL, timeout=60) as response, archive.open("wb") as output:
            validate_runtime_url(response.url)
            count = 0
            while data := response.read(1024 * 1024):
                count += len(data)
                if count > RUNTIME_BYTES:
                    raise ReleaseError("Runtime archive exceeds pinned size")
                output.write(data)
        if count != RUNTIME_BYTES or sha256(archive) != RUNTIME_SHA256:
            raise ReleaseError("Runtime archive size or SHA256 mismatch")
        extracted = stage / "extracted"
        extracted.mkdir()
        extract_runtime(archive, extracted)
        executable_hash = sha256(extracted / "VLCKit.xcframework" / EXECUTABLE_RELATIVE)
        shutil.move(str(extracted / "VLCKit.xcframework"), runtime)
        shutil.copyfile(extracted / "COPYING.txt", vendor / "COPYING.txt")
        proof_path.write_text(json.dumps({"schema": 1, "version": "3.7.3", "origin": RUNTIME_URL, "archiveSha256": RUNTIME_SHA256, "archiveBytes": RUNTIME_BYTES, "executableSha256": executable_hash, "architectures": sorted(REQUIRED_ARCHITECTURES), "excluded": ["dSYMs", "Sample Code", "AppleDouble metadata"], "metadataAdjustment": "DebugSymbolsPath omitted with unshipped dSYMs"}, indent=2) + "\n")
    return runtime


if __name__ == "__main__":
    try:
        print(prepare_runtime())
    except (ReleaseError, OSError, ValueError) as error:
        raise SystemExit(str(error))
