import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureStripeBillingSchema } from '../api-source/stripe-billing-schema.js';
import { StripeBillingStore } from '../api-source/stripe-billing-store.js';
import { ensureStripePaymentSchema, StripePaymentStore } from '../api-source/stripe-payment-store.js';
import { SALE_CATALOG_VERSION } from '../api-source/stripe-sales-catalog.js';
import { fulfillPaidCheckout } from '../api-source/stripe-payment.js';
import { saleIds } from './fixtures';

const connectionString = process.env.PACKAGE_PAYMENT_TEST_DATABASE_URL;
if (connectionString) {
  const target = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
      target.username !== 'flixify_fixture' || target.pathname !== '/flixify_package_payment_fixture' || target.search || target.hash) {
    throw new Error('Refusing a non-isolated payment fixture database');
  }
}

describe.skipIf(!connectionString)('real PostgreSQL one-time payment persistence', () => {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  const store = new StripePaymentStore(pool);
  const billing = new StripeBillingStore(pool);
  let userId: string;
  let sequence = 0;
  const credentials = { username: 'fixturepersonal', password: 'fixturepersonalsecret' };
  const expiry = () => new Date(Date.now() + 31 * 86400000);

  async function reservation(slug: keyof typeof saleIds = '1-ay-2-kullanici') {
    sequence += 1;
    const operationId = randomUUID();
    const sessionId = 'cs_test_fixture' + sequence;
    const paymentIntentId = 'pi_fixture' + sequence;
    const customerId = 'cus_fixture' + userId.replaceAll('-', '');
    await pool.query('insert into public.stripe_customers(user_id,stripe_customer_id,livemode) values($1,$2,false) on conflict do nothing', [userId, customerId]);
    await pool.query(`insert into public.stripe_checkout_sessions(operation_id,stripe_session_id,user_id,package_slug,livemode,status,sale_price_id,sale_catalog_version)
      values($1,$2,$3,$4,false,'open',$5,$6)`, [operationId, sessionId, userId, slug, saleIds[slug], SALE_CATALOG_VERSION]);
    return { operationId, sessionId, paymentIntentId, customerId, packageSlug: slug };
  }
  async function ready(slug: keyof typeof saleIds = '1-ay-2-kullanici') {
    const reserved = await reservation(slug);
    expect(await store.enqueue(reserved.sessionId, false)).toBe(true);
    expect(await store.claim(reserved.sessionId)).toMatchObject({ userId, livemode: false });
    await store.bindPaymentIntent(reserved.sessionId, reserved.paymentIntentId);
    return reserved;
  }
  function completion(payment: { paymentIntentId: string; packageSlug: string }, overrides: Record<string, unknown> = {}) {
    return {
      userId, packageSlug: payment.packageSlug, paymentIntentId: payment.paymentIntentId,
      providerLineId: '4242', providerExpiryBefore: null, providerExpiryAfter: expiry(),
      credentialsBefore: null, credentialsAfter: credentials, ...overrides
    } as Parameters<StripePaymentStore['complete']>[1];
  }
  async function access() { return (await pool.query('select * from public.subscriptions order by id')).rows; }
  async function jobs() { return (await pool.query('select * from public.stripe_payment_jobs order by stripe_session_id')).rows; }
  async function privatePaymentJobs() {
    expect((await pool.query("select relrowsecurity from pg_class where oid='public.stripe_payment_jobs'::regclass")).rows[0].relrowsecurity).toBe(true);
    expect((await pool.query(`select a.privilege_type from pg_class c,
      lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid='public.stripe_payment_jobs'::regclass and a.grantee=0`)).rows).toHaveLength(0);
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect((await pool.query('select has_table_privilege($1,$2,$3) as allowed', [role, 'public.stripe_payment_jobs', privilege])).rows[0].allowed).toBe(false);
      }
    }
  }
  function paymentView(payment: Awaited<ReturnType<typeof reservation>>, paid = true) {
    return {
      sessionId: payment.sessionId, liveMode: false, mode: 'payment', status: 'complete', paymentStatus: paid ? 'paid' : 'unpaid',
      customerId: payment.customerId, userId, packageSlug: payment.packageSlug, catalogVersion: SALE_CATALOG_VERSION,
      users: 2, priceId: saleIds[payment.packageSlug], quantity: 1, amountTotal: 39900, currency: 'try',
      paymentIntent: { id: payment.paymentIntentId, status: paid ? 'succeeded' : 'processing', liveMode: false, amount: 39900,
        amountReceived: paid ? 39900 : 0, currency: 'try', customerId: payment.customerId, userId, packageSlug: payment.packageSlug,
        catalogVersion: SALE_CATALOG_VERSION, users: 2, priceId: saleIds[payment.packageSlug] }
    };
  }
  function fulfillment(payment: Awaited<ReturnType<typeof reservation>>, paid = true, observedCapacity = 2) {
    const view = paymentView(payment, paid);
    let providerLine: Record<string, unknown> | null = null;
    const after = expiry();
    const provider = {
      listPackages: vi.fn(async () => [{ id: 13, name: 'Fixture dual month', isTrial: false, duration: 1, unit: 'months', credits: 1, maxConnections: 2 }]),
      findLine: vi.fn(async (username: string) => providerLine?.username === username ? providerLine : null),
      extendLine: vi.fn(async () => { throw new Error('Unexpected fixture extension'); }),
      createPaidLine: vi.fn(async (input: { username: string; password: string }) => {
        providerLine = { id: '4242', username: input.username, password: input.password, enabled: true,
          isTrial: false, maxConnections: observedCapacity, expiresAt: after.getTime() };
      })
    };
    const deps = { liveMode: false, allowedTestUserIds: new Set([userId]), salePriceIds: saleIds,
      billing: { fetchCheckoutPayment: vi.fn(async () => view) }, store, customerStore: billing, provider };
    return { view, provider, deps, after };
  }

  beforeAll(async () => {
    expect((await pool.query('select current_database() as database, current_user as role')).rows[0]).toEqual({ database: 'flixify_package_payment_fixture', role: 'flixify_fixture' });
    if ((await pool.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n !== 0) {
      throw new Error('Payment fixture requires an empty public schema');
    }
    await pool.query(`
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      end $$;
      alter default privileges in schema public grant select on tables to public, anon, authenticated;
      create table public.users(id uuid primary key default gen_random_uuid(), status text not null default 'new', deleted_at timestamptz, notes text);
      create table public.packages(id uuid primary key default gen_random_uuid(), slug text unique not null, title text not null, duration text not null,
        duration_months integer not null, price_label text, is_active boolean not null default true,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now());
      create table public.user_iptv_credentials(id uuid primary key default gen_random_uuid(), user_id uuid unique not null references public.users(id),
        username text not null, password text not null, updated_at timestamptz not null default now());
      create table public.subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
        package_id uuid not null references public.packages(id), status text not null, starts_at timestamptz not null, ends_at timestamptz not null,
        activated_by_admin_id text not null, end_reason text, created_at timestamptz not null default now());
    `);
    await pool.query(await readFile(new URL('../../../../supabase/migrations/202611010001_single_dual_packages.sql', import.meta.url), 'utf8'));
    await ensureStripeBillingSchema(pool);
    await ensureStripePaymentSchema(pool);
    await pool.query(`create unique index fixture_one_open_checkout_per_user_mode
      on public.stripe_checkout_sessions(user_id,livemode)
      where status in ('creating','open','completed')`);
  });
  beforeEach(async () => {
    await pool.query('truncate public.stripe_payment_jobs,public.stripe_checkout_sessions,public.stripe_subscriptions,public.stripe_customers,public.user_iptv_credentials,public.subscriptions,public.users cascade');
    userId = (await pool.query('insert into public.users default values returning id')).rows[0].id;
  });
  afterAll(async () => { await pool.end(); });

  it('protects reserved provider credentials from inherited public and Supabase role grants', async () => {
    await privatePaymentJobs();
    expect((await pool.query('select has_table_privilege(current_user,$1,$2) as allowed', ['public.stripe_payment_jobs', 'SELECT'])).rows[0].allowed).toBe(true);
  });

  it('replays additive billing migration twice without changing checkout jobs or restoring public access', async () => {
    const payment = await ready();
    await store.reserveNewLine(payment.sessionId, userId);
    const beforeJobs = await jobs();
    const beforeCheckouts = (await pool.query('select * from public.stripe_checkout_sessions order by operation_id')).rows;
    const migration = await readFile(new URL('../../../../supabase/migrations/202611010002_package_checkout_catalog.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(migration);
    expect(await jobs()).toEqual(beforeJobs);
    expect((await pool.query('select * from public.stripe_checkout_sessions order by operation_id')).rows).toEqual(beforeCheckouts);
    await privatePaymentJobs();
  });

  it('rejects unknown or wrong-mode checkout IDs and deduplicates repeated webhook deliveries', async () => {
    const reserved = await reservation();
    expect(await store.enqueue('cs_test_unknown', false)).toBe(false);
    expect(await store.enqueue(reserved.sessionId, true)).toBe(false);
    const results = await Promise.all([store.enqueue(reserved.sessionId, false), store.enqueue(reserved.sessionId, false)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await jobs()).toHaveLength(1);
    expect(await store.jobOwner(reserved.sessionId)).toBe(userId);
    expect(await access()).toHaveLength(0);
  });

  it('claims one fulfillment only even when two workers race and never grants access from a claim', async () => {
    const reserved = await reservation();
    await store.enqueue(reserved.sessionId, false);
    const claims = await Promise.all([store.claim(reserved.sessionId), store.claim(reserved.sessionId)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await access()).toHaveLength(0);
    expect((await pool.query('select count(*)::int n from public.user_iptv_credentials')).rows[0].n).toBe(0);
  });

  it('does not provision or activate content while the real checkout payment is unpaid', async () => {
    const payment = await reservation();
    await store.enqueue(payment.sessionId, false);
    const fixture = fulfillment(payment, false);
    expect(await fulfillPaidCheckout(payment.sessionId, fixture.deps as Parameters<typeof fulfillPaidCheckout>[1])).toBe('awaiting-payment');
    expect(fixture.provider.createPaidLine).not.toHaveBeenCalled();
    expect(fixture.provider.extendLine).not.toHaveBeenCalled();
    expect(await access()).toHaveLength(0);
  });

  it('fulfills the same paid checkout once across concurrent calls with exact dual line readback', async () => {
    const payment = await reservation();
    await store.enqueue(payment.sessionId, false);
    const fixture = fulfillment(payment);
    const results = await Promise.all([
      fulfillPaidCheckout(payment.sessionId, fixture.deps as Parameters<typeof fulfillPaidCheckout>[1]),
      fulfillPaidCheckout(payment.sessionId, fixture.deps as Parameters<typeof fulfillPaidCheckout>[1])
    ]);
    expect(results).toContain('fulfilled');
    expect(results.filter((result) => result === 'fulfilled')).toHaveLength(1);
    expect(fixture.provider.createPaidLine).toHaveBeenCalledTimes(1);
    expect(fixture.provider.extendLine).not.toHaveBeenCalled();
    expect(await access()).toHaveLength(1);
    expect(new Date((await access())[0].ends_at).toISOString()).toBe(fixture.after.toISOString());
    expect((await jobs())[0].payment_intent_id).toBe(payment.paymentIntentId);
    expect((await jobs())[0].status).toBe('fulfilled');
  });

  it('holds a paid dual purchase for review when provider readback still permits only one device', async () => {
    const payment = await reservation();
    await store.enqueue(payment.sessionId, false);
    const fixture = fulfillment(payment, true, 1);
    expect(await fulfillPaidCheckout(payment.sessionId, fixture.deps as Parameters<typeof fulfillPaidCheckout>[1])).toBe('review-required');
    expect(fixture.provider.createPaidLine).toHaveBeenCalledTimes(1);
    expect(await access()).toHaveLength(0);
    expect((await pool.query('select count(*)::int n from public.user_iptv_credentials')).rows[0].n).toBe(0);
    expect((await jobs())[0].status).toBe('review-required');
  });

  it('rejects payment session account substitution before any provider write or access grant', async () => {
    const payment = await reservation();
    await store.enqueue(payment.sessionId, false);
    const fixture = fulfillment(payment);
    fixture.view.userId = randomUUID();
    expect(await fulfillPaidCheckout(payment.sessionId, fixture.deps as Parameters<typeof fulfillPaidCheckout>[1])).toBe('review-required');
    expect(fixture.provider.createPaidLine).not.toHaveBeenCalled();
    expect(await access()).toHaveLength(0);
  });

  it('serializes provider writes for two payments owned by the same account and releases the lock on error', async () => {
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = store.withUserLock(userId, async () => { entered(); await held; return 'first'; });
    await started;
    try { expect(await store.withUserLock(userId, async () => 'second')).toBeNull(); }
    finally { release(); }
    expect(await first).toBe('first');
    await expect(store.withUserLock(userId, async () => { throw new Error('fixture-provider-uncertain'); })).rejects.toThrow('fixture-provider-uncertain');
    expect(await store.withUserLock(userId, async () => 'released')).toBe('released');
  });

  it('does not bind one successful Stripe payment to two checkout jobs', async () => {
    const first = await ready();
    userId = (await pool.query('insert into public.users default values returning id')).rows[0].id;
    const second = await reservation();
    await store.enqueue(second.sessionId, false);
    await store.claim(second.sessionId);
    await expect(store.bindPaymentIntent(second.sessionId, first.paymentIntentId)).rejects.toThrow();
    expect(await access()).toHaveLength(0);
  });

  it('creates first-time access with an explicit activation actor and the exact verified provider deadline', async () => {
    const paid = await ready();
    const after = expiry();
    await store.complete(paid.sessionId, completion(paid, { providerExpiryAfter: after }));
    const records = await access();
    expect(records).toHaveLength(1);
    expect(records[0].activated_by_admin_id).toBe('stripe-payment');
    expect(new Date(records[0].ends_at).toISOString()).toBe(after.toISOString());
    expect((await pool.query('select username,password from public.user_iptv_credentials where user_id=$1', [userId])).rows[0]).toEqual(credentials);
    expect((await jobs())[0].status).toBe('fulfilled');
    expect((await pool.query('select count(*)::int n from public.stripe_subscriptions')).rows[0].n).toBe(0);
    expect((await pool.query('select fulfilled_at from public.stripe_checkout_sessions where stripe_session_id=$1', [paid.sessionId])).rows[0].fulfilled_at).not.toBeNull();
  });

  it('returns fulfillment status only to the original authenticated account and payment mode', async () => {
    const paid = await ready();
    const after = expiry();
    await store.complete(paid.sessionId, completion(paid, { providerExpiryAfter: after }));
    expect(await store.status(paid.sessionId, randomUUID(), false)).toBeNull();
    expect(await store.status(paid.sessionId, userId, true)).toBeNull();
    expect(await store.status(paid.sessionId, userId, false)).toMatchObject({ status: 'active', packageSlug: paid.packageSlug, endsAt: after.toISOString() });
  });

  it('does not label a historical paid checkout active after its verified content deadline', async () => {
    const paid = await ready();
    await store.complete(paid.sessionId, completion(paid));
    await pool.query("update public.stripe_payment_jobs set ends_at=now()-interval '1 hour',provider_expiry_after=now()-interval '1 hour' where stripe_session_id=$1", [paid.sessionId]);
    await pool.query("update public.subscriptions set ends_at=now()-interval '1 hour' where user_id=$1", [userId]);
    expect(await store.status(paid.sessionId, userId, false)).toMatchObject({ status: 'expired', packageSlug: paid.packageSlug });
  });

  it('does not let a completed one-time purchase block a later package purchase', async () => {
    const paid = await ready();
    await store.complete(paid.sessionId, completion(paid));
    expect(await billing.pendingCheckout(userId, false)).toBeNull();
    expect((await billing.accountState(userId, false)).openCheckout).toBe(false);
    await expect(billing.beginCheckout(userId, '6-ay-2-kullanici', false, 'price_fixture_six', SALE_CATALOG_VERSION)).resolves.toEqual(expect.any(String));
  });

  it('replaces an active trial with a paid record while retaining the trial-use history marker', async () => {
    await pool.query('insert into public.user_iptv_credentials(user_id,username,password) values($1,$2,$3)', [userId, credentials.username, credentials.password]);
    const trial = (await pool.query(`insert into public.subscriptions(user_id,package_id,status,starts_at,ends_at,activated_by_admin_id,end_reason)
      select $1,id,'active',now()-interval '1 hour',now()+interval '2 hours','auto-trial','trial-3h' from public.packages where slug='1-ay' returning id`, [userId])).rows[0].id;
    const paid = await ready();
    const after = expiry();
    await store.complete(paid.sessionId, completion(paid, { credentialsBefore: credentials, providerExpiryAfter: after }));
    const records = await access();
    const active = records.filter((row: { status: string }) => row.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(trial);
    expect(active[0].activated_by_admin_id).toBe('stripe-payment');
    expect(active[0].end_reason).toBeNull();
    expect(new Date(active[0].ends_at).toISOString()).toBe(after.toISOString());
    expect(records.find((row: { id: string }) => row.id === trial)).toMatchObject({ status: 'cancelled', end_reason: 'trial-3h' });
  });

  it('rejects credential reassignment during provider I/O without activating the stale line', async () => {
    await pool.query('insert into public.user_iptv_credentials(user_id,username,password) values($1,$2,$3)', [userId, credentials.username, credentials.password]);
    const paid = await ready();
    await pool.query("update public.user_iptv_credentials set password='fixture-new-owner-secret',updated_at=now() where user_id=$1", [userId]);
    await expect(store.complete(paid.sessionId, completion(paid, { credentialsBefore: credentials }))).rejects.toThrow();
    expect(await access()).toHaveLength(0);
    expect((await jobs())[0].status).toBe('fulfilling');
    expect((await pool.query('select password from public.user_iptv_credentials where user_id=$1', [userId])).rows[0].password).toBe('fixture-new-owner-secret');
  });

  it('rejects a blocked account after payment without granting content access', async () => {
    const paid = await ready();
    await pool.query("update public.users set status='blocked' where id=$1", [userId]);
    await expect(store.complete(paid.sessionId, completion(paid))).rejects.toThrow();
    expect(await access()).toHaveLength(0);
    expect((await jobs())[0].status).toBe('fulfilling');
  });

  it('marks uncertain provider operations for review without retrying a claimed payment', async () => {
    const paid = await ready();
    await store.review(paid.sessionId, 'provider_result_uncertain');
    expect(await store.claim(paid.sessionId)).toBeNull();
    expect((await jobs())[0].status).toBe('review-required');
    expect(await access()).toHaveLength(0);
  });
});
