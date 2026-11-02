begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.analytics_consents (
  user_id uuid not null references public.users(id) on delete cascade,
  client_id text not null check (length(client_id) between 3 and 64),
  consent_version integer not null check (consent_version = 1),
  accepted boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

create table if not exists public.analytics_checkout_attribution (
  operation_id text primary key references public.stripe_checkout_sessions(operation_id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  client_id text not null,
  session_id bigint not null check (session_id between 1 and 9007199254740991),
  client_platform text not null check (client_platform in ('web', 'pwa')),
  source_platform text check (source_platform in ('android_tv', 'macos', 'windows')),
  consent_version integer not null check (consent_version = 1),
  revoked_at timestamptz,
  purchase_recorded_at timestamptz,
  activation_recorded_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (user_id, client_id) references public.analytics_consents(user_id, client_id) on delete cascade
);
create index if not exists analytics_attribution_client on public.analytics_checkout_attribution(user_id, client_id);

create table if not exists public.analytics_outbox (
  event_key text primary key check (event_key ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references public.users(id) on delete cascade,
  client_id text not null,
  session_id bigint not null check (session_id between 1 and 9007199254740991),
  stream text not null check (stream in ('web', 'windows')),
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_]{0,39}$'),
  event_timestamp_ms bigint not null check (event_timestamp_ms > 0),
  params jsonb not null check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 32768),
  state text not null default 'pending' check (state in ('pending', 'sending', 'delivered', 'dead')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  foreign key (user_id, client_id) references public.analytics_consents(user_id, client_id) on delete cascade
);
create index if not exists analytics_outbox_pending on public.analytics_outbox(next_attempt_at, created_at) where state in ('pending', 'sending');
create index if not exists analytics_outbox_client on public.analytics_outbox(user_id, client_id) where state in ('pending', 'sending');

alter table public.analytics_consents enable row level security;
alter table public.analytics_checkout_attribution enable row level security;
alter table public.analytics_outbox enable row level security;
revoke all on public.analytics_consents, public.analytics_checkout_attribution, public.analytics_outbox from public;
do $analytics_privacy$
declare role_name name;
begin
  foreach role_name in array array['anon', 'authenticated']::name[] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.analytics_consents, public.analytics_checkout_attribution, public.analytics_outbox from %I', role_name);
    end if;
  end loop;
end
$analytics_privacy$;
commit;
