import io
import json
import plistlib
import struct
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import macos_release as release
import macos_runtime as runtime


def organization_policy():
    return {"schema": 1, "identityKind": "organization", "organizationEnrollmentVerified": True,
            "publicDistributionApproved": True, "teamIdentifier": "ABCDEFGHIJ", "certificateSha1": "A" * 40}


def metadata(configuration="release", architectures=("arm64", "x86_64")):
    return {"CFBundleIdentifier": release.BUNDLE_ID, "CFBundleExecutable": release.PRODUCT,
            "CFBundleShortVersionString": release.VERSION, "CFBundleVersion": str(release.BUILD),
            "LSMinimumSystemVersion": "13.0", "CFBundlePackageType": "APPL",
            "FlixifyBuildConfiguration": configuration, "FlixifyArchitectures": list(architectures)}


class SharedBuildCacheTests(unittest.TestCase):
    def test_universal_build_reuses_cache_but_merges_distinct_architecture_outputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);runtime_root=root/"runtime";framework=runtime_root/release.FRAMEWORK_RELATIVE
            framework.mkdir(parents=True);(framework/"runtime").write_bytes(b"runtime")
            resources=root/"Sources/FlixifyMac/Resources";resources.mkdir(parents=True);(resources/"Flixify.icns").write_bytes(b"icon")
            (root/"Vendor").mkdir();(root/"Vendor/COPYING.txt").write_text("upstream license");(root/"Vendor/runtime-proof.json").write_text("{}")
            scratch=[];merged=[]
            def run(args,**kwargs):
                if args[:2]==["/usr/bin/xcrun","--sdk"]:return "/sdk"
                if args[:2]==["/usr/bin/swift","build"]:
                    cache=Path(args[args.index("--scratch-path")+1]);triple=args[args.index("--triple")+1];architecture=triple.split("-")[0]
                    output=cache/triple/"release";output.mkdir(parents=True,exist_ok=True);(output/release.PRODUCT).write_bytes(architecture.encode())
                    if "--show-bin-path" in args:return str(output)
                    scratch.append(cache);return ""
                if args[:2]==["/usr/bin/lipo","-create"]:
                    inputs=[Path(p) for p in args[2:args.index("-output")]];merged.extend(inputs)
                    Path(args[-1]).write_bytes(b"+".join(p.read_bytes() for p in inputs))
                return ""
            with patch.object(release,"ROOT",root),patch.object(release,"prepare_runtime",return_value=runtime_root),patch.object(release,"run",side_effect=run),patch.object(release,"stage_swift_runtime"),patch.object(release,"audit_app",return_value=[]),patch.object(release,"codesign_app"),patch.object(release,"audit_release_privacy",return_value={"passed":True}):
                app=release.build_app("release",False)
            self.assertEqual(len(set(scratch)),1,"Both architectures should share downloaded SDK artifacts")
            self.assertEqual(len(set(merged)),2,"Architecture products must remain distinct")
            self.assertEqual((app/"Contents/MacOS"/release.PRODUCT).read_bytes(),b"arm64+x86_64")
            info=plistlib.loads((app/"Contents/Info.plist").read_bytes())
            self.assertEqual(info["FlixifyArchitectures"],["arm64","x86_64"])
            self.assertFalse(info["FIREBASE_ANALYTICS_COLLECTION_ENABLED"])
            self.assertFalse(info["GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE"])


