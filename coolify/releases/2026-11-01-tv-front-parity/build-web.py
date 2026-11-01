#!/usr/bin/env python3
"""Publish TV 1.4.7 over the current website, changing only download metadata."""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).parent
reviewed = load('parity_reviewed_publication', HERE.parent / '2026-10-31-live-curation' / 'build-web.py')
backend = load('parity_reviewed_host_proof', HERE.parent / '2026-11-01-welcome-offer' / 'build-backend.py')
publication = reviewed.reviewed
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = 'flixify-ops-web:welcome-offer-3010833e1c4b-20261101'
SOURCE_ID = 'sha256:65a3d81e5337f292d180ffe98dee4e5661b29bf783fee0a33d16c9bfe86c59d2'
BASE_REVISION = '3010833e1c4b1a7ebe059580d820f6c6a02d03e7'
API_TAG = 'flixify-api:welcome-offer-a052006305ed-20261101'
API_ID = 'sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496'
WORKER_TAG = 'flixify-worker:packages-8fa66d103053-20261101'
WORKER_ID = 'sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57'
DB_ID = reviewed.DB_ID
DESCRIPTOR = reviewed.DESCRIPTOR
APK = 'apps/ops-web/public/downloads/flixify-pro-1.4.7.apk'
APK_URL = 'https://flixify.vip/downloads/flixify-pro-1.4.7.apk'
BASELINE_APK = 'apps/ops-web/public/downloads/flixify-pro-1.4.6.apk'
BASELINE_APK_SHA256 = '911bbfc9d6513676d6c6605af1e07a4d9e81f9997bb44c32c17688ae9b34a4b6'
BASELINE_APK_BYTES = 1374125
BASELINE_MANIFEST_BYTES = 483
BASELINE_MANIFEST_SHA256 = '4d48c55550a17bd55ba8c5247da22ccae966ebe11fad4c2ab11f92bfcbd5a838'
SIGNER_SHA256, GRADLE, ANDROID_MANIFEST = reviewed.SIGNER_SHA256, reviewed.GRADLE, reviewed.ANDROID_MANIFEST
UPDATE_MANIFEST, MAX_APK_BYTES = reviewed.UPDATE_MANIFEST, reviewed.MAX_APK_BYTES
PATHS = (DESCRIPTOR,)
NEW_PATHS = ()
EXCLUDED = (*PATHS, APK, UPDATE_MANIFEST, 'apps/ops-web/.next')
TOOLS = frozenset('coolify/releases/2026-11-01-tv-front-parity/' + name for name in (
    'build-web.py', 'release-web.py', 'verify-android.py', 'verify-upgrade.py',
    'test-release.py', 'README.md', 'runtime-paths.json',
))


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise GateError('exact_revision_required')
    return 'flixify-ops-web:tv-front-parity-' + revision[:12] + '-20261101'


for module in (reviewed, publication, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION, module.target = SOURCE_TAG, SOURCE_ID, BASE_REVISION, target
for module in (reviewed, publication):
    for name in ('APK', 'APK_URL', 'BASELINE_APK', 'BASELINE_APK_SHA256', 'BASELINE_APK_BYTES',
                 'BASELINE_MANIFEST_BYTES', 'BASELINE_MANIFEST_SHA256', 'NEW_PATHS', 'TOOLS',
                 'API_TAG', 'API_ID', 'WORKER_TAG', 'WORKER_ID'):
        setattr(module, name, globals()[name])
reviewed.RUNTIME_ALLOWLIST = frozenset(PATHS)
reviewed.configure_paths(PATHS)
original_scope = reviewed.validate_source_scope
original_download_script = reviewed.download_verification_script
original_protected_snapshot = reviewed.protected_snapshot
unique_json = reviewed.unique_json


def parse_runtime_paths(data):
    paths = unique_json(data, 'parity_runtime_paths_invalid')
    if not isinstance(paths, list) or paths != list(PATHS):
        raise GateError('parity_descriptor_only_runtime_paths_required')
    return PATHS


def validate_source_scope(repo, revision, native, native_tree, paths):
    if tuple(paths) != PATHS:
        raise GateError('parity_descriptor_only_runtime_paths_required')
    original_scope(repo, revision, native, native_tree, paths)


def validate_versions(repo, revision, native):
    original = core.git_file(repo, BASE_REVISION, DESCRIPTOR)
    if original.count(b'flixify-pro-1.4.6.apk') != 2 or original.count(b'"1.4.6"') != 1:
        raise GateError('parity_descriptor_baseline_differs')
    if core.git_file(repo, revision, DESCRIPTOR) != original.replace(b'1.4.6', b'1.4.7'):
        raise GateError('parity_descriptor_outside_exact_version_replacement')
    gradle = core.git_file(repo, native, GRADLE)
    for pattern in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]", rb'(?m)^\s*minSdk\s+23\s*$',
                    rb'(?m)^\s*targetSdk\s+35\s*$', rb'(?m)^\s*versionCode\s+15\s*$',
                    rb"(?m)^\s*versionName\s+['\"]1\.4\.7['\"]\s*$"):
        if len(re.findall(pattern, gradle)) != 1:
            raise GateError('parity_native_version_differs')
    if core.git_file(repo, native, ANDROID_MANIFEST).count(b'android:label="Flixify Pro"') != 1:
        raise GateError('parity_native_label_differs')


