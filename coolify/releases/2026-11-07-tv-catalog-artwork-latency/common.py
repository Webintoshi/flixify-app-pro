"""Pins and read-only contracts for the TV 1.4.14 website publication."""
from __future__ import annotations

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


previous = load('tv1414_previous_build', HERE.parent / '2026-11-04-macos-withdrawal/build-web.py')
mac, builder = previous.c, previous.builder
web, backend, command, GateError = mac.web, mac.qr.backend, mac.command, mac.GateError
BASE = '7b70da2a5044f556a0b2cd9cae07f9074f564b9a'
SOURCE_TAG = 'flixify-ops-web:macos-withdrawal-8c359fd2dd10-20261104'
SOURCE_ID = 'sha256:b33da3478e288d23f19371d7772c481192ebc63d9cefa12536198107857a5fcd'
API, WORKER, DB = mac.API, mac.WORKER, mac.DB
ENV_SHA, FENCE_SHA = mac.ENV_SHA, mac.FENCE_SHA
DESCRIPTOR = 'apps/ops-web/app/platform/tv-download.ts'
APK = 'apps/ops-web/public/downloads/flixify-pro-1.4.14.apk'
UPDATE_MANIFEST = 'apps/ops-web/public/downloads/flixify-tv-update.json'
OVERLAY = (DESCRIPTOR, APK, UPDATE_MANIFEST)
APK_URL = 'https://flixify.vip/downloads/flixify-pro-1.4.14.apk'
SIGNER = '158ded464486435f9479db84d1eeb9af82e14338e0b4a494c4297c70ae15e594'
GRADLE = 'apps/tv-android/app/build.gradle'
ANDROID_MANIFEST = 'apps/tv-android/app/src/main/AndroidManifest.xml'
MAX_APK_BYTES = 32 * 1024**2
MAX_NEXT_BYTES = 64 * 1024**2
HOST_RESERVE_BYTES = 1024**3
MIN_WORKSPACE_BYTES = 256 * 1024**2
TOOLS_ROOT = 'coolify/releases/2026-11-07-tv-catalog-artwork-latency/'


def sha(value):
    return hashlib.sha256(value).hexdigest()


def exact_revision(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{40}', value):
        raise GateError('exact_revision_required')
    return value


def target(revision):
    return 'flixify-ops-web:tv-catalog-artwork-' + exact_revision(revision)[:12] + '-20261107'


def configure_builder():
    builder.SOURCE_ID, builder.SOURCE_TAG, builder.BASE_REVISION = SOURCE_ID, SOURCE_TAG, BASE
    builder.PATHS, builder.NEW_PATHS, builder.target = (DESCRIPTOR,), (), target
    # The prior full-config checker uses these two constants in its own module.
    mac.SOURCE_ID, mac.SOURCE_TAG = SOURCE_ID, SOURCE_TAG
    web.EXCLUDED = (*OVERLAY, 'apps/ops-web/.next')


def unique_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise GateError('duplicate_json_key')
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as error:
        raise GateError('invalid_json') from error


def proof(data):
    value = unique_json(data)
    expected = {'schemaVersion': 1, 'packageName': 'vip.flixify.tv', 'versionName': '1.4.14',
                'versionCode': 22, 'minSdk': 23, 'targetSdk': 35, 'signerSha256': SIGNER,
                'checks': {key: True for key in ('releaseBuild', 'releaseLint', 'unitTests', 'instrumentationTests')}}
    if (not isinstance(value, dict) or set(value) != set(expected) | {'nativeRevision', 'nativeTree', 'apkSha256', 'apkBytes'}
            or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items())):
        raise GateError('accepted_1414_native_proof_required')
    exact_revision(value['nativeRevision'])
    exact_revision(value['nativeTree'])
    if (not isinstance(value['apkSha256'], str) or not re.fullmatch('[a-f0-9]{64}', value['apkSha256'])
            or type(value['apkBytes']) is not int or not 1024 <= value['apkBytes'] <= MAX_APK_BYTES):
        raise GateError('accepted_native_apk_identity_invalid')
    # JSON booleans and integer 1 compare equal; nested evidence must retain its types.
    if any(type(v) is not bool or v is not True for v in value['checks'].values()):
        raise GateError('native_checks_not_passing')
    return value


def parse_manifest(data, native):
    if not isinstance(data, bytes) or not 1 <= len(data) <= 65536:
        raise GateError('update_manifest_size_invalid')
    value = unique_json(data)
    expected = {'packageName': 'vip.flixify.tv', 'versionName': '1.4.14', 'versionCode': 22, 'minSdk': 23,
                'apkUrl': APK_URL, 'sha256': native['apkSha256'], 'sizeBytes': native['apkBytes']}
    if (not isinstance(value, dict) or set(value) != set(expected) | {'notes'}
            or any(type(value[k]) is not type(v) or value[k] != v for k, v in expected.items())):
        raise GateError('update_manifest_pins_differ')
    notes = value['notes']
    if (not isinstance(notes, str) or sum(2 if ord(ch) > 0xffff else 1 for ch in notes) > 2048
            or re.search(r'[\x00-\x09\x0b-\x1f\x7f-\x9f]', notes)):
        raise GateError('update_manifest_notes_invalid')
    return value


def public_rows(data):
    return unique_json(web.canonical_public_manifest(data))


