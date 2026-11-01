begin;
set local lock_timeout='5s';
set local statement_timeout='20s';

create table if not exists public.welcome_offer_accounts (
  user_id uuid primary key references public.users(id) on delete cascade,
  campaign text not null check(campaign='welcome-monthly-50-v1'),
  choice text check(choice in ('trial','monthly')),
  dismissed_at timestamptz,
  reserved_operation_id text,
  redeemed_at timestamptz,
  redeemed_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.welcome_offer_accounts enable row level security;
revoke all on public.welcome_offer_accounts from public;
do $welcome_privacy$
declare role_name name;
begin
  foreach role_name in array array['anon','authenticated']::name[] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on public.welcome_offer_accounts from %I',role_name);
    end if;
  end loop;
end
$welcome_privacy$;

alter table public.stripe_checkout_sessions
  add column if not exists welcome_offer_id text,
  add column if not exists welcome_coupon_id text,
  add column if not exists expected_amount_minor integer;

commit;
