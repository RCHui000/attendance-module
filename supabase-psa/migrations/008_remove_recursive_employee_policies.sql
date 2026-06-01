begin;

drop policy if exists "Admin read all employees" on public.employees;
drop policy if exists "Manager read org employees" on public.employees;

drop policy if exists "Self read employee" on public.employees;
create policy "Self read employee"
  on public.employees
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "Reviewer read employees" on public.employees;
create policy "Reviewer read employees"
  on public.employees
  for select
  to authenticated
  using (public.current_user_can_review());

commit;