class ReleasePolicyTests(unittest.TestCase):
    def test_rejects_development_identity_for_public_release(self):
        identities = '  1) ' + 'A' * 40 + ' "Apple Development: Developer (TEAM)"\n'
        with self.assertRaises(release.ReleaseError):
            release.select_identity(identities, None)

    def test_requires_explicit_selection_when_developer_ids_ambiguous(self):
        output = '\n'.join(f'{n}) {c * 40} "Developer ID Application: Name{n} (TEAM{n})"'
                           for n, c in [(1, "A"), (2, "B")])
        with self.assertRaises(release.ReleaseError):
            release.select_identity(output, None)
        self.assertEqual(release.select_identity(output, "B" * 40), "B" * 40)

    def test_requested_identity_must_really_be_available(self):
        with self.assertRaises(release.ReleaseError):
            release.select_identity('1) ' + 'A' * 40 + ' "Developer ID Application: A (TEAM)"', "B" * 40)

    def test_notary_profile_cannot_be_missing_or_option_like(self):
        for value in [None, "", "--password", "x\ny", "A" * 129]:
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.validate_notary_profile(value)
        self.assertEqual(release.validate_notary_profile("Flixify Release"), "Flixify Release")

    def test_notary_must_be_accepted_with_submission_id(self):
        for value in [{"status": "In Progress", "id": "A" * 36}, {"status": "Invalid", "id": "A" * 36},
                      {"status": "Accepted"}, {"status": "Accepted", "id": "bad"}]:
            with self.subTest(value=value), self.assertRaises(release.ReleaseError):
                release.accepted_submission(json.dumps(value))
        accepted = {"status": "Accepted", "id": "01234567-89ab-cdef-0123-456789abcdef"}
        self.assertEqual(release.accepted_submission(json.dumps(accepted)), accepted)

    def test_missing_notary_profile_exits_before_build_or_mutation(self):
        with patch.object(release, "read_organization_policy", return_value=organization_policy()), patch.object(release, "run") as runner, self.assertRaises(release.ReleaseError):
            release.package_release(Path("missing.app"), None, None)
        runner.assert_not_called()

    def test_missing_developer_id_exits_before_build_or_mutation(self):
        with patch.object(release, "read_organization_policy", return_value=organization_policy()), patch.object(release, "run", return_value="0 valid identities found") as runner, self.assertRaises(release.ReleaseError):
            release.package_release(Path("missing.app"), None, "Flixify")
        self.assertEqual(len(runner.call_args_list), 1)
        self.assertEqual(runner.call_args.args[0][0], "/usr/bin/security")

    def test_public_release_rejects_debug_and_host_only_bundles(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "Flixify Pro.app"
            (app / "Contents").mkdir(parents=True)
            for config, arches in [("debug", ("arm64", "x86_64")), ("release", ("arm64",))]:
                (app / "Contents/Info.plist").write_bytes(plistlib.dumps(metadata(config, arches)))
                with self.assertRaises(release.ReleaseError):
                    release.validate_app_metadata(app, public=True)

    def test_bundle_identity_and_minimum_cannot_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "Flixify Pro.app"
            (app / "Contents").mkdir(parents=True)
            for key, value in [("CFBundleIdentifier", "other.app"), ("LSMinimumSystemVersion", "14.0"),
                               ("CFBundleVersion", "0")]:
                info = metadata()
                info[key] = value
                (app / "Contents/Info.plist").write_bytes(plistlib.dumps(info))
                with self.assertRaises(release.ReleaseError):
                    release.validate_app_metadata(app, public=True)

    def test_external_bundle_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "Flixify Pro.app"
            (app / "Contents").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps(metadata()))
            (app / "Contents/unsafe").symlink_to("/Applications/VLC.app")
            with self.assertRaises(release.ReleaseError):
                release.validate_app_metadata(app)

    def test_dependencies_are_bundled_or_apple_system_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "App.app"
            binary = app / "Contents/MacOS/FlixifyMac"
            framework = app / "Contents/Frameworks/VLCKit.framework/Versions/A/VLCKit"
            framework.parent.mkdir(parents=True)
            framework.write_bytes(b"fixture")
            for dependency in ["@rpath/VLCKit.framework/Versions/A/VLCKit",
                               "@loader_path/../Frameworks/VLCKit.framework/Versions/A/VLCKit",
                               "/usr/lib/libSystem.B.dylib", "/System/Library/Frameworks/AppKit.framework/AppKit"]:
                release.validate_dependency(dependency, binary, app)
            for dependency in ["/Applications/VLC.app/Contents/MacOS/lib/libvlc.dylib",
                               "/opt/homebrew/lib/libvlc.dylib", "@rpath/Missing.framework/Missing",
                               "@loader_path/../../../../outside.dylib", "libvlc.dylib"]:
                with self.subTest(dependency=dependency), self.assertRaises(release.ReleaseError):
                    release.validate_dependency(dependency, binary, app)

    def test_runtime_search_path_cannot_escape_bundle(self):
        app = Path("/private/test/App.app")
        binary = app / "Contents/MacOS/FlixifyMac"
        for value in ["@executable_path/../Frameworks", "@loader_path", "/usr/lib/swift"]:
            release.validate_rpath(value, binary, app)
        for value in ["/Users/developer/.build", "@loader_path/../../../../tmp", "@rpath/anything", "relative"]:
            with self.assertRaises(release.ReleaseError):
                release.validate_rpath(value, binary, app)

    def test_deployment_target_ignores_source_version_but_rejects_newer_os(self):
        output = 'Load command 1\n cmd LC_BUILD_VERSION\n platform 1\n minos 13.0\nLoad command 2\n cmd LC_SOURCE_VERSION\n version 99.0\n'
        release.validate_macos_versions(output)
        for bad in [output.replace("minos 13.0", "minos 14.0"), output.replace("platform 1", "platform 2"),
                    "Load command 1\n cmd LC_VERSION_MIN_IPHONEOS\n version 12.0\n", "no target"]:
            with self.assertRaises(release.ReleaseError):
                release.validate_macos_versions(bad)

    def test_legacy_macos_minimum_supported(self):
        release.validate_macos_versions('Load command 1\n cmd LC_VERSION_MIN_MACOSX\n version 10.9\n')

    def test_captured_dependency_paths_deduplicated_across_slices(self):
        output = 'A (architecture arm64):\n\t@rpath/VLCKit (compatibility version 1.0.0, current version 1.0.0)\nA (architecture x86_64):\n\t@rpath/VLCKit (compatibility version 1.0.0, current version 1.0.0)'
        self.assertEqual(release.library_dependencies(output), ["@rpath/VLCKit"])

    def test_signing_inside_out_never_uses_deep_signing(self):
        with tempfile.TemporaryDirectory() as temp:
            app = Path(temp) / "App.app"
            framework = app / "Contents/Frameworks/VLCKit.framework"
            framework.mkdir(parents=True)
            inner = framework / "VLCKit"
            main = app / "Contents/MacOS/FlixifyMac"
            with patch.object(release, "macho_files", return_value=[main, inner]), patch.object(release, "run") as runner:
                release.codesign_app(app, "A" * 40, public=True)
            calls = [call.args[0] for call in runner.call_args_list]
            signs = [call for call in calls if "--sign" in call]
            self.assertEqual([call[-1] for call in signs], [str(inner), str(framework), str(app)])
            self.assertTrue(all("--deep" not in call and "--timestamp" in call and "runtime" in call for call in signs))

    def test_staging_removes_only_compiler_runtime_search_path_after_stdlib_copy(self):
        app = Path("/tmp/Fixture.app")
        binary = app / "Contents/MacOS/FlixifyMac"
        compiler = "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift"
        library = "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-6.2/macosx"
        commands = f"Load command 1\n cmd LC_RPATH\n path {library} (offset 12)\nLoad command 2\n cmd LC_RPATH\n path /Users/other/build (offset 12)\n"

        def runner(args, **kwargs):
            if "--find" in args:
                return compiler
            if args[0] == "/usr/bin/otool":
                return commands
            return ""

        with patch.object(release, "macho_files", return_value=[binary]), patch.object(release, "run", side_effect=runner) as run:
            release.stage_swift_runtime(app)
        calls = [call.args[0] for call in run.call_args_list]
        self.assertEqual(calls[0][:3], ["/usr/bin/xcrun", "swift-stdlib-tool", "--copy"])
        deletions = [call for call in calls if call[0] == "/usr/bin/install_name_tool"]
        self.assertEqual(deletions, [["/usr/bin/install_name_tool", "-delete_rpath", library, str(binary)]])


