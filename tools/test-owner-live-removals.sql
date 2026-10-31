begin;

create temporary table owner_live_removals_fixture
  (like public.live_channel_exclusions including all) on commit drop;

-- Apply the migration to the clone, including when the source is already migrated.
alter table pg_temp.owner_live_removals_fixture
  drop constraint live_channel_exclusions_reason_check,
  drop constraint if exists live_channel_exclusions_reason_metadata_check,
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

insert into pg_temp.owner_live_removals_fixture
  (provider_origin, stream_id, reason, proof_sha256, proof)
values (
  'https://flixify-removal-fixture.invalid', '1256041', 'owner-requested-removal',
  -- SHA-256 of the exact canonical UTF-8 JSON document on the following line.
  '87c5f973496578173227f49ebc56384ae97081b9c06e828e7d8a39dd2111e20e',
  '{"providerOrigin":"https://flixify-removal-fixture.invalid","streamId":"1256041","type":"owner-requested-removal"}'::jsonb
);

insert into pg_temp.owner_live_removals_fixture
  (provider_origin, stream_id, reason, failure_count, first_failed_at, last_failed_at,
   control_stream_id, control_verified_at, proof_sha256, proof)
values (
  'https://flixify-removal-fixture.invalid', '1256042', 'confirmed-http-unavailable', 2,
  '2026-10-31T00:00:00Z', '2026-10-31T00:00:02Z', '90', '2026-10-31T00:00:03Z',
  repeat('a', 64), '{"type":"test-only-hard-failure-fixture"}'::jsonb
);

do $verification$
declare
  assignment text;
  missing_field text;
  invalid_proof jsonb;
  changed integer;
begin
  if (select count(*) from pg_temp.owner_live_removals_fixture) <> 2 then
    raise exception 'valid manual and hard rows were not retained';
  end if;

  foreach assignment in array array[
    'failure_count = 2',
    'first_failed_at = ''2026-10-31T00:00:00Z''',
    'last_failed_at = ''2026-10-31T00:00:02Z''',
    'control_stream_id = ''90''',
    'control_verified_at = ''2026-10-31T00:00:03Z'''
  ] loop
    begin
      execute 'update pg_temp.owner_live_removals_fixture set ' || assignment || ' where stream_id = ''1256041''';
      raise exception 'manual row accepted failure metadata: %', assignment;
    exception when check_violation then null;
    end;
  end loop;

  foreach missing_field in array array[
    'failure_count', 'first_failed_at', 'last_failed_at',
    'control_stream_id', 'control_verified_at'
  ] loop
    begin
      execute format('update pg_temp.owner_live_removals_fixture set %I = null where stream_id = ''1256042''', missing_field);
      raise exception 'hard row accepted missing field: %', missing_field;
    exception when check_violation or not_null_violation then null;
    end;
  end loop;

  for invalid_proof in select value from jsonb_array_elements('[
    {},
    {"providerOrigin":"https://flixify-removal-fixture.invalid","streamId":"1256041"},
    {"type":"owner-requested-removal","providerOrigin":"https://wrong.invalid","streamId":"1256041"},
    {"type":"owner-requested-removal","providerOrigin":"https://flixify-removal-fixture.invalid","streamId":"1256042"},
    {"type":"owner-requested-removal","providerOrigin":"https://flixify-removal-fixture.invalid","streamId":null}
  ]'::jsonb) loop
    begin
      update pg_temp.owner_live_removals_fixture set proof = invalid_proof where stream_id = '1256041';
      raise exception 'manual row accepted a missing or mismatched proof identity';
    exception when check_violation then null;
    end;
  end loop;

  begin
    update pg_temp.owner_live_removals_fixture set proof = null where stream_id = '1256041';
    raise exception 'manual row accepted a null proof';
  exception when not_null_violation then null;
  end;

  begin
    update pg_temp.owner_live_removals_fixture set proof_sha256 = null where stream_id = '1256041';
    raise exception 'manual row accepted a null proof digest';
  exception when not_null_violation then null;
  end;

  begin
    update pg_temp.owner_live_removals_fixture set failure_count = 1 where stream_id = '1256042';
    raise exception 'hard failure minimum was weakened';
  exception when check_violation then null;
  end;

  begin
    update pg_temp.owner_live_removals_fixture set control_stream_id = stream_id where stream_id = '1256042';
    raise exception 'hard failure control identity was weakened';
  exception when check_violation then null;
  end;

  begin
    update pg_temp.owner_live_removals_fixture set first_failed_at = last_failed_at where stream_id = '1256042';
    raise exception 'hard failure chronological evidence was weakened';
  exception when check_violation then null;
  end;

  insert into pg_temp.owner_live_removals_fixture
    (provider_origin, stream_id, reason, failure_count, first_failed_at, last_failed_at,
     control_stream_id, control_verified_at, proof_sha256, proof)
  values (
    'https://flixify-removal-fixture.invalid', '1256041', 'confirmed-http-unavailable', 2,
    '2026-10-31T00:00:00Z', '2026-10-31T00:00:02Z', '90', '2026-10-31T00:00:03Z',
    repeat('b', 64), '{"type":"test-only-audit-upsert-fixture"}'::jsonb
  )
  on conflict (provider_origin, stream_id) do update set
    reason = excluded.reason,
    failure_count = excluded.failure_count,
    first_failed_at = excluded.first_failed_at,
    last_failed_at = excluded.last_failed_at,
    control_stream_id = excluded.control_stream_id,
    control_verified_at = excluded.control_verified_at,
    proof_sha256 = excluded.proof_sha256,
    proof = excluded.proof,
    updated_at = now()
  where owner_live_removals_fixture.last_failed_at <= excluded.last_failed_at;
  get diagnostics changed = row_count;
  if changed <> 0 or not exists (
    select 1 from pg_temp.owner_live_removals_fixture
    where stream_id = '1256041' and reason = 'owner-requested-removal'
      and last_failed_at is null
      and proof_sha256 = '87c5f973496578173227f49ebc56384ae97081b9c06e828e7d8a39dd2111e20e'
  ) then
    raise exception 'audit upsert replaced the owner-requested removal';
  end if;
end;
$verification$;

select 'owner-live-removals-verification-passed' as result;
rollback;
