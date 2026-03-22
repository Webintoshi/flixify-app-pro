alter table public.shared_live_channels
add column if not exists variant_group_key text,
add column if not exists quality_rank integer;

create index if not exists idx_shared_live_channels_variant_lookup
on public.shared_live_channels(snapshot_version, variant_group_key, quality_rank desc, order_index asc);

alter table public.live_playback_diagnostics
add column if not exists client_runtime text,
add column if not exists decoder_mode text,
add column if not exists open_error_code text,
add column if not exists native_state text;

alter table public.vod_playback_diagnostics
add column if not exists client_runtime text,
add column if not exists decoder_mode text,
add column if not exists open_error_code text,
add column if not exists native_state text;
