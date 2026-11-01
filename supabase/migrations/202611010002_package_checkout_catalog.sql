begin;

set local lock_timeout = '5s';
set local statement_timeout = '20s';

alter table if exists public.stripe_checkout_sessions
  add column if not exists sale_price_id text,
  add column if not exists sale_catalog_version text,
  add column if not exists fulfilled_at timestamptz;

create table if not exists public.stripe_payment_jobs (
      stripe_session_id text primary key,
      payment_intent_id text unique,
      user_id uuid not null references public.users(id),
      livemode boolean not null,
      status text not null check(status in ('pending','fulfilling','fulfilled','review-required','expired')),
      provider_line_id text,
      provider_expiry_before timestamptz,
      provider_expiry_after timestamptz,
      reserved_username text,
      reserved_password text,
      ends_at timestamptz,
      fulfilled_at timestamptz,
      error_code text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

create index if not exists stripe_payment_jobs_status on public.stripe_payment_jobs(status,created_at);

alter table public.stripe_payment_jobs enable row level security;
revoke all on public.stripe_payment_jobs from public;
do $payment_privacy$
declare role_name name;
begin
  foreach role_name in array array['anon', 'authenticated']::name[] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.stripe_payment_jobs from %I', role_name);
    end if;
  end loop;
end
$payment_privacy$;

alter table if exists public.referral_qualifications add column if not exists stripe_payment_session_id text;
do $$ begin
  if to_regclass('public.referral_qualifications') is not null then
    create unique index if not exists referral_qualifications_stripe_payment on public.referral_qualifications(stripe_payment_session_id);
  end if;
end $$;

commit;
