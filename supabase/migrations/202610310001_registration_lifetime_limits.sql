-- Run in a transaction after parameterized set_config('flixify.registration_guard_secret', secret, true).
-- Initialize that stable key from the previous APP_JWT_SECRET so existing IP HMACs remain compatible.
-- Pause API registration writers during the final seed/cutover. Never print the key.
lock table public.users, public.registration_trial_ip_quota in share row exclusive mode;

create table if not exists public.registration_ip_lifetime_quota (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  count integer not null check (count between 1 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.registration_installation_claims (
  installation_hash text primary key check (installation_hash ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default now()
);

-- No user foreign key: account deletion must not release either permanent claim.
alter table public.registration_ip_lifetime_quota enable row level security;
alter table public.registration_installation_claims enable row level security;
revoke all on public.registration_ip_lifetime_quota, public.registration_installation_claims from public;

insert into public.registration_ip_lifetime_quota (ip_hash, count, created_at)
select ip_hash, least(count, 2), window_started_at
from public.registration_trial_ip_quota
where count > 0
on conflict (ip_hash) do update
set count = greatest(registration_ip_lifetime_quota.count, excluded.count),
    created_at = least(registration_ip_lifetime_quota.created_at, excluded.created_at);

do $migration$
declare
  guard_secret text := current_setting('flixify.registration_guard_secret', true);
  crypto_schema name;
  role_name name;
begin
  if guard_secret is null or length(guard_secret) < 32 then
    raise exception 'Stable registration guard secret is required for backfill';
  end if;
  select n.nspname into crypto_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if crypto_schema is null then raise exception 'Existing pgcrypto extension is required'; end if;
  execute format($seed$
    insert into public.registration_installation_claims (installation_hash, claimed_at)
    select encode(%I.hmac('auto-registration-installation:v1:' || btrim(registration_installation_id), $1, 'sha256'), 'hex'), min(created_at)
    from public.users
    where registration_installation_id is not null and btrim(registration_installation_id) <> ''
    group by 1
    on conflict (installation_hash) do nothing
  $seed$, crypto_schema) using guard_secret;
  foreach role_name in array array['anon', 'authenticated']::name[] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.registration_ip_lifetime_quota, public.registration_installation_claims from %I', role_name);
    end if;
  end loop;
end
$migration$;
