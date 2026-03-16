alter table public.users
add column if not exists deleted_at timestamptz;

create index if not exists idx_users_deleted_lookup
on public.users(deleted_at, status, created_at desc);
