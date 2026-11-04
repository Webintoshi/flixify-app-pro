#!/usr/bin/env python3
"""Web-only guarded rollout of the Mac website withdrawal candidate."""
import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shutil

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('mac_withdrawal_release_common', HERE / 'common.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
reviewed = c.load('mac_withdrawal_reviewed_transaction', HERE.parent / '2026-11-01-packages/release-backend.py')
guard = reviewed.guard
ORIGINAL_PHP_APPLY = guard.PHP_APPLY


def compose_only_php(original):
    anchor = '$service->saveComposeConfigs();'
    if original.count(anchor) != 1:
        raise c.GateError('unique_compose_persistence_anchor_required')
    # The installed vendor method writes Compose, then regenerates .env.
    # Use its exact Compose writer inside the existing database transaction.
    replacement = ("instant_remote_write_file($service->server, "
                   "$service->workdir().'/docker-compose.yml', $service->docker_compose);")
    return original.replace(anchor, replacement)


def configure(revision, candidate_id):
    target = c.target(revision)
    if not isinstance(candidate_id, str) or not re.fullmatch('sha256:[a-f0-9]{64}', candidate_id):
        raise c.GateError('exact_candidate_id_required')
    guard.REVISION, guard.CANDIDATE_ID = revision, candidate_id
    guard.PHP_APPLY = compose_only_php(ORIGINAL_PHP_APPLY)
    guard.CHANGED, guard.PROTECTED = ('ops-web',), ('db', 'api', 'worker')
    guard.SOURCE, guard.SOURCE_IDS = {'ops-web': c.SOURCE_TAG}, {'ops-web': c.SOURCE_ID}
    guard.TARGET = {'ops-web': target}
    guard.PROTECTED_IMAGES = {'api': c.API, 'worker': c.WORKER}
    guard.PROTECTED_DB_IMAGE_ID = c.DB
    guard.PHP_READ_APPLICATIONS = reviewed.READ_APPLICATIONS.replace("['worker']", "['ops-web']")
    script = reviewed.READ_APPLICATIONS.replace("['worker']", "['api', 'worker']")
    guard.protected_application_images = lambda: json.loads(guard.command('docker', 'exec', 'coolify', 'php', '-r', script))
    guard.validate_plan = reviewed.validate_plan
    guard.healthy = healthy


def healthy(name, tag, identity=None):
    try:
        row = guard.container_snapshot(allow_missing_changed=True)[name]
        if (name != 'ops-web' or row['tag'] != tag or row['image_id'] != identity
                or not row['running'] or row['health'] == 'unhealthy'
                or row['hash'] != guard.compose_hash(name)):
            return False
        script = ('(async()=>{for(const p of ["/","/indir","/paketler","/cihaz","/giris-yap"]){'
                  'const r=await fetch("http://127.0.0.1:3000"+p,{signal:AbortSignal.timeout(8000)});'
                  'if(r.status!==200)throw Error("health")}})().catch(()=>process.exit(1))')
        guard.command('docker', 'exec', 'ops-web-' + guard.UUID, 'node', '-e', script, timeout=60)
        return True
    except Exception:
        return False


def invoke(action):
    if action != 'rollback':
        c.verify_removed(guard.CANDIDATE_ID)
    before = c.protected_host()
    if action == 'rollback':
        with contextlib.redirect_stdout(io.StringIO()):
            guard.rollback()
    elif action == 'recreate':
        _, compose, env, containers, raw, rendered = guard.preflight('target')
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                guard.recreate(containers, compose, env, raw, rendered)
        except Exception:
            guard.verify_recovery_context(containers, compose, env)
            with contextlib.redirect_stdout(io.StringIO()):
                guard.rollback()
            raise c.GateError('web_cutover_failed_source_restored')
    else:
        record, compose, env, containers, raw, rendered = guard.preflight('source')
        if action == 'apply':
            with contextlib.redirect_stdout(io.StringIO()):
                guard.sync_images(record, compose, env, containers, raw, rendered, guard.SOURCE, guard.TARGET)
    if c.protected_host() != before:
        raise c.GateError('protected_api_worker_database_environment_or_other_project_changed')
    print('mac_withdrawal_' + (action or 'preflight') + '_verified; only_web_changed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--candidate-id', required=True)
    actions = parser.add_mutually_exclusive_group()
    for name in ('apply', 'recreate', 'rollback'):
        actions.add_argument('--' + name, action='store_true')
    args = parser.parse_args()
    configure(args.revision, args.candidate_id)
    action = 'rollback' if args.rollback else 'recreate' if args.recreate else 'apply' if args.apply else None
    if action != 'rollback' and action and shutil.disk_usage('/var/lib/docker').free < c.MIN_CUTOVER_BYTES:
        raise c.GateError('cutover_requires_4GiB_no_pruning')
    with reviewed.release_lock():
        invoke(action)


if __name__ == '__main__':
    main()
