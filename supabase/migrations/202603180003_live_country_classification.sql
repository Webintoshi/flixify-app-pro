alter table public.shared_live_channels
add column if not exists country_code text,
add column if not exists country_confidence text not null default 'unknown',
add column if not exists country_match_reason text not null default 'none';

alter table public.shared_live_channels
drop constraint if exists shared_live_channels_country_code_format;

alter table public.shared_live_channels
add constraint shared_live_channels_country_code_format
check (country_code is null or country_code ~ '^[A-Z]{2,3}$');

alter table public.shared_live_channels
drop constraint if exists shared_live_channels_country_confidence_check;

alter table public.shared_live_channels
add constraint shared_live_channels_country_confidence_check
check (country_confidence in ('high', 'medium', 'unknown'));

alter table public.shared_live_channels
drop constraint if exists shared_live_channels_country_match_reason_check;

alter table public.shared_live_channels
add constraint shared_live_channels_country_match_reason_check
check (country_match_reason in ('prefix', 'tr_strong_group', 'tr_balanced_multi_signal', 'none'));

update public.shared_live_channels
set
  country_code = upper((regexp_match(group_title, '^\s*([A-Za-z]{2,3})\s*[:\-]'))[1]),
  country_confidence = 'high',
  country_match_reason = 'prefix'
where country_code is null
  and group_title ~* '^\s*[A-Za-z]{2,3}\s*[:\-]';

create index if not exists idx_shared_live_channels_country_lookup
on public.shared_live_channels(snapshot_version, country_code, order_index);
