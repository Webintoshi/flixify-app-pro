#!/usr/bin/env python3
"""Publish only two Mac download UI files and a root-verified immutable ZIP."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('mac_zip_publication_common', HERE / 'common.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
command, builder, GateError = c.command, c.builder, c.GateError


def sources(repo, revision, pin):
    c.target(revision)
    for ref in (c.BASE, revision):
        if command('git', '-C', str(repo), 'rev-parse', ref + '^{commit}').decode().strip() != ref:
            raise GateError('exact_commit_unavailable')
    paths = (*c.RUNTIME, pin['path'])
    changed = command('git', '-C', str(repo), 'diff', '--name-only', c.BASE, revision, '--', 'apps/ops-web').decode().splitlines()
    if {path for path in changed if '.test.' not in path} != set(paths):
        raise GateError('web_delta_outside_two_mac_files_and_zip')
    updates = {}
    for path in c.RUNTIME:
        builder.require_regular_blob(repo, revision, path)
        updates[path] = c.qr.merge.merge_text(c.qr.merge.blob(repo, c.BASE, path).decode(),
            c.qr.merge.blob(repo, revision, path).decode(), builder.image_file(c.SOURCE_ID, path).decode()).encode()
    path = pin['path']
    c.web.regular_public_blob(repo, revision, path)
    if builder.git_entry(repo, c.BASE, path):
        raise GateError('new_zip_existed_at_baseline')
    builder.require_image_absent(path)
    size = command('git', '-C', str(repo), 'cat-file', '-s', revision + ':' + path).decode().strip()
    if size != str(pin['bytes']):
        raise GateError('git_zip_size_differs_before_read')
    data = command('git', '-C', str(repo), 'show', revision + ':' + path, timeout=180)
    if len(data) != pin['bytes'] or c.sha(data) != pin['sha256'] or not data.startswith(b'PK\x03\x04'):
        raise GateError('zip_bytes_differ_from_root_acceptance')
    updates[path] = data
    c.descriptor_matches(updates[c.RUNTIME[0]], pin)
    return updates


def compile_candidate(revision, base, updates, env):
    config = base.get('Config') or {}
    if not config.get('Cmd') or config.get('Volumes'):
        raise GateError('unsupported_base_runtime_config')
    name = 'flixify-mac-zip-web-build-' + uuid.uuid4().hex[:12]
    created = False
    args = ['docker', 'create', '--name', name, '--network', 'none', '--cpus', '1', '--memory', '1280m',
            '--memory-swap', '1536m', '--pids-limit', '256']
    for key, value in env.items():
        args += ['--env', key + '=' + value]
    try:
        command(*args, c.SOURCE_ID, 'node', '-e', builder.build_script())
        created = True
        with tempfile.TemporaryDirectory(prefix='flixify-mac-zip-overlay-') as directory:
            for index, (path, data) in enumerate(updates.items()):
                file = Path(directory) / str(index)
                file.write_bytes(data)
                file.chmod(0o644)
                command('docker', 'cp', str(file), name + ':/app/' + path)
        command('docker', 'start', '--attach', name, timeout=1200)
        if command('docker', 'inspect', '--format', '{{.State.ExitCode}}', name).strip() != b'0':
            raise GateError('bounded_web_compile_failed')
        command('docker', 'commit', '--change', 'CMD ' + json.dumps(config['Cmd']),
                '--change', 'LABEL org.opencontainers.image.revision=' + revision,
                '--change', 'LABEL vip.flixify.edge-recovery.base=' + c.SOURCE_ID,
                name, c.target(revision), timeout=300)
    finally:
        if created:
            command('docker', 'rm', '--force', name)


def verify_full_runtime_config(base, candidate, revision, env):
    expected = dict(base['Config'])
    expected['Labels'] = dict(expected.get('Labels') or {}) | {
        'org.opencontainers.image.revision': revision,
        'vip.flixify.edge-recovery.base': c.SOURCE_ID,
    }
    expected_env = dict(row.split('=', 1) for row in expected.get('Env', []) if '=' in row) | env
    actual = dict(candidate['Config'])
    actual_env = dict(row.split('=', 1) for row in actual.get('Env', []) if '=' in row)
    if actual_env != expected_env:
        raise GateError('complete_image_environment_differs')
    # Docker commit records its stopped compiler's hostname/base Image reference.
    # Neither is inherited when Docker starts a new container; all other Config keys are exact.
    for value in (expected, actual):
        for key in ('Hostname', 'Image', 'Env'):
            value.pop(key, None)
    if actual != expected:
        raise GateError('complete_image_runtime_config_differs')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--artifact-pin', required=True, type=Path)
    parser.add_argument('--source-pin', type=Path)
    actions = parser.add_mutually_exclusive_group()
    for name in ('measure', 'build', 'verify-existing'):
        actions.add_argument('--' + name, action='store_true')
    args = parser.parse_args()
    pin = c.artifact_pin(json.loads(args.artifact_pin.read_bytes()))
    c.configure_builder(pin)
    c.target(args.revision)
    before_host = c.qr.backend.host_snapshot()
    if before_host['environment'] != c.ENV_SHA or before_host['registrationFence'] != c.FENCE_SHA:
        raise GateError('environment_or_registration_fence_drift')
    before_images = set(command('docker', 'image', 'ls', '--no-trunc', '-q').decode().splitlines())
    base = builder.core.image(c.SOURCE_ID)
    if builder.core.image(c.SOURCE_TAG)['Id'] != c.SOURCE_ID:
        raise GateError('source_image_tag_drift')
    current = json.loads(command('docker', 'inspect', 'ops-web-' + builder.UUID))[0]
    if (current['Image'] != c.SOURCE_ID or current['Config']['Image'] != c.SOURCE_TAG
            or not current['State']['Running']
            or (current['Config'].get('Labels') or {}).get('com.docker.compose.project') != builder.UUID):
        raise GateError('actual_web_runtime_drift')
    source = c.web.untouched(c.SOURCE_ID)
    if args.measure:
        print(json.dumps(source, sort_keys=True))
        return
    if args.source_pin is None or json.loads(args.source_pin.read_bytes()) != source:
        raise GateError('independent_web_source_pin_required')
    updates = sources(args.repo, args.revision, pin)
    expected_public = c.expected_public(c.web.public_manifest(c.SOURCE_ID), pin)
    config = builder.image_file(c.SOURCE_ID, builder.CONFIG)
    if config != c.qr.merge.blob(args.repo, c.BASE, builder.CONFIG):
        raise GateError('next_config_drift')
    env = dict(row.split('=', 1) for row in current['Config']['Env'] if '=' in row)
    if any(key not in env for key in builder.PUBLIC_WEB_KEYS):
        raise GateError('public_build_setting_missing')
    env = {key: env[key] for key in builder.PUBLIC_WEB_KEYS}
    if not (args.build or args.verify_existing):
        print('mac_zip_web_preflight_passed')
        return
    if args.build:
        if shutil.disk_usage('/var/lib/docker').free < c.MIN_BUILD_BYTES:
            raise GateError('build_requires_5GiB_no_pruning')
        if c.target(args.revision) in command('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}').decode().splitlines():
            raise GateError('candidate_exists_use_verify_existing')
        compile_candidate(args.revision, base, updates, env)
    candidate = builder.verify_candidate(base, args.revision, updates, env, config)
    verify_full_runtime_config(base, builder.core.image(candidate), args.revision, env)
    if (c.web.untouched(candidate) != source
            or json.loads(c.web.canonical_public_manifest(c.web.public_manifest(candidate))) != expected_public):
        raise GateError('untouched_source_or_existing_public_assets_changed')
    if c.qr.backend.host_snapshot() != before_host:
        raise GateError('existing_host_containers_or_environment_changed')
    if not before_images <= set(command('docker', 'image', 'ls', '--no-trunc', '-q').decode().splitlines()):
        raise GateError('existing_image_removed')
    print('mac_zip_web_candidate_verified:' + candidate)


if __name__ == '__main__':
    main()
