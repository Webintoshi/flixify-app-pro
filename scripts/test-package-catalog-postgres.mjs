#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const connectionString = process.env.PACKAGE_CATALOG_TEST_DATABASE_URL;
assert(connectionString, "PACKAGE_CATALOG_TEST_DATABASE_URL is required; no production DATABASE_URL fallback");
const target = new URL(connectionString);
assert(["postgres:", "postgresql:"].includes(target.protocol));
assert(["127.0.0.1", "localhost", "[::1]"].includes(target.hostname), "Fixture must use isolated loopback");
assert.equal(target.username, "flixify_fixture");
assert.equal(target.pathname, "/flixify_package_catalog_fixture");
assert.equal(target.search, "");

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { Pool } = require("pg");
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });
const migration = await readFile(new URL("../supabase/migrations/202611010001_single_dual_packages.sql", import.meta.url), "utf8");
const expected = [
  ["1-ay", "1 Ay · Tek Kullanıcı", "1m", 1, "250 ₺"],
  ["6-ay", "6 Ay · Tek Kullanıcı", "6m", 6, "699 ₺"],
  ["12-ay", "12 Ay · Tek Kullanıcı", "12m", 12, "999 ₺"],
  ["1-ay-2-kullanici", "1 Ay · Çift Kullanıcı", "1m", 1, "399 ₺"],
  ["6-ay-2-kullanici", "6 Ay · Çift Kullanıcı", "6m", 6, "999 ₺"],
  ["12-ay-2-kullanici", "12 Ay · Çift Kullanıcı", "12m", 12, "1.399 ₺"]
];
const passed = [];
async function check(name, run) { await run(); passed.push(name); }
async function migrate() {
  const client = await pool.connect();
  try { await client.query(migration); }
  catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
async function packages() { return (await pool.query("select * from public.packages order by slug")).rows; }
async function retainedState() {
  const state = {};
  for (const table of ["users", "subscriptions", "payment_requests", "user_iptv_credentials", "provider_entitlement_sync"]) {
    state[table] = (await pool.query(`select * from public.${table} order by id`)).rows;
  }
  return state;
}

try {
  assert.deepEqual((await pool.query("select current_database() as database, current_user as role")).rows[0],
    { database: "flixify_package_catalog_fixture", role: "flixify_fixture" });
  assert.equal((await pool.query("select count(*)::integer as n from pg_tables where schemaname='public'")).rows[0].n, 0,
    "Fixture database must be empty; refusing existing tables");
  await pool.query(`
    create function public.set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = clock_timestamp(); return new; end; $$;
    create table public.packages (
      id uuid primary key default gen_random_uuid(), slug text unique not null, title text not null,
      duration text not null check(duration in ('1m','3m','6m','12m')),
      duration_months integer not null check(duration_months in (1,3,6,12)), price_label text,
      is_active boolean not null default true,
      created_at timestamptz not null default '2026-03-13T00:00:00Z',
      updated_at timestamptz not null default '2026-03-13T00:00:00Z'
    );
    create trigger packages_set_updated_at before update on public.packages for each row execute function public.set_updated_at();
    alter table public.packages enable row level security;
    create table public.users (id uuid primary key default gen_random_uuid(), status text not null, notes text);
    create table public.subscriptions (
      id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id),
      package_id uuid references public.packages(id) on delete restrict, status text,
      starts_at timestamptz, ends_at timestamptz, activated_by_admin_id text, end_reason text
    );
    create table public.payment_requests (
      id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id),
      package_id uuid references public.packages(id) on delete restrict, status text, note text
    );
    create table public.user_iptv_credentials (
      id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id), username text, password text
    );
    create table public.provider_entitlement_sync (
      id uuid primary key default gen_random_uuid(), user_id uuid references public.users(id),
      subscription_id uuid references public.subscriptions(id), provider_line_id text, next_attempt_at timestamptz
    );
    insert into public.packages(slug,title,duration,duration_months,price_label,is_active) values
      ('1-ay','1 Ay','1m',1,'249 TL',true), ('3-ay','3 Ay','3m',3,'640 TL',true),
      ('6-ay','6 Ay','6m',6,'990 TL',true), ('12-ay','12 Ay','12m',12,'1.600 TL',true),
      ('6-ay-2-kullanici','Old dual label','6m',6,'1 TL',false),
      ('provider-managed','Sağlayıcı Paketi','1m',1,null,false),
      ('trial-internal','Internal trial','1m',1,null,false),
      ('historical-custom','Historical custom','12m',12,'Historical',false);
    insert into public.users(status,notes) values ('active','fixture-retained-user');
    insert into public.subscriptions(user_id,package_id,status,starts_at,ends_at,activated_by_admin_id,end_reason)
      select u.id,p.id,'active','2026-10-01T00:00:00Z','2027-01-01T00:00:00Z','fixture-admin',null
      from public.users u cross join public.packages p where p.slug='3-ay';
    insert into public.payment_requests(user_id,package_id,status,note)
      select u.id,p.id,'pending-review','fixture-retained-payment' from public.users u cross join public.packages p where p.slug='3-ay';
    insert into public.user_iptv_credentials(user_id,username,password)
      select id,'fixture-only-line','fixture-only-password' from public.users;
    insert into public.provider_entitlement_sync(user_id,subscription_id,provider_line_id,next_attempt_at)
      select user_id,id,'12345','2026-11-01T12:00:00Z' from public.subscriptions;
  `);

  const beforePackages = await packages();
  const beforeState = await retainedState();

  await check("catalog publication is atomic when an insert fails", async () => {
    await pool.query("alter table public.packages add constraint fixture_reject_dual check (price_label is distinct from '399 ₺')");
    await assert.rejects(migrate(), (error) => error.code === "23514");
    assert.deepEqual(await packages(), beforePackages);
    assert.deepEqual(await retainedState(), beforeState);
    await pool.query("alter table public.packages drop constraint fixture_reject_dual");
  });
  await migrate();
  const first = await packages();

  await check("publishes only the six requested sale variants at their exact total prices", async () => {
    const active = first.filter((row) => row.is_active);
    assert.equal(active.length, 6);
    for (const [slug, title, duration, durationMonths, price] of expected) {
      const row = active.find((item) => item.slug === slug);
      assert(row, `Missing ${slug}`);
      assert.deepEqual([row.slug,row.title,row.duration,row.duration_months,row.price_label], [slug,title,duration,durationMonths,price]);
    }
  });
  await check("preserves existing single and dual IDs and creation dates", async () => {
    for (const old of beforePackages) {
      const current = first.find((row) => row.slug === old.slug);
      assert(current);
      assert.equal(current.id, old.id);
      assert.equal(current.created_at.toISOString(), old.created_at.toISOString());
    }
  });
  await check("retires the three month sales row while preserving all references and entitlements", async () => {
    const old = beforePackages.find((row) => row.slug === "3-ay");
    const current = first.find((row) => row.slug === "3-ay");
    assert.equal(current.is_active, false);
    for (const column of ["id", "slug", "title", "duration", "duration_months", "price_label"]) assert.equal(current[column], old[column]);
    assert.deepEqual(await retainedState(), beforeState);
  });
  await check("does not change trial neutral or unrelated historical package rows", async () => {
    for (const slug of ["provider-managed", "trial-internal", "historical-custom"]) {
      assert.deepEqual(first.find((row) => row.slug === slug), beforePackages.find((row) => row.slug === slug));
    }
  });
  await check("keeps package row level security enabled", async () => {
    assert.equal((await pool.query("select relrowsecurity from pg_class where oid='public.packages'::regclass")).rows[0].relrowsecurity, true);
  });
  await check("second application changes neither rows nor updated timestamps", async () => {
    await migrate();
    assert.deepEqual(await packages(), first);
    assert.deepEqual(await retainedState(), beforeState);
  });
  console.log(JSON.stringify({ fixture: "isolated-postgresql", passed: passed.length, cases: passed, customerAccountsCreated: 0 }));
} finally { await pool.end(); }
