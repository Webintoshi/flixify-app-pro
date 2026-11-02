#!/usr/bin/env python3
"""Guarded two-service analytics cutover. Default preflight changes nothing."""
from __future__ import annotations
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import policy as p
import build


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


reviewed = load('analytics_reviewed_image_transaction', HERE.parent / '2026-11-01-packages/release-backend.py')
guard = reviewed.guard
STATE = guard.DIRECTORY / '.analytics-20261102-rollout.json'
MIGRATION_RECEIPT = guard.DIRECTORY / '.analytics-20261102-migration.json'
CANDIDATES = {}
OWNED = {}
PREVIOUS = {}
ORIGINAL_PHP = guard.PHP_APPLY
ORIGINAL_EXPECTED = guard.expected_swapped

PHP_ENV_FUNCTION = r'''
function analyticsEnv($details) {
    $result = [];
    if (!isset($details['environment']) || !is_array($details['environment'])) { throw new RuntimeException('environment shape'); }
    if (array_is_list($details['environment'])) {
        foreach ($details['environment'] as $row) {
            if (!is_string($row) || !str_contains($row, '=')) { throw new RuntimeException('environment entry'); }
            [$key, $value] = explode('=', $row, 2);
            if (array_key_exists($key, $result)) { throw new RuntimeException('environment duplicate'); }
            $result[$key] = $value;
        }
        return $result;
    }
    return $details['environment'];
}
function analyticsSwap(&$details, $p) {
    $allowed = ['GA4_ENABLED', 'GA4_WEB_MEASUREMENT_ID', 'GA4_WEB_API_SECRET', 'GA4_WINDOWS_MEASUREMENT_ID', 'GA4_WINDOWS_API_SECRET', 'GA4_ANALYTICS_HASH_SECRET'];
    $keys = array_fill_keys($allowed, true);
    $map = analyticsEnv($details);
    if (canonical(array_intersect_key($map, $keys)) !== canonical($p['ga_old']) || array_diff_key($p['ga_new'], $keys)) { throw new RuntimeException('owned environment drift'); }
    if (array_is_list($details['environment'])) {
        $details['environment'] = array_values(array_filter($details['environment'], fn($row) => !isset($keys[explode('=', $row, 2)[0]])));
        $values = $p['ga_new']; ksort($values);
        foreach ($values as $key => $value) { $details['environment'][] = $key . '=' . $value; }
    } else {
        $details['environment'] = array_diff_key($map, $keys) + $p['ga_new'];
    }
}
'''
PHP_ENV_SWAP = "        analyticsSwap($raw['services']['api'], $p);\n        analyticsSwap($expected['services']['api'], $p);\n"
if ORIGINAL_PHP.count("$phase = 'bootstrap_autoload';") != 1 or ORIGINAL_PHP.count("        $phase = 'compose_dump';") != 1:
    raise p.GateError('reviewed_coolify_transaction_anchor_drift')
PHP_APPLY = ORIGINAL_PHP.replace("$phase = 'bootstrap_autoload';", PHP_ENV_FUNCTION + "\n$phase = 'bootstrap_autoload';").replace("        $phase = 'compose_dump';", PHP_ENV_SWAP + "        $phase = 'compose_dump';")


def require_postgres_proof(path, accepted):
    if path is None: raise p.GateError('accepted_isolated_postgres_proof_required')
    data = Path(path).read_bytes()
    if not 2 <= len(data) <= 262144 or p.digest(data) != accepted['postgresFixtureSha256']: raise p.GateError('postgres_proof_digest_mismatch')
    proof = json.loads(data)
    for key in ('passed', 'protectedUnchanged', 'allOtherContainersUnchanged', 'ownedContainersRemoved'):
        if proof.get(key) is not True: raise p.GateError('postgres_fixture_not_passed_and_clean')
    if proof.get('cleanupErrors') != [] or proof.get('nodeExit') != 0 or proof.get('phase') != 'complete': raise p.GateError('postgres_fixture_incomplete')
    fixture = proof.get('fixture', {})
    if fixture.get('passed') is not True or fixture.get('googleRequests') != 0 or fixture.get('providerRequests') != 0 or fixture.get('productionDatabaseAccess') is not False:
        raise p.GateError('isolated_fixture_scope_not_proven')


def private_state(path, value=None):
    if value is None:
        info = path.lstat()
        if not path.is_file() or path.is_symlink() or info.st_mode & 0o077 or info.st_uid != os.geteuid() or info.st_size > 65536: raise p.GateError('owned_private_rollout_record_required')
        return json.loads(path.read_bytes())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(value, output, sort_keys=True); output.write('\n'); output.flush(); os.fsync(output.fileno())


def state_value(accepted):
    return {'schema': 1, 'revision': accepted['revision'], 'source': {'api': p.API_ID, 'ops-web': p.WEB_ID}, 'candidates': CANDIDATES, 'previous': {}, 'ownedHashes': {key: p.digest(value.encode()) for key, value in OWNED.items()}, 'migrationSha256': accepted['migrationSha256']}


