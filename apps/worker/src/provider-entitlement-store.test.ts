import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { createProviderEntitlementStore } from './provider-entitlement-store.js';
import type { ProviderEntitlement } from './provider-entitlement.js';
// Intentionally no DATABASE_URL fallback. Only an empty, dedicated, loopback test database is accepted.
const connectionString = process.env.PROVIDER_SYNC_TEST_DATABASE_URL;
if (connectionString) {
    const url = new URL(connectionString);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/flixify_provider_sync_test(?:_[a-z0-9]+)?$/.test(url.pathname))
        throw Error('Refusing non-local or non-test provider sync database');
}
describe.skipIf(!connectionString)('real PostgreSQL provider entitlement store', () => {
    const pool = new Pool({ connectionString, max: 4 });
    const store = createProviderEntitlementStore(pool);
    let fixtureOwned = false;
    let userId: string;
    let credentialId: string;
    const future = () => new Date(Date.now() + 86400000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    const line = (overrides: Partial<ProviderEntitlement> = {}): ProviderEntitlement => ({ lineId: '123', username: 'alice', password: 'secret', packageId: '8', isTrial: false, enabled: true, adminEnabled: true, expiresAt: future(), ...overrides });
    async function claim() { await store.discover(); const jobs = await store.claim(); expect(jobs).toHaveLength(1); return jobs[0]; }
    async function again() { await pool.query('update public.provider_entitlement_sync set next_attempt_at=now()'); return claim(); }
    async function subscriptions() { return (await pool.query('select * from public.subscriptions order by created_at,id')).rows; }
    beforeAll(async () => {
        const tables = await pool.query("select tablename from pg_tables where schemaname='public'");
        if (tables.rows.length)
            throw Error('Provider sync fixture requires an empty public schema');
        fixtureOwned = true;
        await pool.query(`create table public.users(id uuid primary key default gen_random_uuid(),status text not null default 'new',deleted_at timestamptz);
   create table public.user_iptv_credentials(id uuid primary key default gen_random_uuid(),user_id uuid unique references public.users(id),username text,password text,updated_at timestamptz default now());
   create table public.app_settings(id boolean primary key,shared_source_reference_username text,shared_source_reference_password text);
   create table public.packages(id uuid primary key default gen_random_uuid(),slug text unique,title text,duration text,duration_months integer,is_active boolean default true);
   create table public.subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid references public.users(id),package_id uuid references public.packages(id),status text check(status in('active','expired','cancelled')),starts_at timestamptz,ends_at timestamptz,activated_by_admin_id text,end_reason text,created_at timestamptz default now());
   create table public.admin_audit_logs(id uuid primary key default gen_random_uuid(),admin_id text,action text,entity_type text,entity_id text,payload jsonb);
   insert into public.app_settings values(true,'shared','shared-secret');
   insert into public.packages(slug,title,duration,duration_months) values('1-ay','1 Ay','1m',1),('3-ay','3 Ay','3m',3),('6-ay','6 Ay','6m',6),('12-ay','12 Ay','12m',12);`);
        await pool.query(await readFile(new URL('../../../supabase/migrations/202610260001_provider_entitlement_sync.sql', import.meta.url), 'utf8'));
    });
    beforeEach(async () => {
        await pool.query('truncate public.provider_entitlement_sync,public.admin_audit_logs,public.subscriptions,public.user_iptv_credentials,public.users cascade');
        userId = (await pool.query('insert into public.users default values returning id')).rows[0].id;
        credentialId = (await pool.query("insert into public.user_iptv_credentials(user_id,username,password,updated_at) values($1,'alice','secret','2026-10-26T12:00:00.123456Z') returning id", [userId])).rows[0].id;
    });
    afterAll(async () => {
        if (fixtureOwned)
            await pool.query('drop table if exists public.provider_entitlement_sync,public.admin_audit_logs,public.subscriptions,public.user_iptv_credentials,public.users,public.packages,public.app_settings cascade');
        await pool.end();
    });
    it('upgrades expired trial, preserves trial history and uses exact expiry; repeat is audit-idempotent', async () => {
        await pool.query("insert into public.subscriptions(user_id,package_id,status,starts_at,ends_at,activated_by_admin_id,end_reason) select $1,id,'expired',now()-interval '4 hours',now()-interval '1 hour','auto-trial','trial-3h' from public.packages where slug='1-ay'", [userId]);
        await store.apply(await claim(), line());
        expect(await subscriptions()).toHaveLength(2);
        const audit = (await pool.query('select count(*)::int n from public.admin_audit_logs')).rows[0].n;
        await store.apply(await again(), line());
        expect((await pool.query('select count(*)::int n from public.admin_audit_logs')).rows[0].n).toBe(audit);
        expect((await subscriptions()).find((s: {
            activated_by_admin_id: string;
            end_reason: string;
        }) => s.activated_by_admin_id === 'auto-trial').end_reason).toBe('trial-3h');
    });
    it('retains active trial marker on paid upgrade and on disabled first paid observation', async () => {
        for(const enabled of [true,false]) {
            await pool.query('truncate public.provider_entitlement_sync,public.admin_audit_logs,public.subscriptions');
            await pool.query("insert into public.subscriptions(user_id,package_id,status,starts_at,ends_at,activated_by_admin_id,end_reason) select $1,id,'active',now()-interval '1 hour',now()+interval '2 hours','auto-trial','trial-3h' from public.packages where slug='1-ay'",[userId]);
            await store.apply(await claim(),line({enabled}));
            expect((await pool.query("select exists(select 1 from public.subscriptions where user_id=$1 and end_reason='trial-3h') as has_used_trial",[userId])).rows[0].has_used_trial).toBe(true);
            expect((await subscriptions()).find((s:{activated_by_admin_id:string})=>s.activated_by_admin_id==='auto-trial').end_reason).toBe('trial-3h');
        }
    });
    it('extends, shortens, expires, disables and re-enables the same managed record', async () => {
        await store.apply(await claim(), line());
        const id = (await subscriptions())[0].id;
        for (const ms of [172800000, 3600000]) {
            const expiresAt = new Date(Date.now() + ms).toISOString();
            await store.apply(await again(), line({ expiresAt }));
            expect(new Date((await subscriptions())[0].ends_at).toISOString()).toBe(expiresAt);
        }
        await store.apply(await again(), line({ expiresAt: '2020-01-01T00:00:00.000Z' }));
        expect((await subscriptions())[0].status).toBe('expired');
        await store.apply(await again(), line());
        await store.apply(await again(), line({ enabled: false }));
        expect((await subscriptions())[0].status).toBe('cancelled');
        await store.apply(await again(), line());
        expect((await subscriptions())[0]).toMatchObject({ id, status: 'active' });
    });
    it('never creates or renews trial; paid to trial closes managed access', async () => {
        await store.apply(await claim(), line({ isTrial: true }));
        expect(await subscriptions()).toHaveLength(0);
        await store.apply(await again(), line());
        await store.apply(await again(), line({ isTrial: true }));
        expect((await subscriptions())[0]).toMatchObject({ status: 'cancelled', end_reason: 'provider-trial' });
    });
    it('preserves administrator cancellation and uses inactive neutral package', async () => {
        await store.apply(await claim(), line({ packageId: '999' }));
        expect((await pool.query("select is_active from public.packages where slug='provider-managed'")).rows[0].is_active).toBe(false);
        await pool.query("update public.subscriptions set status='cancelled',end_reason='admin-fraud'");
        await store.apply(await again(), line());
        expect((await subscriptions())[0].end_reason).toBe('admin-fraud');
        expect((await subscriptions())[0].status).toBe('cancelled');
    });
    it('rejects stale lease, credential microsecond version and blocked user at apply', async () => {
        const old = await claim();
        await pool.query('update public.provider_entitlement_sync set lease_until=now()-interval \'1 second\'');
        const fresh = (await store.claim())[0];
        await expect(store.apply(old, line())).rejects.toThrow('SYNC_CONFLICT');
        await pool.query("update public.user_iptv_credentials set updated_at=updated_at+interval '1 microsecond' where id=$1", [credentialId]);
        await expect(store.apply(fresh, line())).rejects.toThrow('SYNC_CONFLICT');
        expect(await subscriptions()).toHaveLength(0);
        const job = await claim();
        await pool.query("update public.users set status='blocked'");
        await expect(store.apply(job, line())).rejects.toThrow('SYNC_CONFLICT');
    });
    it('excludes duplicate pair, reference identity, deleted and blocked accounts', async () => {
        const other = (await pool.query('insert into public.users default values returning id')).rows[0].id;
        await pool.query("insert into public.user_iptv_credentials(user_id,username,password) values($1,'alice','secret')", [other]);
        await store.discover();
        expect(await store.claim()).toHaveLength(0);
        await pool.query('delete from public.user_iptv_credentials where user_id=$1', [other]);
        for (const sql of ["update public.user_iptv_credentials set username='shared'", "update public.users set status='blocked'", "update public.users set deleted_at=now()"]) {
            await pool.query(sql);
            await store.discover();
            expect(await store.claim()).toHaveLength(0);
        }
    });
    it('preserves admin cancellation across credential versions of the same verified line', async () => {
        await store.apply(await claim(), line());
        const id = (await subscriptions())[0].id;
        await pool.query("update public.subscriptions set status='cancelled',end_reason='admin-fraud'");
        await pool.query("update public.user_iptv_credentials set updated_at=updated_at+interval '1 microsecond'");
        await store.apply(await claim(), line());
        expect(await subscriptions()).toHaveLength(1);
        expect((await subscriptions())[0]).toMatchObject({ id, status: 'cancelled', end_reason: 'admin-fraud' });
    });
    it.each([
        { label: 'trial', observation: { isTrial: true }, status: 'cancelled', reason: 'provider-trial' },
        { label: 'disabled', observation: { enabled: false }, status: 'cancelled', reason: 'provider-disabled' },
        { label: 'expired', observation: { expiresAt: '2020-01-01T00:00:00.000Z' }, status: 'expired', reason: 'provider-expired' }
    ])('closes transferred paid ownership immediately on $label observation', async ({ observation, status, reason }) => {
        await store.apply(await claim(), line());
        const id = (await subscriptions())[0].id;
        await pool.query("update public.user_iptv_credentials set updated_at=updated_at+interval '1 microsecond'");
        const job = await claim();
        const observed = line({ expiresAt: new Date(Date.now() + 3600000).toISOString(), ...observation });
        await store.apply(job, observed);
        const rows = await subscriptions();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id, status, end_reason: reason });
        expect(new Date(rows[0].ends_at).toISOString()).toBe(observed.expiresAt);
        const mappings = (await pool.query('select id,provider_line_id,subscription_id from public.provider_entitlement_sync order by created_at,id')).rows;
        expect(mappings.find((row: { id: string }) => row.id === job.id)).toMatchObject({ provider_line_id: observed.lineId, subscription_id: id });
        expect(mappings.filter((row: { subscription_id: string | null }) => row.subscription_id === id)).toHaveLength(1);
    });
    it('closes conflicting active history and verifies RLS and unique line constraints', async () => {
        await pool.query("insert into public.subscriptions(user_id,package_id,status,starts_at,ends_at,activated_by_admin_id) select $1,id,'active',now(),now()+interval '1 month','admin' from public.packages where slug='1-ay'", [userId]);
        await store.apply(await claim(), line());
        expect((await subscriptions()).filter((s: {
            status: string;
        }) => s.status === 'active')).toHaveLength(1);
        expect((await subscriptions()).find((s: {
            activated_by_admin_id: string;
        }) => s.activated_by_admin_id === 'admin').end_reason).toBe('provider-replaced');
        expect((await pool.query("select relrowsecurity from pg_class where oid='public.provider_entitlement_sync'::regclass")).rows[0].relrowsecurity).toBe(true);
        await expect(pool.query("insert into public.provider_entitlement_sync(user_id,credential_id,credential_version,provider_line_id) values($1,$2,'other','123')", [userId, credentialId])).rejects.toMatchObject({ code: '23505' });
    });
    it('leases distinct jobs across concurrent claimers, retains known success after failure', async () => {
        await store.discover();
        const groups = await Promise.all([store.claim(), store.claim()]);
        expect(groups.flat()).toHaveLength(1);
        const job = groups.flat()[0];
        await store.apply(job, line());
        const next = await again();
        await store.fail(next, 'PROVIDER_UNAVAILABLE');
        const state = (await pool.query('select * from public.provider_entitlement_sync')).rows[0];
        expect(state.last_error).toBe('PROVIDER_UNAVAILABLE');
        expect(state.last_success_at).not.toBeNull();
        expect((await subscriptions())[0].status).toBe('active');
    });
});
