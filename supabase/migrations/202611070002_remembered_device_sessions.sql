alter table public.device_sessions alter column expires_at drop not null;
alter table public.device_sessions alter column expires_at drop default;
create table if not exists public.session_refresh_rotations (
  predecessor_id uuid primary key references public.device_sessions(id) on delete cascade,
  successor_id uuid not null unique references public.device_sessions(id) on delete cascade,
  predecessor_revoked_at timestamptz not null,
  response_ciphertext text,
  created_at timestamptz not null default clock_timestamp(),
  adopted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  check(predecessor_id<>successor_id)
);
create index if not exists session_refresh_rotations_cleanup on public.session_refresh_rotations(expires_at)
where response_ciphertext is not null;
alter table public.session_refresh_rotations enable row level security;
revoke all on public.session_refresh_rotations from public;
