"""Offline release contracts. No Docker, emulator, network or account operations."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.modules.setdefault('yaml', types.SimpleNamespace(safe_load=json.loads, YAMLError=ValueError))
HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


web = load('renewal_web_contract', HERE / 'build-web.py') if (HERE / 'build-web.py').exists() else None
release = load('renewal_release_contract', HERE / 'release-web.py') if (HERE / 'release-web.py').exists() else None
android = load('renewal_android_contract', HERE / 'verify-android.py') if (HERE / 'verify-android.py').exists() else None


class DefaultClosed(unittest.TestCase):
    def test_default_measure_stops_at_pending_acceptance(self):
        result = subprocess.run([sys.executable, str(HERE / 'build-web.py'), '--measure'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ROOT_ACCEPTANCE_PENDING', result.stderr)
        result = subprocess.run([sys.executable, str(HERE / 'release-web.py')], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ROOT_ACCEPTANCE_PENDING', result.stderr)


@unittest.skipIf(web is None or release is None or android is None, 'profile implementation pending')
class Contracts(unittest.TestCase):
    def accepted(self):
        return {'schema': 1, 'nativeRevision': web.NATIVE_REVISION, 'nativeTree': web.NATIVE_TREE,
                'apkSha256': web.ACCEPTED_APK_SHA256, 'apkBytes': web.ACCEPTED_APK_BYTES, 'apkProofSha256': 'd' * 64,
                'runtimeProofSha256': 'e' * 64, 'acceptance': 'root-accepted-offline-runtime-evidence'}

    def proof(self, accepted):
        return {'schema': 1, 'nativeRevision': accepted['nativeRevision'], 'nativeTree': accepted['nativeTree'],
                'packageName': 'vip.flixify.tv', 'versionName': '1.4.10', 'versionCode': 18, 'minSdk': 23,
                'targetSdk': 35, 'sha256': accepted['apkSha256'], 'sizeBytes': accepted['apkBytes'],
                'certificateSha256': web.SIGNER_SHA256, 'baselineApkSha256': web.BASELINE_APK_SHA256,
                'baselineApkSizeBytes': web.BASELINE_APK_BYTES, 'signatureSchemes': ['v1', 'v2'], 'releaseDebuggable': False}

    def evidence(self):
        tmp = tempfile.TemporaryDirectory(prefix='renewal-evidence-')
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        artifact = root / 'instrumentation.txt'
        artifact.write_bytes(b'Actual offline instrumentation receipt fixture\n')
        accepted = self.accepted()
        proof = root / 'android.json'
        proof.write_text(json.dumps(self.proof(accepted)))
        accepted['apkProofSha256'] = web.digest(proof.read_bytes())
        runtime = {'schema': 1, 'packageName': 'vip.flixify.tv', 'versionName': '1.4.10', 'versionCode': 18,
                   'nativeRevision': accepted['nativeRevision'], 'nativeTree': accepted['nativeTree'],
                   'apkSha256': accepted['apkSha256'], 'verification': 'offline-instrumentation',
                   **{name: True for name in web.RUNTIME_CHECKS},
                   'unitTests': 172, 'networkInstrumentationTests': 51, 'catalogFixtureItems': 29000,
                   'realAccountUsed': False, 'realCheckoutStarted': False, 'providerPlaybackOpened': False,
                   'evidenceFiles': {role: [artifact.name] for role in ('baselineMeasurements', 'afterMeasurements', 'finalBuildLog', 'finalNetworkXml', 'finalUnitXml', 'focusedRemoteXml', 'performanceLog')},
                   'artifacts': [{'file': artifact.name, 'bytes': artifact.stat().st_size, 'sha256': web.digest(artifact.read_bytes())}]}
        runtime_path = root / 'runtime.json'
        runtime_path.write_text(json.dumps(runtime))
        accepted['runtimeProofSha256'] = web.digest(runtime_path.read_bytes())
        return accepted, proof, runtime_path, runtime

    def test_placeholders_and_booleans_do_not_authorize_host_reads(self):
        pending = json.loads((HERE / 'release-pins.json').read_bytes())
        with patch.object(web, 'protected_snapshot') as host, patch.object(web, 'command') as command:
            with self.assertRaisesRegex(web.GateError, 'ROOT_ACCEPTANCE_PENDING'):
                web.preflight(Path('/fixture'), 'f' * 40, pending, None, None, 'a' * 64, 100)
            host.assert_not_called()
            command.assert_not_called()
        for name in ('nativeRevision', 'nativeTree', 'apkSha256', 'apkProofSha256', 'runtimeProofSha256', 'apkBytes', 'acceptance'):
            value = self.accepted()
            value[name] = False
            with self.subTest(name=name), self.assertRaises(web.GateError):
                web.require_accepted(value)
        with patch.object(release.build, 'require_accepted', side_effect=release.build.GateError('ROOT_ACCEPTANCE_PENDING')), patch.object(release.reviewed, 'configure') as configure:
            with self.assertRaisesRegex(release.GateError, 'ROOT_ACCEPTANCE_PENDING'):
                release.configure('f' * 40, 'sha256:' + 'a' * 64, None, None, None)
            configure.assert_not_called()

    def test_runtime_receipt_binds_every_artifact_and_required_check(self):
        accepted, proof, runtime_path, runtime = self.evidence()
        web.verify_evidence(accepted, proof, runtime_path)
        for check in web.RUNTIME_CHECKS:
            changed = copy.deepcopy(runtime)
            changed[check] = False
            runtime_path.write_text(json.dumps(changed))
            accepted['runtimeProofSha256'] = web.digest(runtime_path.read_bytes())
            with self.subTest(check=check), self.assertRaises(web.GateError):
                web.verify_evidence(accepted, proof, runtime_path)
        runtime_path.write_text(json.dumps(runtime))
        accepted['runtimeProofSha256'] = web.digest(runtime_path.read_bytes())
        (runtime_path.parent / 'instrumentation.txt').write_bytes(b'changed evidence')
        with self.assertRaisesRegex(web.GateError, 'runtime_artifact'):
            web.verify_evidence(accepted, proof, runtime_path)

    def test_performance_receipt_requires_exact_counts_and_bound_evidence_roles(self):
        accepted, proof, runtime_path, original = self.evidence()
        for field, bad in (('unitTests', 171), ('networkInstrumentationTests', True),
                           ('catalogFixtureItems', 28000), ('evidenceFiles', {}),
                           ('evidenceFiles', dict(original['evidenceFiles'], afterMeasurements=['unbound.json']))):
            runtime = dict(original, **{field: bad})
            runtime_path.write_text(json.dumps(runtime))
            accepted['runtimeProofSha256'] = web.digest(runtime_path.read_bytes())
            with self.subTest(field=field), self.assertRaises(web.GateError):
                web.verify_evidence(accepted, proof, runtime_path)

    def test_runtime_evidence_rejects_path_escape_symlinks_and_unreviewed_proof(self):
        for filename in ('../private.txt', '/tmp/private.txt', 'nested/file.txt'):
            accepted, proof, runtime_path, runtime = self.evidence()
            runtime['artifacts'][0]['file'] = filename
            runtime_path.write_text(json.dumps(runtime))
            accepted['runtimeProofSha256'] = web.digest(runtime_path.read_bytes())
            with self.subTest(filename=filename), self.assertRaises(web.GateError):
                web.verify_evidence(accepted, proof, runtime_path)
        accepted, proof, runtime_path, _ = self.evidence()
        artifact = runtime_path.parent / 'instrumentation.txt'
        target = runtime_path.parent / 'actual.txt'
        artifact.rename(target)
        artifact.symlink_to(target.name)
        with self.assertRaisesRegex(web.GateError, 'runtime_artifact_regular_file'):
            web.verify_evidence(accepted, proof, runtime_path)
        accepted, proof, runtime_path, _ = self.evidence()
        accepted['runtimeProofSha256'] = 'f' * 64
        with self.assertRaisesRegex(web.GateError, 'runtime_proof_digest'):
            web.verify_evidence(accepted, proof, runtime_path)

    def test_apk_identity_certificate_and_version_are_exact(self):
        accepted = self.accepted()
        proof = self.proof(accepted)
        web.validate_apk_proof(json.dumps(proof).encode(), accepted['nativeRevision'], accepted['nativeTree'], accepted['apkSha256'], accepted['apkBytes'])
        for name, value in (('versionCode', 16), ('versionName', '1.4.8'), ('releaseDebuggable', True), ('certificateSha256', 'f' * 64), ('baselineApkSha256', 'f' * 64), ('signatureSchemes', ['v2'])):
            changed = dict(proof, **{name: value})
            with self.subTest(name=name), self.assertRaises(web.GateError):
                web.validate_apk_proof(json.dumps(changed).encode(), accepted['nativeRevision'], accepted['nativeTree'], accepted['apkSha256'], accepted['apkBytes'])
        signing = 'Signer #1 certificate SHA-256 digest: ' + web.SIGNER_SHA256 + '\nVerified using v1 scheme (JAR signing): true\nVerified using v2 scheme (APK Signature Scheme v2): true\n'
        badging = "package: name='vip.flixify.tv' versionCode='18' versionName='1.4.10'\nsdkVersion:'23'\ntargetSdkVersion:'35'\n"
        android.validate_tool_output(signing, badging)
        for wrong in (signing.replace(web.SIGNER_SHA256, 'f' * 64), signing.replace('v2): true', 'v2): false')):
            with self.assertRaises(android.GateError):
                android.validate_tool_output(wrong, badging)

    def fixture(self):
        tmp = tempfile.TemporaryDirectory(prefix='renewal-git-')
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        def git(*args):
            return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL).decode().strip()
        def put(path, data):
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        def commit():
            git('add', '.')
            git('commit', '-qm', 'offline fixture')
            return git('rev-parse', 'HEAD')
        git('init', '-q')
        git('config', 'user.name', 'Offline fixture')
        git('config', 'user.email', 'offline@example.invalid')
        for path in web.PATHS:
            put(path, b'baseline source\n')
        for tree in web.PROTECTED_TREES:
            put(tree + '/frozen.txt', b'frozen\n')
        put('apps/tv-android/source.java', b'baseline native\n')
        put(web.BASELINE_APK, b'old APK')
        put(web.UPDATE_MANIFEST, b'old manifest')
        baseline = commit()
        for path in web.PRIOR_SUPPORT:
            put(path, b'prior reviewed support\n')
        prior = commit()
        put('apps/tv-android/source.java', b'accepted native\n')
        for path in web.PERFORMANCE_SUPPORT:
            put(path, b'reviewed performance plan\n')
        native = commit()
        tree = git('rev-parse', native + ':apps/tv-android')
        for path in web.PATHS:
            put(path, b'reviewed source\n')
        put(web.APK, b'new APK')
        put(web.UPDATE_MANIFEST, b'new manifest')
        revision = commit()
        for name, value in (('NATIVE_REVISION', native), ('NATIVE_TREE', tree), ('PUBLIC_REVISION', revision), ('PRIOR_REVISION', prior)):
            patcher = patch.object(web, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        accepted = dict(self.accepted(), nativeRevision=native, nativeTree=tree)
        return root, git, put, commit, baseline, revision, accepted

    def test_git_scope_accepts_only_named_web_overlay_and_frozen_native(self):
        root, git, put, commit, baseline, revision, accepted = self.fixture()
        with patch.object(web, 'BASE_REVISION', baseline):
            web.validate_source_scope(root, revision, accepted)
            for path in ('apps/api/frozen.txt', 'apps/worker/frozen.txt', 'packages/frozen.txt', 'apps/macos-native/frozen.txt', 'apps/windows-native/frozen.txt', 'apps/tv-android/source.java', 'apps/ops-web/app/platform/session.tsx', 'coolify/releases/2026-11-02-analytics/build.py', web.BASELINE_APK, 'apps/ops-web/package.json'):
                put(path, b'unreviewed change\n')
                changed = commit()
                with self.subTest(path=path), self.assertRaises(web.GateError):
                    web.validate_source_scope(root, changed, accepted)
                git('reset', '--hard', revision)

    def test_prior_support_is_allowed_only_at_exact_reviewed_mode_and_blob(self):
        root, git, put, commit, baseline, revision, accepted = self.fixture()
        with patch.object(web, 'BASE_REVISION', baseline):
            web.validate_source_scope(root, revision, accepted)
            for path in (*web.PRIOR_SUPPORT, *web.PERFORMANCE_SUPPORT):
                put(path, b'unreviewed support mutation\n')
                changed = commit()
                with self.subTest(path=path), self.assertRaisesRegex(web.GateError, 'frozen_blob'):
                    web.validate_source_scope(root, changed, accepted)
                git('reset', '--hard', revision)
            path = next(iter(web.PRIOR_SUPPORT))
            (root / path).chmod(0o755)
            changed = commit()
            with self.assertRaisesRegex(web.GateError, 'frozen_blob'):
                web.validate_source_scope(root, changed, accepted)
            git('reset', '--hard', revision)
            put('coolify/releases/2026-11-02-tv-renewal-recovery/extra.py', b'not allowed')
            changed = commit()
            with self.assertRaisesRegex(web.GateError, 'outside_exact_scope'):
                web.validate_source_scope(root, changed, accepted)
        self.assertNotIn('apps/ops-web/public/downloads/flixify-pro-1.4.9.apk', web.EXCLUDED)

    def test_reviewed_runtime_blob_cannot_change_after_publication(self):
        root, git, put, commit, baseline, revision, accepted = self.fixture()
        put(web.PATHS[1], b'not the accepted handoff')
        changed = commit()
        with patch.object(web, 'BASE_REVISION', baseline), self.assertRaisesRegex(web.GateError, 'frozen_blob'):
            web.validate_source_scope(root, changed, accepted)

    def test_actual_accepted_source_and_artifact_proof(self):
        accepted = self.accepted()
        web.validate_source_scope(web.ROOT, web.PUBLIC_REVISION, accepted)
        web.validate_versions(web.ROOT, web.PUBLIC_REVISION, web.NATIVE_REVISION)
        proof = web.ROOT.parent / 'artifacts/tv-speed-20261102/artifact-proof.json'
        web.validate_apk_proof(proof.read_bytes(), web.NATIVE_REVISION, web.NATIVE_TREE,
                               web.ACCEPTED_APK_SHA256, web.ACCEPTED_APK_BYTES)
        for name, value in (('nativeRevision', 'a' * 40), ('apkBytes', 2147554), ('apkSha256', 'f' * 64)):
            with self.subTest(name=name), self.assertRaisesRegex(web.GateError, 'accepted_identity'):
                web.require_accepted(dict(accepted, **{name: value}))

    def test_actual_source_full_artifact_validator(self):
        with patch.object(web.builder, 'require_image_absent') as absent:
            values = web.validate_artifacts(web.ROOT, web.PUBLIC_REVISION,
                                            web.ACCEPTED_APK_SHA256, web.ACCEPTED_APK_BYTES)
        self.assertEqual(set(values), {web.APK, web.UPDATE_MANIFEST})
        absent.assert_called_once_with(web.APK)
        self.assertNotIn('apps/ops-web/public/downloads/flixify-pro-1.4.9.apk', values)

    def test_full_artifact_validator_rejects_extra_or_changed_source_only_apk(self):
        tmp = tempfile.TemporaryDirectory(prefix='catalog-public-artifact-git-')
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        def git(*args):
            return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL).decode().strip()
        def put(path, data):
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        def commit():
            git('add', '.')
            git('commit', '-qm', 'offline public artifact fixture')
            return git('rev-parse', 'HEAD')
        git('init', '-q')
        git('config', 'user.name', 'Offline fixture')
        git('config', 'user.email', 'offline@example.invalid')
        for path in (web.BASELINE_APK, web.UPDATE_MANIFEST):
            put(path, web.core.git_file(web.ROOT, web.BASE_REVISION, path))
        baseline = commit()
        prior_apk = 'apps/ops-web/public/downloads/flixify-pro-1.4.9.apk'
        put(prior_apk, web.core.git_file(web.ROOT, web.PRIOR_REVISION, prior_apk))
        prior = commit()
        for path in (web.APK, web.UPDATE_MANIFEST):
            put(path, web.core.git_file(web.ROOT, web.PUBLIC_REVISION, path))
        publication = commit()
        with patch.object(web, 'BASE_REVISION', baseline), patch.object(web, 'PRIOR_REVISION', prior), patch.object(web.builder, 'require_image_absent'):
            values = web.validate_artifacts(root, publication, web.ACCEPTED_APK_SHA256, web.ACCEPTED_APK_BYTES)
            self.assertEqual(set(values), {web.APK, web.UPDATE_MANIFEST})
            for kind in ('extra', 'mode', 'bytes'):
                if kind == 'extra':
                    put('apps/ops-web/public/downloads/unreviewed.apk', b'unreviewed')
                elif kind == 'mode':
                    (root / prior_apk).chmod(0o755)
                else:
                    put(prior_apk, b'changed frozen APK')
                revision = commit()
                with self.subTest(kind=kind), self.assertRaises(web.GateError):
                    web.validate_artifacts(root, revision, web.ACCEPTED_APK_SHA256, web.ACCEPTED_APK_BYTES)
                git('reset', '--hard', publication)
            # The source-only exception must not weaken APK or manifest checks.
            for path, data in ((web.APK, b'PK\x03\x04' + b'X' * (web.ACCEPTED_APK_BYTES - 4)),
                               (web.UPDATE_MANIFEST, b'{}'), (web.BASELINE_APK, b'changed old installer')):
                put(path, data)
                revision = commit()
                with self.subTest(path=path), self.assertRaises(web.GateError):
                    web.validate_artifacts(root, revision, web.ACCEPTED_APK_SHA256, web.ACCEPTED_APK_BYTES)
                git('reset', '--hard', publication)

    def test_release_disk_floor_is_eight_gib(self):
        for available in (0, 8 * 1024**3 - 1):
            with patch.object(release.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=available)):
                with self.assertRaisesRegex(release.GateError, 'requires_8GiB'):
                    release.require_disk_floor()
        with patch.object(release.shutil, 'disk_usage', return_value=types.SimpleNamespace(free=8 * 1024**3)):
            release.require_disk_floor()

    def test_complete_public_manifest_preserves_old_modes_links_and_bytes(self):
        accepted = self.accepted()
        manifest = json.dumps({'packageName': 'vip.flixify.tv', 'versionName': '1.4.10', 'versionCode': 18, 'minSdk': 23,
                               'apkUrl': web.APK_URL, 'sha256': accepted['apkSha256'], 'sizeBytes': accepted['apkBytes'], 'notes': 'Yenileme ekranı.'}).encode()
        rows = [['dir', '', 493], ['dir', 'downloads', 493],
                ['file', web.UPDATE_MANIFEST.removeprefix('apps/ops-web/public/'), 420, web.BASELINE_MANIFEST_BYTES, web.BASELINE_MANIFEST_SHA256],
                ['link', 'retained-link', 511, 'downloads/old.apk'], ['file', 'downloads/old.apk', 420, 50, 'f' * 64]]
        for path, size, sha in web.RETAINED:
            rows.append(['file', path.removeprefix('apps/ops-web/public/'), 420, size, sha])
        result = json.loads(web.expected_public_manifest(json.dumps(rows).encode(), accepted['apkSha256'], accepted['apkBytes'], manifest))
        for row in rows:
            if row[1] != 'downloads/flixify-tv-update.json':
                self.assertIn(row, result)
        self.assertEqual(len(result), len(rows) + 1)
        for index, row in enumerate(rows):
            if row[1] == web.BASELINE_APK.removeprefix('apps/ops-web/public/'):
                rows[index] = [*row[:2], 493, *row[3:]]
        with self.assertRaisesRegex(web.GateError, 'retained_public'):
            web.expected_public_manifest(json.dumps(rows).encode(), accepted['apkSha256'], accepted['apkBytes'], manifest)

    def test_bounded_compile_never_changes_resource_caps_or_uses_other_image(self):
        calls = []
        def command(*args, **kwargs):
            calls.append(args)
            if args[:2] == ('docker', 'create'):
                return b'a' * 64
            if args[:2] == ('docker', 'inspect'):
                return b'0\n'
            return b''
        with patch.object(web, 'command', command):
            web.container_compile('a' * 40, {'Config': {'Cmd': ['npm', 'start']}}, {path: b'reviewed' for path in (*web.PATHS, web.APK, web.UPDATE_MANIFEST)}, {})
        create = next(call for call in calls if call[:2] == ('docker', 'create'))
        for key, value in (('--network', 'none'), ('--memory', '1280m'), ('--memory-swap', '1536m'), ('--cpus', '1'), ('--pids-limit', '256')):
            self.assertEqual(create[create.index(key) + 1], value)
        self.assertIn(web.SOURCE_ID, create)
        self.assertIn('cpu.max', create[-1])
        self.assertIn('pids.max', create[-1])
        self.assertEqual(sum(call[:2] == ('docker', 'rm') for call in calls), 1)

    def test_release_configuration_can_change_only_ops_web(self):
        accepted, proof, runtime, _ = self.evidence()
        with patch.object(release.build, 'require_accepted', return_value=accepted), patch.object(release.build, 'verify_evidence'), patch.object(release.reviewed.guard, 'command') as command:
            release.configure('f' * 40, 'sha256:' + 'a' * 64, accepted, proof, runtime)
        command.assert_not_called()
        self.assertEqual(release.guard.CHANGED, ('ops-web',))
        self.assertEqual(release.guard.PROTECTED, ('api', 'worker', 'db'))
        self.assertEqual(release.guard.SOURCE_IDS, {'ops-web': web.SOURCE_ID})
        self.assertEqual(release.guard.PROTECTED_IMAGES['api'], (web.API_TAG, web.API_ID))
        self.assertEqual(release.guard.PROTECTED_IMAGES['worker'], (web.WORKER_TAG, web.WORKER_ID))

    def test_fresh_source_measurement_and_manifest_pins_are_not_historical(self):
        self.assertEqual(web.BASE_REVISION, '07fbf0bf4b29a1f07bb6b28d6dec740b80b9bda1')
        self.assertEqual(web.SOURCE_ID, 'sha256:dd2873797802a76c45052feb1a76a626adc2f04fa63a72f289350450169d4bfd')
        self.assertEqual(set(web.EXCLUDED), {*web.PATHS, web.APK, web.UPDATE_MANIFEST, 'apps/ops-web/.next'})
        self.assertNotIn(web.BASELINE_APK, web.EXCLUDED)
        for args in (('ROOT_MEASURE_FRESH_CURRENT_WEB', 100), ('a' * 64, 0), ('a' * 64, True)):
            with self.assertRaises(web.GateError):
                web.validate_source_fingerprint(*args)
        web.require_helpers()


if __name__ == '__main__':
    unittest.main()
