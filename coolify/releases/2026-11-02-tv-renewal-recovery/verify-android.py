#!/usr/bin/env python3
"""Inspect actual 1.4.9/code17 APK and 1.4.8 signing continuity; no device operations."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

spec = importlib.util.spec_from_file_location('renewal_android_profile', Path(__file__).with_name('build-web.py'))
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)
GateError, SIGNER_SHA256 = web.GateError, web.SIGNER_SHA256


def validate_signatures(signing):
    certificates = re.findall(r'(?m)^Signer #\d+ certificate SHA-256 digest:\s*([0-9a-fA-F]{64})\s*$', signing)
    if certificates != [SIGNER_SHA256]:
        raise GateError('apk_existing_single_signer_required')
    for label in ('v1 scheme (JAR signing)', 'v2 scheme (APK Signature Scheme v2)'):
        if len(re.findall(r'(?m)^Verified using ' + re.escape(label) + r': true\s*$', signing)) != 1:
            raise GateError('apk_v1_and_v2_signatures_required')


def validate_tool_output(signing, badging):
    validate_signatures(signing)
    package = re.findall(r"(?m)^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    minimum = re.findall(r"(?m)^(?:sdkVersion|minSdkVersion):'([^']+)'", badging)
    target = re.findall(r"(?m)^targetSdkVersion:'([^']+)'", badging)
    if package != [('vip.flixify.tv', '17', '1.4.9')] or minimum != ['23'] or target != ['35'] or re.search(r'(?m)^application-debuggable(?:\s|$)', badging):
        raise GateError('apk_release_package_version_or_api_differs')


def run(*args):
    try:
        result = subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
        if len(result.stdout) > 1024 * 1024:
            raise GateError('android_tool_output_exceeds_bound')
        return result.stdout.decode('utf8')
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise GateError('android_verification_tool_failed') from None


def apk_bytes(path):
    value = web.regular_bytes(path, web.MAX_APK_BYTES, 'apk_regular_bounded_file_required')
    if len(value) < 1024 or not value.startswith(b'PK\x03\x04'):
        raise GateError('apk_zip_required')
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_repo', type=Path)
    parser.add_argument('--native-revision', required=True)
    for name in ('apk', 'previous-apk', 'apksigner', 'aapt2', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args(argv)
    web.target(args.native_revision)
    if web.command('git', '-C', str(args.source_repo), 'rev-parse', args.native_revision + '^{commit}').decode().strip() != args.native_revision:
        raise GateError('native_revision_not_exact')
    web.command('git', '-C', str(args.source_repo), 'merge-base', '--is-ancestor', web.BASE_REVISION, args.native_revision)
    tree = web.command('git', '-C', str(args.source_repo), 'rev-parse', args.native_revision + ':apps/tv-android').decode().strip()
    web.target(tree)
    current, previous = apk_bytes(args.apk), apk_bytes(args.previous_apk)
    if len(previous) != web.BASELINE_APK_BYTES or hashlib.sha256(previous).hexdigest() != web.BASELINE_APK_SHA256:
        raise GateError('previous_published_148_apk_bytes_differ')
    validate_tool_output(run(str(args.apksigner), 'verify', '--verbose', '--print-certs', str(args.apk)),
                         run(str(args.aapt2), 'dump', 'badging', str(args.apk)))
    validate_signatures(run(str(args.apksigner), 'verify', '--verbose', '--print-certs', str(args.previous_apk)))
    proof = {'schema': 1, 'nativeRevision': args.native_revision, 'nativeTree': tree, 'packageName': 'vip.flixify.tv',
             'versionName': '1.4.9', 'versionCode': 17, 'minSdk': 23, 'targetSdk': 35,
             'sha256': hashlib.sha256(current).hexdigest(), 'sizeBytes': len(current), 'certificateSha256': SIGNER_SHA256,
             'baselineApkSha256': web.BASELINE_APK_SHA256, 'baselineApkSizeBytes': web.BASELINE_APK_BYTES,
             'signatureSchemes': ['v1', 'v2'], 'releaseDebuggable': False}
    web.validate_apk_proof(json.dumps(proof).encode(), args.native_revision, tree, proof['sha256'], proof['sizeBytes'])
    with args.output.open('xb') as output:
        output.write((json.dumps(proof, sort_keys=True, indent=2) + '\n').encode())
    print(json.dumps({'proofSha256': web.digest(args.output.read_bytes()), 'apkSha256': proof['sha256'], 'apkBytes': len(current), 'nativeTree': tree}))


if __name__ == '__main__':
    try:
        main()
    except GateError as error:
        print('android_verification_stopped:' + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
        print('android_verification_stopped:' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
