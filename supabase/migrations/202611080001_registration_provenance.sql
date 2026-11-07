do $migration$
declare
  field_name text;
  field_info record;
  constraint_name text;
  expression text;
  expected_expression text;
begin
  if to_regclass('public.users') is null then
    raise exception 'Registration provenance requires public.users';
  end if;
  foreach field_name in array array['registration_method','registration_platform'] loop
    select a.atttypid,a.attnotnull,a.atthasdef,a.attgenerated,a.attidentity into field_info
      from pg_attribute a where a.attrelid='public.users'::regclass and a.attname=field_name and not a.attisdropped;
    if not found then
      execute format('alter table public.users add column %I text',field_name);
    elsif field_info.atttypid<>'text'::regtype or field_info.attnotnull or field_info.atthasdef
        or field_info.attgenerated<>'' or field_info.attidentity<>'' then
      raise exception 'Incompatible existing registration provenance column: %',field_name;
    end if;
  end loop;
  foreach field_name in array array['registration_method','registration_platform'] loop
    constraint_name='users_'||field_name||'_check';
    expected_expression=case field_name
      when 'registration_method' then '(registration_method = ANY (ARRAY[''phone_otp''::text, ''account_code''::text]))'
      else '(registration_platform = ANY (ARRAY[''web''::text, ''android_tv''::text, ''android_phone''::text, ''macos''::text, ''windows''::text]))'
    end;
    select pg_get_expr(c.conbin,c.conrelid) into expression from pg_constraint c
      where c.conrelid='public.users'::regclass and c.conname=constraint_name and c.contype='c' and c.convalidated;
    if found then
      if regexp_replace(expression,'[[:space:]]','','g')<>regexp_replace(expected_expression,'[[:space:]]','','g') then
        raise exception 'Incompatible existing registration provenance constraint: %',constraint_name;
      end if;
    elsif exists(select 1 from pg_constraint c where c.conrelid='public.users'::regclass and c.conname=constraint_name) then
      raise exception 'Incompatible existing registration provenance constraint: %',constraint_name;
    else
      execute format('alter table public.users add constraint %I check (%s)',constraint_name,expected_expression);
    end if;
  end loop;
end
$migration$;