def parse_manifest(data, sha256, size):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 65536:
        raise GateError('parity_manifest_size_invalid')
    value = unique_json(data, 'parity_manifest_invalid')
    expected = {'packageName': 'vip.flixify.tv', 'versionName': '1.4.7', 'versionCode': 15,
                'minSdk': 23, 'apkUrl': APK_URL, 'sha256': sha256, 'sizeBytes': size}
    if not isinstance(value, dict) or set(value) != set(expected) | {'notes'} or any(value[k] != v or type(value[k]) is not type(v) for k, v in expected.items()):
        raise GateError('parity_manifest_pin_differs')
    notes = value['notes']
    if not isinstance(notes, str) or sum(2 if ord(c) > 0xffff else 1 for c in notes) > 2048 or re.search(r'[\x00-\x09\x0b-\x1f\x7f-\x9f]', notes):
        raise GateError('parity_manifest_notes_invalid')
    return value


def validate_apk_proof(data, native, native_tree, sha256, size):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 16384:
        raise GateError('independent_apk_proof_invalid')
    value = unique_json(data, 'independent_apk_proof_invalid')
    expected = {'schema': 1, 'nativeRevision': native, 'nativeTree': native_tree, 'packageName': 'vip.flixify.tv',
                'versionName': '1.4.7', 'versionCode': 15, 'minSdk': 23, 'targetSdk': 35, 'sha256': sha256,
                'sizeBytes': size, 'certificateSha256': SIGNER_SHA256, 'baselineApkSha256': BASELINE_APK_SHA256,
                'baselineApkSizeBytes': BASELINE_APK_BYTES, 'signatureSchemes': ['v1', 'v2'], 'releaseDebuggable': False}
    if not isinstance(value, dict) or set(value) != set(expected) or any(value[k] != v or type(value[k]) is not type(v) for k, v in expected.items()):
        raise GateError('independent_apk_proof_differs')
    return value


def protected_snapshot(api_tag, api_id):
    if (api_tag, api_id) != (API_TAG, API_ID):
        raise GateError('parity_exact_current_api_required')
    try:
        return {'services': original_protected_snapshot(api_tag, api_id), 'host': backend.host_snapshot()}
    except backend.GateError as error:
        raise GateError(str(error)) from None


def download_verification_script(sha256, size, manifest):
    script = original_download_script(sha256, size, manifest)
    if script.count('flixify-pro-1.4.4.apk') != 1 or script.count('j.versionName!=="1.4.4"||j.versionCode!==12') != 1:
        raise GateError('parity_reviewed_download_verifier_anchor_differs')
    return script.replace('flixify-pro-1.4.4.apk', 'flixify-pro-1.4.7.apk').replace(
        'j.versionName!=="1.4.4"||j.versionCode!==12', 'j.versionName!=="1.4.7"||j.versionCode!==15')


reviewed.parse_runtime_paths, reviewed.validate_source_scope = parse_runtime_paths, validate_source_scope
reviewed.validate_versions = validate_versions
reviewed.parse_manifest, publication.parse_manifest = parse_manifest, parse_manifest
reviewed.validate_apk_proof, reviewed.protected_snapshot = validate_apk_proof, protected_snapshot
reviewed.download_verification_script = download_verification_script
validate_artifacts, expected_public_manifest = reviewed.validate_artifacts, reviewed.expected_public_manifest
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched
preflight, verify_candidate, main = reviewed.preflight, reviewed.verify_candidate, reviewed.main

if __name__ == '__main__':
    try:
        main()
    except GateError as error:
        print('build_stopped:' + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print('build_stopped:' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
