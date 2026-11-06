#!/usr/bin/env python3
"""Preflight or replace only the verified, bind-mounted Telegram bot script."""
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import time
import uuid

HERE = Path(__file__).resolve().parent
BOT = 'flixify-telegram-bot'
SOURCE_SHA = 'aabba2e98c0cc46e4323a38674dfd94d73003e2b3cc12afba5a371ea74cf229a'
SCRIPT = Path('/data/flixify/app/scripts/telegram-panel-bot.mjs')
DATA = Path('/data/flixify/app/data')
LOGS = Path('/data/flixify/app/logs')
LOCK = Path('/tmp/flixify-telegram-registration-release.lock')
SERVICE = 'eupquokyj7qegufqvqkjmuyr'
CORE = {name + '-' + SERVICE for name in ('api', 'ops-web', 'worker', 'db')}
HEALTH_SECONDS = 120


class GateError(RuntimeError):
    pass


class ScriptWriteError(GateError):
    def __init__(self, observed_partial_sha):
        super().__init__('mounted_source_write_failed')
        self.observed_partial_sha = observed_partial_sha


def sha(value):
    return hashlib.sha256(value).hexdigest()


def run(*args, timeout=90):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Docker output can include source lines, environment values or response bodies.
        raise GateError('command_failed:' + args[0] + ':' + str(result.returncode))
    return result.stdout


def regular_bytes(path, limit):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
        raise GateError('regular_bounded_file_required')
    data = path.read_bytes()
    if len(data) != info.st_size:
        raise GateError('file_changed_during_read')
    return data, info


def rows():
    ids = run('docker', 'ps', '--all', '--quiet', '--no-trunc').decode().split()
    return json.loads(run('docker', 'inspect', *ids)) if ids else []


def stable_identity(row):
    return {key: row.get(key) for key in ('Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts')}


def protected_snapshot():
    result = {}
    current = rows()
    for row in current:
        if row['Name'] == '/' + BOT:
            continue
        identity = stable_identity(row)
        if row['Name'].lstrip('/') in CORE:
            identity['lifecycle'] = {key: row['State'].get(key) for key in ('StartedAt', 'Running')}
            identity['restartCount'] = row['RestartCount']
        result[row['Id']] = sha(json.dumps(identity, sort_keys=True).encode())
    if not CORE <= {row['Name'].lstrip('/') for row in current}:
        raise GateError('protected_flixify_service_missing')
    return result


def bot_snapshot(require_running=True):
    values = json.loads(run('docker', 'inspect', BOT))
    if len(values) != 1:
        raise GateError('bot_container_set_invalid')
    row = values[0]
    if row['Name'] != '/' + BOT or (require_running and not row['State']['Running']):
        raise GateError('bot_not_running')
    expected = {'/app/scripts/telegram-panel-bot.mjs': str(SCRIPT),
                '/app/data': str(DATA), '/app/logs': str(LOGS)}
    mounts = row['Mounts']
    if len(mounts) != 3 or {m['Destination'] for m in mounts} != set(expected):
        raise GateError('bot_mount_set_changed')
    for mount in mounts:
        if (mount.get('Type') != 'bind' or mount.get('Source') != expected[mount['Destination']]
                or mount.get('RW') is not True):
            raise GateError('bot_mount_changed')
    if (row['Config'].get('Cmd') != ['node', 'scripts/telegram-panel-bot.mjs']
            or row['Config'].get('WorkingDir') != '/app'
            or row['HostConfig'].get('NetworkMode') != 'bridge'
            or row['HostConfig'].get('RestartPolicy', {}).get('Name') != 'unless-stopped'):
        raise GateError('bot_runtime_config_changed')
    return row


def mounted_data_path(env, key, default):
    value = PurePosixPath(env.get(key) or default)
    if not value.is_absolute():
        value = PurePosixPath('/app') / value
    if '..' in value.parts or not value.is_relative_to('/app/data'):
        raise GateError('state_path_outside_data_mount')
    return DATA / str(value.relative_to('/app/data'))


def state_paths(bot):
    env = dict(value.split('=', 1) for value in bot['Config'].get('Env', []) if '=' in value)
    state = mounted_data_path(env, 'TELEGRAM_PANEL_STATE_FILE', 'data/telegram-panel-bot-state.json')
    heartbeat = mounted_data_path(env, 'TELEGRAM_PANEL_HEARTBEAT_FILE', 'data/telegram-panel-bot-heartbeat.json')
    return state, heartbeat, Path(str(state) + '.registrations.json')


