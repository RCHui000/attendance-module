begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

update auth.users
set
  role = coalesce(nullif(role, ''), 'authenticated'),
  aud = coalesce(nullif(aud, ''), 'authenticated')
where role is null
   or role = ''
   or aud is null
   or aud = '';

alter table auth.users
  alter column role set default 'authenticated',
  alter column aud set default 'authenticated';

commit;
