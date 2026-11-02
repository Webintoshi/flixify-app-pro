#!/usr/bin/env python3
"""Apply only the pinned additive analytics migration; default inspects without SQL writes."""
from __future__ import annotations
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import policy as p
import build
RECEIPT = Path('/data/coolify/services') / p.UUID / '.analytics-20261102-migration.json'
TABLES = ('analytics_consents', 'analytics_checkout_attribution', 'analytics_outbox')


def validate_sql(sql):
    if not isinstance(sql, str) or not 1 <= len(sql.encode()) <= 65536 or '\x00' in sql: raise p.GateError('bounded_migration_sql_required')
    without_fk_actions = re.sub(r'\bon\s+delete\s+cascade\b', '', sql, flags=re.I)
    if re.search(r'\b(drop|truncate|delete|insert|update|copy|grant)\b', without_fk_actions, re.I): raise p.GateError('destructive_or_data_migration_refused')
    for name in re.findall(r'\bpublic\.([a-z_][a-z0-9_]*)', sql, re.I):
        if name not in {*TABLES, 'users', 'stripe_checkout_sessions'}: raise p.GateError('migration_relation_outside_analytics_scope')
    for name in re.findall(r'\b(?:alter\s+table|create\s+table\s+if\s+not\s+exists)\s+public\.([a-z_][a-z0-9_]*)', sql, re.I):
        if name not in TABLES: raise p.GateError('migration_may_change_only_three_analytics_tables')
    if not re.match(r'\s*begin\s*;', sql, re.I) or not re.search(r'commit\s*;\s*$', sql, re.I): raise p.GateError('bounded_transaction_required')


NODE = r'''
const fs=require('node:fs'),crypto=require('node:crypto'),{Client}=require('pg');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const db=new URL(process.env.DATABASE_URL||'');
if(!['postgres:','postgresql:'].includes(db.protocol)||!['db','db-eupquokyj7qegufqvqkjmuyr'].includes(db.hostname)||!['','5432'].includes(db.port))throw Error('database_context');
const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000,application_name:'flixify-analytics-additive-release'});
const tables=['analytics_consents','analytics_checkout_attribution','analytics_outbox'];
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function snapshot(){
 const result=await client.query(`select c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,
 coalesce((select json_agg(json_build_array(a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'[]'::json) as columns,
 coalesce((select json_agg(json_build_array(x.conname,x.contype,pg_get_constraintdef(x.oid)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),'[]'::json) as constraints,
 coalesce((select json_agg(json_build_array(i.indexname,i.indexdef) order by i.indexname) from pg_indexes i where i.schemaname='public' and i.tablename=c.relname),'[]'::json) as indexes
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S','f') order by c.relname`);
 const own=result.rows.filter(x=>tables.includes(x.relname));
 if(result.rows.some(x=>x.relname.startsWith('analytics_')&&!tables.includes(x.relname)))throw Error('unknown_analytics_relation');
 return {own,analyticsSchemaSha256:hash(own),unrelatedSchemaSha256:hash(result.rows.filter(x=>!tables.includes(x.relname)))};
}
async function validate(s){
 const columns={analytics_consents:['user_id','client_id','consent_version','accepted','updated_at'],analytics_checkout_attribution:['operation_id','user_id','client_id','session_id','client_platform','source_platform','consent_version','revoked_at','purchase_recorded_at','activation_recorded_at','updated_at'],analytics_outbox:['event_key','user_id','client_id','session_id','stream','event_name','event_timestamp_ms','params','state','attempts','next_attempt_at','lease_until','lease_token','created_at','delivered_at']};
 if(s.own.length!==3)throw Error('migration_tables_missing');
 for(const row of s.own){if(row.relkind!=='r'||row.relrowsecurity!==true||JSON.stringify(row.columns.map(x=>x[0]))!==JSON.stringify(columns[row.relname])||row.constraints.length<2)throw Error('analytics_schema_shape');}
 const publicAcl=await client.query("select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname='public' and c.relname=any($1::text[]) and a.grantee=0) as allowed",[tables]);if(publicAcl.rows[0].allowed)throw Error('analytics_public_privileges');
 for(const role of (await client.query("select rolname from pg_roles where rolname in ('anon','authenticated')")).rows){for(const table of tables){const q=await client.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed",[role.rolname,'public.'+table]);if(q.rows[0].allowed)throw Error('analytics_role_privileges');}}
}
(async()=>{await client.connect();try{
 const before=await snapshot();
 if(input.apply){
  if(before.own.length!==0&&!input.existingReceipt)throw Error('unowned_existing_analytics_schema');
  await client.query(input.sql);const first=await snapshot();await validate(first);
  if(first.unrelatedSchemaSha256!==before.unrelatedSchemaSha256)throw Error('unrelated_schema_changed');
  await client.query(input.sql);const second=await snapshot();await validate(second);
  if(JSON.stringify(first)!==JSON.stringify(second))throw Error('migration_not_idempotent');
  console.log(JSON.stringify({analyticsSchemaSha256:second.analyticsSchemaSha256,unrelatedSchemaSha256:second.unrelatedSchemaSha256,repeatedIdempotent:true,tables:tables}));
 }else{
  if(before.own.length)await validate(before);
  console.log(JSON.stringify({analyticsSchemaSha256:before.analyticsSchemaSha256,unrelatedSchemaSha256:before.unrelatedSchemaSha256,tables:before.own.map(x=>x.relname)}));
 }
}finally{await client.end()}})().catch(()=>{console.error('analytics_migration_guard_failed');process.exitCode=1});
'''


