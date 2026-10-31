-- Provider rows and personal favorites remain intact; only presentation is filtered.
create table public.live_channel_exclusions (
  provider_origin text not null check (length(provider_origin) between 9 and 256 and provider_origin ~ '^https://[^/?#@[:space:]]+$'),
  stream_id text not null check (stream_id ~ '^[1-9][0-9]{0,14}$'),
  reason text not null check (reason = 'confirmed-http-unavailable'),
  failure_count integer not null check (failure_count >= 2),
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  control_stream_id text not null check (control_stream_id ~ '^[1-9][0-9]{0,14}$' and control_stream_id <> stream_id),
  control_verified_at timestamptz not null,
  proof_sha256 text not null check (proof_sha256 ~ '^[0-9a-f]{64}$'),
  proof jsonb not null check (jsonb_typeof(proof) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (provider_origin, stream_id),
  check (first_failed_at < last_failed_at and last_failed_at <= control_verified_at)
);
alter table public.live_channel_exclusions enable row level security;
revoke all on public.live_channel_exclusions from public;
