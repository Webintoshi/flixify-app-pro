#!/usr/bin/env python3
"""Publish exactly the 1.4.14 descriptor, APK and updater manifest; preflight by default."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import tempfile
import threading
import uuid

HERE = Path(__file__).resolve().parent
import importlib.util
spec = importlib.util.spec_from_file_location('tv1414_publication_common', HERE / 'common.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
builder, command, GateError = c.builder, c.command, c.GateError


def bounded_blob(repo, revision, path, maximum=4 * 1024**2):
    builder.require_regular_blob(repo, revision, path)
    if path in c.OVERLAY and not re.fullmatch(rb'100644 blob [a-f0-9]{40}\t' + re.escape(path.encode()) + rb'\x00', builder.git_entry(repo, revision, path)):
        raise GateError('publication_file_not_regular_mode_0644')
    length = command('git', '-C', str(repo), 'cat-file', '-s', revision + ':' + path).decode().strip()
    if not length.isdecimal() or not 1 <= int(length) <= maximum:
        raise GateError('source_blob_size_outside_bound:' + path)
    data = command('git', '-C', str(repo), 'cat-file', 'blob', revision + ':' + path, timeout=180)
    if len(data) != int(length):
        raise GateError('source_blob_length_differs:' + path)
    return data


def sources(repo, revision, native):
    for ref in (c.BASE, native['nativeRevision'], revision):
        c.exact_revision(ref)
        if command('git', '-C', str(repo), 'rev-parse', ref + '^{commit}').decode().strip() != ref:
            raise GateError('exact_source_commit_unavailable')
    for first, last in ((c.BASE, native['nativeRevision']), (native['nativeRevision'], revision)):
        command('git', '-C', str(repo), 'merge-base', '--is-ancestor', first, last)
    for ref in (native['nativeRevision'], revision):
        if command('git', '-C', str(repo), 'rev-parse', ref + ':apps/tv-android').decode().strip() != native['nativeTree']:
            raise GateError('native_tree_changed_after_accepted_freeze')
    if command('git', '-C', str(repo), 'diff', '--name-only', c.BASE, native['nativeRevision'], '--', 'apps/ops-web').strip():
        raise GateError('web_publication_must_follow_native_freeze')
    changes = command('git', '-C', str(repo), 'diff', '--no-renames', '--name-status', c.BASE, revision).decode().splitlines()
    found = set()
    for row in changes:
        parts = row.split('\t')
        if len(parts) != 2:
            raise GateError('source_delta_status_invalid')
        status, path = parts
        if path in c.OVERLAY:
            found.add((status, path))
        elif not (path.startswith('apps/tv-android/') or path.startswith(c.TOOLS_ROOT)):
            raise GateError('change_outside_native_and_exact_publication:' + path)
    if found != {('M', c.DESCRIPTOR), ('A', c.APK), ('M', c.UPDATE_MANIFEST)}:
        raise GateError('exact_three_file_web_overlay_required')
    old = bounded_blob(repo, c.BASE, c.DESCRIPTOR)
    descriptor = bounded_blob(repo, revision, c.DESCRIPTOR)
    if (old.count(b'flixify-pro-1.4.13.apk') != 2 or old.count(b'"1.4.13"') != 1
            or descriptor != old.replace(b'1.4.13', b'1.4.14')):
        raise GateError('descriptor_outside_exact_version_replacement')
    if builder.image_file(c.SOURCE_ID, c.DESCRIPTOR) != old:
        raise GateError('actual_source_descriptor_differs_from_base')
    gradle = bounded_blob(repo, native['nativeRevision'], c.GRADLE)
    for expression in (rb"\bapplicationId\s+['\"]vip\.flixify\.tv['\"]", rb'(?m)^\s*minSdk\s+23\s*$',
                       rb'(?m)^\s*targetSdk\s+35\s*$', rb'(?m)^\s*versionCode\s+22\s*$',
                       rb"(?m)^\s*versionName\s+['\"]1\.4\.14['\"]\s*$"):
        if len(re.findall(expression, gradle)) != 1:
            raise GateError('native_version_or_platform_contract_differs')
    if bounded_blob(repo, native['nativeRevision'], c.ANDROID_MANIFEST).count(b'android:label="Flixify Pro"') != 1:
        raise GateError('native_application_label_differs')
    apk = bounded_blob(repo, revision, c.APK, c.MAX_APK_BYTES)
    manifest = bounded_blob(repo, revision, c.UPDATE_MANIFEST, 65536)
    if len(apk) != native['apkBytes'] or c.sha(apk) != native['apkSha256'] or not apk.startswith(b'PK\x03\x04'):
        raise GateError('accepted_native_and_published_apk_differ')
    c.parse_manifest(manifest, native)
    if builder.git_entry(repo, c.BASE, c.APK):
        raise GateError('new_apk_already_present_in_source')
    builder.require_image_absent(c.APK)
    if builder.image_file(c.SOURCE_ID, c.UPDATE_MANIFEST) != bounded_blob(repo, c.BASE, c.UPDATE_MANIFEST, 65536):
        raise GateError('source_update_manifest_drift')
    return {c.DESCRIPTOR: descriptor, c.APK: apk, c.UPDATE_MANIFEST: manifest}


def next_footprint():
    script = ('const fs=require("node:fs"),path=require("node:path");let bytes=0;'
        'function scan(p){const s=fs.lstatSync(p);if(s.isSymbolicLink())return;'
        'if(s.isFile()){bytes+=s.size;return}if(!s.isDirectory())throw Error("next_file_type");'
        'for(const e of fs.readdirSync(p))scan(path.join(p,e))}'
        'scan("/app/apps/ops-web/.next");console.log(bytes)')
    value = command('docker', 'run', '--rm', '--network', 'none', '--cpus', '1', '--memory', '128m',
        '--memory-swap', '192m', '--pids-limit', '64', '--entrypoint', 'node', c.SOURCE_ID, '-e', script).decode().strip()
    if not value.isdecimal():
        raise GateError('next_footprint_invalid')
    return int(value)


def source_runtime():
    base = builder.core.image(c.SOURCE_ID)
    if base['Id'] != c.SOURCE_ID or builder.core.image(c.SOURCE_TAG)['Id'] != c.SOURCE_ID:
        raise GateError('source_image_tag_drift')
    current = json.loads(command('docker', 'inspect', 'ops-web-' + builder.UUID))[0]
    if (current['Image'] != c.SOURCE_ID or current['Config']['Image'] != c.SOURCE_TAG or not current['State']['Running']
            or (current['Config'].get('Labels') or {}).get('com.docker.compose.project') != builder.UUID):
        raise GateError('actual_web_runtime_drift')
    env = dict(row.split('=', 1) for row in current['Config'].get('Env', []) if '=' in row)
    if not set(builder.PUBLIC_WEB_KEYS) <= set(env):
        raise GateError('public_build_environment_missing')
    return base, {key: env[key] for key in builder.PUBLIC_WEB_KEYS}


def measure():
    before = c.protected_host(include_web=True)
    _, env = source_runtime()
    original_public = c.web.public_manifest(c.SOURCE_ID)
    result = {'schemaVersion': 1, 'sourceTag': c.SOURCE_TAG, 'sourceId': c.SOURCE_ID,
              'excluded': [*c.OVERLAY, 'apps/ops-web/.next'], 'measurement': c.web.untouched(c.SOURCE_ID),
              'publicSha256': c.sha(c.web.canonical_public_manifest(original_public)),
              'nextBytes': next_footprint(), 'publicBuildEnv': env}
    c.disk_budget(result['nextBytes'], 1024)
    if c.protected_host(include_web=True) != before:
        raise GateError('host_changed_during_independent_measurement')
    return result


def source_pin(data):
    value = c.unique_json(data)
    keys = {'schemaVersion', 'sourceTag', 'sourceId', 'excluded', 'measurement', 'publicSha256', 'nextBytes', 'publicBuildEnv'}
    if (not isinstance(value, dict) or set(value) != keys or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
            or value['sourceTag'] != c.SOURCE_TAG or value['sourceId'] != c.SOURCE_ID
            or value['excluded'] != [*c.OVERLAY, 'apps/ops-web/.next']):
        raise GateError('independent_current_source_pin_required')
    if not isinstance(value['measurement'], dict) or set(value['measurement']) != {'sha256', 'files'}:
        raise GateError('source_measurement_shape_invalid')
    c.web.validate_source_fingerprint(**value['measurement'])
    if not isinstance(value['publicSha256'], str) or not re.fullmatch('[a-f0-9]{64}', value['publicSha256']):
        raise GateError('source_public_digest_invalid')
    env = value['publicBuildEnv']
    if not isinstance(env, dict) or set(env) != set(builder.PUBLIC_WEB_KEYS) or any(not isinstance(v, str) for v in env.values()):
        raise GateError('source_public_build_environment_invalid')
    c.disk_budget(value['nextBytes'], 1024)
    return value


def inputs(repo, revision, native, pin):
    updates = sources(repo, revision, native)
    original_public = c.web.public_manifest(c.SOURCE_ID)
    if c.sha(c.web.canonical_public_manifest(original_public)) != pin['publicSha256']:
        raise GateError('independently_pinned_source_public_tree_differs')
    c.expected_public(original_public, native, updates[c.UPDATE_MANIFEST])
    if c.web.untouched(c.SOURCE_ID) != pin['measurement']:
        raise GateError('independently_pinned_source_tree_differs')
    if next_footprint() != pin['nextBytes']:
        raise GateError('independently_pinned_next_footprint_differs')
    config = builder.image_file(c.SOURCE_ID, builder.CONFIG)
    if config != bounded_blob(repo, c.BASE, builder.CONFIG):
        raise GateError('source_next_config_drift')
    return updates, original_public, config


def require_disk(budget, build=False):
    floor = budget['requiredFreeBytes'] if build else budget['hostReserveBytes']
    if shutil.disk_usage('/var/lib/docker').free < floor:
        raise GateError('insufficient_disk_for_measured_budget_no_pruning')


class DiskWatch:
    def __init__(self, owned):
        self.owned, self.stop = owned, threading.Event()
        self.failure = None
        self.thread = threading.Thread(target=self.watch, daemon=True, name='flixify-owned-build-disk-watch')

    def watch(self):
        while not self.stop.wait(1):
            try:
                if shutil.disk_usage('/var/lib/docker').free >= c.HOST_RESERVE_BYTES:
                    continue
                self.failure = 'host_disk_reserve_breached'
            except OSError:
                self.failure = 'host_disk_monitor_unavailable'
            try:
                command('docker', 'kill', self.owned, timeout=10)
            except Exception:
                pass
            return

    def __enter__(self):
        require_disk({'hostReserveBytes': c.HOST_RESERVE_BYTES})
        self.thread.start()
        return self

    def __exit__(self, *unused):
        self.stop.set()
        self.thread.join(timeout=12)
        if self.thread.is_alive() or self.failure:
            raise GateError(self.failure or 'host_disk_monitor_did_not_stop')


def compile_candidate(revision, base, updates, env, budget):
    if set(updates) != set(c.OVERLAY):
        raise GateError('compiler_exact_three_file_overlay_required')
    config = base.get('Config') or {}
    if not config.get('Cmd') or config.get('Volumes'):
        raise GateError('unsupported_base_runtime_config')
    require_disk(budget, build=True)
    name = 'flixify-tv1414-web-build-' + uuid.uuid4().hex[:12]
    created = False
    args = ['docker', 'create', '--name', name, '--network', 'none', '--cpus', '1', '--memory', '1280m',
            '--memory-swap', '1536m', '--pids-limit', '256']
    for key, value in env.items():
        args += ['--env', key + '=' + value]
    # The inherited compiler also validates actual kernel memory/swap caps.
    script = (r'const capFs=require("node:fs");const cpu=capFs.readFileSync("/sys/fs/cgroup/cpu.max","utf8").trim().split(/\s+/);'
        r'if(cpu.length!==2||!cpu.every(v=>/^\d+$/.test(v))||BigInt(cpu[0])<=0n||BigInt(cpu[0])>BigInt(cpu[1]))throw Error("cpu_cap_invalid");'
        r'const pids=capFs.readFileSync("/sys/fs/cgroup/pids.max","utf8").trim();if(!/^\d+$/.test(pids)||BigInt(pids)<=0n||BigInt(pids)>256n)throw Error("pid_cap_invalid");'
        + builder.build_script())
    try:
        owned = command(*args, c.SOURCE_ID, 'node', '-e', script).decode().strip()
        created = True
        if not re.fullmatch('[a-f0-9]{64}', owned):
            raise GateError('owned_compiler_container_id_invalid')
        with tempfile.TemporaryDirectory(prefix='flixify-tv1414-overlay-') as directory:
            for index, (path, data) in enumerate(updates.items()):
                file = Path(directory) / str(index)
                file.write_bytes(data)
                file.chmod(0o644)
                command('docker', 'cp', str(file), owned + ':/app/' + path)
        with DiskWatch(owned):
            command('docker', 'start', '--attach', owned, timeout=1200)
            if command('docker', 'inspect', '--format', '{{.State.ExitCode}}', owned).strip() != b'0':
                raise GateError('bounded_web_compile_failed')
            rw = command('docker', 'inspect', '--size', '--format', '{{.SizeRw}}', owned).decode().strip()
            if not rw.isdecimal() or int(rw) > budget['workspaceBytes'] // 2:
                raise GateError('compiler_writable_layer_exceeds_measured_budget')
            # Commit can temporarily duplicate the writable layer. Reserve it before starting.
            if shutil.disk_usage('/var/lib/docker').free < budget['hostReserveBytes'] + int(rw):
                raise GateError('commit_requires_host_reserve_plus_layer_bytes')
            command('docker', 'commit', '--change', 'CMD ' + json.dumps(config['Cmd']),
                '--change', 'LABEL org.opencontainers.image.revision=' + revision,
                '--change', 'LABEL vip.flixify.edge-recovery.base=' + c.SOURCE_ID,
                owned, c.target(revision), timeout=300)
        require_disk(budget)
    finally:
        if created:
            command('docker', 'rm', '--force', name)


def download_script(native, manifest):
    c.parse_manifest(manifest, native)
    return ('const crypto=require("node:crypto");(async()=>{const root="http://127.0.0.1:3000";'
        'async function bytes(r,n){let size=0;const chunks=[];for await(const x of r.body){size+=x.length;if(size>n)throw Error("oversize");chunks.push(x)}if(size!==n)throw Error("size");return Buffer.concat(chunks,size)}'
        'const pins=' + json.dumps([{'path': c.APK.removeprefix('apps/ops-web/public'), 'size': native['apkBytes'], 'sha': native['apkSha256'], 'kind': 'apk'},
                                   {'path': c.UPDATE_MANIFEST.removeprefix('apps/ops-web/public'), 'size': len(manifest), 'sha': c.sha(manifest), 'kind': 'json'}]) + ';'
        'for(const p of pins){let h;for(let i=0;i<40;i++){try{h=await fetch(root+p.path,{method:"HEAD",signal:AbortSignal.timeout(2000)});if(h.status===200)break}catch{}await new Promise(r=>setTimeout(r,250))}'
        'if(!h||h.status!==200||Number(h.headers.get("content-length"))!==p.size)throw Error("head");const mime=h.headers.get("content-type")?.split(";")[0];if(p.kind==="apk"?!["application/vnd.android.package-archive","application/octet-stream"].includes(mime):mime!=="application/json")throw Error("mime");'
        'if(p.kind==="apk"){const r=await fetch(root+p.path,{headers:{Range:"bytes=0-31"},signal:AbortSignal.timeout(10000)});if(r.status!==206||r.headers.get("content-range")!=="bytes 0-31/"+p.size)throw Error("range");await bytes(r,32)}'
        'const r=await fetch(root+p.path,{signal:AbortSignal.timeout(15000)});if(r.status!==200)throw Error("get");const b=await bytes(r,p.size);if(crypto.createHash("sha256").update(b).digest("hex")!==p.sha)throw Error("digest");if(p.kind==="apk"&&!b.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw Error("apk");}'
        'for(const p of ["/","/indir","/paketler","/cihaz","/giris-yap"]){const r=await fetch(root+p,{redirect:"manual",signal:AbortSignal.timeout(8000)});if(r.status!==200)throw Error("page");if(p==="/indir"){const text=await r.text();if(!text.includes("/downloads/flixify-pro-1.4.14.apk")||!text.includes("1.4.14"))throw Error("download_page_version")}}'
        'console.log("tv1414_download_and_pages_verified")})().catch(()=>{console.error("tv1414_download_contract_failed");process.exit(1)})')


def verify_download(candidate, native, manifest):
    name = 'flixify-tv1414-web-check-' + uuid.uuid4().hex[:12]
    created = False
    try:
        owned = command('docker', 'create', '--name', name, '--network', 'none', '--cpus', '1', '--memory', '512m',
            '--memory-swap', '640m', '--pids-limit', '128', candidate).decode().strip()
        created = True
        if not re.fullmatch('[a-f0-9]{64}', owned) or command('docker', 'inspect', '--format', '{{.Image}}', owned).decode().strip() != candidate:
            raise GateError('download_check_container_identity_differs')
        command('docker', 'start', owned)
        command('docker', 'exec', owned, 'node', '-e', download_script(native, manifest), timeout=160)
    finally:
        if created:
            command('docker', 'rm', '--force', name)


def verify_candidate(revision, base, updates, env, config, original_public, native, pin, download=True):
    candidate = builder.verify_candidate(base, revision, updates, env, config)
    c.previous.verify_full_runtime_config(base, builder.core.image(candidate), revision, env)
    if c.web.untouched(candidate) != pin['measurement']:
        raise GateError('candidate_changed_untouched_source_or_dependencies')
    if c.public_rows(c.web.public_manifest(candidate)) != c.expected_public(original_public, native, updates[c.UPDATE_MANIFEST]):
        raise GateError('candidate_changed_existing_public_asset')
    c.mac.verify_removed(candidate)
    if download:
        verify_download(candidate, native, updates[c.UPDATE_MANIFEST])
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path, nargs='?')
    parser.add_argument('--revision')
    parser.add_argument('--native-proof', type=Path)
    parser.add_argument('--source-pin', type=Path)
    actions = parser.add_mutually_exclusive_group()
    for action in ('measure', 'build', 'verify-existing'):
        actions.add_argument('--' + action, action='store_true')
    args = parser.parse_args()
    c.configure_builder()
    if args.measure:
        print(json.dumps(measure(), sort_keys=True))
        return
    if args.repo is None or args.revision is None or args.native_proof is None or args.source_pin is None:
        raise GateError('exact_repo_revision_native_proof_and_independent_source_pin_required')
    c.target(args.revision)
    native, pin = c.proof(args.native_proof.read_bytes()), source_pin(args.source_pin.read_bytes())
    before = c.protected_host(include_web=True)
    base, env = source_runtime()
    if env != pin['publicBuildEnv']:
        raise GateError('runtime_public_build_environment_changed')
    updates, public, config = inputs(args.repo, args.revision, native, pin)
    budget = c.disk_budget(pin['nextBytes'], sum(len(value) for value in updates.values()))
    if not (args.build or args.verify_existing):
        require_disk(budget, build=True)
        if c.protected_host(include_web=True) != before:
            raise GateError('host_changed_during_preflight')
        print(json.dumps({'state': 'tv1414_web_preflight_passed', 'diskBudget': budget}, sort_keys=True))
        return
    images = set(command('docker', 'image', 'ls', '--no-trunc', '-q').decode().splitlines())
    if args.build:
        if c.target(args.revision) in command('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}').decode().splitlines():
            raise GateError('candidate_already_exists_use_verify_existing')
        compile_candidate(args.revision, base, updates, env, budget)
    candidate = verify_candidate(args.revision, base, updates, env, config, public, native, pin)
    if c.protected_host(include_web=True) != before:
        raise GateError('existing_host_container_or_environment_changed')
    if not images <= set(command('docker', 'image', 'ls', '--no-trunc', '-q').decode().splitlines()):
        raise GateError('existing_image_removed')
    print(json.dumps({'state': 'tv1414_web_candidate_verified', 'candidateId': candidate,
        'candidateTag': c.target(args.revision), 'revision': args.revision, 'diskBudget': budget}, sort_keys=True))


if __name__ == '__main__':
    main()
