alter table public.app_settings
add column if not exists shared_source_base_url text,
add column if not exists shared_source_playlist_path text not null default 'playlist',
add column if not exists shared_source_playlist_suffix text not null default 'm3u_plus',
add column if not exists shared_source_reference_username text,
add column if not exists shared_source_reference_password text,
add column if not exists shared_source_status text not null default 'pending' check (shared_source_status in ('pending', 'syncing', 'ready', 'error')),
add column if not exists shared_source_snapshot_version integer not null default 0,
add column if not exists shared_source_last_successful_sync_at timestamptz,
add column if not exists shared_source_last_error text;

create table if not exists public.user_iptv_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  username text not null,
  password text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists user_iptv_credentials_set_updated_at
on public.user_iptv_credentials;

create trigger user_iptv_credentials_set_updated_at
before update on public.user_iptv_credentials
for each row
execute function public.set_updated_at();

create table if not exists public.shared_m3u_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by_admin_id text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  snapshot_version integer,
  attempt_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_shared_m3u_sync_jobs_status
on public.shared_m3u_sync_jobs(status, created_at);

create table if not exists public.shared_live_channels (
  id uuid primary key default gen_random_uuid(),
  snapshot_version integer not null,
  title text not null,
  group_title text,
  logo_url text,
  stream_path text not null,
  tvg_id text,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.shared_movies (
  id uuid primary key default gen_random_uuid(),
  snapshot_version integer not null,
  title text not null,
  poster_url text,
  group_title text,
  stream_path text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.shared_series (
  id uuid primary key default gen_random_uuid(),
  snapshot_version integer not null,
  title text not null,
  poster_url text,
  group_title text,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.shared_episodes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.shared_series(id) on delete cascade,
  snapshot_version integer not null,
  title text not null,
  season_number integer not null default 1,
  episode_number integer not null default 1,
  stream_path text not null,
  order_index integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_shared_live_channels_lookup
on public.shared_live_channels(snapshot_version, group_title, order_index);

create index if not exists idx_shared_movies_lookup
on public.shared_movies(snapshot_version, group_title, order_index);

create index if not exists idx_shared_series_lookup
on public.shared_series(snapshot_version, group_title, order_index);

create index if not exists idx_shared_episodes_lookup
on public.shared_episodes(series_id, snapshot_version);

create index if not exists idx_shared_live_channels_title_trgm
on public.shared_live_channels using gin (lower(title) gin_trgm_ops);

create index if not exists idx_shared_movies_title_trgm
on public.shared_movies using gin (lower(title) gin_trgm_ops);

create index if not exists idx_shared_series_title_trgm
on public.shared_series using gin (lower(title) gin_trgm_ops);
