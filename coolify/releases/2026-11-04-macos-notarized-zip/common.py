"""Immutable pins and shared source checks for the Mac ZIP website publication."""
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


qr = load('mac_zip_qr_build_support', HERE.parent / '2026-11-03-qr-device-login/build-api.py')
web = load('mac_zip_previous_web_support', HERE.parent / '2026-10-31-search-activation/build-web.py')
builder, command, GateError = web.builder, web.command, qr.GateError
BASE = 'f820673242b543f849eb2bee2e1e9c48eef10971'
SOURCE_TAG = 'flixify-ops-web:qr-device-login-20cad131f98f-20261103'
SOURCE_ID = 'sha256:af9e74473b7ea55e077a3cbb5c8ce3aa3f302e0cb58e4cc16fb91df25228e437'
API = ('flixify-api:qr-device-login-20cad131f98f-20261103', 'sha256:bdf418ab2906fa1f177511d2e4a483e11fed6cbdba0e1452991512adffd013b1')
WORKER = ('flixify-worker:packages-8fa66d103053-20261101', 'sha256:9db57cd7e0ddfd3783d6e7522e710c8232c956c2c752ff461947ebb81ecadf57')
DB = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
ENV_SHA = 'c64b280b5c24f67964259a5de5e8aa883bd9d925ec1336614cd23e8fb5f46a42'
FENCE_SHA = '5d904f0016bf2274e146b54a713295fb80db1cc1a1f9e42533a290099868574b'
RUNTIME = ('apps/ops-web/app/platform/mac-download.ts', 'apps/ops-web/app/indir/page.tsx')
MIN_BUILD_BYTES = 5 * 1024**3
MIN_CUTOVER_BYTES = 4 * 1024**3


def sha(data):
    return hashlib.sha256(data).hexdigest()


def target(revision):
    if not isinstance(revision, str) or not re.fullmatch('[a-f0-9]{40}', revision):
        raise GateError('exact_revision_required')
    return 'flixify-ops-web:macos-notarized-zip-' + revision[:12] + '-20261104'


def artifact_pin(value):
    if (not isinstance(value, dict) or set(value) != {'path', 'sha256', 'bytes'}
            or not isinstance(value.get('path'), str)
            or not re.fullmatch(r'apps/ops-web/public/downloads/[A-Za-z0-9][A-Za-z0-9._-]*\.zip', value['path'])
            or not isinstance(value.get('sha256'), str) or not re.fullmatch('[a-f0-9]{64}', value['sha256'])
            or type(value.get('bytes')) is not int or not 1024 <= value['bytes'] <= 160 * 1024**2):
        raise GateError('root_verified_zip_pin_required')
    return value


def configure_builder(pin):
    builder.SOURCE_ID, builder.SOURCE_TAG, builder.BASE_REVISION = SOURCE_ID, SOURCE_TAG, BASE
    builder.PATHS, builder.NEW_PATHS, builder.target = RUNTIME, (), target
    web.EXCLUDED = (*RUNTIME, pin['path'], 'apps/ops-web/.next')


def descriptor_matches(data, pin):
    text = data.decode('utf-8')
    filename = Path(pin['path']).name
    for field, value in (('href', '/downloads/' + filename), ('filename', filename), ('sha256', pin['sha256'])):
        if len(re.findall(r'\b' + field + r'\s*:\s*' + re.escape(json.dumps(value)), text)) != 1:
            raise GateError('mac_descriptor_zip_pin_differs:' + field)
    if (len(re.findall(r'\bsizeBytes\s*:\s*' + str(pin['bytes']) + r'\b', text.replace('_', ''))) != 1
            or len(re.findall(r'\bnotarized\s*:\s*true\b', text)) != 1):
        raise GateError('mac_descriptor_size_or_notarization_differs')


def expected_public(original, pin):
    rows = json.loads(web.canonical_public_manifest(original))
    relative = pin['path'].removeprefix('apps/ops-web/public/')
    if any(row[1] == relative for row in rows):
        raise GateError('new_zip_already_in_public_manifest')
    rows.append(['file', relative, 0o644, pin['bytes'], pin['sha256']])
    return sorted(rows, key=lambda row: row[1])


def protected_host():
    state = qr.backend.host_snapshot()
    if state['environment'] != ENV_SHA or state['registrationFence'] != FENCE_SHA:
        raise GateError('environment_or_registration_fence_drift')
    return {key: value for key, value in state.items()
            if not isinstance(value, dict) or value.get('name') != '/ops-web-' + builder.UUID}