def read_json(path):
    data, _ = regular_bytes(path, 16 * 1024 * 1024)
    return json.loads(data)


def admin_ids(value):
    ids = value.get('adminIds')
    if not isinstance(ids, list) or not ids or any(type(x) not in (str, int) for x in ids):
        raise GateError('nonempty_admin_set_required')
    return {str(x) for x in ids}


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('timestamp_required')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timezone_required')
    return result


def valid_journal(value, after):
    if value.get('version') != 1 or not isinstance(value.get('entries'), list):
        return False
    cutoff, checkpoint = timestamp(value.get('cutoffAt')), timestamp(value.get('checkpointAt'))
    now = datetime.now(timezone.utc)
    if cutoff > checkpoint or checkpoint <= after or (checkpoint - now).total_seconds() > 5:
        return False
    if len(value['entries']) > 10000:
        return False
    for entry in value['entries']:
        if (not isinstance(entry, dict) or not isinstance(entry.get('userId'), str)
                or not entry['userId'] or not isinstance(entry.get('adminIds'), list)
                or not isinstance(entry.get('acknowledgedAdminIds'), list)
                or any(not isinstance(x, str) for x in entry['adminIds'] + entry['acknowledgedAdminIds'])
                or not set(entry['acknowledgedAdminIds']) <= set(entry['adminIds'])):
            return False
        timestamp(entry.get('createdAt'))
    return True


def health(after, expected_bot, paths, state_admins, heartbeat_admins, require_journal):
    try:
        current = bot_snapshot()
        if stable_identity(current) != stable_identity(expected_bot):
            return False
        state, heartbeat, journal = paths
        beat = read_json(heartbeat)
        now = datetime.now(timezone.utc)
        if (beat.get('status') != 'running' or beat.get('isPolling') is not True
                or admin_ids(beat) != heartbeat_admins or admin_ids(read_json(state)) != state_admins):
            return False
        for key in ('lastHeartbeatAt', 'lastSyncAt'):
            observed = timestamp(beat.get(key))
            if observed <= after or (observed - now).total_seconds() > 5:
                return False
        if (now - timestamp(beat['lastHeartbeatAt'])).total_seconds() > 45:
            return False
        return not require_journal or valid_journal(read_json(journal), after)
    except (OSError, ValueError, KeyError, TypeError, GateError):
        return False


def wait_healthy(*args):
    end = time.monotonic() + HEALTH_SECONDS
    while True:
        if health(*args):
            return True
        if time.monotonic() >= end:
            return False
        time.sleep(1.5)


def choose_probe_image(bot, explicit_image):
    if explicit_image is None:
        return bot['Image']
    if not isinstance(explicit_image, str) or not re.fullmatch('sha256:[a-f0-9]{64}', explicit_image):
        raise GateError('immutable_probe_image_id_required')
    images = json.loads(run('docker', 'image', 'inspect', explicit_image))
    if (not isinstance(images, list) or len(images) != 1 or not isinstance(images[0], dict)
            or images[0].get('Id') != explicit_image):
        raise GateError('immutable_probe_image_not_present')
    live_version = run('docker', 'exec', BOT, 'node', '--version').strip()
    if not re.fullmatch(rb'v[0-9]+\.[0-9]+\.[0-9]+', live_version):
        raise GateError('live_bot_node_version_invalid')
    name = 'flixify-telegram-registration-version-' + uuid.uuid4().hex[:12]
    try:
        probe_version = run('docker', 'run', '--rm', '--name', name, '--pull', 'never',
                            '--network', 'none', '--read-only', '--user', '0:0', '--cap-drop', 'ALL',
                            '--security-opt', 'no-new-privileges', '--cpus', '0.5', '--memory', '128m',
                            '--memory-swap', '128m', '--pids-limit', '32', '--entrypoint', 'node',
                            explicit_image, '--version').strip()
    finally:
        try:
            run('docker', 'rm', '--force', name)
        except GateError:
            pass
    if probe_version != live_version:
        raise GateError('probe_image_node_version_differs')
    return explicit_image


