create table if not exists public.vod_playback_diagnostics (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  kind text not null check (kind in ('movie', 'episode')),
  diagnostics_session_id uuid,
  event text not null check (
    event in (
      'session-created',
      'audio-track-selected',
      'audio-track-switch-failed',
      'no-audio-detected',
      'transcode-started',
      'transcode-failed',
      'playback-failed',
      'recovered'
    )
  ),
  delivery_mode text check (delivery_mode in ('hls_proxy', 'file_proxy', 'hls_transcoded')),
  source_transport text check (source_transport in ('hls', 'mp4', 'mkv', 'avi', 'unknown')),
  player_engine text,
  uptime_ms integer,
  buffered_seconds double precision,
  current_time_seconds double precision,
  ready_state integer,
  network_state integer,
  audio_track_id text,
  error_code text,
  upstream_status integer,
  error_message text,
  detail jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_vod_playback_diagnostics_item_created
on public.vod_playback_diagnostics(item_id, created_at desc);

create index if not exists idx_vod_playback_diagnostics_session
on public.vod_playback_diagnostics(diagnostics_session_id, created_at desc);