def require_state(accepted):
    if private_state(STATE) != state_value(accepted): raise p.GateError('rollout_record_revision_or_owned_keys_differ')


def protected_host():
    snapshot = build.backend.host_snapshot()
    if snapshot['environment'] != p.ENV_SHA or snapshot['registrationFence'] != p.FENCE_SHA: raise p.GateError('environment_or_registration_fence_drift')
    return {key: value for key, value in snapshot.items() if not isinstance(value, dict) or value.get('name') not in ('/api-' + p.UUID, '/ops-web-' + p.UUID)}


def owned_for(new_images):
    if new_images == guard.TARGET: return OWNED
    if new_images == guard.SOURCE: return PREVIOUS
    raise p.GateError('only_exact_source_target_swap_allowed')


def expected_swapped(raw, rendered, new_images):
    first, second = ORIGINAL_EXPECTED(raw, rendered, new_images)
    return p.with_analytics(first, owned_for(new_images)), p.with_analytics(second, owned_for(new_images))


def locked_swap(record, old_images, new_images):
    before, after = owned_for(old_images), owned_for(new_images)
    payload = {'uuid': p.UUID, 'old': old_images, 'new': new_images, 'protected': {name: pin[0] for name, pin in guard.PROTECTED_IMAGES.items()}, 'raw_sha': guard.sha(record['docker_compose_raw']), 'rendered_sha': guard.sha(record['docker_compose']), 'ga_old': before, 'ga_new': after}
    guard.command('docker', 'exec', '-i', 'coolify', 'php', '-r', PHP_APPLY, input_data=json.dumps(payload, separators=(',', ':')).encode(), timeout=180, capture_sync_phase=True)


def candidate_images():
    result = {}
    for name in guard.CHANGED:
        candidate = guard.image(guard.TARGET[name]); base = guard.image(guard.SOURCE_IDS[name])
        labels = candidate.get('Config', {}).get('Labels') or {}; layers = base.get('RootFS', {}).get('Layers') or []
        if (candidate['Id'] != CANDIDATES[name] or guard.image_id(guard.TARGET[name]) != CANDIDATES[name] or candidate['Id'] == guard.SOURCE_IDS[name] or not layers or candidate.get('RootFS', {}).get('Layers', [])[:len(layers)] != layers or labels.get('vip.flixify.edge-recovery.base') != guard.SOURCE_IDS[name] or labels.get('org.opencontainers.image.revision') != guard.REVISION):
            raise p.GateError('accepted_candidate_identity_ancestry_or_revision_drift:' + name)
        result[name] = candidate['Id']
    return result


def healthy(name, tag, identity=None):
    try:
        item = guard.container_snapshot(allow_missing_changed=True)[name]
        if item['tag'] != tag or item['image_id'] != identity or not item['running'] or item['health'] == 'unhealthy' or item['hash'] != guard.compose_hash(name): return False
        if name == 'api':
            check = 'if(typeof process.env.REGISTRATION_GUARD_SECRET!=="string"||process.env.REGISTRATION_GUARD_SECRET.length<32||process.env.AUTO_TRIAL_DAILY_IP_LIMIT!=="2")throw Error("registration_guard");const r=await fetch("http://127.0.0.1:4000/health",{signal:AbortSignal.timeout(8000)});if(r.status!==200||(await r.json()).ok!==true)throw Error("health");'
            if tag == guard.TARGET['api']:
                expected = {'schema': 1, 'consentVersion': 1, 'web': {'enabled': True, 'measurementId': OWNED['GA4_WEB_MEASUREMENT_ID']}, 'windows': {'enabled': True, 'measurementId': OWNED['GA4_WINDOWS_MEASUREMENT_ID']}}
                check += 'const c=await fetch("http://127.0.0.1:4000/analytics/config",{signal:AbortSignal.timeout(8000)});if(c.status!==200||JSON.stringify(await c.json())!==JSON.stringify(' + json.dumps(expected) + '))throw Error("analytics_configuration");'
        else:
            check = 'if(process.env.REGISTRATION_GUARD_SECRET!=="")throw Error("registration_isolation");for(const path of ["/","/indir","/paketler"]){if((await fetch("http://127.0.0.1:3000"+path,{signal:AbortSignal.timeout(8000)})).status!==200)throw Error("page_health");}'
        guard.command('docker', 'exec', name + '-' + p.UUID, 'node', '-e', '(async()=>{' + check + '})().catch(()=>process.exit(1))', timeout=35)
        return True
    except Exception: return False