def offline_checks(candidate, candidate_sha, probe, probe_sha, image):
    if sha(regular_bytes(probe, 1024 * 1024)[0]) != probe_sha:
        raise GateError('offline_probe_hash_changed')
    if any(any(char in str(path.resolve()) for char in (',', '\n', '\r')) for path in (candidate, probe)):
        raise GateError('mount_path_contains_separator')
    sandbox = ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--user', '0:0',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--cpus', '0.5',
               '--memory', '256m', '--memory-swap', '256m', '--pids-limit', '64',
               '--mount', 'type=bind,src=' + str(candidate.resolve()) + ',dst=/run/candidate.mjs,readonly',
               '--mount', 'type=bind,src=' + str(probe.resolve()) + ',dst=/run/offline-probe.mjs,readonly',
               '--entrypoint', 'node', image]
    result = None
    for arguments in (('--check', '/run/candidate.mjs'),
                      ('/run/offline-probe.mjs', '/run/candidate.mjs')):
        name = 'flixify-telegram-registration-probe-' + uuid.uuid4().hex[:12]
        try:
            output = run(*sandbox[:3], '--name', name, *sandbox[3:], *arguments)
            if arguments[0] != '--check':
                result = json.loads(output)
        finally:
            try:
                run('docker', 'rm', '--force', name)
            except GateError:
                pass
    required = {'active-assigned-registration', 'durable-discovery', 'acknowledged-delivery',
                'restart-no-duplicate', 'failed-delivery-retry'}
    if result.get('passed') is not True or not required <= set(result.get('checks', [])):
        raise GateError('offline_registration_probe_failed')
    if sha(regular_bytes(candidate, 2 * 1024 * 1024)[0]) != candidate_sha:
        raise GateError('candidate_changed_during_probe')


def file_identity(info):
    return info.st_dev, info.st_ino, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid


def write_script(contents, expected_identity):
    descriptor = os.open(SCRIPT, os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0))
    try:
        if file_identity(os.fstat(descriptor)) != expected_identity:
            raise GateError('mounted_source_identity_changed')
        try:
            offset = 0
            while offset < len(contents):
                count = os.write(descriptor, memoryview(contents)[offset:])
                if type(count) is not int or count <= 0:
                    raise OSError('write_made_no_progress')
                offset += count
            os.ftruncate(descriptor, len(contents))
            os.fsync(descriptor)
        except BaseException:
            observed_sha = None
            try:
                if file_identity(os.fstat(descriptor)) == expected_identity:
                    os.lseek(descriptor, 0, os.SEEK_SET)
                    observed = bytearray()
                    while len(observed) <= 2 * 1024 * 1024:
                        chunk = os.read(descriptor, min(65536, 2 * 1024 * 1024 + 1 - len(observed)))
                        if not chunk:
                            break
                        observed.extend(chunk)
                    info = os.fstat(descriptor)
                    if (len(observed) <= 2 * 1024 * 1024 and info.st_size == len(observed)
                            and file_identity(info) == expected_identity):
                        observed_sha = sha(observed)
            except (OSError, ValueError):
                pass
            raise ScriptWriteError(observed_sha) from None
    finally:
        os.close(descriptor)


