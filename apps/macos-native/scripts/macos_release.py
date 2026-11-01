"""Build a local app; admit public packages only after Apple's trust checks."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from macos_runtime import (EXECUTABLE_RELATIVE, FRAMEWORK_RELATIVE, ROOT,
                           REQUIRED_ARCHITECTURES, ReleaseError,
                           macho_architectures, prepare_runtime, sha256)
from macos_privacy import (audit_release_privacy, known_personal_identifiers,
                           read_organization_policy, validate_organization_subject)

PRODUCT = "FlixifyMac"
APP_NAME = "Flixify Pro"
BUNDLE_ID = "vip.flixify.mac"
VERSION = "1.0.0"
BUILD = 1
MINIMUM_SYSTEM = "13.0"
DMG_NAME = f"Flixify-Pro-{VERSION}-macos-universal.dmg"
DOWNLOAD_URL = f"https://flixify.vip/downloads/{DMG_NAME}"


def run(arguments: list[str], *, cwd: Path | None = None, capture: bool = False,
        timeout: int = 1800) -> str:
    result = subprocess.run(arguments, cwd=cwd or ROOT, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None,
                            timeout=timeout)
    if result.returncode:
        detail = ((result.stderr or result.stdout or "").strip()[-2000:]
                  if capture else "")
        raise ReleaseError(f"{Path(arguments[0]).name} failed ({result.returncode}) {detail}")
    return result.stdout or ""


def macho_files(root: Path) -> list[Path]:
    found = []
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        with path.open("rb") as handle:
            if macho_architectures(handle.read(4096)):
                found.append(path)
    return sorted(found)


def library_dependencies(output: str) -> list[str]:
    return list(dict.fromkeys(line.strip().split(" (compatibility version", 1)[0]
                              for line in output.splitlines()
                              if line.startswith("\t") and " (compatibility version" in line))


def load_paths(output: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"^\s*path (.+) \(offset \d+\)$", output, re.M)))


def validate_dependency(dependency: str, binary: Path, app: Path) -> None:
    if dependency.startswith(("/System/Library/", "/usr/lib/")):
        return
    frameworks = app / "Contents/Frameworks"
    if dependency.startswith("@rpath/"):
        relative = dependency.removeprefix("@rpath/")
        if relative.startswith("libswift") and "/" not in relative:
            return
        target = frameworks / relative
    elif dependency.startswith("@loader_path/"):
        target = binary.parent / dependency.removeprefix("@loader_path/")
    elif dependency.startswith("@executable_path/"):
        target = app / "Contents/MacOS" / dependency.removeprefix("@executable_path/")
    else:
        raise ReleaseError(f"External dependency in {binary.name}: {dependency}")
    resolved = target.resolve()
    if not resolved.is_relative_to(app.resolve()) or not resolved.is_file():
        raise ReleaseError(f"Unbundled dependency in {binary.name}: {dependency}")


def validate_macos_versions(output: str) -> None:
    minimums = []
    for block in output.split("Load command "):
        command = re.search(r"^\s*cmd (LC_\S+)\s*$", block, re.M)
        if not command:
            continue
        kind = command[1]
        if kind == "LC_BUILD_VERSION":
            platform = re.search(r"^\s*platform (\S+)\s*$", block, re.M)
            version = re.search(r"^\s*minos (\d+\.\d+(?:\.\d+)?)\s*$", block, re.M)
            if not platform or platform[1] not in ("1", "MACOS", "macos") or not version:
                raise ReleaseError("Non-macOS or malformed build command")
            minimums.append(version[1])
        elif kind == "LC_VERSION_MIN_MACOSX":
            version = re.search(r"^\s*version (\d+\.\d+(?:\.\d+)?)\s*$", block, re.M)
            if not version:
                raise ReleaseError("Malformed macOS deployment target")
            minimums.append(version[1])
        elif kind.startswith("LC_VERSION_MIN_"):
            raise ReleaseError("Non-macOS Mach-O bundled")
    if not minimums:
        raise ReleaseError("Mach-O has no macOS deployment target")
    for value in minimums:
        parts = tuple(map(int, value.split(".")))
        if parts[:2] > (13, 0):
            raise ReleaseError(f"A bundled binary requires macOS {value}")


def validate_rpath(value: str, binary: Path, app: Path) -> None:
    if value.startswith(("/usr/lib/", "/System/Library/")):
        return
    if value.startswith("@loader_path/"):
        target = binary.parent / value.removeprefix("@loader_path/")
    elif value.startswith("@executable_path/"):
        target = app / "Contents/MacOS" / value.removeprefix("@executable_path/")
    elif value in ("@loader_path", "@executable_path"):
        return
    else:
        raise ReleaseError(f"External runtime search path: {value}")
    if not target.resolve().is_relative_to(app.resolve()):
        raise ReleaseError(f"Runtime search path leaves the app: {value}")


def verify_architectures(binary: Path, required_architectures) -> frozenset[str]:
    with binary.open("rb") as handle:
        architectures = macho_architectures(handle.read(4096))
    if not set(required_architectures).issubset(architectures):
        raise ReleaseError(f"Missing required architecture: {binary.name}")
    run(["/usr/bin/lipo", str(binary), "-verify_arch", *sorted(required_architectures)])
    return architectures


def audit_app(app: Path, required_architectures=REQUIRED_ARCHITECTURES) -> list[dict]:
    validate_app_metadata(app)
    reports = []
    for binary in macho_files(app):
        architectures = verify_architectures(binary, required_architectures)
        dependencies = library_dependencies(run(["/usr/bin/otool", "-L", str(binary)], capture=True))
        identity_output = run(["/usr/bin/otool", "-D", str(binary)], capture=True)
        identities = {line.strip() for line in identity_output.splitlines()
                      if line.startswith(("@", "/System/Library/", "/usr/lib/"))}
        for dependency in dependencies:
            if dependency not in identities:
                validate_dependency(dependency, binary, app)
        commands = run(["/usr/bin/otool", "-l", str(binary)], capture=True)
        for value in load_paths(commands):
            validate_rpath(value, binary, app)
        validate_macos_versions(commands)
        reports.append({"path": str(binary.relative_to(app)), "architectures": sorted(architectures),
                        "sha256": sha256(binary), "dependencies": dependencies})
    if not any(report["path"] == f"Contents/MacOS/{PRODUCT}" for report in reports):
        raise ReleaseError("Application executable missing")
    return reports


def validate_app_metadata(app: Path, *, public: bool = False) -> dict:
    if app.is_symlink() or not app.is_dir() or app.suffix != ".app":
        raise ReleaseError("A real app bundle is required")
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    expected = {"CFBundleIdentifier": BUNDLE_ID, "CFBundleExecutable": PRODUCT,
                "CFBundleShortVersionString": VERSION, "CFBundleVersion": str(BUILD),
                "LSMinimumSystemVersion": MINIMUM_SYSTEM, "CFBundlePackageType": "APPL"}
    if any(info.get(key) != value for key, value in expected.items()):
        raise ReleaseError("Application identity/version/deployment target differs")
    if public and (info.get("FlixifyBuildConfiguration") != "release" or
                   set(info.get("FlixifyArchitectures", [])) != REQUIRED_ARCHITECTURES):
        raise ReleaseError("Public packaging requires a universal release build")
    for path in app.rglob("*"):
        if path.is_symlink() and not path.resolve().is_relative_to(app.resolve()):
            raise ReleaseError("Application contains an external symlink")
    return info


def codesign_app(app: Path, identity: str, *, public: bool) -> None:
    def sign(target: Path):
        args = ["/usr/bin/codesign", "--force", "--sign", identity]
        if public:
            args += ["--timestamp", "--options", "runtime"]
        run([*args, str(target)])
    main = app / "Contents/MacOS" / PRODUCT
    for binary in macho_files(app):
        if binary != main:
            sign(binary)
    frameworks = sorted((p for p in app.rglob("*.framework") if not p.is_symlink()),
                        key=lambda p: len(p.parts), reverse=True)
    for framework in frameworks:
        sign(framework)
    sign(app)
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)])


def signing_identities(output: str) -> list[tuple[str, str]]:
    return re.findall(r'^\s*\d+\)\s+([0-9A-Fa-f]{40})\s+"(Developer ID Application: [^"]+)"', output, re.M)


def select_identity(output: str, requested: str | None) -> str:
    identities = signing_identities(output)
    if requested:
        matches = [(digest, name) for digest, name in identities if requested in (digest, name)]
    else:
        matches = identities
    if len(matches) != 1:
        raise ReleaseError("Exactly one matching Developer ID Application identity is required")
    return matches[0][0]


def validate_notary_profile(profile: str | None) -> str:
    if not profile or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_. -]{0,127}", profile):
        raise ReleaseError("Provide a stored notarytool keychain profile with --notary-profile")
    return profile


def accepted_submission(output: str) -> dict:
    result = json.loads(output)
    if result.get("status") != "Accepted" or not re.fullmatch(r"[0-9a-fA-F-]{36}", result.get("id", "")):
        raise ReleaseError("Apple notarization was not Accepted; no public artifact produced")
    return {"id": result["id"], "status": "Accepted"}


def submit_notary(archive: Path, profile: str) -> dict:
    return accepted_submission(run(["/usr/bin/xcrun", "notarytool", "submit", str(archive),
                                    "--keychain-profile", profile, "--wait", "--timeout", "20m",
                                    "--output-format", "json", "--no-progress"], capture=True,
                                   timeout=1300))


def source_manifest(path: Path) -> dict:
    entries = {}
    for item in sorted(path.rglob("*")):
        if item.is_symlink():
            entries[str(item.relative_to(path))] = {"symlink": os.readlink(item)}
        elif item.is_file():
            entries[str(item.relative_to(path))] = sha256(item)
    return entries


def stage_swift_runtime(app: Path) -> None:
    frameworks = app / "Contents/Frameworks"
    run(["/usr/bin/xcrun", "swift-stdlib-tool", "--copy", "--platform", "macosx",
         "--scan-executable", str(app / "Contents/MacOS" / PRODUCT),
         "--scan-folder", str(frameworks), "--destination", str(frameworks)])
    compiler = Path(run(["/usr/bin/xcrun", "--find", "swift"], capture=True).strip()).resolve()
    toolchain_libraries = compiler.parents[1] / "lib"
    for binary in macho_files(app):
        commands = run(["/usr/bin/otool", "-l", str(binary)], capture=True)
        for value in load_paths(commands):
            path = Path(value)
            if path.is_absolute() and path.is_relative_to(toolchain_libraries) and path.name == "macosx" and path.parent.name.startswith("swift"):
                run(["/usr/bin/install_name_tool", "-delete_rpath", value, str(binary)])


def release_privacy_flags(root: Path = ROOT, home: Path | None = None) -> list[str]:
    home = Path.home() if home is None else home
    flags = []
    mappings = [(str(home), "/BuildHome"), (str(root), "/Flixify"),
                ("/private/var/folders", "/BuildTemp"), ("/private/tmp", "/BuildTemp")]
    for source, destination in mappings:
        mapping = source + "=" + destination
        flags += ["-Xswiftc", "-file-prefix-map", "-Xswiftc", mapping,
                  "-Xswiftc", "-debug-prefix-map", "-Xswiftc", mapping,
                  "-Xcc", "-ffile-prefix-map=" + mapping,
                  "-Xcc", "-fdebug-prefix-map=" + mapping,
                  "-Xcc", "-fmacro-prefix-map=" + mapping]
    return flags + ["-Xswiftc", "-file-compilation-dir", "-Xswiftc", "/Flixify",
                    "-Xswiftc", "-Xfrontend", "-Xswiftc", "-no-serialize-debugging-options"]


def build_app(configuration: str, host_only: bool) -> Path:
    runtime = prepare_runtime()
    architectures = [os.uname().machine] if host_only else sorted(REQUIRED_ARCHITECTURES)
    if not set(architectures).issubset(REQUIRED_ARCHITECTURES):
        raise ReleaseError("Unsupported build host architecture")
    sdk = run(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"], capture=True).strip()
    outputs = []
    for architecture in architectures:
        arguments = ["/usr/bin/swift", "build", "--configuration", configuration,
                     "--scratch-path", str(ROOT / ".build" / f"{configuration}-{architecture}"),
                     "--triple", f"{architecture}-apple-macosx{MINIMUM_SYSTEM}", "--sdk", sdk,
                     "--product", PRODUCT, "--jobs", "4", "-Xlinker", "-rpath",
                     "-Xlinker", "@executable_path/../Frameworks"]
        if configuration == "release":
            arguments += release_privacy_flags()
        run(arguments)
        bin_path = Path(run([*arguments, "--show-bin-path"], capture=True).strip())
        outputs.append(bin_path)
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    app = dist / f"{APP_NAME}.app"
    with tempfile.TemporaryDirectory(prefix="app-stage-", dir=dist) as temp:
        staging = Path(temp) / app.name
        contents = staging / "Contents"
        (contents / "MacOS").mkdir(parents=True)
        (contents / "Frameworks").mkdir()
        resources = contents / "Resources"
        resources.mkdir()
        executable = contents / "MacOS" / PRODUCT
        if len(outputs) == 1:
            shutil.copyfile(outputs[0] / PRODUCT, executable)
        else:
            run(["/usr/bin/lipo", "-create", *[str(path / PRODUCT) for path in outputs],
                 "-output", str(executable)])
        executable.chmod(0o755)
        shutil.copytree(runtime / FRAMEWORK_RELATIVE, contents / "Frameworks/VLCKit.framework", symlinks=True)
        for bundle in outputs[0].glob("*.bundle"):
            reference = source_manifest(bundle)
            for other in outputs[1:]:
                if source_manifest(other / bundle.name) != reference:
                    raise ReleaseError("Architecture resource bundles differ")
            shutil.copytree(bundle, resources / bundle.name, symlinks=True)
        icon = ROOT.parent / "viewer-native-qt/resources/icon.icns"
        shutil.copyfile(icon, resources / "Flixify.icns")
        shutil.copyfile(ROOT / "Vendor/COPYING.txt", resources / "COPYING-VLCKit.txt")
        (resources / "VLCKit-origin.json").write_text((ROOT / "Vendor/runtime-proof.json").read_text())
        info = {"CFBundleDevelopmentRegion": "tr", "CFBundleDisplayName": APP_NAME,
                "CFBundleExecutable": PRODUCT, "CFBundleIdentifier": BUNDLE_ID,
                "CFBundleInfoDictionaryVersion": "6.0", "CFBundleName": APP_NAME,
                "CFBundlePackageType": "APPL", "CFBundleShortVersionString": VERSION,
                "CFBundleVersion": str(BUILD), "CFBundleIconFile": "Flixify.icns",
                "LSApplicationCategoryType": "public.app-category.entertainment",
                "LSMinimumSystemVersion": MINIMUM_SYSTEM, "NSPrincipalClass": "NSApplication",
                "NSHighResolutionCapable": True, "NSSupportsAutomaticGraphicsSwitching": True,
                "FlixifyBuildConfiguration": configuration, "FlixifyArchitectures": architectures}
        (contents / "Info.plist").write_bytes(plistlib.dumps(info))
        stage_swift_runtime(staging)
        if configuration == "release":
            run(["/usr/bin/strip", "-S", "-x", str(executable)])
        audit_app(staging, architectures)
        codesign_app(staging, "-", public=False)
        proof = {"checkedAt": datetime.now(timezone.utc).isoformat(), "configuration": configuration,
                 "architectures": architectures, "bundleIdentifier": BUNDLE_ID,
                 "versionName": VERSION, "buildNumber": BUILD,
                 "signing": "ad hoc local development", "publicDistributionReady": False,
                 "binaries": audit_app(staging, architectures)}
        if configuration == "release":
            privacy = audit_release_privacy(staging, raise_on_failure=False)
            report_name = "privacy-report.json" if privacy["passed"] else "privacy-report-failed.json"
            (dist / report_name).write_text(json.dumps(privacy, indent=2) + "\n")
            if not privacy["passed"]:
                raise ReleaseError("Release privacy audit failed; see redacted privacy-report-failed.json")
            proof["privacyAudit"] = privacy
        if app.exists():
            if app.is_symlink() or not app.is_dir():
                raise ReleaseError("Refusing to replace an unexpected distribution path")
            shutil.rmtree(app)
        shutil.move(staging, app)
        (dist / "local-build-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    return app


def package_release(app: Path, requested_identity: str | None, profile: str | None,
                    organization_policy: Path | None = None) -> Path:
    policy = read_organization_policy(organization_policy)
    profile = validate_notary_profile(profile)
    identity_output = run(["/usr/bin/security", "find-identity", "-p", "codesigning", "-v"], capture=True)
    identity = select_identity(identity_output, requested_identity)
    identifiers = known_personal_identifiers(identity_output)
    validate_organization_subject(identity_output, identity, policy, identifiers)
    validate_app_metadata(app, public=True)
    audit_app(app)
    audit_release_privacy(app, identifiers=identifiers)
    destination = ROOT / "dist/public"
    destination.mkdir(parents=True, exist_ok=True)
    final_dmg = destination / DMG_NAME
    if final_dmg.exists():
        raise ReleaseError("An immutable public package with this version already exists")
    with tempfile.TemporaryDirectory(prefix="release-", dir=ROOT / "dist") as temp:
        working = Path(temp)
        image_root = working / "image"
        image_root.mkdir()
        public_app = image_root / app.name
        shutil.copytree(app, public_app, symlinks=True)
        codesign_app(public_app, identity, public=True)
        privacy = audit_release_privacy(public_app, identifiers=identifiers)
        app_zip = working / "notarize-app.zip"
        run(["/usr/bin/ditto", "-c", "-k", "--keepParent", "--sequesterRsrc", str(public_app), str(app_zip)])
        app_submission = submit_notary(app_zip, profile)
        run(["/usr/bin/xcrun", "stapler", "staple", str(public_app)])
        run(["/usr/bin/xcrun", "stapler", "validate", str(public_app)])
        run(["/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", str(public_app)])
        (image_root / "Applications").symlink_to("/Applications")
        dmg = working / DMG_NAME
        run(["/usr/bin/hdiutil", "create", "-volname", APP_NAME, "-srcfolder", str(image_root),
             "-format", "UDZO", str(dmg)])
        run(["/usr/bin/codesign", "--force", "--timestamp", "--sign", identity, str(dmg)])
        dmg_submission = submit_notary(dmg, profile)
        run(["/usr/bin/xcrun", "stapler", "staple", str(dmg)])
        run(["/usr/bin/xcrun", "stapler", "validate", str(dmg)])
        run(["/usr/sbin/spctl", "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=4", str(dmg)])
        run(["/usr/bin/hdiutil", "verify", str(dmg)])
        mounted = plistlib.loads(run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-plist", str(dmg)], capture=True).encode())
        entities = mounted.get("system-entities", [])
        mounts = [entry for entry in entities if entry.get("mount-point")]
        if len(mounts) != 1:
            raise ReleaseError("Unexpected disk image mount layout")
        mount = mounts[0]
        try:
            installed_app = Path(mount["mount-point"]) / app.name
            audit_app(installed_app)
            run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(installed_app)])
            run(["/usr/bin/xcrun", "stapler", "validate", str(installed_app)])
            run(["/usr/sbin/spctl", "--assess", "--type", "execute", "--verbose=4", str(installed_app)])
        finally:
            run(["/usr/bin/hdiutil", "detach", mount["dev-entry"]])
        proof = {"checkedAt": datetime.now(timezone.utc).isoformat(), "bundleIdentifier": BUNDLE_ID,
                 "versionName": VERSION, "buildNumber": BUILD, "architectures": sorted(REQUIRED_ARCHITECTURES),
                 "identityFingerprint": identity, "appNotarization": app_submission,
                 "organizationTeamIdentifier": policy["teamIdentifier"],
                 "organizationIdentityPolicySha256": sha256(organization_policy), "privacyAudit": privacy,
                 "dmgNotarization": dmg_submission, "appStapledBeforeDmgCreation": True,
                 "appAndDmgStaplesValidated": True, "gatekeeperAppDmgAndMountedAppPassed": True,
                 "binaries": audit_app(public_app), "sha256": sha256(dmg), "sizeBytes": dmg.stat().st_size,
                 "publicDistributionReady": True}
        descriptor = {"bundleIdentifier": BUNDLE_ID, "versionName": VERSION, "buildNumber": BUILD,
                      "minSystemVersion": MINIMUM_SYSTEM, "architectures": sorted(REQUIRED_ARCHITECTURES),
                      "dmgUrl": DOWNLOAD_URL, "sha256": proof["sha256"], "sizeBytes": proof["sizeBytes"],
                      "notes": "Flixify Pro: Android TV özellikleriyle yerel macOS uygulaması."}
        shutil.move(dmg, final_dmg)
        (destination / "release-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
        (destination / "flixify-macos-update.json").write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n")
    return final_dmg


def build_main():
    parser = argparse.ArgumentParser(description="Build a local Flixify app; not a public signed release")
    parser.add_argument("--configuration", choices=["debug", "release"], default="release")
    parser.add_argument("--host-only", action="store_true", help="Local QA only; public packaging rejects this")
    args = parser.parse_args()
    print(build_app(args.configuration, args.host_only))


def package_main():
    parser = argparse.ArgumentParser(description="Create a signed, notarized universal public DMG")
    parser.add_argument("--app", type=Path, default=ROOT / "dist" / f"{APP_NAME}.app")
    parser.add_argument("--identity", help="Installed Developer ID Application name or certificate fingerprint")
    parser.add_argument("--notary-profile", default=os.environ.get("FLIXIFY_NOTARY_PROFILE"))
    parser.add_argument("--organization-identity-policy", type=Path,
                        help="Reviewed corporate enrollment and certificate approval; individual identity is blocked")
    args = parser.parse_args()
    print(package_release(args.app.resolve(), args.identity, args.notary_profile, args.organization_identity_policy))
