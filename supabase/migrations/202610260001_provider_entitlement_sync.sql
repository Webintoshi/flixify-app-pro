-- Neutral duration is schema compatibility only; provider ends_at is authoritative.
insert into public.packages(slug,title,duration,duration_months,is_active)
values ('provider-managed','Sağlayıcı Paketi','1m',1,false) on conflict(slug) do nothing;
create table public.provider_entitlement_sync (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete cascade,
 credential_id uuid not null references public.user_iptv_credentials(id) on delete cascade,
 credential_version text not null,
 provider_line_id text unique check (provider_line_id ~ '^[0-9]{1,20}$'),
 subscription_id uuid unique references public.subscriptions(id) on delete restrict,
 next_attempt_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 failure_count integer not null default 0 check(failure_count>=0),
 last_error text check(last_error in ('PROVIDER_UNAVAILABLE','PROVIDER_INVALID','PROVIDER_IDENTITY','PROVIDER_AMBIGUOUS','SYNC_CONFLICT')),
 last_success_at timestamptz,
 created_at timestamptz not null default now(),
 unique(user_id,credential_id,credential_version),
 check ((lease_token is null) = (lease_until is null))
);
create index provider_entitlement_due on public.provider_entitlement_sync(next_attempt_at,lease_until);
create index provider_entitlement_credentials_pair on public.user_iptv_credentials(username,password);
alter table public.provider_entitlement_sync enable row level security;
-- No client policy: worker database role only.
revoke all on public.provider_entitlement_sync from public;
