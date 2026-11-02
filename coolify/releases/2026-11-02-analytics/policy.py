"""Pure release policy. Importing this file performs no host or network operations."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat


class GateError(RuntimeError):
    pass


BASE = 'eba4d62b3893e0e173392be0421101279bfe3bac'
UUID = 'eupquokyj7qegufqvqkjmuyr'
WEB_TAG = 'flixify-ops-web:windows-repair-eba4d62b3893-20261102'
WEB_ID = 'sha256:3f882fa9bc2029bc4cad6cd4635fb6d304900085e89e0e97ddba900ad040bfd3'
API_TAG = 'flixify-api:welcome-offer-a052006305ed-20261101'
API_ID = 'sha256:241bbdc543761a2081055d08117077d91fc0cd18296147a5397ed42fed46f496'
WORKER_TAG = 'flixify-worker:packages-8fa66d103053-20261101'
WORKER_ID = 'sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57'
DB_ID = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
ENV_SHA = 'c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42'
FENCE_SHA = '5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b'
MIN_FREE = 8 * 1024**3
API_ROOT = 'coolify/releases/2026-11-01-welcome-offer/api-source/'
API_NAMES = ('analytics-policy.ts', 'analytics-delivery.ts', 'analytics-routes.ts', 'analytics-store.ts', 'analytics-runtime.ts', 'stripe-billing-routes.ts', 'stripe-billing-store.ts', 'stripe-payment.ts', 'stripe-payment-store.ts')
API_NEW = tuple('apps/api/src/' + name for name in API_NAMES[:5])
API_PATHS = tuple('apps/api/src/' + name for name in API_NAMES) + ('apps/api/src/server.ts',)
SERVER_REPLACEMENTS = (
    {'old': 'import { registerWelcomeOfferRoutes } from "./welcome-offer-routes.js";', 'new': 'import { registerWelcomeOfferRoutes } from "./welcome-offer-routes.js";\nimport { registerAnalyticsRuntime } from "./analytics-runtime.js";'},
    {'old': '  if (!isDemoMode) registerWelcomeOfferRoutes(app, { authenticate: authenticateUser, store: new WelcomeOfferStore(pool) });', 'new': '  if (!isDemoMode) registerWelcomeOfferRoutes(app, { authenticate: authenticateUser, store: new WelcomeOfferStore(pool) });\n  if (!isDemoMode) registerAnalyticsRuntime(app, { authenticate: authenticateUser, pool });'},
)
WEB_NEW = tuple('apps/ops-web/app/platform/' + name for name in ('analytics-playback.ts', 'analytics-policy.ts', 'analytics-provider.tsx', 'analytics.module.css', 'analytics.ts'))
WEB_PATHS = tuple('apps/ops-web/app/' + name for name in ('ayarlar/page.tsx', 'canli-tv/page.tsx', 'components/home/HomeFooter.tsx', 'components/install/InstallProvider.tsx', 'giris-yap/page.tsx', 'indir/page.tsx', 'kayit-ol/page.tsx', 'layout.tsx', 'paketler/page.tsx', 'platform/catalog-search.tsx', 'platform/catalog.tsx', 'platform/detail.tsx', 'platform/landing.tsx', 'platform/login.tsx', 'platform/session.tsx', 'platform/shell.tsx', 'platform/welcome-offer.tsx', 'site-shell.tsx', 'platform/tv-download.ts', 'platform/mac-download.ts', 'platform/windows-download.ts')) + WEB_NEW
UPDATE = 'apps/ops-web/public/downloads/flixify-tv-update.json'
OLD_UPDATE_SHA = 'f439fd197839cbc3773dacc226801718c8688a3c438467f74ac87d619a838680'
ARTIFACT_PATHS = {
    'android': 'apps/ops-web/public/downloads/flixify-pro-1.4.8.apk',
    'macos': 'apps/ops-web/public/downloads/flixify-pro-macos-1.0.1-build3-test.dmg',
    'windows': 'apps/ops-web/public/downloads/flixify-pro-windows-1.0.2-x64-test-setup.exe',
}
RETAINED = (
    ('apps/ops-web/public/downloads/flixify-pro-windows-1.0.0-x64-test-setup.exe', 70307673, 'a77def878ffecb6080d2e80a7db491e2745e8be91b239fbf15be308cfa9e5927'),
    ('apps/ops-web/public/downloads/flixify-pro-windows-1.0.1-x64-test-setup.exe', 70316933, '9b40a987ee342e60b425fbd87698e80ebc9ab4cfff40b71dc522352c4d0aa8e9'),
    ('apps/ops-web/public/downloads/flixify-pro-macos-1.0.0-build2-test.dmg', 44517156, 'ad6de5abf8eea360fb4e195c11f0c82de48236d3ab723986e634df1c587a315d'),
    ('apps/ops-web/public/downloads/flixify-pro-1.4.7.apk', 1398255, '4c509e19ed410834a1e93bcf3ea3e57c0895a3f6a2e9fa33a411d56bbcb75284'),
)
MIGRATION = 'supabase/migrations/202611020001_analytics.sql'
GA_KEYS = frozenset(('GA4_ENABLED', 'GA4_WEB_MEASUREMENT_ID', 'GA4_WEB_API_SECRET', 'GA4_WINDOWS_MEASUREMENT_ID', 'GA4_WINDOWS_API_SECRET', 'GA4_ANALYTICS_HASH_SECRET'))


def digest(value):
    return hashlib.sha256(value).hexdigest()


def exact(value, pattern, label):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise GateError(label)
    return value


def pins(value):
    if not isinstance(value, dict) or set(value) != {'schema', 'revision', 'native', 'apiServerSha256', 'migrationSha256', 'postgresFixtureSha256'} or value['schema'] != 1:
        raise GateError('accepted_release_pins_required')
    exact(value['revision'], r'[0-9a-f]{40}', 'accepted_revision_required')
    for key in ('apiServerSha256', 'migrationSha256', 'postgresFixtureSha256'):
        exact(value[key], r'[0-9a-f]{64}', 'accepted_' + key + '_required')
    if not isinstance(value['native'], dict) or set(value['native']) != set(ARTIFACT_PATHS):
        raise GateError('accepted_native_set_required')
    for name, row in value['native'].items():
        if not isinstance(row, dict) or set(row) != {'revision', 'tree', 'sha256', 'bytes', 'evidenceSha256', 'acceptance'}:
            raise GateError('accepted_native_shape_required')
        for key in ('revision', 'tree'): exact(row[key], r'[0-9a-f]{40}', 'accepted_' + name + '_' + key + '_required')
        for key in ('sha256', 'evidenceSha256'): exact(row[key], r'[0-9a-f]{64}', 'accepted_' + name + '_' + key + '_required')
        if type(row['bytes']) is not int or not 1024 <= row['bytes'] <= 160 * 1024**2:
            raise GateError('accepted_artifact_bytes_required')
        expected = {'windows': 'actual-windows-ci', 'macos': 'configured-universal-local-test', 'android': 'configured-release-same-signer'}[name]
        if row['acceptance'] != expected: raise GateError('accepted_native_evidence_kind_required')
    return value


def analytics_environment(value):
    if not isinstance(value, dict) or set(value) != GA_KEYS:
        raise GateError('only_complete_owned_GA4_environment_allowed')
    if value['GA4_ENABLED'] != 'true': raise GateError('analytics_enabled_release_required')
    for key in ('GA4_WEB_MEASUREMENT_ID', 'GA4_WINDOWS_MEASUREMENT_ID'):
        exact(value[key], r'G-[A-Z0-9]{6,20}', 'analytics_measurement_id_invalid')
    for key in ('GA4_WEB_API_SECRET', 'GA4_WINDOWS_API_SECRET'):
        exact(value[key], r'[A-Za-z0-9_-]{8,128}', 'analytics_api_secret_invalid')
    exact(value['GA4_ANALYTICS_HASH_SECRET'], r'[A-Za-z0-9_+=/-]{32,256}', 'analytics_stable_hash_secret_invalid')
    return dict(value)


def read_private_environment(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid() or not 2 <= info.st_size <= 8192:
        raise GateError('owned_private_0600_environment_file_required')
    def unique(rows):
        result = {}
        for key, value in rows:
            if key in result: raise GateError('duplicate_environment_key')
            result[key] = value
        return result
    return analytics_environment(json.loads(path.read_bytes(), object_pairs_hook=unique))


def environment(document, service):
    value = document['services'][service].get('environment')
    if isinstance(value, dict): return dict(value)
    if not isinstance(value, list): raise GateError('environment_shape_invalid')
    result = {}
    for row in value:
        if not isinstance(row, str) or '=' not in row: raise GateError('environment_entry_invalid')
        key, item = row.split('=', 1)
        if key in result: raise GateError('duplicate_environment_key')
        result[key] = item
    return result


def with_analytics(document, owned):
    if set(owned) - GA_KEYS: raise GateError('unowned_environment_mutation')
    result = copy.deepcopy(document)
    original = result['services']['api']['environment']
    if isinstance(original, dict):
        for key in GA_KEYS: original.pop(key, None)
        original.update(owned)
    elif isinstance(original, list):
        result['services']['api']['environment'] = [row for row in original if row.split('=', 1)[0] not in GA_KEYS] + [key + '=' + value for key, value in sorted(owned.items())]
    else: raise GateError('environment_shape_invalid')
    return result


def restore_analytics(document, expected, previous):
    actual = {key: value for key, value in environment(document, 'api').items() if key in GA_KEYS}
    if actual != expected: raise GateError('owned_environment_drift_rollback_stopped')
    return with_analytics(document, previous)


def validate_web_delta(changed, public):
    runtime = set()
    for path in changed:
        if re.fullmatch(r'apps/ops-web/app/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?', path): continue
        runtime.add(path)
    if runtime != set(WEB_PATHS) | set(public): raise GateError('exact_web_runtime_and_public_scope_required')


def expected_public(rows, additions):
    if set(additions) != set(ARTIFACT_PATHS.values()) | {UPDATE}: raise GateError('exact_three_native_files_and_update_manifest_required')
    indexed = {row[1]: row for row in rows}
    if len(indexed) != len(rows) or indexed.get('downloads') != ['dir', 'downloads', 0o755]: raise GateError('source_public_manifest_invalid')
    for path, size, sha in RETAINED:
        relative = path.removeprefix('apps/ops-web/public/')
        if indexed.get(relative) != ['file', relative, 0o644, size, sha]: raise GateError('retained_public_artifact_drift')
    relative = UPDATE.removeprefix('apps/ops-web/public/')
    if indexed.get(relative) != ['file', relative, 0o644, 462, OLD_UPDATE_SHA]: raise GateError('source_tv_manifest_drift')
    result = [row for row in rows if row[1] != relative]
    for path, value in additions.items():
        relative = path.removeprefix('apps/ops-web/public/')
        if path != UPDATE and relative in indexed: raise GateError('new_native_artifact_already_exists')
        result.append(['file', relative, 0o644, len(value), digest(value)])
    return sorted(result, key=lambda row: row[1])


def require_helper_pins(repo):
    here = Path(__file__).resolve().parent
    entries = json.loads((here / 'helper-pins.json').read_bytes())
    expected = set('coolify/releases/2026-10-26-edge-recovery/' + name for name in ('build-worker.py', 'build-web.py', 'build-web-tv-style.py', 'build-tv-direct-web.py', 'build-tv-startup-web.py', 'release-worker.py')) | {'coolify/releases/2026-10-31-live-registration/build-api.py', 'coolify/releases/2026-10-31-search-activation/build-web.py', 'coolify/releases/2026-11-01-packages/build-backend.py', 'coolify/releases/2026-11-01-packages/release-backend.py'}
    if set(entries) != expected: raise GateError('reviewed_helper_scope_drift')
    for path, sha in entries.items():
        source = Path(repo) / path
        if source.is_symlink() or not source.is_file() or digest(source.read_bytes()) != sha: raise GateError('reviewed_helper_source_drift:' + path)


def verify_native_evidence(directory, accepted):
    if directory is None: raise GateError('accepted_native_evidence_directory_required')
    for platform, row in accepted['native'].items():
        path = Path(directory) / (platform + '.json')
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or not 2 <= info.st_size <= 262144: raise GateError('native_evidence_regular_bounded_file_required')
        data = path.read_bytes()
        if digest(data) != row['evidenceSha256']: raise GateError('native_evidence_digest_mismatch:' + platform)
        proof = json.loads(data)
        expected = {'platform': platform, 'sourceRevision': row['revision'], 'sourceTree': row['tree'], 'artifactSha256': row['sha256'], 'artifactBytes': row['bytes'], 'verification': row['acceptance']}
        if not isinstance(proof, dict) or any(proof.get(key) != value or type(proof.get(key)) is not type(value) for key, value in expected.items()): raise GateError('native_evidence_artifact_source_or_verification_mismatch:' + platform)
