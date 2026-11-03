"""Single-layer export of the owned QR web compiler; never imports another base."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import threading

ACCEPTED_BASE = 'sha256:85892877db795825c23fc51ad3f56c77bcb503d0000f2fd35bd1c263a208f7f5'
MARKER = 'vip.flixify.qr-device-login.flattened'
METHOD = 'docker-export-v1'
RESERVE_BYTES = 1024**3
MAX_EXPORT_BYTES = 4 * 1024**3
MAX_UNPACKED_BYTES = 8 * 1024**3
PUBLIC_KEYS = ('NEXT_PUBLIC_API_BASE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
               'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
               'NEXT_PUBLIC_APP_DEMO_MODE', 'NEXT_PUBLIC_SUPPORT_WHATSAPP', 'NEXT_PUBLIC_SUPPORT_TELEGRAM')


class FlattenError(Exception):
    pass


def identity(value):
    return isinstance(value, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', value) is not None


def expected_config(base, revision, env):
    if (base.get('Id') != ACCEPTED_BASE or base.get('Os') != 'linux'
            or not isinstance(base.get('Architecture'), str) or not base['Architecture']
            or not re.fullmatch(r'[0-9a-f]{40}', revision)):
        raise FlattenError('flat_web_exact_accepted_base_and_revision_required')
    config = copy.deepcopy(base.get('Config'))
    if not isinstance(config, dict) or not config.get('Cmd') or config.get('Volumes'):
        raise FlattenError('flat_web_base_config_unsupported')
    if not isinstance(env, dict) or not set(env) <= set(PUBLIC_KEYS) or any(not isinstance(v, str) for v in env.values()):
        raise FlattenError('flat_web_public_environment_invalid')
    entries = config.get('Env') or []
    keys = []
    for entry in entries:
        if not isinstance(entry, str) or '=' not in entry or entry.split('=', 1)[0] in keys:
            raise FlattenError('flat_web_base_environment_invalid')
        keys.append(entry.split('=', 1)[0])
    if env:
        config['Env'] = [key + '=' + env[key] if key in env else entry for key, entry in zip(keys, entries)]
        config['Env'].extend(key + '=' + value for key, value in env.items() if key not in keys)
    config['Labels'] = dict(config.get('Labels') or {}) | {
        'org.opencontainers.image.revision': revision,
        'vip.flixify.edge-recovery.base': ACCEPTED_BASE,
        MARKER: METHOD,
    }
    return config


def flat_ancestry(candidate, base, revision):
    """The release's sole ancestry exception is the explicitly marked web base."""
    try:
        labels = expected_config(base, revision, {})['Labels']
    except (FlattenError, TypeError, ValueError):
        return False
    rootfs = candidate.get('RootFS') or {}
    layers = rootfs.get('Layers') or []
    return (identity(candidate.get('Id')) and candidate['Id'] != base['Id']
            and rootfs.get('Type') == 'layers' and len(layers) == 1 and identity(layers[0])
            and candidate.get('Config', {}).get('Labels') == labels)


def verify_flat_candidate(candidate, base, revision, env, diff_id=None):
    if not flat_ancestry(candidate, base, revision):
        raise FlattenError('flat_web_identity_labels_or_rootfs_invalid')
    if diff_id is not None and candidate['RootFS']['Layers'] != [diff_id]:
        raise FlattenError('flat_web_export_digest_mismatch')
    if candidate['Config'] != expected_config(base, revision, env):
        raise FlattenError('flat_web_complete_runtime_config_changed')
    for field in ('Os', 'Architecture', 'Variant', 'OsVersion', 'OsFeatures'):
        if candidate.get(field) != base.get(field):
            raise FlattenError('flat_web_platform_changed')


def _path(value):
    if not isinstance(value, str) or value.startswith('/') or '\\' in value or any(ord(c) < 32 for c in value):
        raise FlattenError('flat_web_unsafe_export_path')
    value = value.removeprefix('./').removesuffix('/')
    if not value or any(part in ('', '.', '..') for part in value.split('/')):
        raise FlattenError('flat_web_unsafe_export_path')
    if any(part.startswith('.wh.') for part in value.split('/')):
        raise FlattenError('flat_web_export_contains_whiteout')
    return value