def configure(accepted, environment, api_id, web_id):
    global CANDIDATES, OWNED
    for identity in (api_id, web_id): p.exact(identity, r'sha256:[0-9a-f]{64}', 'exact_accepted_candidate_id_required')
    CANDIDATES, OWNED = {'api': api_id, 'ops-web': web_id}, environment
    guard.REVISION = accepted['revision']
    guard.CHANGED, guard.PROTECTED = ('api', 'ops-web'), ('db', 'worker')
    guard.SOURCE, guard.SOURCE_IDS = {'api': p.API_TAG, 'ops-web': p.WEB_TAG}, {'api': p.API_ID, 'ops-web': p.WEB_ID}
    guard.TARGET = {'api': build.target('api', accepted['revision']), 'ops-web': build.target('web', accepted['revision'])}
    guard.PROTECTED_IMAGES = {'worker': (p.WORKER_TAG, p.WORKER_ID)}
    guard.PHP_READ_APPLICATIONS = reviewed.READ_APPLICATIONS.replace("['worker']", "['api', 'ops-web']")
    guard.protected_application_images = lambda: json.loads(guard.command('docker', 'exec', 'coolify', 'php', '-r', reviewed.READ_APPLICATIONS))
    original_validate = reviewed.validate_plan
    def validate(raw, rendered, generated, containers, applications, stage, *, recovering=False):
        original_validate(raw, rendered, generated, containers, applications, stage, recovering=recovering)
        expected = PREVIOUS if stage == 'source' else OWNED
        for document in (raw, rendered, generated):
            values = p.environment(document, 'api')
            if {key: value for key, value in values.items() if key in p.GA_KEYS} != expected: raise p.GateError('owned_api_environment_stage_drift')
            for name in ('ops-web', 'worker', 'db'):
                if set(p.environment(document, name)) & p.GA_KEYS: raise p.GateError('analytics_secrets_must_exist_only_on_api')
    guard.validate_plan, guard.healthy = validate, healthy
    guard.candidate_images, guard.expected_swapped, guard.locked_image_swap = candidate_images, expected_swapped, locked_swap


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pins', type=Path, default=HERE / 'release-pins.json')
    parser.add_argument('--api-candidate-id', required=True)
    parser.add_argument('--web-candidate-id', required=True)
    parser.add_argument('--environment-file', required=True, type=Path)
    parser.add_argument('--postgres-proof', type=Path)
    parser.add_argument('--native-proof-dir', type=Path)
    parser.add_argument('--migration-receipt', type=Path, default=MIGRATION_RECEIPT)
    actions = parser.add_mutually_exclusive_group()
    for action in ('apply', 'recreate', 'rollback'): actions.add_argument('--' + action, action='store_true')
    args = parser.parse_args(argv)
    accepted = p.pins(json.loads(args.pins.read_bytes()))
    require_postgres_proof(args.postgres_proof, accepted)
    p.verify_native_evidence(args.native_proof_dir, accepted)
    configure(accepted, p.read_private_environment(args.environment_file), args.api_candidate_id, args.web_candidate_id)
    import migrate
    migrate.verify_receipt(args.migration_receipt, accepted)
    action = 'rollback' if args.rollback else 'recreate' if args.recreate else 'apply' if args.apply else None
    def execute():
        before = protected_host()
        if action == 'rollback':
            require_state(accepted)
            with contextlib.redirect_stdout(io.StringIO()): guard.rollback()
        elif action == 'recreate':
            require_state(accepted)
            record, compose, env, containers, raw, rendered = guard.preflight('target')
            try:
                with contextlib.redirect_stdout(io.StringIO()): guard.recreate(containers, compose, env, raw, rendered)
            except Exception:
                guard.verify_recovery_context(containers, compose, env)
                with contextlib.redirect_stdout(io.StringIO()): guard.rollback()
                raise p.GateError('analytics_recreate_failed_exact_old_images_and_owned_env_restored')
        else:
            record, compose, env, containers, raw, rendered = guard.preflight('source')
            if action == 'apply':
                if STATE.exists(): require_state(accepted)
                else: private_state(STATE, state_value(accepted))
                with contextlib.redirect_stdout(io.StringIO()): guard.sync_images(record, compose, env, containers, raw, rendered, guard.SOURCE, guard.TARGET)
        if protected_host() != before: raise p.GateError('registration_fence_environment_or_unrelated_containers_changed')
        print('analytics_' + (action or 'preflight') + '_verified; only_api_web_and_owned_GA4_keys; additive_schema_retained')
    if action:
        if shutil.disk_usage('/var/lib/docker').free < p.MIN_FREE: raise p.GateError('release_requires_8GiB_no_automatic_pruning')
        with reviewed.release_lock(): execute()
    else: execute()


if __name__ == '__main__':
    try: main()
    except (p.GateError, guard.GateError, build.backend.GateError) as error: print('release_stopped:' + str(error), file=sys.stderr); sys.exit(1)
    except (ValueError, KeyError, TypeError, OSError, guard.yaml.YAMLError) as error: print('release_stopped:' + type(error).__name__, file=sys.stderr); sys.exit(1)