class RuntimePolicyTests(unittest.TestCase):
    def test_download_cannot_use_http_or_other_origin(self):
        runtime.validate_runtime_url(runtime.RUNTIME_URL)
        for url in ["http://download.videolan.org/a", "https://evil.test/a", "https://download.videolan.org:444/a",
                    "https://user:secret@download.videolan.org/a", "https://download.videolan.org/a?token=x"]:
            with self.assertRaises(runtime.ReleaseError):
                runtime.validate_runtime_url(url)

    def test_archive_path_traversal_rejected(self):
        for path in ["/absolute", "../escape", "root/../../escape", "root\\escape"]:
            with self.assertRaises(runtime.ReleaseError):
                runtime.validate_relative_path(path)

    def test_universal_header_identifies_both_architectures(self):
        header = b"\xca\xfe\xba\xbe" + struct.pack(">I", 2)
        header += struct.pack(">IIIII", 0x01000007, 0, 0, 0, 0)
        header += struct.pack(">IIIII", 0x0100000C, 0, 0, 0, 0)
        self.assertEqual(runtime.macho_architectures(header), runtime.REQUIRED_ARCHITECTURES)
        with self.assertRaises(runtime.ReleaseError):
            runtime.macho_architectures(header[:12])

    def test_archive_symlink_cannot_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "runtime.tar.xz"
            with tarfile.open(archive, "w:xz") as output:
                info = tarfile.TarInfo(str(runtime.FRAMEWORK_PREFIX / runtime.LIBRARY_ID / "VLCKit.framework/escape"))
                info.type = tarfile.SYMTYPE
                info.linkname = "../../../../../../outside"
                output.addfile(info)
            with self.assertRaises(runtime.ReleaseError):
                runtime.extract_runtime(archive, root / "extract")


