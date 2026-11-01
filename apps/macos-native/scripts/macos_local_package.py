"""Create a local-test disk image without changing signing or public release policy."""
from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from macos_privacy import audit_release_privacy
from macos_release import (APP_NAME, BUNDLE_ID, BUILD, PRODUCT, ROOT, VERSION,
                           ReleaseError, audit_app, run, sha256, validate_app_metadata)


INSTALL_NOTICE = """FLIXIFY PRO — YEREL TEST PAKETİ

Flixify Pro'yu Applications (Uygulamalar) kısayoluna sürükleyin.
Kopyalama bitince disk görüntüsünü çıkarın ve uygulamayı Uygulamalar'dan açın.

Bu paket Apple tarafından noter onayı almamıştır ve genel dağıtım sürümü değildir.
macOS uygulamayı açarken geliştiriciyi doğrulayamadığına dair uyarı gösterebilir.
"""


def bundle_manifest(app: Path) -> str:
    rows = []
    for path in sorted(app.rglob("*")):
        relative = path.relative_to(app).as_posix()
        if path.is_symlink():
            rows.append((relative, "symlink", path.readlink().as_posix()))
        elif path.is_file():
            rows.append((relative, "file", sha256(path)))
    return hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()


def require_adhoc_signature(app: Path) -> None:
    result = subprocess.run(["/usr/bin/codesign", "--display", "--verbose=4", str(app)],
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=120)
    description = (result.stdout or "") + (result.stderr or "")
    if result.returncode or "Signature=adhoc" not in description.splitlines():
        raise ReleaseError("Local-test packaging requires the existing ad hoc app signature; no identity is selected or created")


def cleanup_staging(staging: Path) -> None:
    dist = ROOT / "dist"
    if (staging.is_symlink() or staging.parent.resolve() != dist.resolve() or
            not staging.name.startswith(".local-test-") or dist.is_symlink()):
        raise ReleaseError("Refusing to delete a path outside generated local-test staging")
    if not staging.exists():
        return
    if not staging.is_dir() or staging.is_mount() or (staging / "mounted").is_mount():
        raise ReleaseError("Refusing to delete unexpected or still-mounted local-test staging")
    shutil.rmtree(staging)


def package_local_test(app: Path) -> Path:
    dist = ROOT / "dist"
    destination = dist / "local-test"
    if (dist.is_symlink() or dist.resolve().parent != ROOT.resolve() or
            app.parent.resolve() != dist.resolve() or app.is_symlink()):
        raise ReleaseError("Local-test input and staging must stay in the project distribution directory")
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise ReleaseError("Local-test output must be a real project directory")
    info = validate_app_metadata(app, public=True)
    audit_app(app)
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)])
    require_adhoc_signature(app)
    audit_release_privacy(app)
    source_manifest = bundle_manifest(app)
    main_hash = sha256(app / "Contents/MacOS" / PRODUCT)
    name = f"Flixify-Pro-{VERSION}-macos-universal-LOCAL-TEST-{main_hash[:12]}"
    final_image = destination / f"{name}.dmg"
    final_proof = destination / f"{name}.json"
    if final_image.exists() or final_proof.exists() or final_image.is_symlink() or final_proof.is_symlink():
        raise ReleaseError("This local-test artifact already exists; existing packages are never overwritten")
    payload_size = sum(path.stat().st_size for path in app.rglob("*")
                       if path.is_file() and not path.is_symlink())
    if shutil.disk_usage(dist).free < payload_size * 3 + 64 * 1024 * 1024:
        raise ReleaseError("Not enough free space for local-test staging and verification")

    staging = Path(tempfile.mkdtemp(prefix=".local-test-", dir=dist))
    try:
        image_root = staging / "image"
        image_root.mkdir()
        copied_app = image_root / f"{APP_NAME}.app"
        shutil.copytree(app, copied_app, symlinks=True)
        if bundle_manifest(copied_app) != source_manifest:
            raise ReleaseError("Staged app does not match the audited source app")
        (image_root / "Applications").symlink_to("/Applications")
        (image_root / "OKU-BENI.txt").write_text(INSTALL_NOTICE, encoding="utf-8")
        image = staging / f"{name}.dmg"
        run(["/usr/bin/hdiutil", "create", "-volname", f"{APP_NAME} — Yerel Test",
             "-srcfolder", str(image_root), "-format", "UDZO", str(image)])
        run(["/usr/bin/hdiutil", "verify", str(image)])
        mount = staging / "mounted"
        mount.mkdir()
        attached = False
        try:
            response = run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen",
                            "-mountpoint", str(mount), "-plist", str(image)], capture=True)
            attached = True
            entities = plistlib.loads(response.encode()).get("system-entities", [])
            mounts = [entry.get("mount-point") for entry in entities if entry.get("mount-point")]
            if len(mounts) != 1 or Path(mounts[0]).resolve() != mount.resolve():
                raise ReleaseError("Unexpected local-test disk image mount layout")
            mounted_app = mount / f"{APP_NAME}.app"
            validate_app_metadata(mounted_app, public=True)
            binaries = audit_app(mounted_app)
            run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(mounted_app)])
            privacy = audit_release_privacy(mounted_app)
            if bundle_manifest(mounted_app) != source_manifest:
                raise ReleaseError("The app in the disk image differs from the audited source app")
        finally:
            if attached:
                run(["/usr/bin/hdiutil", "detach", str(mount)])
        if bundle_manifest(app) != source_manifest:
            raise ReleaseError("Source app changed during packaging; rebuild the local-test package")
        proof = {"schema": 1, "checkedAt": datetime.now(timezone.utc).isoformat(),
                 "distributionKind": "local-test", "bundleIdentifier": BUNDLE_ID,
                 "versionName": VERSION, "buildNumber": BUILD,
                 "architectures": sorted(info["FlixifyArchitectures"]),
                 "signing": "existing ad hoc app signature; unsigned disk image",
                 "notarized": False, "gatekeeperApprovalClaimed": False,
                 "publicDistributionReady": False, "mountedAppMatchesSource": True,
                 "sourceAppUnchanged": True, "appManifestSha256": source_manifest,
                 "mainSha256": main_hash, "binaries": binaries, "privacyAudit": privacy,
                 "sha256": sha256(image), "sizeBytes": image.stat().st_size}
        proof_file = staging / f"{name}.json"
        proof_file.write_text(json.dumps(proof, indent=2) + "\n")
        destination.mkdir(exist_ok=True)
        if destination.is_symlink() or destination.resolve().parent != dist.resolve():
            raise ReleaseError("Local-test output directory changed during packaging")
        if final_image.exists() or final_proof.exists():
            raise ReleaseError("Local-test destination appeared during packaging; refusing to overwrite it")
        shutil.move(image, final_image)
        shutil.move(proof_file, final_proof)
        return final_image
    finally:
        cleanup_staging(staging)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an unnotarized local-test DMG; never a public release")
    parser.add_argument("--app", type=Path, default=ROOT / "dist" / f"{APP_NAME}.app")
    args = parser.parse_args()
    print(package_local_test(args.app.absolute()))