def expected_public(original, native, manifest):
    parse_manifest(manifest, native)
    rows = public_rows(original)
    entries = {row[1]: row for row in rows}
    old = UPDATE_MANIFEST.removeprefix('apps/ops-web/public/')
    new = APK.removeprefix('apps/ops-web/public/')
    if entries.get('downloads', [None])[0] != 'dir' or entries.get(old, [None])[0] != 'file' or new in entries:
        raise GateError('source_download_tree_invalid')
    # Mac downloads were withdrawn in the pinned source; never reintroduce them.
    if any(path.removeprefix('apps/ops-web/public/') in entries for path in mac.REMOVED_PUBLIC):
        raise GateError('withdrawn_mac_download_present')
    rows = [row for row in rows if row[1] != old]
    rows += [['file', new, 0o644, native['apkBytes'], native['apkSha256']],
             ['file', old, 0o644, len(manifest), sha(manifest)]]
    return public_rows(json.dumps(rows).encode())


def current_host_snapshot():
    ids = command('docker', 'ps', '--all', '--quiet', '--no-trunc').decode().splitlines()
    if len(ids) != len(set(ids)) or any(not re.fullmatch('[a-f0-9]{64}', value) for value in ids):
        raise GateError('current_host_inventory_invalid')
    rows = unique_json(command('docker', 'inspect', *ids)) if ids else []
    if not isinstance(rows, list) or len(rows) != len(ids):
        raise GateError('current_host_inspection_set_differs')
    result, names = {}, set()
    for row in rows:
        if not isinstance(row, dict):
            raise GateError('current_host_container_shape_invalid')
        identity, name, image = row.get('Id'), row.get('Name'), row.get('Image')
        state, config, host_config, mounts = row.get('State'), row.get('Config'), row.get('HostConfig'), row.get('Mounts')
        network_settings = row.get('NetworkSettings')
        networks = network_settings.get('Networks') if isinstance(network_settings, dict) else None
        if (identity not in ids or identity in result or not isinstance(name, str) or not name.startswith('/')
                or len(name) < 2 or name in names or not isinstance(image, str) or not re.fullmatch('sha256:[a-f0-9]{64}', image)
                or not isinstance(state, dict) or type(state.get('Running')) is not bool
                or any(type(state.get(key)) is not bool for key in ('Paused', 'Restarting', 'Dead', 'OOMKilled'))
                or not isinstance(state.get('StartedAt'), str) or not 1 <= len(state['StartedAt']) <= 100
                or type(row.get('RestartCount')) is not int or row['RestartCount'] < 0
                or not isinstance(config, dict) or not isinstance(host_config, dict)
                or not isinstance(mounts, list) or any(not isinstance(value, dict) for value in mounts)
                or not isinstance(networks, dict)
                or any(not isinstance(key, str) or not isinstance(value, dict) for key, value in networks.items())):
            raise GateError('current_host_container_shape_invalid')
        private_configuration = {'Config': config, 'HostConfig': host_config, 'Mounts': mounts, 'Networks': networks}
        result[identity] = {'name': name, 'image': image, 'startedAt': state['StartedAt'],
            'running': state['Running'], 'restarts': row['RestartCount'],
            'lifecycle': {key: state[key] for key in ('Paused', 'Restarting', 'Dead', 'OOMKilled')},
            'config': sha(json.dumps(private_configuration, sort_keys=True, separators=(',', ':')).encode())}
        names.add(name)
    if set(result) != set(ids):
        raise GateError('current_host_inspection_set_differs')
    service = Path('/data/coolify/services') / builder.UUID
    result['environment'] = sha((service / '.env').read_bytes())
    result['registrationFence'] = sha((service / '.live-registration-rollout.json').read_bytes())
    return result


def protected_host(include_web=False):
    pins = {'api': API, 'worker': WORKER, 'db': ('postgres:16-alpine', DB)}
    rows = unique_json(command('docker', 'inspect', *(name + '-' + builder.UUID for name in pins)))
    seen = set()
    for row in rows:
        name = row['Name'].removeprefix('/').removesuffix('-' + builder.UUID)
        if (name not in pins or name in seen or (row['Config']['Image'], row['Image']) != pins[name]
                or not row['State']['Running'] or (row['State'].get('Health') or {}).get('Status') == 'unhealthy'
                or (row['Config'].get('Labels') or {}).get('com.docker.compose.project') != builder.UUID):
            raise GateError('protected_service_image_or_health_drift')
        seen.add(name)
    if seen != set(pins):
        raise GateError('protected_service_set_differs')
    state = current_host_snapshot()
    if state['environment'] != ENV_SHA or state['registrationFence'] != FENCE_SHA:
        raise GateError('environment_or_registration_fence_drift')
    return state if include_web else {key: value for key, value in state.items()
        if not isinstance(value, dict) or value.get('name') != '/ops-web-' + builder.UUID}


def disk_budget(next_bytes, overlay_bytes):
    if type(next_bytes) is not int or not 1 <= next_bytes <= MAX_NEXT_BYTES:
        raise GateError('source_next_footprint_outside_reviewed_bound')
    if type(overlay_bytes) is not int or not 1024 <= overlay_bytes <= MAX_APK_BYTES + 128 * 1024:
        raise GateError('overlay_footprint_outside_bound')
    # Four copies cover writable output, commit tar/layer handling and transient output.
    # The 256 MiB floor is >20x this source's measured 10 MiB .next plus 2 MiB APK.
    workspace = max(MIN_WORKSPACE_BYTES, 4 * (next_bytes + overlay_bytes))
    return {'hostReserveBytes': HOST_RESERVE_BYTES, 'workspaceBytes': workspace,
            'requiredFreeBytes': HOST_RESERVE_BYTES + workspace}