def _open_rootfs(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise FlattenError('flat_web_export_not_regular') from error
    source = os.fdopen(descriptor, 'rb')
    if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
        source.close()
        raise FlattenError('flat_web_export_not_regular')
    return source


def analyze_rootfs(source):
    size = os.fstat(source.fileno()).st_size
    if not 1024 <= size <= MAX_EXPORT_BYTES or size % 512:
        raise FlattenError('flat_web_export_size_invalid')
    digest = hashlib.sha256()
    source.seek(0)
    while data := source.read(1024**2):
        digest.update(data)
    source.seek(0)
    names = set()
    unpacked = 0
    try:
        with tarfile.open(fileobj=source, mode='r:') as archive:
            for member in archive:
                if member.isdir() and member.name in ('.', './'):
                    continue
                name = _path(member.name)
                if name in names or len(names) >= 1000000:
                    raise FlattenError('flat_web_duplicate_or_excess_export_entries')
                names.add(name)
                if member.islnk():
                    _path(member.linkname)
                if not (member.isfile() or member.isdir() or member.issym() or member.islnk()
                        or member.ischr() or member.isblk() or member.isfifo()) or member.sparse is not None:
                    raise FlattenError('flat_web_unsupported_export_entry')
                unpacked += ((member.size + 4095) // 4096) * 4096 + 4096
                if member.size < 0 or unpacked > MAX_UNPACKED_BYTES:
                    raise FlattenError('flat_web_export_expansion_limit')
    except (tarfile.TarError, EOFError, OSError) as error:
        raise FlattenError('flat_web_export_tar_invalid') from error
    if not names:
        raise FlattenError('flat_web_export_empty')
    source.seek(0)
    return {'diffId': 'sha256:' + digest.hexdigest(), 'bytes': size, 'unpackedBytes': unpacked}


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def write_archive(output, rootfs, base, revision, env, tag):
    config = expected_config(base, revision, env)
    if tag != 'flixify-ops-web:qr-device-login-' + revision[:12] + '-20261103':
        raise FlattenError('flat_web_exact_candidate_tag_required')
    with _open_rootfs(rootfs) as source:
        receipt = analyze_rootfs(source)
        image = {'architecture': base['Architecture'], 'os': base['Os'], 'config': config,
                 'rootfs': {'type': 'layers', 'diff_ids': [receipt['diffId']]},
                 'history': [{'created_by': 'flixify QR compiled-container export'}]}
        for inspected, stored in (('Variant', 'variant'), ('OsVersion', 'os.version'), ('OsFeatures', 'os.features')):
            if base.get(inspected): image[stored] = base[inspected]
        raw = _json(image)
        filename = hashlib.sha256(raw).hexdigest() + '.json'
        manifest = _json([{'Config': filename, 'RepoTags': [tag], 'Layers': ['rootfs/layer.tar']}])
        with tarfile.open(fileobj=output, mode='w|', format=tarfile.PAX_FORMAT) as archive:
            for name, data in ((filename, raw), ('manifest.json', manifest)):
                row = tarfile.TarInfo(name)
                row.size, row.mode = len(data), 0o600
                archive.addfile(row, io.BytesIO(data))
            layer = tarfile.TarInfo('rootfs/layer.tar')
            layer.size, layer.mode = receipt['bytes'], 0o600
            archive.addfile(layer, source)
        return receipt


def copy_export(source, destination, disk_path, maximum=MAX_EXPORT_BYTES):
    total = 0
    while chunk := source.read(1024**2):
        if total + len(chunk) > maximum:
            raise FlattenError('flat_web_export_exceeds_size_cap')
        if shutil.disk_usage(disk_path).free < RESERVE_BYTES + len(chunk):
            raise FlattenError('flat_web_export_disk_reserve_required')
        destination.write(chunk)
        total += len(chunk)
    return total


def _stream(args, transfer, *, importing=False):
    """A watchdog also bounds a blocked pipe without buffering image bytes."""
    with tempfile.TemporaryFile() as diagnostics:
        try:
            process = subprocess.Popen(args, stdin=subprocess.PIPE if importing else subprocess.DEVNULL,
                                       stdout=diagnostics if importing else subprocess.PIPE, stderr=diagnostics)
        except OSError as error:
            raise FlattenError('flat_web_stream_command_unavailable') from error
        timer = threading.Timer(900, process.kill)
        timer.daemon = True
        timer.start()
        try:
            result = transfer(process.stdin if importing else process.stdout)
            if importing: process.stdin.close()
            if process.wait():
                raise FlattenError('flat_web_load_failed' if importing else 'flat_web_export_failed')
            return result
        except (OSError, subprocess.SubprocessError) as error:
            raise FlattenError('flat_web_load_stream_failed' if importing else 'flat_web_export_stream_failed') from error
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
            process.wait()
            if process.stdout is not None and not importing: process.stdout.close()
            if importing and not process.stdin.closed: process.stdin.close()


def flatten_compiled(command, base, revision, env, name, tag):
    expected_config(base, revision, env)
    if not re.fullmatch(r'flixify-qr-web-build-[0-9a-f]{12}', name):
        raise FlattenError('flat_web_owned_compiler_required')
    row = json.loads(command('docker', 'inspect', name))[0]
    owned = row.get('Id')
    if (not isinstance(owned, str) or not re.fullmatch(r'[0-9a-f]{64}', owned)
            or row.get('Name') != '/' + name or row.get('Image') != base['Id'] or row.get('Mounts') != []
            or row.get('HostConfig', {}).get('NetworkMode') != 'none'):
        raise FlattenError('flat_web_compiler_identity_or_mounts_changed')
    command('docker', 'stop', '--time', '10', owned, timeout=30)
    stopped = json.loads(command('docker', 'inspect', owned))[0]
    if (stopped.get('Id') != owned or stopped.get('Image') != base['Id'] or stopped.get('Mounts') != []
            or stopped.get('State', {}).get('Running') is not False):
        raise FlattenError('flat_web_compiler_not_frozen')
    if tag in command('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', tag).decode().splitlines():
        raise FlattenError('flat_web_candidate_tag_already_exists')
    with tempfile.TemporaryDirectory(prefix='flixify-qr-web-flat-') as directory:
        rootfs = Path(directory) / 'rootfs.tar'
        with rootfs.open('xb') as destination:
            rootfs.chmod(0o600)
            _stream(['docker', 'export', owned], lambda source: copy_export(source, destination, directory))
        with _open_rootfs(rootfs) as source:
            receipt = analyze_rootfs(source)
        # Docker stages the raw tar and unpacks it; sparse expansion is rejected.
        required = receipt['bytes'] + receipt['unpackedBytes'] + RESERVE_BYTES
        if shutil.disk_usage('/var/lib/docker').free < required:
            raise FlattenError('flat_web_load_projected_disk_reserve_required')
        loaded = _stream(['docker', 'load', '--quiet'],
                         lambda output: write_archive(output, rootfs, base, revision, env, tag), importing=True)
        candidate = json.loads(command('docker', 'image', 'inspect', tag))[0]
        verify_flat_candidate(candidate, base, revision, env, loaded['diffId'])
        return candidate['Id']