def initialize_journal(path, owner):
    now = datetime.now(timezone.utc).isoformat()
    value = {'version': 1, 'cutoffAt': now, 'checkpointAt': now, 'entries': []}
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    except FileExistsError:
        # Existing queued or acknowledged notifications belong to the running notifier.
        read_json(path)
        return
    with os.fdopen(descriptor, 'wb') as file:
        os.fchown(file.fileno(), owner.st_uid, owner.st_gid)
        file.write((json.dumps(value) + '\n').encode())
        file.flush()
        os.fsync(file.fileno())
    directory = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def deploy(candidate, candidate_sha, probe, probe_sha, apply=False, source_sha=SOURCE_SHA,
           probe_image_id=None):
    if source_sha != SOURCE_SHA or any(not re.fullmatch('[a-f0-9]{64}', x) for x in (candidate_sha, probe_sha)):
        raise GateError('explicit_reviewed_hashes_required')
    if candidate.resolve() == SCRIPT.resolve():
        raise GateError('candidate_must_be_separate')
    original, info = regular_bytes(SCRIPT, 2 * 1024 * 1024)
    updated, _ = regular_bytes(candidate, 2 * 1024 * 1024)
    if sha(original) != source_sha or sha(updated) != candidate_sha or source_sha == candidate_sha:
        raise GateError('source_or_candidate_hash_mismatch')
    identity = file_identity(info)
    bot = bot_snapshot()
    before = protected_snapshot()
    paths = state_paths(bot)
    state_admins, heartbeat_admins = admin_ids(read_json(paths[0])), admin_ids(read_json(paths[1]))
    probe_image = choose_probe_image(bot, probe_image_id)
    offline_checks(candidate, candidate_sha, probe, probe_sha, probe_image)
    if (protected_snapshot() != before or stable_identity(bot_snapshot()) != stable_identity(bot)
            or regular_bytes(SCRIPT, 2 * 1024 * 1024)[0] != original
            or file_identity(SCRIPT.lstat()) != identity
            or admin_ids(read_json(paths[0])) != state_admins
            or admin_ids(read_json(paths[1])) != heartbeat_admins):
        raise GateError('baseline_changed_during_preflight')
    if not apply:
        print('telegram_registration_preflight_passed; no_live_script_or_process_changed')
        return
    try:
        initialize_journal(paths[2], paths[0].stat())
        write_script(updated, identity)
        run('docker', 'restart', '--time', '20', BOT)
        after = datetime.now(timezone.utc)
        if not wait_healthy(after, bot, paths, state_admins, heartbeat_admins, True):
            raise GateError('new_bot_registration_health_failed')
        if (protected_snapshot() != before or stable_identity(bot_snapshot()) != stable_identity(bot)
                or sha(regular_bytes(SCRIPT, 2 * 1024 * 1024)[0]) != candidate_sha
                or file_identity(SCRIPT.lstat()) != identity):
            raise GateError('protected_runtime_or_script_changed')
    except BaseException as error:
        try:
            current, current_info = regular_bytes(SCRIPT, 2 * 1024 * 1024)
            allowed = {source_sha, candidate_sha}
            if isinstance(error, ScriptWriteError) and error.observed_partial_sha is not None:
                allowed.add(error.observed_partial_sha)
            if file_identity(current_info) != identity or sha(current) not in allowed:
                raise GateError('rollback_refuses_unexpected_source')
            if stable_identity(bot_snapshot(require_running=False)) != stable_identity(bot):
                raise GateError('rollback_refuses_changed_bot_config')
            write_script(original, identity)
            run('docker', 'restart', '--time', '20', BOT)
            after = datetime.now(timezone.utc)
            if not wait_healthy(after, bot, paths, state_admins, heartbeat_admins, False):
                raise GateError('original_bot_health_failed')
            if (sha(regular_bytes(SCRIPT, 2 * 1024 * 1024)[0]) != source_sha
                    or file_identity(SCRIPT.lstat()) != identity or protected_snapshot() != before):
                raise GateError('rollback_protected_baseline_changed')
        except BaseException:
            raise GateError('telegram_registration_failed_and_rollback_not_verified') from None
        raise GateError('telegram_registration_failed_original_bot_restored') from None
    print('telegram_registration_release_passed; only_bot_restarted; no_persistent_backup_created')


def parse_arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--candidate-sha256', required=True)
    parser.add_argument('--probe', type=Path, default=HERE / 'offline-probe.mjs')
    parser.add_argument('--probe-sha256', required=True)
    parser.add_argument('--source-sha256', default=SOURCE_SHA)
    parser.add_argument('--probe-image-id', help='Existing immutable image ID for an exact Node-version-matched offline probe')
    parser.add_argument('--apply', action='store_true')
    return parser.parse_args(argv)


def main():
    args = parse_arguments()
    with contextlib.ExitStack() as stack:
        if args.apply:
            lock = stack.enter_context(LOCK.open('a'))
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise GateError('telegram_registration_release_already_running') from None
        deploy(args.candidate, args.candidate_sha256, args.probe, args.probe_sha256,
               args.apply, args.source_sha256, args.probe_image_id)


if __name__ == '__main__':
    try:
        main()
    except (GateError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        code = str(error) if isinstance(error, GateError) else type(error).__name__
        print('telegram_registration_release_failed:' + code)
        raise SystemExit(1)
