begin;

alter table public.live_channel_exclusions
  drop constraint live_channel_exclusions_reason_check,
  add constraint live_channel_exclusions_reason_check
    check (reason in ('confirmed-http-unavailable', 'owner-requested-removal')),
  alter column failure_count drop not null,
  alter column first_failed_at drop not null,
  alter column last_failed_at drop not null,
  alter column control_stream_id drop not null,
  alter column control_verified_at drop not null,
  add constraint live_channel_exclusions_reason_metadata_check check (
    (
      reason = 'confirmed-http-unavailable'
      and failure_count is not null
      and first_failed_at is not null
      and last_failed_at is not null
      and control_stream_id is not null
      and control_verified_at is not null
    )
    or
    (
      reason = 'owner-requested-removal'
      and failure_count is null
      and first_failed_at is null
      and last_failed_at is null
      and control_stream_id is null
      and control_verified_at is null
      and proof @> jsonb_build_object(
        'type', 'owner-requested-removal',
        'providerOrigin', provider_origin,
        'streamId', stream_id
      )
    )
  );

commit;
