alter table public.live_playback_diagnostics
drop constraint if exists live_playback_diagnostics_delivery_mode_check;

alter table public.live_playback_diagnostics
add constraint live_playback_diagnostics_delivery_mode_check
check (delivery_mode in ('hls_proxy', 'hls_transmuxed', 'hls_transcoded', 'file_proxy'));
