create table if not exists public.live_playback_diagnostics (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.shared_live_channels(id) on delete cascade,
  snapshot_version integer not null,
  diagnostics_session_id uuid,
  event text not null,
  delivery_mode text check (delivery_mode in ('hls_proxy', 'hls_transmuxed', 'hls_transcoded')),
  source_transport text check (source_transport in ('ts', 'hls', 'mp4', 'mkv', 'unknown')),
  player_engine text,
  uptime_ms integer,
  buffered_seconds double precision,
  current_time_seconds double precision,
  ready_state integer,
  network_state integer,
  stall_reason text,
  error_code text,
  upstream_status integer,
  error_message text,
  detail jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_live_playback_diagnostics_channel_created
on public.live_playback_diagnostics(channel_id, created_at desc);

create index if not exists idx_live_playback_diagnostics_session
on public.live_playback_diagnostics(diagnostics_session_id, created_at desc);
