alter table public.users
add column if not exists kryptonite_code text;

update public.users
set
  kryptonite_code = upper(kryptonite_code),
  code_suffix = right(upper(kryptonite_code), 4)
where kryptonite_code is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_kryptonite_code_format'
  ) then
    alter table public.users
    add constraint users_kryptonite_code_format
    check (kryptonite_code is null or upper(kryptonite_code) ~ '^[A-Z0-9]{16}$');
  end if;
end
$$;

create unique index if not exists idx_users_kryptonite_code
on public.users (kryptonite_code)
where kryptonite_code is not null;
