-- Only newly registered accounts enqueue jobs; existing accounts are not backfilled.
-- The HMAC key is APP_JWT_SECRET in the API. Raw client IP addresses are never stored.
create table if not exists public.registration_trial_ip_quota (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists idx_registration_trial_ip_quota_window
on public.registration_trial_ip_quota(window_started_at);

alter table public.registration_trial_ip_quota enable row level security;

create table if not exists public.auto_trial_provision_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  provider_username text not null unique check (provider_username ~ '^[A-Z0-9]{16}$'),
  provider_password text not null check (provider_password ~ '^[A-Z0-9]{16}$' and provider_password <> provider_username),
  status text not null default 'queued'
    check (status in ('queued', 'reconcile', 'verified', 'completed', 'review')),
  create_attempted_at timestamptz,
  provider_line_id text unique,
  provider_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  reconcile_attempt_count integer not null default 0 check (reconcile_attempt_count >= 0),
  next_attempt_at timestamptz not null default timezone('utc', now()),
  lease_until timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_auto_trial_jobs_due
on public.auto_trial_provision_jobs(status, next_attempt_at, lease_until, created_at);

drop trigger if exists auto_trial_provision_jobs_set_updated_at
on public.auto_trial_provision_jobs;

create trigger auto_trial_provision_jobs_set_updated_at
before update on public.auto_trial_provision_jobs
for each row execute function public.set_updated_at();

alter table public.auto_trial_provision_jobs enable row level security;
