#!/usr/bin/env python3
"""Guarded web-only cutover; preflight, metadata apply and recreation are separate."""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('tv1415_release_build', HERE / 'build-web.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
c = build.c
previous = c.load('tv1415_previous_release', HERE.parent / '2026-11-04-macos-withdrawal/release.py')
reviewed, guard = previous.reviewed, previous.guard
NATIVE, MANIFEST = None, None


def configure(revision, candidate_id, native, manifest):
    global NATIVE, MANIFEST
    c.configure_builder()
    if not isinstance(candidate_id, str) or not re.fullmatch('sha256:[a-f0-9]{64}', candidate_id):
        raise c.GateError('exact_candidate_image_id_required')
    c.parse_manifest(manifest, native)
    NATIVE, MANIFEST = native, manifest
    guard.REVISION, guard.CANDIDATE_ID = revision, candidate_id
    guard.PHP_APPLY = previous.compose_only_php(previous.ORIGINAL_PHP_APPLY)
    guard.CHANGED, guard.PROTECTED = ('ops-web',), ('db', 'api', 'worker')
    guard.SOURCE, guard.SOURCE_IDS = {'ops-web': c.SOURCE_TAG}, {'ops-web': c.SOURCE_ID}
    guard.TARGET = {'ops-web': c.target(revision)}
    guard.PROTECTED_IMAGES = {'api': c.API, 'worker': c.WORKER}
    guard.PROTECTED_DB_IMAGE_ID = c.DB
    guard.PHP_READ_APPLICATIONS = reviewed.READ_APPLICATIONS.replace("['worker']", "['ops-web']")
    script = reviewed.READ_APPLICATIONS.replace("['worker']", "['api', 'worker']")
    guard.protected_application_images = lambda: json.loads(guard.command('docker', 'exec', 'coolify', 'php', '-r', script))
    guard.validate_plan, guard.healthy = reviewed.validate_plan, healthy


def healthy(name, tag, identity=None):
    try:
        row = guard.container_snapshot(allow_missing_changed=True)[name]
        if (name != 'ops-web' or row['tag'] != tag or row['image_id'] != identity or not row['running']
                or row['health'] == 'unhealthy' or row['hash'] != guard.compose_hash(name)):
            return False
        if tag == guard.TARGET['ops-web']:
            script = build.download_script(NATIVE, MANIFEST)
        elif tag == c.SOURCE_TAG:
            # The retained rollback source has 1.4.14, so it cannot satisfy the new APK check.
            script = ('(async()=>{for(const p of ["/","/indir","/paketler","/cihaz","/giris-yap"]){'
                'const r=await fetch("http://127.0.0.1:3000"+p,{redirect:"manual",signal:AbortSignal.timeout(8000)});'
                'if(r.status!==200)throw Error("rollback_page")}})().catch(()=>process.exit(1))')
        else:
            return False
        guard.command('docker', 'exec', 'ops-web-' + guard.UUID, 'node', '-e', script, timeout=160)
        return True
    except Exception:
        return False


def verify_candidate(repo, revision, candidate_id, native, pin):
    base = c.builder.core.image(c.SOURCE_ID)
    if base['Id'] != c.SOURCE_ID or c.builder.core.image(c.SOURCE_TAG)['Id'] != c.SOURCE_ID:
        raise c.GateError('source_image_tag_drift')
    updates, public, config = build.inputs(repo, revision, native, pin)
    verified = build.verify_candidate(revision, base, updates, pin['publicBuildEnv'], config, public, native, pin)
    if verified != candidate_id:
        raise c.GateError('candidate_differs_from_verified_native_publication')
    return updates[c.UPDATE_MANIFEST]


def invoke(action):
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
    print('tv1415_web_' + (action or 'preflight') + '_verified; only_web_changed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--candidate-id', required=True)
    parser.add_argument('--native-proof', type=Path, required=True)
    parser.add_argument('--source-pin', type=Path, required=True)
    actions = parser.add_mutually_exclusive_group()
    for name in ('apply', 'recreate', 'rollback'):
        actions.add_argument('--' + name, action='store_true')
    args = parser.parse_args()
    c.configure_builder()
    c.target(args.revision)
    native, pin = c.proof(args.native_proof.read_bytes()), build.source_pin(args.source_pin.read_bytes())
    action = 'rollback' if args.rollback else 'recreate' if args.recreate else 'apply' if args.apply else None
    with reviewed.release_lock():
        # Rollback remains available at low disk and never depends on a healthy candidate.
        if action == 'rollback':
            manifest = build.bounded_blob(args.repo, args.revision, c.UPDATE_MANIFEST, 65536)
        else:
            build.require_disk({'hostReserveBytes': c.HOST_RESERVE_BYTES})
            before = c.protected_host()
            manifest = verify_candidate(args.repo, args.revision, args.candidate_id, native, pin)
            if c.protected_host() != before:
                raise c.GateError('protected_host_changed_during_candidate_verification')
        configure(args.revision, args.candidate_id, native, manifest)
        invoke(action)


if __name__ == '__main__':
    main()
