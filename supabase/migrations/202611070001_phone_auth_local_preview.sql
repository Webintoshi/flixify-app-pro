create table if not exists public.phone_auth_identities (
  phone_hash text primary key check(phone_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null unique references public.users(id) on delete restrict,
  masked_phone text not null,
  verified_at timestamptz not null default clock_timestamp()
);
create table if not exists public.phone_auth_challenges (
  id uuid primary key,
  phone_hash text not null,
  masked_phone text not null,
  otp_hash text not null,
  secret_hash text not null,
  installation_hash text not null,
  ip_hash text not null,
  context_ciphertext text,
  state text not null default 'pending' check(state in('pending','accepted','failed','consumed','superseded')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '5 minutes'),
  consumed_at timestamptz
);
create index if not exists phone_auth_challenges_phone on public.phone_auth_challenges(phone_hash,created_at desc);
create table if not exists public.phone_auth_rates (
  key_hash text primary key,
  window_start timestamptz not null default clock_timestamp(),
  hits integer not null default 0,
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.phone_auth_identities enable row level security;
alter table public.phone_auth_challenges enable row level security;
alter table public.phone_auth_rates enable row level security;
revoke all on public.phone_auth_identities,public.phone_auth_challenges,public.phone_auth_rates from public;
alter table public.device_sessions drop constraint if exists device_sessions_auth_method_check;
alter table public.device_sessions drop constraint if exists device_sessions_auth_method_phone_check;
alter table public.device_sessions add constraint device_sessions_auth_method_phone_check check(auth_method in('account_code','device_link','phone_otp'));
