"""Run package/entitlement fixtures without any production database connection."""
import argparse
import json
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

API = 'sha256:24900673833b1e2809ab5de19ac7472e8a4325f545b1d987401c78c08160d6b6'
WORKER = 'sha256:d5b9ab4bd57a09dea9bc5ded2a0769052317485c32d4e476c3b03a0eded064ee'
DB = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
COMMON = ['supabase/migrations/202611010001_single_dual_packages.sql']

def run(*args, **kw):
    result = subprocess.run(args, capture_output=True, text=True, timeout=180, **kw)
    if result.returncode:
        print(result.stdout[-24000:] + result.stderr[-12000:], flush=True)
        raise RuntimeError('isolated_fixture_command_failed')
    return result.stdout

def fixture(repo, kind):
    name = 'flixify-packages-fixture-' + uuid.uuid4().hex[:12]
    database = {'catalog': 'flixify_package_catalog_fixture', 'worker': 'flixify_provider_sync_test_packages', 'payment': 'flixify_package_payment_fixture'}[kind]
    paths = COMMON + (['scripts/test-package-catalog-postgres.mjs'] if kind == 'catalog' else [
        'apps/worker/src/provider-entitlement.ts', 'apps/worker/src/provider-entitlement-store.ts',
        'apps/worker/src/provider-entitlement-store.test.ts', 'supabase/migrations/202610260001_provider_entitlement_sync.sql'])
    if kind == 'payment':
        release = 'coolify/releases/2026-11-01-packages/'
        paths = COMMON + [release + 'billing-vitest.config.ts', 'supabase/migrations/202611010002_package_checkout_catalog.sql']
        paths += [path.relative_to(repo).as_posix() for folder in ['api-source', 'billing-tests'] for path in sorted((repo / release / folder).glob('*.ts'))]
    created = False
    try:
        run('docker', 'run', '-d', '--name', name, '--network', 'none', '--memory', '256m', '--memory-swap', '320m',
            '--pids-limit', '128', '--tmpfs', '/var/lib/postgresql/data:rw,size=192m',
            '-e', 'POSTGRES_USER=flixify_fixture', '-e', 'POSTGRES_PASSWORD=fixture-only', '-e', 'POSTGRES_DB=' + database, DB)
        created = True
        for attempt in range(30):
            probe = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'flixify_fixture', '-d', database], capture_output=True)
            if probe.returncode == 0:
                break
            time.sleep(.3)
        else:
            raise RuntimeError('fixture_postgres_not_ready')
        args = ['docker', 'run', '--rm', '--network', 'container:' + name, '--memory', '512m', '--memory-swap', '640m',
                '--pids-limit', '128', '--workdir', '/app']
        for path in paths:
            source = (repo / path).resolve()
            if not source.is_file() or source.is_symlink():
                raise RuntimeError('fixture_source_missing')
            args += ['-v', str(source) + ':/app/' + path + ':ro']
        key = {'catalog': 'PACKAGE_CATALOG_TEST_DATABASE_URL', 'worker': 'PROVIDER_SYNC_TEST_DATABASE_URL', 'payment': 'PACKAGE_PAYMENT_TEST_DATABASE_URL'}[kind]
        args += ['-e', key + '=postgresql://flixify_fixture:fixture-only@127.0.0.1:5432/' + database,
                 '--entrypoint', 'node', WORKER if kind == 'worker' else API]
        if kind == 'catalog':
            args += ['/app/scripts/test-package-catalog-postgres.mjs']
        elif kind == 'worker':
            args += ['-e', "require('node:child_process').execFileSync('npx',['--no-install','vitest','run','--root','/app','apps/worker/src/provider-entitlement-store.test.ts'],{stdio:'inherit'})"]
        else:
            args += ['-e', "require('node:child_process').execFileSync('npx',['--no-install','vitest','run','--config','coolify/releases/2026-11-01-packages/billing-vitest.config.ts','coolify/releases/2026-11-01-packages/billing-tests/payment-postgres.test.ts'],{stdio:'inherit'})"]
        output = run(*args)
        print(output)
        print('PACKAGES_FIXTURE_OK ' + kind)
    finally:
        if created:
            run('docker', 'rm', '--force', name)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--kind', choices=['catalog', 'worker', 'payment', 'both'], default='both')
    args = parser.parse_args()
    for kind in (['catalog', 'worker'] if args.kind == 'both' else [args.kind]):
        fixture(args.repo, kind)
