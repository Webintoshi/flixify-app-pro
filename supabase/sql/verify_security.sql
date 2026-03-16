select
  schemaname,
  tablename,
  rowsecurity,
  hasrules
from pg_tables
where schemaname = 'public'
order by tablename;

select
  grantee,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

