begin;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;

create or replace function public.current_employee_id()
returns bigint
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from public.employees where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.current_user_has_role(role_name text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.employees e on e.id = ur.employee_id
    where e.auth_user_id = auth.uid()
      and ur.role = role_name
  )
$$;

create or replace function public.current_user_can_review()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.current_user_has_role('admin') or public.current_user_has_role('manager')
$$;

alter function public.current_employee_id() owner to postgres;
alter function public.current_user_has_role(text) owner to postgres;
alter function public.current_user_can_review() owner to postgres;

grant execute on function public.current_employee_id() to authenticated, anon;
grant execute on function public.current_user_has_role(text) to authenticated, anon;
grant execute on function public.current_user_can_review() to authenticated, anon;

drop policy if exists "Authenticated read active projects" on public.projects;
create policy "Authenticated read active projects"
  on public.projects
  for select
  to authenticated
  using (coalesce(status, 'active') <> 'deleted');

drop policy if exists "Authenticated read organizations" on public.organizations;
create policy "Authenticated read organizations"
  on public.organizations
  for select
  to authenticated
  using (true);

drop policy if exists "Self read profile" on public.employee_profiles;
create policy "Self read profile"
  on public.employee_profiles
  for select
  to authenticated
  using (employee_id = public.current_employee_id());

commit;
