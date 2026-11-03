alter table public.device_sessions
  add column if not exists auth_method text not null default 'account_code' check (auth_method in ('account_code','device_link')),
  add column if not exists family_id uuid;

create table if not exists public.device_login_requests (
  id uuid primary key,
  user_code text not null unique,
  secret_verifier text,
  installation_hash text,
  device_name text not null,
  platform text not null check (platform in ('android_tv','web','macos','windows')),
  state text not null default 'pending' check (state in ('pending','approved','issued','completed','denied','cancelled','expired')),
  user_id uuid references public.users(id) on delete cascade,
  approver_session_id uuid,
  expires_at timestamptz not null default (clock_timestamp() + interval '180 seconds'),
  delivery_expires_at timestamptz,
  envelope text,
  interval_seconds integer not null default 2,
  next_poll_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
create index if not exists idx_device_login_cleanup on public.device_login_requests(state, expires_at, delivery_expires_at);
create index if not exists idx_device_login_installation on public.device_login_requests(installation_hash, expires_at) where state = 'pending';
create index if not exists idx_device_login_user on public.device_login_requests(user_id);
create index if not exists idx_device_sessions_family on public.device_sessions(family_id);
create table if not exists public.device_login_rates (
  key_hash text primary key,
  window_start timestamptz not null,
  hits integer not null
);
create index if not exists idx_device_login_rates_expiry on public.device_login_rates(window_start);
alter table public.device_login_requests enable row level security;
alter table public.device_login_rates enable row level security;
