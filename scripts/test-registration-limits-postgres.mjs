#!/usr/bin/env node
// Run only inside a dedicated network-isolated PostgreSQL fixture namespace.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const connectionString = process.env.REGISTRATION_LIMITS_TEST_DATABASE_URL;
assert(connectionString, "REGISTRATION_LIMITS_TEST_DATABASE_URL is required; no production DATABASE_URL fallback");
const target = new URL(connectionString);
assert(["postgres:", "postgresql:"].includes(target.protocol));
assert(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Fixture must be reachable only on shared isolated loopback");
assert.equal(target.username, "flixify_fixture");
assert.equal(target.pathname, "/flixify_registration_limits_fixture");
assert.equal(target.search, "");

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Pool } = require("pg");
const ts = require("typescript");
const source = await readFile(new URL("../apps/api/src/registration-limits.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const policy = await import("data:text/javascript;base64," + Buffer.from(javascript).toString("base64"));
const migration = await readFile(new URL("../supabase/migrations/202610310001_registration_lifetime_limits.sql", import.meta.url), "utf8");
const secret = "fixture-only-registration-guard-secret-0123456789";
const pool = new Pool({ connectionString, max: 12, connectionTimeoutMillis: 5000 });
const passed = [];

async function check(name, run) { await run(); passed.push(name); }
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('flixify.registration_guard_secret', $1, true)", [secret]);
    await client.query(migration);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
async function register(installationId, requestIp, failAfterUser = false) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await policy.claimRegistrationSlots(client, { installationId, requestIp, guardSecret: secret });
    const userId = "fixture-" + randomUUID();
    await client.query("insert into public.users(id, registration_installation_id) values ($1, $2)", [userId, installationId]);
    if (failAfterUser) throw new Error("fixture-job-failure");
    await client.query("insert into public.auto_trial_provision_jobs(user_id) values ($1)", [userId]);
    await client.query("commit");
    return userId;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
async function quota(ip) {
  return (await pool.query("select count from public.registration_ip_lifetime_quota where ip_hash=$1", [policy.registrationIpHash(ip, secret)])).rows[0]?.count;
}
async function claim(id) {
  return (await pool.query("select count(*)::integer as n from public.registration_installation_claims where installation_hash=$1", [policy.registrationInstallationHash(id, secret)])).rows[0].n;
}

try {
  const identity = (await pool.query("select current_database() as database, current_user as role")).rows[0];
  assert.deepEqual(identity, { database: "flixify_registration_limits_fixture", role: "flixify_fixture" });
  assert.equal((await pool.query("select count(*)::integer as n from pg_tables where schemaname='public'")).rows[0].n, 0, "Fixture database must be empty; refusing existing tables");
  await pool.query(`
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create role anon;
    create role authenticated;
    create table public.users (
      id text primary key, registration_installation_id text,
      created_at timestamptz not null default now(), deleted_at timestamptz
    );
    create unique index idx_users_registration_installation_active_unique
      on public.users(registration_installation_id)
      where registration_installation_id is not null and deleted_at is null;
    create table public.registration_trial_ip_quota (
      ip_hash text primary key, window_started_at timestamptz not null default now(), count integer not null
    );
    create table public.auto_trial_provision_jobs (user_id text unique references public.users(id) on delete cascade);
    alter default privileges in schema public grant all on tables to anon, authenticated;
    insert into public.users(id, registration_installation_id, deleted_at) values
      ('seed-active', 'installation-seed-active', null),
      ('seed-deleted', 'installation-seed-deleted', now()),
      ('seed-history-duplicate', 'installation-seed-deleted', now());
  `);
  await pool.query("insert into public.registration_trial_ip_quota(ip_hash,count) values ($1,1),($2,7),($3,0)", [policy.registrationIpHash("198.51.100.10", secret), policy.registrationIpHash("198.51.100.20", secret), policy.registrationIpHash("198.51.100.30", secret)]);
  const usersBefore = (await pool.query("select * from public.users order by id")).rows;
  const oldQuotaBefore = (await pool.query("select * from public.registration_trial_ip_quota order by ip_hash")).rows;

  await check("migration preserves accounts and seeds all retained installation IDs plus only known IP counts", async () => {
    await migrate();
    assert.deepEqual((await pool.query("select * from public.users order by id")).rows, usersBefore);
    assert.deepEqual((await pool.query("select * from public.registration_trial_ip_quota order by ip_hash")).rows, oldQuotaBefore);
    assert.equal(await quota("198.51.100.10"), 1);
    assert.equal(await quota("198.51.100.20"), 2);
    assert.equal(await quota("198.51.100.30"), undefined);
    assert.equal(await claim("installation-seed-active"), 1);
    assert.equal(await claim("installation-seed-deleted"), 1);
    assert.equal((await pool.query("select count(*)::integer as n from public.registration_installation_claims")).rows[0].n, 2);
  });
  await check("claim tables retain RLS and deny fixture public roles", async () => {
    for (const table of ["registration_ip_lifetime_quota", "registration_installation_claims"]) {
      assert.equal((await pool.query("select relrowsecurity from pg_class where oid=$1::regclass", ["public." + table])).rows[0].relrowsecurity, true);
      for (const role of ["anon", "authenticated"]) assert.equal((await pool.query("select has_table_privilege($1,$2,'select') as allowed", [role, "public." + table])).rows[0].allowed, false);
    }
  });
  await check("deleted historical installation cannot register again or consume a new IP slot", async () => {
    await assert.rejects(register("installation-seed-deleted", "203.0.113.9"), policy.RegistrationInstallationLimitError);
    assert.equal(await quota("203.0.113.9"), undefined);
  });
  await check("parallel distinct devices on the same IP commit exactly two accounts and two jobs", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => register("installation-parallel-ip-" + i, "203.0.113.40")));
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(accepted.length, 2);
    assert.equal(rejected.length, 6);
    assert(rejected.every((result) => result.reason instanceof policy.AutoTrialRegistrationRateLimitError));
    assert.equal(await quota("203.0.113.40"), 2);
    assert.equal((await pool.query("select count(*)::integer as n from public.users where registration_installation_id like 'installation-parallel-ip-%'")).rows[0].n, 2);
    assert.equal((await pool.query("select count(*)::integer as n from public.auto_trial_provision_jobs j join public.users u on u.id=j.user_id where u.registration_installation_id like 'installation-parallel-ip-%'")).rows[0].n, 2);
  });
  await check("parallel requests for one installation commit once across different IPs", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => register("installation-parallel-once", "203.0.113." + (80 + i))));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(rejected.length, 7);
    assert(rejected.every((result) => result.reason instanceof policy.RegistrationInstallationLimitError));
    assert.equal((await pool.query("select sum(count)::integer as n from public.registration_ip_lifetime_quota where ip_hash = any($1::text[])", [Array.from({ length: 8 }, (_, i) => policy.registrationIpHash("203.0.113." + (80 + i), secret))])).rows[0].n, 1);
  });
  await check("failed user-job transaction releases both claims so a retry can succeed", async () => {
    await assert.rejects(register("installation-job-rollback", "203.0.113.110", true), /fixture-job-failure/);
    assert.equal(await quota("203.0.113.110"), undefined);
    assert.equal(await claim("installation-job-rollback"), 0);
    assert.equal((await pool.query("select count(*)::integer as n from public.users where registration_installation_id='installation-job-rollback'")).rows[0].n, 0);
    await register("installation-job-rollback", "203.0.113.110");
    assert.equal(await quota("203.0.113.110"), 1);
  });
  await check("exhausted IP failure does not consume a device claim", async () => {
    await assert.rejects(register("installation-after-full-ip", "203.0.113.40"), policy.AutoTrialRegistrationRateLimitError);
    assert.equal(await claim("installation-after-full-ip"), 0);
    await register("installation-after-full-ip", "203.0.113.111");
    assert.equal(await claim("installation-after-full-ip"), 1);
  });
  await check("old timestamps and legacy daily cleanup cannot reset the permanent IP counter", async () => {
    await pool.query("update public.registration_ip_lifetime_quota set created_at=now()-interval '20 years',updated_at=now()-interval '20 years' where ip_hash=$1", [policy.registrationIpHash("203.0.113.40", secret)]);
    await pool.query("delete from public.registration_trial_ip_quota");
    await assert.rejects(register("installation-no-expiry-reset", "203.0.113.40"), policy.AutoTrialRegistrationRateLimitError);
    assert.equal(await quota("203.0.113.40"), 2);
  });
  await check("hard deletion of an account does not release its lifetime installation claim", async () => {
    const id = await register("installation-delete-proof", "203.0.113.112");
    await pool.query("delete from public.users where id=$1", [id]);
    await assert.rejects(register("installation-delete-proof", "203.0.113.113"), policy.RegistrationInstallationLimitError);
    assert.equal(await quota("203.0.113.113"), undefined);
    assert.equal(await quota("203.0.113.112"), 1);
  });
  await check("reapplying the migration never reduces or expires existing permanent counts", async () => {
    const before = (await pool.query("select * from public.registration_ip_lifetime_quota order by ip_hash")).rows;
    await migrate();
    assert.deepEqual((await pool.query("select * from public.registration_ip_lifetime_quota order by ip_hash")).rows, before);
  });
  console.log(JSON.stringify({ fixture: "isolated-postgresql", passed: passed.length, cases: passed, customerAccountsCreated: 0 }));
} finally { await pool.end(); }
