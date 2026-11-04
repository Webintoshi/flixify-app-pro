"""Immutable pins and shared checks for withdrawing Mac website downloads."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


qr = load('mac_withdrawal_qr_build_support', HERE.parent / '2026-11-03-qr-device-login/build-api.py')
web = load('mac_withdrawal_previous_web_support', HERE.parent / '2026-10-31-search-activation/build-web.py')
builder, command, GateError = web.builder, web.command, qr.GateError
BASE = 'f820673242b543f849eb2bee2e1e9c48eef10971'
SOURCE_TAG = 'flixify-ops-web:qr-device-login-20cad131f98f-20261103'
SOURCE_ID = 'sha256:af9e74473b7ea55e077a3cbb5c8ce3aa3f302e0cb58e4cc16fb91df25228e437'
API = ('flixify-api:qr-device-login-20cad131f98f-20261103', 'sha256:bdf418ab2906fa1f177511d2e4a483e11fed6cbdba0e1452991512adffd013b1')
WORKER = ('flixify-worker:packages-8fa66d103053-20261101', 'sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57')
DB = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
ENV_SHA = 'c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42'
FENCE_SHA = '5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b'
RUNTIME = ('apps/ops-web/app/platform/landing.tsx', 'apps/ops-web/app/platform/shell.tsx',
           'apps/ops-web/app/indir/page.tsx', 'apps/ops-web/app/indir/page.module.css')
REMOVED_SOURCE = ('apps/ops-web/app/platform/mac-download.ts',)
REMOVED_PUBLIC = tuple('apps/ops-web/public/downloads/' + name for name in (
    'flixify-pro-macos-1.0.0-build2-test.dmg',
    'flixify-pro-macos-1.0.1-build3-test.dmg',
    'flixify-pro-macos-1.0.2-build4-test.dmg'))
REMOVED = REMOVED_SOURCE + REMOVED_PUBLIC
MIN_BUILD_BYTES = 5 * 1024**3
MIN_CUTOVER_BYTES = 4 * 1024**3


def sha(data):
    return hashlib.sha256(data).hexdigest()


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch('[a-f0-9]{40}', revision):
        raise GateError('exact_revision_required')
    return 'flixify-ops-web:macos-withdrawal-' + revision[:12] + '-20261104'


def configure_builder():
    builder.SOURCE_ID, builder.SOURCE_TAG, builder.BASE_REVISION = SOURCE_ID, SOURCE_TAG, BASE
    builder.PATHS, builder.NEW_PATHS, builder.target = RUNTIME, (), target
    web.EXCLUDED = (*RUNTIME, *REMOVED, 'apps/ops-web/.next')


def public_rows(original):
    try:
        return json.loads(web.canonical_public_manifest(original))
    except (ValueError, web.GateError) as error:
        raise GateError('public_manifest_invalid') from error


def expected_public(original):
    rows = public_rows(original)
    removed = {path.removeprefix('apps/ops-web/public/') for path in REMOVED_PUBLIC}
    entries = {row[1]: row for row in rows}
    if any(entries.get(path, [None])[0] != 'file' for path in removed):
        raise GateError('withdrawn_mac_download_missing_or_not_regular')
    return [row for row in rows if row[1] not in removed]


def removal_script():
    return ('const fs=require("node:fs");for(const p of ' + json.dumps(['/app/' + p for p in REMOVED])
            + '){if(!fs.lstatSync(p).isFile())throw Error("withdrawal_target_not_regular");fs.unlinkSync(p)}')


def verify_removed(image):
    script = ('const fs=require("node:fs");for(const p of ' + json.dumps(['/app/' + p for p in REMOVED])
              + '){try{fs.lstatSync(p)}catch(e){if(e.code==="ENOENT")continue;throw e}'
              + 'throw Error("withdrawn_mac_file_still_present")}')
    command('docker', 'run', '--rm', '--network', 'none', '--memory', '128m', '--memory-swap', '192m',
            '--pids-limit', '64', '--entrypoint', 'node', image, '-e', script)


def protected_host():
    state = qr.backend.host_snapshot()
    if state['environment'] != ENV_SHA or state['registrationFence'] != FENCE_SHA:
        raise GateError('environment_or_registration_fence_drift')
    return {key: value for key, value in state.items()
            if not isinstance(value, dict) or value.get('name') != '/ops-web-' + builder.UUID}
