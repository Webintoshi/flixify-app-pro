alter table public.users
add column if not exists registration_installation_id text,
add column if not exists deleted_at timestamptz;

create unique index if not exists idx_users_registration_installation_active_unique
on public.users (registration_installation_id)
where registration_installation_id is not null
  and deleted_at is null;

create index if not exists idx_users_registration_installation_lookup
on public.users (registration_installation_id, deleted_at);
