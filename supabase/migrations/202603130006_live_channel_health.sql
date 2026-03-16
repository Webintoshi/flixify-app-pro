alter table public.shared_live_channels
add column if not exists transport text not null default 'unknown'
check (transport in ('ts', 'hls', 'mp4', 'mkv', 'unknown'));

create table if not exists public.shared_live_channel_health (
  channel_id uuid primary key references public.shared_live_channels(id) on delete cascade,
  snapshot_version integer not null,
  health_status text not null default 'unknown' check (health_status in ('unknown', 'healthy', 'degraded', 'broken')),
  failure_count integer not null default 0,
  last_checked_at timestamptz,
  last_play_requested_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists shared_live_channel_health_set_updated_at
on public.shared_live_channel_health;

create trigger shared_live_channel_health_set_updated_at
before update on public.shared_live_channel_health
for each row
execute function public.set_updated_at();

create index if not exists idx_shared_live_channel_health_status
on public.shared_live_channel_health(health_status, last_checked_at desc);

create index if not exists idx_shared_live_channel_health_requested
on public.shared_live_channel_health(last_play_requested_at desc);

update public.shared_live_channels
set transport = case
  when lower(stream_path) like '%.m3u8%' then 'hls'
  when lower(stream_path) like '%.ts%' then 'ts'
  when lower(stream_path) like '%.mp4%' then 'mp4'
  when lower(stream_path) like '%.mkv%' then 'mkv'
  else transport
end
where transport = 'unknown';