def database_snapshot(accepted, *, sql=None, existing=False):
    rows = json.loads(build.command('docker', 'inspect', 'db-' + p.UUID, 'api-' + p.UUID))
    if len(rows) != 2: raise p.GateError('migration_service_context_required')
    for row in rows:
        labels = row.get('Config', {}).get('Labels') or {}
        if not row.get('State', {}).get('Running') or labels.get('com.docker.compose.project') != p.UUID: raise p.GateError('migration_service_context_drift')
    if rows[0]['Image'] != p.DB_ID or rows[0]['Name'] != '/db-' + p.UUID: raise p.GateError('migration_pinned_database_required')
    api = rows[1]
    if api['Image'] != p.API_ID:
        image = build.core.image(api['Image']); labels = image.get('Config', {}).get('Labels') or {}
        if labels.get('org.opencontainers.image.revision') != accepted['revision'] or labels.get('vip.flixify.edge-recovery.base') != p.API_ID: raise p.GateError('migration_api_context_drift')
    payload = json.dumps({'sql': sql, 'apply': sql is not None, 'existingReceipt': existing}).encode()
    result = subprocess.run(['docker','exec','-i','api-' + p.UUID,'node','-e',NODE], input=payload, capture_output=True, timeout=100)
    if result.returncode: raise p.GateError('additive_migration_database_inspection_or_apply_failed')
    try: return json.loads(result.stdout)
    except (ValueError, UnicodeError): raise p.GateError('migration_result_invalid') from None


def read_receipt(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid() or info.st_size > 65536: raise p.GateError('owned_private_migration_receipt_required')
    return json.loads(path.read_bytes())


def verify_receipt(path, accepted):
    receipt = read_receipt(path)
    if (set(receipt) != {'schema','migrationVersion','migrationSha256','dbImageId','analyticsSchemaSha256','unrelatedSchemaSha256','repeatedIdempotent'} or receipt['schema'] != 1 or receipt['migrationVersion'] != '202611020001' or receipt['migrationSha256'] != accepted['migrationSha256'] or receipt['dbImageId'] != p.DB_ID or receipt['repeatedIdempotent'] is not True): raise p.GateError('accepted_migration_version_receipt_required')
    current = database_snapshot(accepted)
    if set(current['tables']) != set(TABLES) or any(receipt[key] != current[key] for key in ('analyticsSchemaSha256','unrelatedSchemaSha256')): raise p.GateError('installed_migration_schema_drift')
    return receipt


def parser():
    value = argparse.ArgumentParser(description=__doc__)
    value.add_argument('source_repo', type=Path)
    value.add_argument('--pins', type=Path, default=HERE / 'release-pins.json')
    value.add_argument('--postgres-proof', type=Path)
    value.add_argument('--receipt', type=Path, default=RECEIPT)
    value.add_argument('--apply', action='store_true')
    return value


def main(argv=None):
    args = parser().parse_args(argv)
    accepted = p.pins(json.loads(args.pins.read_bytes()))
    import release
    release.require_postgres_proof(args.postgres_proof, accepted)
    sql = build.read_blob(args.source_repo, accepted['revision'], p.MIGRATION).decode()
    if p.digest(sql.encode()) != accepted['migrationSha256']: raise p.GateError('migration_digest_mismatch')
    validate_sql(sql)
    if not args.apply:
        if args.receipt.exists(): verify_receipt(args.receipt, accepted)
        else:
            current = database_snapshot(accepted)
            if current['tables']: raise p.GateError('existing_schema_without_owned_version_receipt')
        print('analytics_migration_preflight_ok; no_sql_writes'); return
    with release.reviewed.release_lock():
        before = release.protected_host()
        existing = args.receipt.exists()
        if existing: verify_receipt(args.receipt, accepted)
        current = database_snapshot(accepted, sql=sql, existing=existing)
        receipt = {'schema':1,'migrationVersion':'202611020001','migrationSha256':accepted['migrationSha256'],'dbImageId':p.DB_ID,'analyticsSchemaSha256':current['analyticsSchemaSha256'],'unrelatedSchemaSha256':current['unrelatedSchemaSha256'],'repeatedIdempotent':True}
        if existing:
            if read_receipt(args.receipt) != receipt: raise p.GateError('existing_migration_receipt_differs')
        else: release.private_state(args.receipt, receipt)
        verify_receipt(args.receipt, accepted)
        if release.protected_host() != before: raise p.GateError('migration_changed_existing_host_or_environment')
    print('analytics_migration_applied_twice_identical; three_new_RLS_tables_only; version_receipt_verified')


if __name__ == '__main__':
    try: main()
    except (p.GateError, build.backend.GateError) as error: print('migration_stopped:' + str(error), file=sys.stderr); sys.exit(1)
    except (ValueError, KeyError, TypeError, OSError, subprocess.TimeoutExpired) as error: print('migration_stopped:' + type(error).__name__, file=sys.stderr); sys.exit(1)
