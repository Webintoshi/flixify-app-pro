create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  code_lookup text not null unique,
  code_hash text not null,
  status text not null default 'new' check (status in ('new', 'active', 'blocked')),
  notes text,
  last_login_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  device_name text,
  platform text,
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default timezone('utc', now()),
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  duration text not null check (duration in ('1m', '3m', '6m', '12m')),
  duration_months integer not null check (duration_months in (1, 3, 6, 12)),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete restrict,
  status text not null check (status in ('active', 'expired', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  activated_by_admin_id text not null,
  end_reason text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_m3u_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  source_url text not null,
  status text not null default 'pending' check (status in ('pending', 'syncing', 'ready', 'error')),
  current_snapshot_version integer not null default 0,
  last_successful_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.m3u_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  user_m3u_source_id uuid not null references public.user_m3u_sources(id) on delete cascade,
  requested_by_admin_id text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  snapshot_version integer,
  attempt_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.live_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  snapshot_version integer not null,
  title text not null,
  group_title text,
  logo_url text,
  stream_url text not null,
  tvg_id text,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.movies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  snapshot_version integer not null,
  title text not null,
  poster_url text,
  group_title text,
  stream_url text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  snapshot_version integer not null,
  title text not null,
  poster_url text,
  group_title text,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  snapshot_version integer not null,
  title text not null,
  season_number integer not null default 1,
  episode_number integer not null default 1,
  stream_url text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete restrict,
  status text not null default 'pending-review' check (status in ('pending-review', 'approved', 'rejected')),
  note text,
  reviewed_by_admin_id text,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.trial_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  reviewed_by_admin_id text,
  reviewed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.app_settings (
  id boolean primary key default true,
  support_whatsapp_url text not null,
  support_telegram_url text not null,
  sales_portal_url text,
  hero_title text not null,
  hero_subtitle text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint single_settings_row check (id)
);

create trigger users_set_updated_at
before update on public.users
for each row execute procedure public.set_updated_at();

create trigger packages_set_updated_at
before update on public.packages
for each row execute procedure public.set_updated_at();

create trigger user_m3u_sources_set_updated_at
before update on public.user_m3u_sources
for each row execute procedure public.set_updated_at();

create trigger payment_requests_set_updated_at
before update on public.payment_requests
for each row execute procedure public.set_updated_at();

create trigger trial_requests_set_updated_at
before update on public.trial_requests
for each row execute procedure public.set_updated_at();

create index if not exists idx_device_sessions_user_id on public.device_sessions(user_id);
create index if not exists idx_device_sessions_active on public.device_sessions(user_id, revoked_at);
create index if not exists idx_users_code_lookup on public.users(code_lookup);
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_expiry on public.subscriptions(status, ends_at);
create index if not exists idx_live_channels_lookup on public.live_channels(user_id, snapshot_version);
create index if not exists idx_movies_lookup on public.movies(user_id, snapshot_version);
create index if not exists idx_series_lookup on public.series(user_id, snapshot_version);
create index if not exists idx_episodes_lookup on public.episodes(series_id, snapshot_version);
create index if not exists idx_payment_requests_status on public.payment_requests(status, created_at desc);
create index if not exists idx_trial_requests_status on public.trial_requests(status, created_at desc);
create index if not exists idx_m3u_sync_jobs_status on public.m3u_sync_jobs(status, created_at);

insert into public.packages (slug, title, duration, duration_months)
values
  ('1-ay', '1 Ay', '1m', 1),
  ('3-ay', '3 Ay', '3m', 3),
  ('6-ay', '6 Ay', '6m', 6),
  ('12-ay', '12 Ay', '12m', 12)
on conflict (slug) do update
set
  title = excluded.title,
  duration = excluded.duration,
  duration_months = excluded.duration_months,
  is_active = true;

insert into public.app_settings (
  id,
  support_whatsapp_url,
  support_telegram_url,
  sales_portal_url,
  hero_title,
  hero_subtitle
)
values (
  true,
  'https://wa.me/900000000000',
  'https://t.me/yourchannel',
  null,
  'Canli TV, film ve diziler tek uygulamada',
  'Kriptonit kod ile hizli giris, size ozel baglanti ve manuel onayli paket yonetimi.'
)
on conflict (id) do nothing;
