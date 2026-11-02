#!/usr/bin/env python3
"""Analytics candidates only. Inspection is the default; --build never deploys."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import os
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import policy as p


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


p.require_helper_pins(HERE.parents[2])
web = load('analytics_bounded_web_helpers', HERE.parent / '2026-10-31-search-activation/build-web.py')
backend = load('analytics_bounded_backend_helpers', HERE.parent / '2026-11-01-packages/build-backend.py')
command, core = backend.command, backend.core
SOURCE = {'api': (p.API_TAG, p.API_ID), 'web': (p.WEB_TAG, p.WEB_ID)}
EXCLUDED = (*p.WEB_PATHS, *p.ARTIFACT_PATHS.values(), p.UPDATE, 'apps/ops-web/.next')


def target(service, revision):
    p.exact(revision, r'[0-9a-f]{40}', 'exact_revision_required')
    if service not in SOURCE: raise p.GateError('api_or_web_only')
    return 'flixify-' + ('ops-web' if service == 'web' else 'api') + ':analytics-' + revision[:12] + '-20261102'


def configuration(service):
    if service != 'api': raise p.GateError('api_only_backend_overlay')
    return {'tag': p.API_TAG, 'id': p.API_ID, 'paths': p.API_PATHS, 'new': p.API_NEW, 'dist': 'apps/api/dist', 'entry': 'server.js'}


backend.configuration = configuration
backend.target = target
for module in (web, web.builder):
    module.SOURCE_TAG, module.SOURCE_ID, module.BASE_REVISION = p.WEB_TAG, p.WEB_ID, p.BASE
    module.PATHS, module.NEW_PATHS = p.WEB_PATHS, p.WEB_NEW
    module.target = lambda revision: target('web', revision)
web.EXCLUDED = EXCLUDED


def host_snapshot():
    result = backend.host_snapshot()
    if result['environment'] != p.ENV_SHA or result['registrationFence'] != p.FENCE_SHA:
        raise p.GateError('accepted_environment_or_registration_fence_drift')
    expected = {'api': (p.API_TAG, p.API_ID), 'ops-web': (p.WEB_TAG, p.WEB_ID), 'worker': (p.WORKER_TAG, p.WORKER_ID), 'db': ('postgres:16-alpine', p.DB_ID)}
    rows = json.loads(command('docker', 'inspect', *(name + '-' + p.UUID for name in expected)))
    if len(rows) != 4: raise p.GateError('protected_container_set_drift')
    for row in rows:
        name = row['Name'].removeprefix('/').removesuffix('-' + p.UUID)
        if (name not in expected or (row['Config']['Image'], row['Image']) != expected[name] or not row['State']['Running'] or (row['Config'].get('Labels') or {}).get('com.docker.compose.project') != p.UUID):
            raise p.GateError('current_protected_container_drift')
    return result


def exact_revision(repo, revision):
    p.exact(revision, r'[0-9a-f]{40}', 'exact_revision_required')
    if command('git', '-C', str(repo), 'rev-parse', revision + '^{commit}').decode().strip() != revision:
        raise p.GateError('revision_not_exact')


def validate_scope(repo, accepted):
    revision = accepted['revision']
    for ref in (p.BASE, revision): exact_revision(repo, ref)
    command('git', '-C', str(repo), 'merge-base', '--is-ancestor', p.BASE, revision)
    for tree in ('apps/api', 'apps/worker', 'packages'):
        if command('git', '-C', str(repo), 'rev-parse', p.BASE + ':' + tree) != command('git', '-C', str(repo), 'rev-parse', revision + ':' + tree):
            raise p.GateError('protected_canonical_source_tree_changed:' + tree)
    for platform, source in (('android', 'apps/tv-android'), ('macos', 'apps/macos-native'), ('windows', 'apps/windows-native')):
        row = accepted['native'][platform]
        exact_revision(repo, row['revision'])
        command('git', '-C', str(repo), 'merge-base', '--is-ancestor', row['revision'], revision)
        for ref in (row['revision'], revision):
            if command('git', '-C', str(repo), 'rev-parse', ref + ':' + source).decode().strip() != row['tree']:
                raise p.GateError('accepted_native_freeze_drift:' + platform)
    changed = command('git', '-C', str(repo), 'diff', '--no-renames', '--name-only', p.BASE, revision, '--', 'apps/ops-web').decode().splitlines()
    p.validate_web_delta(changed, {*p.ARTIFACT_PATHS.values(), p.UPDATE})
    for path in changed: web.builder.require_regular_blob(repo, revision, path)


def read_blob(repo, revision, path, limit=1024 * 1024):
    web.builder.require_regular_blob(repo, revision, path)
    size = command('git', '-C', str(repo), 'cat-file', '-s', revision + ':' + path).decode().strip()
    if not size.isdecimal() or not 1 <= int(size) <= limit: raise p.GateError('bounded_git_blob_required:' + path)
    return command('git', '-C', str(repo), 'show', revision + ':' + path, timeout=60)


def artifacts(repo, accepted):
    revision = accepted['revision']
    expected = {'A\t' + path for path in p.ARTIFACT_PATHS.values()} | {'M\t' + p.UPDATE}
    status = set(command('git', '-C', str(repo), 'diff', '--no-renames', '--name-status', p.BASE, revision, '--', 'apps/ops-web/public').decode().splitlines())
    if status != expected: raise p.GateError('public_overlay_scope_differs')
    result = {}
    for platform, path in p.ARTIFACT_PATHS.items():
        row = accepted['native'][platform]
        if web.builder.git_entry(repo, p.BASE, path): raise p.GateError('new_artifact_not_absent_at_baseline')
        web.builder.require_image_absent(path)
        entry = web.builder.git_entry(repo, revision, path)
        if not re.fullmatch(rb'100644 blob [0-9a-f]{40}\t' + re.escape(path.encode()) + rb'\x00', entry): raise p.GateError('public_artifact_mode_must_be_0644')
        data = read_blob(repo, revision, path, 160 * 1024**2)
        if len(data) != row['bytes'] or p.digest(data) != row['sha256']: raise p.GateError('accepted_artifact_mismatch:' + platform)
        if platform == 'android' and not data.startswith(b'PK\x03\x04'): raise p.GateError('apk_magic_invalid')
        if platform == 'windows' and not data.startswith(b'MZ'): raise p.GateError('installer_magic_invalid')
        if platform == 'macos' and data[-512:-508] != b'koly': raise p.GateError('dmg_trailer_invalid')
        result[path] = data
    result[p.UPDATE] = read_blob(repo, revision, p.UPDATE, 65536)
    update = json.loads(result[p.UPDATE])
    android = accepted['native']['android']
    values = {'packageName': 'vip.flixify.tv', 'versionName': '1.4.8', 'versionCode': 16, 'minSdk': 23, 'apkUrl': 'https://flixify.vip/' + p.ARTIFACT_PATHS['android'].removeprefix('apps/ops-web/public/'), 'sha256': android['sha256'], 'sizeBytes': android['bytes']}
    if set(update) != set(values) | {'notes'} or any(update.get(k) != v or type(update.get(k)) is not type(v) for k, v in values.items()): raise p.GateError('new_tv_manifest_not_exact_accepted_apk')
    if not isinstance(update['notes'], str) or len(update['notes']) > 2048 or re.search(r'[\x00-\x1f\x7f-\x9f]', update['notes']): raise p.GateError('new_update_notes_invalid')
    for platform, descriptor in (('android', 'tv-download.ts'), ('macos', 'mac-download.ts'), ('windows', 'windows-download.ts')):
        text = read_blob(repo, revision, 'apps/ops-web/app/platform/' + descriptor).decode()
        name = Path(p.ARTIFACT_PATHS[platform]).name
        if ('href: "/downloads/' + name + '"') not in text or ('filename: "' + name + '"') not in text: raise p.GateError('download_descriptor_artifact_mismatch:' + platform)
        if platform != 'android':
            if accepted['native'][platform]['sha256'] not in text: raise p.GateError('download_descriptor_hash_mismatch')
            match = re.search(r'sizeBytes:\s*([0-9_]+)', text)
            if not match or int(match[1].replace('_', '')) != accepted['native'][platform]['bytes']: raise p.GateError('download_descriptor_size_mismatch')
        if platform == 'macos' and 'notarized: false' not in text: raise p.GateError('mac_trust_claim_changed_without_notarization_proof')
        if platform == 'windows' and 'signed: false' not in text: raise p.GateError('windows_trust_claim_changed_without_signing_proof')
    return result


def backend_updates(repo, accepted, source):
    revision = accepted['revision']
    result = {}
    for name in p.API_NAMES:
        path = 'apps/api/src/' + name
        if path in p.API_NEW:
            previous = backend.helpers.SOURCE_ID; backend.helpers.SOURCE_ID = p.API_ID
            try: backend.helpers.require_image_absent(path)
            finally: backend.helpers.SOURCE_ID = previous
        else:
            original = backend.helpers.image_file(p.API_ID, path)
            if p.digest(original) != source['sourceHashes'][path]: raise p.GateError('current_api_source_hash_drift')
        result[path] = read_blob(repo, revision, p.API_ROOT + name)
        if path not in p.API_NEW and result[path] == original: raise p.GateError('api_overlay_unchanged')
    path = 'apps/api/src/server.ts'
    original = backend.helpers.image_file(p.API_ID, path)
    if p.digest(original) != accepted['apiServerSha256'] or source['sourceHashes'][path] != accepted['apiServerSha256']: raise p.GateError('fresh_current_api_server_hash_required')
    description = {'path': path, 'sourceSha256': accepted['apiServerSha256'], 'replacements': list(p.SERVER_REPLACEMENTS)}
    previous = backend.SERVER_PATCH_COUNT; backend.SERVER_PATCH_COUNT = 2
    try: result[path] = backend.patch_server(original, description)
    finally: backend.SERVER_PATCH_COUNT = previous
    return result


def candidate_tests(repo, revision, candidate):
    roots = ('coolify/releases/2026-11-01-welcome-offer/', 'coolify/releases/2026-11-01-packages/')
    paths = command('git', '-C', str(repo), 'ls-tree', '-r', '--name-only', revision, '--', *roots).decode().splitlines()
    files = [path for path in paths if re.fullmatch(r'coolify/releases/2026-11-01-(?:welcome-offer|packages)/(?:welcome-tests|billing-tests)/[A-Za-z0-9_.-]+\.(?:test\.ts|fixture\.ts|ts)', path)]
    files += [roots[0] + 'billing-vitest.config.ts', 'coolify/releases/2026-11-02-analytics/candidate-tests.config.ts']
    if not any(path.endswith('analytics-revenue.test.ts') for path in files): raise p.GateError('analytics_and_billing_candidate_tests_required')
    env = dict(backend.legacy.TEST_ENV)
    env.update({key: '' for key in ('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TEST_DATABASE_URL', 'PG_TEST_DATABASE_URL', 'PACKAGE_CATALOG_TEST_DATABASE_URL', 'PACKAGE_PAYMENT_TEST_DATABASE_URL', 'WELCOME_OFFER_TEST_DATABASE_URL', *p.GA_KEYS)})
    env['STRIPE_BILLING_ENABLED'] = 'false'
    with tempfile.TemporaryDirectory(prefix='analytics-candidate-tests-') as directory:
        args = ['docker', 'run', '--rm', '--network', 'none', '--memory', '1280m', '--memory-swap', '1536m', '--cpus', '1', '--pids-limit', '256']
        for key, value in env.items(): args += ['-e', key + '=' + value]
        for index, path in enumerate(files):
            source = Path(directory) / str(index); source.write_bytes(read_blob(repo, revision, path)); args += ['-v', str(source) + ':/app/' + path + ':ro']
        setup = backend.legacy.cgroup()
        for root in roots:
            setup += "fs.symlinkSync('/app/apps/api/src','/app/" + root + "api-source','dir');"
        setup += 'cp.execFileSync("npx",["--no-install","vitest","run","--root","/app","--config","/app/coolify/releases/2026-11-02-analytics/candidate-tests.config.ts"],{stdio:"inherit"});'
        command(*args, '--entrypoint', 'node', candidate, '-e', setup, timeout=360)


def download_checks(candidate, accepted, data):
    expected = []
    for path, size, sha in p.RETAINED: expected.append({'path': path.removeprefix('apps/ops-web/public'), 'bytes': size, 'sha256': sha})
    for path, value in data.items(): expected.append({'path': path.removeprefix('apps/ops-web/public'), 'bytes': len(value), 'sha256': p.digest(value)})
    script = ('const crypto=require("node:crypto");(async()=>{const rows=' + json.dumps(expected) + ';'
        'const mime={exe:["application/vnd.microsoft.portable-executable","application/x-msdownload","application/x-msdos-program","application/x-dosexec","application/octet-stream"],dmg:["application/x-apple-diskimage","application/octet-stream"],apk:["application/vnd.android.package-archive","application/octet-stream"],json:["application/json"]};'
        'async function bounded(r,n){const chunks=[];let bytes=0;for await(const chunk of r.body){bytes+=chunk.length;if(bytes>n)throw Error("response_limit");chunks.push(chunk)}if(bytes!==n)throw Error("response_size");return Buffer.concat(chunks,bytes)}'
        'for(const x of rows){const u="http://127.0.0.1:3000"+x.path;let h;for(let i=0;i<40;i++){try{h=await fetch(u,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.status===200)break}catch{}await new Promise(r=>setTimeout(r,250))}'
        'const kind=x.path.split(".").at(-1);if(!h||h.status!==200||Number(h.headers.get("content-length"))!==x.bytes||!mime[kind]?.includes(h.headers.get("content-type")?.split(";")[0]))throw Error("head_contract");'
        'if(kind!=="json"){const r=await fetch(u,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/"+x.bytes)throw Error("range_contract");await bounded(r,32)}'
        'const f=await fetch(u,{signal:AbortSignal.timeout(120000)});if(f.status!==200)throw Error("body_status");const b=await bounded(f,x.bytes);if(crypto.createHash("sha256").update(b).digest("hex")!==x.sha256)throw Error("body_contract");'
        'if(kind==="exe"){if(b.length<64||b.subarray(0,2).toString()!=="MZ")throw Error("exe_magic");const pe=b.readUInt32LE(60);if(pe<64||pe>b.length-24||!b.subarray(pe,pe+4).equals(Buffer.from([80,69,0,0])))throw Error("pe_magic")}'
        'if(kind==="dmg"&&b.subarray(b.length-512,b.length-508).toString()!=="koly")throw Error("dmg_magic");if(kind==="apk"&&!b.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw Error("apk_magic")}'
        'for(const path of ["/","/indir","/paketler"]){if((await fetch("http://127.0.0.1:3000"+path,{redirect:"manual",signal:AbortSignal.timeout(10000)})).status!==200)throw Error("page_status")}console.log("all_old_and_new_native_downloads_verified")})().catch(()=>{console.error("download_contract_failed");process.exit(1)})')
    name = 'flixify-analytics-download-check-' + uuid.uuid4().hex[:12]
    created = False
    try:
        command('docker', 'create', '--name', name, '--network', 'none', '--memory', '512m', '--memory-swap', '640m', '--cpus', '0.5', '--pids-limit', '128', candidate); created = True
        command('docker', 'start', name)
        command('docker', 'exec', name, 'node', '-e', script, timeout=1200)
    finally:
        if created: command('docker', 'rm', '--force', name)


def run(args):
    if args.measure:
        host_snapshot()
        value = backend.snapshot(p.API_ID, 'api') if args.service == 'api' else web.untouched(p.WEB_ID)
        print(json.dumps(value, sort_keys=True)); return
    accepted = p.pins(json.loads(args.pins.read_bytes()))
    p.verify_native_evidence(args.native_proof_dir, accepted)
    validate_scope(args.source_repo, accepted)
    migration = read_blob(args.source_repo, accepted['revision'], p.MIGRATION)
    if p.digest(migration) != accepted['migrationSha256']: raise p.GateError('accepted_migration_digest_required')
    if not args.source_pin: raise p.GateError('independent_source_pin_required')
    source = json.loads(args.source_pin.read_bytes())
    before_host = host_snapshot()
    revision, service = accepted['revision'], args.service
    if service == 'api':
        source = backend.validate_source_pin(source, 'api')
        base = core.image(p.API_ID)
        if core.image(p.API_TAG)['Id'] != p.API_ID or backend.snapshot(p.API_ID, 'api') != source: raise p.GateError('independent_current_api_source_pin_mismatch')
        updated = backend_updates(args.source_repo, accepted, source)
    else:
        base, updated, web_env, config = web.builder.preflight(args.source_repo, revision)
        data = artifacts(args.source_repo, accepted); updated.update(data)
        if source != web.untouched(p.WEB_ID): raise p.GateError('independent_web_untouched_fingerprint_mismatch')
        original_public = json.loads(web.canonical_public_manifest(web.public_manifest(p.WEB_ID)))
        public = p.expected_public(original_public, data)
    if host_snapshot() != before_host: raise p.GateError('preflight_host_drift')
    if not (args.build or args.verify_existing):
        print('analytics_' + service + '_preflight_ok; no_build_or_service_mutation'); return
    if shutil.disk_usage('/var/lib/docker').free < p.MIN_FREE: raise p.GateError('build_requires_8GiB_no_automatic_pruning')
    tag = target(service, revision)
    if args.build and tag in command('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', tag).decode().splitlines(): raise p.GateError('candidate_tag_exists_use_verify_existing')
    if service == 'api':
        expected = backend.compile_overlay('api', revision, base, updated, source, publish=args.build)
        candidate = backend.verify_candidate('api', revision, base, updated, source, expected)
        candidate_tests(args.source_repo, revision, candidate)
    else:
        if args.build: web.container_compile(revision, base, updated, web_env)
        candidate = web.builder.verify_candidate(base, revision, updated, web_env, config)
        if web.untouched(candidate) != source or json.loads(web.canonical_public_manifest(web.public_manifest(candidate))) != public: raise p.GateError('candidate_untouched_or_public_tree_mismatch')
        download_checks(candidate, accepted, data)
    if host_snapshot() != before_host: raise p.GateError('candidate_build_changed_existing_host')
    print('analytics_' + service + '_candidate_verified:' + candidate)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source_repo', type=Path)
    parser.add_argument('--service', choices=('api', 'web'), required=True)
    parser.add_argument('--pins', type=Path, default=HERE / 'release-pins.json')
    parser.add_argument('--source-pin', type=Path)
    parser.add_argument('--native-proof-dir', type=Path)
    actions = parser.add_mutually_exclusive_group()
    for action in ('measure', 'build', 'verify-existing'): actions.add_argument('--' + action, action='store_true')
    args = parser.parse_args(argv)
    if args.build or args.verify_existing:
        lock = Path('/data/coolify/services') / p.UUID / '.packages-release.lock'
        fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise p.GateError('another_release_or_build_running') from None
            run(args)
        finally: os.close(fd)
    else: run(args)


if __name__ == '__main__':
    try: main()
    except (p.GateError, backend.GateError, web.GateError) as error: print('build_stopped:' + str(error), file=sys.stderr); sys.exit(1)
    except (ValueError, KeyError, TypeError, OSError) as error: print('build_stopped:' + type(error).__name__, file=sys.stderr); sys.exit(1)