class PublicSequenceTests(unittest.TestCase):
    def exercise(self, app_status="Accepted", dmg_status="Accepted", deny_gatekeeper=False, individual=False):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / "dist/Flixify Pro.app"
            (app / "Contents").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps(metadata()))
            policy = root / "corporate-policy.json"
            reviewed = organization_policy()
            if individual:
                reviewed.pop("organizationEnrollmentVerified")
                reviewed.update(identityKind="individual", individualEnrollmentVerified=True,
                                personalNameVisibilityAccepted=True)
            policy.write_text(json.dumps(reviewed))
            calls = []
            status = iter([app_status, dmg_status])
            app_stapled = False
            mounted = root / "mounted"
            mounted.mkdir()

            def runner(args, **kwargs):
                nonlocal app_stapled
                calls.append(args)
                if args[0] == "/usr/bin/security":
                    return '1) ' + 'A' * 40 + ' "Developer ID Application: ' + ('Private Person' if individual else 'Test') + ' (ABCDEFGHIJ)"'
                if "notarytool" in args:
                    return json.dumps({"id": "01234567-89ab-cdef-0123-456789abcdef", "status": next(status)})
                if "stapler" in args and "staple" in args and args[-1].endswith(".app"):
                    app_stapled = True
                if args[:2] == ["/usr/bin/hdiutil", "create"]:
                    self.assertTrue(app_stapled, "App ticket must be embedded before constructing DMG")
                    Path(args[-1]).write_bytes(b"signed notarized disk image fixture")
                if args[0] == "/usr/sbin/spctl" and deny_gatekeeper:
                    raise release.ReleaseError("Gatekeeper rejected fixture")
                if args[:2] == ["/usr/bin/hdiutil", "attach"]:
                    return plistlib.dumps({"system-entities": [{"mount-point": str(mounted), "dev-entry": "/dev/test"}]}).decode()
                return ""

            arguments = {"identity_policy": policy} if individual else {"organization_policy": policy}
            with patch.object(release, "ROOT", root), patch.object(release, "run", side_effect=runner), \
                 patch.object(release, "audit_app", return_value=[]), patch.object(release, "codesign_app"), \
                 patch.object(release, "known_personal_identifiers", return_value=set()):
                if app_status != "Accepted" or dmg_status != "Accepted" or deny_gatekeeper:
                    with self.assertRaises(release.ReleaseError):
                        release.package_release(app, None, "Test", **arguments)
                    self.assertFalse((root / "dist/public" / release.DMG_NAME).exists())
                    self.assertFalse((root / "dist/public/flixify-macos-update.json").exists())
                else:
                    result = release.package_release(app, None, "Test", **arguments)
                    descriptor = json.loads((root / "dist/public/flixify-macos-update.json").read_text())
                    self.assertEqual(descriptor["sha256"], release.sha256(result))
                    self.assertEqual(descriptor["sizeBytes"], result.stat().st_size)
                    self.assertEqual(descriptor["dmgUrl"], release.DOWNLOAD_URL)
                    proof = json.loads((root / "dist/public/release-proof.json").read_text())
                    self.assertTrue(proof["publicDistributionReady"])
                    if individual:
                        self.assertEqual(proof["signingIdentityKind"], "individual")
                        self.assertTrue(proof["personalNameVisibilityAccepted"])
                        self.assertNotIn("Private Person", json.dumps(proof))
                        self.assertTrue(proof["privacyAudit"]["individualNameVisibilityAccepted"])
            return calls

    def test_success_requires_app_then_dmg_notarization_and_gatekeeper(self):
        calls = self.exercise()
        submitted = [args[3] for args in calls if "notarytool" in args]
        self.assertTrue(submitted[0].endswith(".zip"))
        self.assertTrue(submitted[1].endswith(".dmg"))
        self.assertEqual(len([args for args in calls if args[0] == "/usr/sbin/spctl"]), 3)

    def test_rejected_app_produces_no_public_download(self):
        self.exercise(app_status="Invalid")

    def test_rejected_dmg_produces_no_public_download(self):
        self.exercise(dmg_status="Invalid")

    def test_gatekeeper_failure_produces_no_public_download(self):
        self.exercise(deny_gatekeeper=True)

    def test_approved_individual_release_keeps_all_notary_and_gatekeeper_gates(self):
        self.exercise(individual=True)
        self.exercise(individual=True, app_status="Invalid")
        self.exercise(individual=True, dmg_status="Invalid")
        self.exercise(individual=True, deny_gatekeeper=True)


if __name__ == "__main__":
    unittest.main()
