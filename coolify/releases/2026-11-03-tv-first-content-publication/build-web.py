#!/usr/bin/env python3
"""Guarded TV 1.4.11/code19 publication over the actual live TV 1.4.10 image."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import uuid


class GateError(RuntimeError):
    pass


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PROFILE = 'coolify/releases/2026-11-03-tv-first-content-publication/'
HELPER_PATHS = frozenset(
    'coolify/releases/2026-10-26-edge-recovery/' + name for name in
    ('build-worker.py', 'build-web.py', 'build-web-tv-style.py', 'build-tv-direct-web.py',
     'build-tv-startup-web.py', 'release-worker.py')
) | frozenset((
    'coolify/releases/2026-10-31-live-registration/build-api.py',
    'coolify/releases/2026-10-31-search-activation/build-web.py',
    'coolify/releases/2026-10-31-live-curation/build-web.py',
    'coolify/releases/2026-10-31-turkey-lineup/build-web.py',
    'coolify/releases/2026-11-01-packages/build-backend.py',
    'coolify/releases/2026-11-01-packages/build-web-embedded.py',
    'coolify/releases/2026-11-01-packages/release-backend.py',
    'coolify/releases/2026-11-01-packages/release-web-embedded.py',
    'coolify/releases/2026-11-01-welcome-offer/build-backend.py',
))


def digest(value):
    return hashlib.sha256(value).hexdigest()


def unique_json(data, label):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise GateError(label)
            result[key] = value
        return result
    try:
        return json.loads(data.decode('utf8'), object_pairs_hook=unique)
    except (ValueError, UnicodeError, AttributeError):
        raise GateError(label) from None


def regular_bytes(path, maximum, label):
    if path is None:
        raise GateError(label)
    path = Path(path)
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 1 <= info.st_size <= maximum:
            raise GateError(label)
        value = path.read_bytes()
        if len(value) != info.st_size:
            raise GateError(label)
        return value
    except OSError:
        raise GateError(label) from None


def require_helpers():
    entries = unique_json(regular_bytes(HERE / 'helper-pins.json', 65536, 'reviewed_helper_pins_required'), 'reviewed_helper_pins_invalid')
    if not isinstance(entries, dict) or set(entries) != HELPER_PATHS:
        raise GateError('reviewed_helper_scope_drift')
    for path, sha in entries.items():
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{64}', sha) or digest(regular_bytes(ROOT / path, 1024 * 1024, 'reviewed_helper_source_missing')) != sha:
            raise GateError('reviewed_helper_source_drift:' + path)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


require_helpers()
reviewed = load('renewal_reviewed_apk_publication', HERE.parent / '2026-10-31-live-curation/build-web.py')
backend = load('renewal_reviewed_host_snapshot', HERE.parent / '2026-11-01-welcome-offer/build-backend.py')
publication = reviewed.reviewed
builder, core, GateError, command = reviewed.builder, reviewed.core, reviewed.GateError, reviewed.command
SOURCE_TAG = 'flixify-ops-web:tv-catalog-publication-e7e62e43dd6b-20261102'
SOURCE_ID = 'sha256:718025341d2282758af5a086d6d2bcec8c81666de3de34022d14b7fa3afe4cf8'
BASE_REVISION = 'e7e62e43dd6b2caa691f10081af206d71d2b2f11'
API_TAG = 'flixify-api:analytics-07fbf0bf4b29-20261102'
API_ID = 'sha256:b7ef006b1733516a73f5ef1e5388b2cc7e746f738d0e4ebd80c164ad34067eb0'
WORKER_TAG = 'flixify-worker:packages-8fa66d103053-20261101'
WORKER_ID = 'sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57'
DB_ID = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
ENV_SHA256 = 'c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42'
FENCE_SHA256 = '5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b'
DESCRIPTOR = 'apps/ops-web/app/platform/tv-download.ts'
PATHS = (DESCRIPTOR,)
NEW_PATHS = ()
APK = 'apps/ops-web/public/downloads/flixify-pro-1.4.11.apk'
APK_URL = 'https://flixify.vip/downloads/flixify-pro-1.4.11.apk'
UPDATE_MANIFEST = 'apps/ops-web/public/downloads/flixify-tv-update.json'
BASELINE_APK = 'apps/ops-web/public/downloads/flixify-pro-1.4.10.apk'
BASELINE_APK_SHA256 = '6c820efbe587a1486441e1991cf289c437e884657ee7d9edf81a3635d87057a9'
BASELINE_APK_BYTES = 2147555
BASELINE_MANIFEST_BYTES = 458
BASELINE_MANIFEST_SHA256 = '41372df8aa4cba7beb5da0e9f3cad57dc0fba2cac3805a14b3acbcf573cd7f9d'
SIGNER_SHA256 = '158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594'
GRADLE, ANDROID_MANIFEST, MAX_APK_BYTES = reviewed.GRADLE, reviewed.ANDROID_MANIFEST, reviewed.MAX_APK_BYTES
EXCLUDED = (*PATHS, APK, UPDATE_MANIFEST, 'apps/ops-web/.next')
PROTECTED_TREES = ('apps/api', 'apps/worker', 'packages', 'apps/macos-native', 'apps/windows-native')
TOOLS = frozenset(PROFILE + name for name in (
    'build-web.py', 'release-web.py', 'verify-android.py', 'release-pins.json',
    'helper-pins.json', 'test-release.py', 'README.md',
))
PERFORMANCE_SUPPORT = frozenset((
    'docs/superpowers/plans/2026-11-03-tv-first-content.md',
    'docs/superpowers/specs/2026-11-03-tv-first-content-design.md',
))


def require_frozen_blob(repo, revision, path, frozen):
    builder.require_regular_blob(repo, revision, path)
    # ls-tree includes mode, kind and blob identity: no mode-only exception.
    current = command('git', '-C', str(repo), 'ls-tree', revision, '--', path)
    expected = command('git', '-C', str(repo), 'ls-tree', frozen, '--', path)
    if not expected or current != expected:
        raise GateError('catalog_frozen_blob_changed:' + path)


RETAINED = (
    (BASELINE_APK, BASELINE_APK_BYTES, BASELINE_APK_SHA256),
    ('apps/ops-web/public/downloads/flixify-pro-1.4.8.apk', 2141040, '261849966386c62ebbeb4cafa096b1a451331520f429c4c7cf4af74a6a0fec5c'),
    ('apps/ops-web/public/downloads/flixify-pro-1.4.7.apk', 1398255, '4c509e19ed410834a1e93bcf3ea3e57c0895a3f6a2e9fa33a411d56bbcb75284'),
    ('apps/ops-web/public/downloads/flixify-pro-macos-1.0.0-build2-test.dmg', 44517156, 'ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d'),
    ('apps/ops-web/public/downloads/flixify-pro-macos-1.0.1-build3-test.dmg', 46149316, '41d5ff671cdd7602052e3b15c6e0b63001a299421a5171eb315d98694f340785'),
    ('apps/ops-web/public/downloads/flixify-pro-windows-1.0.0-x64-test-setup.exe', 70307673, 'a77def878ffecb6080d2e80a7db491e2745e8be91b239fbf15be308cfa9e5927'),
    ('apps/ops-web/public/downloads/flixify-pro-windows-1.0.1-x64-test-setup.exe', 70316933, '9b40a987ee342e60b425fbd87698e80ebc9ab4cfff40b71dc522352c4d0aa8e9'),
    ('apps/ops-web/public/downloads/flixify-pro-windows-1.0.2-x64-test-setup.exe', 70355546, '3df1d76ba33f654a36d0349e96fdb102d190ba89e3fec9152fa43dc277c1abe0'),
)
RUNTIME_CHECKS = ('passed', 'unitTestsPassed', 'fullInstrumentationPassed',
                  'lintReleasePassed', 'releaseBuildPassed')
EVIDENCE_ROLES = frozenset(('finalUnitXml', 'finalInstrumentationXml', 'finalInstrumentationLog',
                            'finalBuildLog', 'performanceLog', 'firstContentJson'))


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise GateError('exact_revision_required')
    return 'flixify-ops-web:tv-first-content-publication-' + revision[:12] + '-20261103'


for module in (reviewed, publication, builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION, module.target = SOURCE_TAG, SOURCE_ID, BASE_REVISION, target
    module.PATHS, module.NEW_PATHS = PATHS, NEW_PATHS
for module in (reviewed, publication):
    for name in ('APK', 'APK_URL', 'BASELINE_APK', 'BASELINE_APK_SHA256', 'BASELINE_APK_BYTES',
                 'BASELINE_MANIFEST_BYTES', 'BASELINE_MANIFEST_SHA256', 'API_TAG', 'API_ID',
                 'WORKER_TAG', 'WORKER_ID', 'DB_ID', 'EXCLUDED'):
        setattr(module, name, globals()[name])
reviewed.RUNTIME_ALLOWLIST = frozenset(PATHS)
reviewed.configure_paths(PATHS)
public_manifest, canonical_public_manifest = reviewed.public_manifest, reviewed.canonical_public_manifest
validate_source_fingerprint, require_untouched = reviewed.validate_source_fingerprint, reviewed.require_untouched
snapshot_script, untouched = reviewed.snapshot_script, reviewed.untouched


def require_accepted(value=None):
    if value is None:
        value = unique_json(regular_bytes(HERE / 'release-pins.json', 16384, 'release_pins_required'), 'release_pins_invalid')
    keys = {'schema', 'nativeRevision', 'nativeTree', 'apkSha256', 'apkBytes', 'apkProofSha256', 'runtimeProofSha256', 'publicationRevision', 'unitTests', 'instrumentationTests', 'acceptance'}
    if not isinstance(value, dict) or set(value) != keys or type(value['schema']) is not int or value['schema'] != 1 or value['acceptance'] != 'root-accepted-offline-runtime-evidence':
        raise GateError('ROOT_ACCEPTANCE_PENDING')
    for key in ('nativeRevision', 'nativeTree', 'publicationRevision', 'apkSha256', 'apkProofSha256', 'runtimeProofSha256'):
        length = 40 if key in ('nativeRevision', 'nativeTree', 'publicationRevision') else 64
        if not isinstance(value[key], str) or not re.fullmatch('[0-9a-f]{' + str(length) + '}', value[key]):
            raise GateError('ROOT_ACCEPTANCE_PENDING:' + key)
    if type(value['apkBytes']) is not int or not 1024 <= value['apkBytes'] <= MAX_APK_BYTES:
        raise GateError('ROOT_ACCEPTANCE_PENDING:apkBytes')
    for key, minimum in (('unitTests', 172), ('instrumentationTests', 153)):
        if type(value[key]) is not int or not minimum <= value[key] <= 100000:
            raise GateError('ROOT_ACCEPTANCE_PENDING:' + key)
    if value['nativeRevision'] == value['publicationRevision']:
        raise GateError('native_and_publication_commits_must_differ')
    return value


def validate_apk_proof(data, native, native_tree, sha256, size):
    value = unique_json(data, 'independent_apk_proof_invalid')
    expected = {'schema': 1, 'nativeRevision': native, 'nativeTree': native_tree, 'packageName': 'vip.flixify.tv',
                'versionName': '1.4.11', 'versionCode': 19, 'minSdk': 23, 'targetSdk': 35, 'sha256': sha256,
                'sizeBytes': size, 'certificateSha256': SIGNER_SHA256, 'baselineApkSha256': BASELINE_APK_SHA256,
                'baselineApkSizeBytes': BASELINE_APK_BYTES, 'signatureSchemes': ['v1', 'v2'], 'releaseDebuggable': False}
    if not isinstance(value, dict) or set(value) != set(expected) or any(value[k] != v or type(value[k]) is not type(v) for k, v in expected.items()):
        raise GateError('independent_apk_proof_differs')
    return value


def verify_evidence(accepted, apk_proof_path, runtime_proof_path):
    accepted = require_accepted(accepted)
    proof = regular_bytes(apk_proof_path, 16384, 'independent_apk_proof_file_required')
    if digest(proof) != accepted['apkProofSha256']:
        raise GateError('independent_apk_proof_digest_differs')
    validate_apk_proof(proof, accepted['nativeRevision'], accepted['nativeTree'], accepted['apkSha256'], accepted['apkBytes'])
    runtime = regular_bytes(runtime_proof_path, 262144, 'runtime_proof_file_required')
    if digest(runtime) != accepted['runtimeProofSha256']:
        raise GateError('runtime_proof_digest_differs')
    value = unique_json(runtime, 'runtime_proof_invalid')
    expected = {'schema': 1, 'packageName': 'vip.flixify.tv', 'versionName': '1.4.11', 'versionCode': 19, 'minSdk': 23, 'targetSdk': 35,
                'nativeRevision': accepted['nativeRevision'], 'nativeTree': accepted['nativeTree'],
                'publicationRevision': accepted['publicationRevision'], 'apkSha256': accepted['apkSha256'],
                'verification': 'offline-instrumentation', **{name: True for name in RUNTIME_CHECKS},
                'unitTests': accepted['unitTests'], 'instrumentationTests': accepted['instrumentationTests'],
                'catalogFixtureItems': 29000,
                'realAccountUsed': False, 'realCheckoutStarted': False, 'providerPlaybackOpened': False}
    if not isinstance(value, dict) or set(value) != set(expected) | {'artifacts', 'evidenceFiles', 'instrumentationCommand'} or any(value[k] != v or type(value[k]) is not type(v) for k, v in expected.items()):
        raise GateError('runtime_proof_checks_or_identity_differ')
    artifacts = value['artifacts']
    if not isinstance(artifacts, list) or not 1 <= len(artifacts) <= 64:
        raise GateError('runtime_artifacts_required')
    names, evidence, total_bytes = set(), {}, 0
    for row in artifacts:
        if not isinstance(row, dict) or set(row) != {'file', 'bytes', 'sha256'} or not isinstance(row['file'], str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,199}', row['file']) or row['file'] in names:
            raise GateError('runtime_artifact_name_invalid')
        names.add(row['file'])
        if type(row['bytes']) is not int or not 1 <= row['bytes'] <= 128 * 1024**2 or not isinstance(row['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', row['sha256']):
            raise GateError('runtime_artifact_pin_invalid')
        total_bytes += row['bytes']
        if total_bytes > 256 * 1024**2:
            raise GateError('runtime_artifact_total_exceeds_bound')
        data = regular_bytes(Path(runtime_proof_path).parent / row['file'], row['bytes'], 'runtime_artifact_regular_file_required')
        if len(data) != row['bytes'] or digest(data) != row['sha256']:
            raise GateError('runtime_artifact_digest_or_size_differs')
        evidence[row['file']] = data
    roles = value['evidenceFiles']
    if not isinstance(roles, dict) or set(roles) != EVIDENCE_ROLES:
        raise GateError('runtime_evidence_roles_required')
    for files in roles.values():
        if not isinstance(files, list) or not files or any(not isinstance(name, str) or name not in names for name in files) or len(set(files)) != len(files):
            raise GateError('runtime_evidence_role_artifact_required')
    command_text = value['instrumentationCommand']
    if (not isinstance(command_text, str) or not 1 <= len(command_text) <= 8192
            or 'connectedDebugAndroidTest' not in command_text
            or re.search(r'(?i)(?:-P\s*[^\s]*class|instrumentationrunnerarguments|--tests|#|testfile|notclass|package=|--exclude-task|-x(?:\s|$)|dry-run)', command_text)):
        raise GateError('full_unfiltered_instrumentation_command_required')
    if not any(command_text.encode() in evidence[name] and b'BUILD SUCCESSFUL' in evidence[name]
               for name in roles['finalInstrumentationLog']):
        raise GateError('full_instrumentation_command_and_success_log_required')
    unit_cases = junit_cases([evidence[name] for name in roles['finalUnitXml']])
    instrument_cases = junit_cases([evidence[name] for name in roles['finalInstrumentationXml']])
    if unit_cases & instrument_cases:
        raise GateError('runtime_unit_and_instrumentation_coverage_duplicates')
    if len(unit_cases) != accepted['unitTests'] or len(instrument_cases) != accepted['instrumentationTests']:
        raise GateError('runtime_xml_counts_differ_from_reviewed_pins')
    for name in roles['firstContentJson']:
        validate_first_content(evidence[name])
    return value


def junit_cases(documents):
    cases = set()
    for data in documents:
        if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
            raise GateError('runtime_xml_declarations_forbidden')
        try:
            root = ET.fromstring(data)
        except ET.ParseError:
            raise GateError('runtime_xml_invalid') from None
        if root.tag not in ('testsuite', 'testsuites'):
            raise GateError('runtime_xml_suite_required')
        for suite in root.iter():
            if suite.tag not in ('testsuite', 'testsuites'):
                continue
            descendant_cases = list(suite.iter('testcase'))
            for key in ('failures', 'errors', 'skipped'):
                if suite.get(key, '0') != '0':
                    raise GateError('runtime_xml_not_all_passed')
            declared = suite.get('tests')
            if (declared is not None or suite.findall('testcase')) and declared != str(len(descendant_cases)):
                raise GateError('runtime_xml_suite_count_differs')
        local = list(root.iter('testcase'))
        if not local:
            raise GateError('runtime_xml_testcases_required')
        for case in local:
            identity = (case.get('classname'), case.get('name'))
            if (not all(isinstance(part, str) and part for part in identity)
                    or identity in cases or any(case.find(tag) is not None for tag in ('failure', 'error', 'skipped'))):
                raise GateError('runtime_xml_duplicate_or_nonpassing_case')
            cases.add(identity)
    return cases


def validate_first_content(data):
    value = unique_json(data, 'first_content_json_invalid')
    expected = {'schema': 1, 'catalogFixtureItems': 29000, 'callbackGatesPassed': True,
                'diskGatesPassed': True, 'artworkGatesPassed': True, 'accountGatesPassed': True}
    groups = ('callbacks', 'diskReads', 'uiMeasurements')
    if (not isinstance(value, dict) or set(value) != set(expected) | set(groups)
            or any(value[key] != item or type(value[key]) is not type(item) for key, item in expected.items())):
        raise GateError('first_content_checks_differ')
    for group in groups:
        rows = value[group]
        if not isinstance(rows, list) or not 1 <= len(rows) <= 256:
            raise GateError('first_content_measurements_required')
        names = set()
        for row in rows:
            if (not isinstance(row, dict) or set(row) != {'name', 'elapsedMs', 'thresholdMs'}
                    or not isinstance(row['name'], str) or not 1 <= len(row['name']) <= 200 or row['name'] in names):
                raise GateError('first_content_measurement_identity_invalid')
            names.add(row['name'])
            elapsed, threshold = row['elapsedMs'], row['thresholdMs']
            if (type(elapsed) not in (int, float) or type(threshold) not in (int, float)
                    or not math.isfinite(elapsed) or not math.isfinite(threshold)
                    or not 0 <= elapsed <= threshold or not 0 < threshold <= 60000
                    or (group == 'callbacks' and threshold > 500)):
                raise GateError('first_content_measurement_budget_invalid')
    return value


def validate_source_scope(repo, revision, accepted):
    accepted = require_accepted(accepted)
    native, native_tree = accepted['nativeRevision'], accepted['nativeTree']
    public = accepted['publicationRevision']
    for exact in (BASE_REVISION, native, public, revision):
        target(exact)
        if command('git', '-C', str(repo), 'rev-parse', exact + '^{commit}').decode().strip() != exact:
            raise GateError('renewal_revision_not_exact')
    for first, last in ((BASE_REVISION, native), (native, public), (public, revision)):
        command('git', '-C', str(repo), 'merge-base', '--is-ancestor', first, last)
    for exact in (native, public, revision):
        if command('git', '-C', str(repo), 'rev-parse', exact + ':apps/tv-android').decode().strip() != native_tree:
            raise GateError('renewal_native_tree_changed_after_freeze')
    for path in PERFORMANCE_SUPPORT:
        for exact in (public, revision):
            require_frozen_blob(repo, exact, path, native)
    for tree in PROTECTED_TREES:
        if command('git', '-C', str(repo), 'rev-parse', BASE_REVISION + ':' + tree) != command('git', '-C', str(repo), 'rev-parse', revision + ':' + tree):
            raise GateError('renewal_protected_source_tree_changed:' + tree)
    runtime = set()
    changed = command('git', '-C', str(repo), 'diff', '--no-renames', '--name-only', BASE_REVISION, revision).decode().splitlines()
    for path in changed:
        if path in (*PATHS, APK, UPDATE_MANIFEST):
            require_frozen_blob(repo, revision, path, public)
            runtime.add(path)
        elif path.startswith('apps/tv-android/'):
            require_frozen_blob(repo, revision, path, native)
        elif path in PERFORMANCE_SUPPORT:
            require_frozen_blob(repo, revision, path, native)
        elif path in TOOLS:
            builder.require_regular_blob(repo, revision, path)
        else:
            raise GateError('renewal_change_outside_exact_scope:' + path)
    if runtime != {*PATHS, APK, UPDATE_MANIFEST}:
        raise GateError('renewal_exact_web_runtime_and_public_delta_required')
    for path in PATHS:
        builder.require_regular_blob(repo, BASE_REVISION, path)
        builder.require_regular_blob(repo, revision, path)
    published = set(command('git', '-C', str(repo), 'diff', '--no-renames', '--name-only', native, revision, '--', 'apps/ops-web').decode().splitlines())
    if not {DESCRIPTOR, APK, UPDATE_MANIFEST} <= published:
        raise GateError('renewal_publication_required_after_native_freeze')


def validate_versions(repo, revision, native):
    original = core.git_file(repo, BASE_REVISION, DESCRIPTOR)
    if original.count(b'flixify-pro-1.4.10.apk') != 2 or original.count(b'"1.4.10"') != 1 or core.git_file(repo, revision, DESCRIPTOR) != original.replace(b'1.4.10', b'1.4.11'):
        raise GateError('renewal_descriptor_outside_exact_version_replacement')
    gradle = core.git_file(repo, native, GRADLE)
    for pattern in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]", rb'(?m)^\s*minSdk\s+23\s*$',
                    rb'(?m)^\s*targetSdk\s+35\s*$', rb'(?m)^\s*versionCode\s+19\s*$', rb"(?m)^\s*versionName\s+['\"]1\.4\.11['\"]\s*$"):
        if len(re.findall(pattern, gradle)) != 1:
            raise GateError('renewal_native_version_differs')
    if core.git_file(repo, native, ANDROID_MANIFEST).count(b'android:label="Flixify Pro"') != 1:
        raise GateError('renewal_native_label_differs')


def parse_manifest(data, sha256, size):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 65536:
        raise GateError('renewal_manifest_size_invalid')
    value = unique_json(data, 'renewal_manifest_invalid')
    expected = {'packageName': 'vip.flixify.tv', 'versionName': '1.4.11', 'versionCode': 19,
                'minSdk': 23, 'apkUrl': APK_URL, 'sha256': sha256, 'sizeBytes': size}
    if not isinstance(value, dict) or set(value) != set(expected) | {'notes'} or any(value[k] != v or type(value[k]) is not type(v) for k, v in expected.items()):
        raise GateError('renewal_manifest_pins_differ')
    notes = value['notes']
    if not isinstance(notes, str) or sum(2 if ord(ch) > 0xffff else 1 for ch in notes) > 2048 or re.search(r'[\x00-\x09\x0b-\x1f\x7f-\x9f]', notes):
        raise GateError('renewal_manifest_notes_invalid')
    return value


def expected_public_manifest(original, sha256, size, manifest):
    rows = unique_json(canonical_public_manifest(original), 'renewal_public_manifest_invalid')
    entries = {row[1]: row for row in rows}
    for path, length, sha in RETAINED:
        relative = path.removeprefix('apps/ops-web/public/')
        if entries.get(relative) != ['file', relative, 0o644, length, sha]:
            raise GateError('renewal_retained_public_artifact_drift:' + relative)
    if 'downloads/flixify-pro-1.4.9.apk' in entries:
        raise GateError('source_only_149_must_remain_absent_from_image')
    parse_manifest(manifest, sha256, size)
    return publication.expected_public_manifest(original, sha256, size, manifest)


def protected_snapshot():
    try:
        services = publication.protected_snapshot(API_TAG, API_ID)
        host = backend.host_snapshot()
    except backend.GateError as error:
        raise GateError(str(error)) from None
    if host.get('environment') != ENV_SHA256 or host.get('registrationFence') != FENCE_SHA256:
        raise GateError('renewal_environment_or_registration_fence_drift')
    return {'services': services, 'host': host}


publication.parse_manifest = parse_manifest
reviewed.parse_manifest = parse_manifest

def validate_artifacts(repo, revision, sha256, size):
    if not isinstance(sha256, str) or not re.fullmatch(r'[0-9a-f]{64}', sha256) or type(size) is not int or not 1024 <= size <= MAX_APK_BYTES:
        raise GateError('web_apk_pin_invalid')
    status = command('git', '-C', str(repo), 'diff', '--no-renames', '--name-status', BASE_REVISION, revision, '--', 'apps/ops-web/public').decode().splitlines()
    if set(status) != {'A\t' + APK, 'M\t' + UPDATE_MANIFEST}:
        raise GateError('web_public_changes_differ')
    publication.regular_public_blob(repo, BASE_REVISION, BASELINE_APK)
    previous = core.git_file(repo, BASE_REVISION, BASELINE_APK)
    if len(previous) != BASELINE_APK_BYTES or digest(previous) != BASELINE_APK_SHA256:
        raise GateError('curation_previous_apk_baseline_differs')
    if core.git_file(repo, revision, BASELINE_APK) != previous:
        raise GateError('curation_previous_apk_changed')
    publication.regular_public_blob(repo, BASE_REVISION, UPDATE_MANIFEST)
    old_manifest = core.git_file(repo, BASE_REVISION, UPDATE_MANIFEST)
    if len(old_manifest) != BASELINE_MANIFEST_BYTES or digest(old_manifest) != BASELINE_MANIFEST_SHA256:
        raise GateError('web_baseline_manifest_differs')
    values = {}
    for path in (APK, UPDATE_MANIFEST):
        publication.regular_public_blob(repo, revision, path)
        for ancestor in Path(path).parents:
            if str(ancestor) == '.':
                continue
            entry = builder.git_entry(repo, BASE_REVISION, str(ancestor))
            if entry and not entry.startswith(b'040000 tree '):
                raise GateError('web_public_ancestor_not_tree')
        length = command('git', '-C', str(repo), 'cat-file', '-s', revision + ':' + path).decode().strip()
        if not length.isdecimal() or (path == APK and int(length) != size) or (path == UPDATE_MANIFEST and not 1 <= int(length) <= 65536):
            raise GateError('web_public_artifact_size_invalid')
        if path == APK:
            if builder.git_entry(repo, BASE_REVISION, path):
                raise GateError('web_new_apk_already_exists')
            builder.require_image_absent(path)
        values[path] = core.git_file(repo, revision, path)
    if not values[APK].startswith(b'PK\x03\x04') or len(values[APK]) != size or digest(values[APK]) != sha256:
        raise GateError('web_apk_bytes_differ')
    parse_manifest(values[UPDATE_MANIFEST], sha256, size)
    return values


def preflight(repo, revision, accepted, apk_proof, runtime_proof, source_sha256, source_files):
    accepted = require_accepted(accepted)
    verify_evidence(accepted, apk_proof, runtime_proof)
    source_pin = validate_source_fingerprint(source_sha256, source_files)
    require_helpers()
    validate_source_scope(repo, revision, accepted)
    validate_versions(repo, revision, accepted['nativeRevision'])
    before_host = protected_snapshot()
    artifacts = validate_artifacts(repo, revision, accepted['apkSha256'], accepted['apkBytes'])
    base, updated, web_env, config = reviewed.source_preflight(repo, revision)
    updated.update(artifacts)
    before = untouched(SOURCE_ID)
    require_untouched(source_pin, before)
    original_public = public_manifest(SOURCE_ID)
    expected_public_manifest(original_public, accepted['apkSha256'], accepted['apkBytes'], artifacts[UPDATE_MANIFEST])
    if protected_snapshot() != before_host:
        raise GateError('renewal_preflight_protected_state_drift')
    return base, updated, web_env, config, original_public, before, before_host


def compile_script():
    limits = ('const guardFs=require("node:fs");function cap(p){const v=guardFs.readFileSync(p,"utf8").trim();if(!/^\\d+$/.test(v))throw Error("renewal_cgroup_unbounded");return BigInt(v)}'
              'let quota,period;if(guardFs.existsSync("/sys/fs/cgroup/cpu.max")){const c=guardFs.readFileSync("/sys/fs/cgroup/cpu.max","utf8").trim().split(/\\s+/);if(c.length!==2||!c.every(x=>/^\\d+$/.test(x)))throw Error("renewal_cpu_unbounded");quota=BigInt(c[0]);period=BigInt(c[1])}'
              'else{quota=cap("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");period=cap("/sys/fs/cgroup/cpu/cpu.cfs_period_us")}if(quota<=0n||period<=0n||quota>period)throw Error("renewal_cpu_cap_exceeded");'
              'const pp=guardFs.existsSync("/sys/fs/cgroup/pids.max")?"/sys/fs/cgroup/pids.max":"/sys/fs/cgroup/pids/pids.max";const pids=cap(pp);if(pids<=0n||pids>256n)throw Error("renewal_pid_cap_exceeded");')
    return limits + builder.build_script()


def container_compile(revision, base, updated, web_env):
    config = base.get('Config') or {}
    if not config.get('Cmd') or config.get('Volumes'):
        raise GateError('renewal_compile_base_config_unsupported')
    if set(updated) != {*PATHS, APK, UPDATE_MANIFEST}:
        raise GateError('renewal_compile_exact_overlay_required')
    name = 'flixify-renewal-web-build-' + uuid.uuid4().hex[:12]
    created = False
    args = ['docker', 'create', '--name', name, '--network', 'none', '--memory', '1280m',
            '--memory-swap', '1536m', '--cpus', '1', '--pids-limit', '256']
    for key, value in web_env.items():
        args.extend(('--env', key + '=' + value))
    args.extend((SOURCE_ID, 'node', '-e', compile_script()))
    try:
        owned = command(*args).decode().strip()
        created = True
        if not re.fullmatch(r'[0-9a-f]{64}', owned):
            raise GateError('renewal_compile_container_id_invalid')
        with tempfile.TemporaryDirectory(prefix='flixify-renewal-overlay-') as directory:
            for index, (path, data) in enumerate(updated.items()):
                file = Path(directory) / str(index)
                file.write_bytes(data)
                file.chmod(0o644)
                command('docker', 'cp', str(file), owned + ':/app/' + path)
        command('docker', 'start', '--attach', owned, timeout=1200)
        if command('docker', 'inspect', '--format', '{{.State.ExitCode}}', owned).decode().strip() != '0':
            raise GateError('renewal_bounded_compile_failed')
        command('docker', 'commit', '--change', 'CMD ' + json.dumps(config['Cmd']), '--change',
                'LABEL org.opencontainers.image.revision=' + revision, '--change',
                'LABEL vip.flixify.edge-recovery.base=' + SOURCE_ID, owned, target(revision), timeout=300)
    finally:
        if created:
            command('docker', 'rm', '--force', name)


def download_verification_script(sha256, size, manifest):
    parse_manifest(manifest, sha256, size)
    pins = [(APK, size, sha256), *RETAINED, (UPDATE_MANIFEST, len(manifest), digest(manifest))]
    rows = [{'path': path.removeprefix('apps/ops-web/public'), 'size': length, 'sha': sha,
             'kind': 'json' if path.endswith('.json') else 'apk' if path.endswith('.apk') else 'dmg' if path.endswith('.dmg') else 'exe'} for path, length, sha in pins]
    return ('const crypto=require("node:crypto");(async()=>{const base="http://127.0.0.1:3000",pins=' + json.dumps(rows) + ';'
            'const mime={exe:["application/vnd.microsoft.portable-executable","application/x-msdownload","application/x-msdos-program","application/x-dosexec","application/octet-stream"],dmg:["application/x-apple-diskimage","application/octet-stream"],apk:["application/vnd.android.package-archive","application/octet-stream"],json:["application/json"]};'
            'async function bounded(r,size){const chunks=[];let count=0;for await(const c of r.body){count+=c.length;if(count>size)throw Error("download_too_large");chunks.push(c)}if(count!==size)throw Error("download_size_invalid");return Buffer.concat(chunks,count)}'
            'for(const p of pins){const u=base+p.path;let h;for(let n=0;n<40;n++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.status===200)break}catch{}await new Promise(r=>setTimeout(r,250))}'
            'if(!h||h.status!==200||Number(h.headers.get("content-length"))!==p.size||!mime[p.kind].includes(h.headers.get("content-type")?.split(";")[0]))throw Error("download_head_invalid");'
            'if(p.kind!=="json"){const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/"+p.size)throw Error("download_range_invalid");await bounded(r,32)}'
            'const full=await fetch(u,{signal:AbortSignal.timeout(120000)});if(full.status!==200)throw Error("download_get_invalid");const b=await bounded(full,p.size);if(crypto.createHash("sha256").update(b).digest("hex")!==p.sha)throw Error("download_digest_invalid");'
            'if(p.kind==="apk"&&!b.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw Error("apk_magic_invalid");'
            'if(p.kind==="dmg"&&b.subarray(b.length-512,b.length-508).toString()!=="koly")throw Error("dmg_magic_invalid");'
            'if(p.kind==="exe"){if(b.length<64||b.subarray(0,2).toString()!=="MZ")throw Error("exe_magic_invalid");const p=b.readUInt32LE(60);if(p<64||p>b.length-24||!b.subarray(p,p+4).equals(Buffer.from([80,69,0,0])))throw Error("exe_pe_invalid")}}'
            'for(const path of ["/","/indir","/paketler"]){const r=await fetch(base+path,{redirect:"manual",signal:AbortSignal.timeout(10000)});if(r.status!==200)throw Error("page_status_invalid")}console.log("candidate_renewal_and_retained_downloads_verified")})().catch(()=>{console.error("candidate_renewal_download_contract_failed");process.exit(1)})')


def verify_download(candidate, sha256, size, manifest):
    name = 'flixify-renewal-download-check-' + uuid.uuid4().hex[:12]
    created = False
    try:
        owned = command('docker', 'create', '--name', name, '--network', 'none', '--memory', '512m', '--memory-swap', '640m', '--cpus', '1', '--pids-limit', '128', candidate).decode().strip()
        created = True
        if not re.fullmatch(r'[0-9a-f]{64}', owned) or command('docker', 'inspect', '--format', '{{.Image}}', owned).decode().strip() != candidate:
            raise GateError('renewal_candidate_container_drift')
        command('docker', 'start', owned)
        command('docker', 'exec', owned, 'node', '-e', download_verification_script(sha256, size, manifest), timeout=300)
    finally:
        if created:
            command('docker', 'rm', '--force', name)


def verify_candidate(result, revision, accepted):
    base, updated, web_env, config, original_public, before, _ = result
    candidate = builder.verify_candidate(base, revision, updated, web_env, config)
    require_untouched(before, untouched(candidate))
    if canonical_public_manifest(public_manifest(candidate)) != expected_public_manifest(original_public, accepted['apkSha256'], accepted['apkBytes'], updated[UPDATE_MANIFEST]):
        raise GateError('renewal_candidate_public_tree_differs')
    verify_download(candidate, accepted['apkSha256'], accepted['apkBytes'], updated[UPDATE_MANIFEST])
    return candidate


def main(argv=None):
    accepted = require_accepted()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_repo', nargs='?', type=Path)
    parser.add_argument('--revision')
    parser.add_argument('--apk-proof-file', type=Path, required=True)
    parser.add_argument('--runtime-proof-file', type=Path, required=True)
    parser.add_argument('--source-untouched-sha256')
    parser.add_argument('--source-untouched-files', type=int)
    actions = parser.add_mutually_exclusive_group()
    for name in ('measure', 'build', 'verify-existing'):
        actions.add_argument('--' + name, action='store_true')
    args = parser.parse_args(argv)
    verify_evidence(accepted, args.apk_proof_file, args.runtime_proof_file)
    if args.measure:
        protected = protected_snapshot()
        measured = untouched(SOURCE_ID)
        if protected_snapshot() != protected:
            raise GateError('renewal_measure_protected_state_drift')
        print(json.dumps({'sourceTag': SOURCE_TAG, 'sourceId': SOURCE_ID, 'excluded': list(EXCLUDED), 'measurement': measured}, sort_keys=True))
        return
    if args.source_repo is None or args.revision is None:
        raise GateError('exact_source_repository_and_revision_required')
    result = preflight(args.source_repo, args.revision, accepted, args.apk_proof_file, args.runtime_proof_file, args.source_untouched_sha256, args.source_untouched_files)
    if not (args.build or args.verify_existing):
        print('tv_renewal_preflight_ok; no_mutation; independent_native_apk_runtime_and_source_pins_verified')
        return
    if args.build:
        if shutil.disk_usage('/var/lib/docker').free < 8 * 1024**3:
            raise GateError('renewal_build_requires_8GiB')
        if target(args.revision) in command('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', target(args.revision)).decode().splitlines():
            raise GateError('renewal_candidate_tag_exists_use_verify_existing')
        container_compile(args.revision, result[0], result[1], result[2])
    candidate = verify_candidate(result, args.revision, accepted)
    if protected_snapshot() != result[-1]:
        raise GateError('renewal_build_changed_protected_state')
    print('web_candidate_verified:' + candidate)


if __name__ == '__main__':
    try:
        main()
    except GateError as error:
        print('build_stopped:' + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print('build_stopped:' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
