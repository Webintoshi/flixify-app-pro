import type { Pool } from 'pg';

const migrations = new WeakMap<Pool, Promise<void>>();

/** Creates additive billing tables; it never changes existing entitlement records. */
export async function ensureStripeBillingSchema(pool: Pool): Promise<void> {
  const existing = migrations.get(pool);
  if (existing) return existing;
  const migration = createSchema(pool).catch(error => {
    migrations.delete(pool);
    throw error;
  });
  migrations.set(pool, migration);
  return migration;
}

async function createSchema(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists public.stripe_customers (
      user_id uuid not null references public.users(id),
      stripe_customer_id text not null,
      livemode boolean not null,
      created_at timestamptz not null default now(),
      primary key (user_id, livemode),
      unique (stripe_customer_id, livemode)
    )
  `);
  await pool.query(`
    create table if not exists public.stripe_subscriptions (
      stripe_subscription_id text primary key,
      user_id uuid not null references public.users(id),
      package_slug text not null,
      livemode boolean not null,
      status text not null,
      current_period_end timestamptz,
      cancel_at_period_end boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists public.stripe_checkout_sessions (
      operation_id text primary key,
      stripe_session_id text unique,
      user_id uuid not null references public.users(id),
      package_slug text not null,
      livemode boolean not null,
      status text not null check (status in ('creating', 'open', 'completed', 'expired', 'failed')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query('alter table public.stripe_checkout_sessions add column if not exists sale_price_id text, add column if not exists sale_catalog_version text, add column if not exists fulfilled_at timestamptz');
  await pool.query(`
    create table if not exists public.stripe_events (
      stripe_event_id text primary key,
      event_type text not null,
      livemode boolean not null,
      received_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create table if not exists public.stripe_invoice_jobs (
      stripe_invoice_id text primary key,
      user_id uuid references public.users(id),
      package_slug text,
      stripe_subscription_id text,
      livemode boolean not null,
      status text not null check (status in ('pending', 'fulfilling', 'fulfilled', 'review-required')),
      provider_line_id text,
      provider_expiry_before timestamptz,
      provider_expiry_after timestamptz,
      reserved_username text,
      reserved_password text,
      error_code text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query('create index if not exists stripe_subscriptions_user on public.stripe_subscriptions(user_id, livemode)');
  await pool.query('create index if not exists stripe_checkout_sessions_user on public.stripe_checkout_sessions(user_id, livemode, status)');
  await pool.query('create index if not exists stripe_invoice_jobs_status on public.stripe_invoice_jobs(status, created_at)');
}
