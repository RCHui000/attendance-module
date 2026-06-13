-- V0.12: Atomic timesheet workflow transitions for PostgREST clients.

begin;

create or replace function public.psa_resolve_timesheet_assignees(p_timesheet_id bigint)
returns table(assignee_user_id bigint, assignee_role text)
language sql
stable
security definer
set search_path = public, auth
as $$
  with sheet as (
    select user_id
    from public.timesheets
    where id = p_timesheet_id
  ),
  employee_profile as (
    select ep.manager_user_id, ep.org_id
    from public.employee_profiles ep
    join sheet s on s.user_id = ep.employee_id
    limit 1
  ),
  department_head as (
    select coalesce(
      nullif(ep.manager_user_id, 0),
      nullif(org.manager_user_id, 0),
      0
    ) as employee_id
    from employee_profile ep
    left join public.organizations org on org.id = ep.org_id
  ),
  project_heads as (
    select coalesce(
      nullif(p.project_owner_id, 0),
      nullif(owner_org.manager_user_id, 0),
      nullif((select employee_id from department_head), 0),
      0
    ) as employee_id
    from public.timesheet_entries te
    join public.projects p on p.id = te.project_id
    left join public.organizations owner_org on owner_org.id = p.owner_org_id
    where te.timesheet_id = p_timesheet_id
  ),
  candidates as (
    select employee_id, 'project_owner'::text as assignee_role, 1 as priority
    from project_heads
    where employee_id <> 0
    union all
    select employee_id, 'department_head'::text as assignee_role, 2 as priority
    from department_head
    where employee_id <> 0
    union all
    select ur.employee_id, 'admin'::text as assignee_role, 3 as priority
    from public.user_roles ur
    where ur.role = 'admin'
      and not exists (select 1 from project_heads where employee_id <> 0)
      and not exists (select 1 from department_head where employee_id <> 0)
    order by priority
    limit 20
  )
  select distinct on (employee_id)
    employee_id as assignee_user_id,
    assignee_role
  from candidates
  where employee_id is not null and employee_id <> 0
  order by employee_id, priority;
$$;

create or replace function public.psa_timesheet_action(
  p_timesheet_id bigint,
  p_action text,
  p_comment text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor_id bigint;
  v_sheet public.timesheets%rowtype;
  v_now timestamptz := now();
  v_changed integer := 0;
  v_pending integer := 0;
  v_to_status text;
begin
  v_actor_id := public.current_employee_id();
  if v_actor_id is null then
    raise exception 'Not authenticated';
  end if;

  select *
    into v_sheet
    from public.timesheets
    where id = p_timesheet_id
    for update;

  if not found then
    raise exception 'Timesheet not found';
  end if;

  if p_action = 'submit' then
    if v_sheet.user_id <> v_actor_id then
      raise exception 'Cannot submit another employee timesheet';
    end if;
    if v_sheet.status not in ('draft', 'rejected') then
      raise exception 'Cannot submit current status';
    end if;

    update public.timesheets
       set status = 'submitted',
           submitted_at = v_now,
           review_comment = '',
           approved_by = null,
           approved_at = null,
           updated_at = v_now
     where id = p_timesheet_id;

    update public.workflow_tasks
       set status = 'completed',
           completed_by = v_actor_id,
           completed_at = v_now,
           result_action = 'cancelled',
           comment = coalesce(p_comment, '')
     where workflow_key = 'timesheet'
       and target_type = 'timesheet'
       and target_id = p_timesheet_id
       and status = 'pending';

    insert into public.workflow_tasks (
      workflow_key,
      target_type,
      target_id,
      status,
      assignee_role,
      assignee_user_id,
      created_by
    )
    select
      'timesheet',
      'timesheet',
      p_timesheet_id,
      'pending',
      assignee_role,
      assignee_user_id,
      v_actor_id
    from public.psa_resolve_timesheet_assignees(p_timesheet_id);

    get diagnostics v_changed = row_count;
    if v_changed = 0 then
      raise exception 'No approver found for timesheet';
    end if;

    return jsonb_build_object('ok', true, 'status', 'submitted', 'taskCount', v_changed);
  end if;

  if p_action in ('approve', 'reject') then
    if v_sheet.status <> 'submitted' then
      raise exception 'Cannot review current status';
    end if;
    if not public.current_user_can_review() then
      raise exception 'Current user cannot review timesheets';
    end if;

    update public.workflow_tasks
       set status = 'completed',
           completed_by = v_actor_id,
           completed_at = v_now,
           result_action = p_action,
           comment = coalesce(p_comment, '')
     where workflow_key = 'timesheet'
       and target_type = 'timesheet'
       and target_id = p_timesheet_id
       and status = 'pending'
       and (
         assignee_user_id = v_actor_id
         or assignee_user_id is null
         or public.current_user_has_role('admin')
       );

    get diagnostics v_changed = row_count;
    if v_changed = 0 then
      raise exception 'No pending task assigned to current user';
    end if;

    if p_action = 'reject' then
      update public.workflow_tasks
         set status = 'completed',
             completed_by = v_actor_id,
             completed_at = v_now,
             result_action = 'cancelled',
             comment = coalesce(p_comment, '')
       where workflow_key = 'timesheet'
         and target_type = 'timesheet'
         and target_id = p_timesheet_id
         and status = 'pending';

      update public.timesheets
         set status = 'rejected',
             review_comment = coalesce(p_comment, ''),
             updated_at = v_now
       where id = p_timesheet_id;

      v_to_status := 'rejected';
    else
      select count(*)
        into v_pending
        from public.workflow_tasks
       where workflow_key = 'timesheet'
         and target_type = 'timesheet'
         and target_id = p_timesheet_id
         and status = 'pending';

      if v_pending = 0 then
        update public.timesheets
           set status = 'approved',
               approved_by = v_actor_id,
               approved_at = v_now,
               updated_at = v_now
         where id = p_timesheet_id;
        v_to_status := 'approved';
      else
        v_to_status := 'submitted';
      end if;
    end if;

    insert into public.approval_logs (
      target_type,
      target_id,
      actor_id,
      action,
      comment,
      from_status,
      to_status
    )
    values (
      'timesheet',
      p_timesheet_id,
      v_actor_id,
      p_action,
      coalesce(p_comment, ''),
      'submitted',
      v_to_status
    );

    return jsonb_build_object('ok', true, 'status', v_to_status, 'pendingTaskCount', v_pending);
  end if;

  if p_action = 'reopen' then
    if not (v_sheet.user_id = v_actor_id or public.current_user_has_role('admin')) then
      raise exception 'Cannot reopen this timesheet';
    end if;

    update public.workflow_tasks
       set status = 'completed',
           completed_by = v_actor_id,
           completed_at = v_now,
           result_action = 'cancelled',
           comment = coalesce(p_comment, '')
     where workflow_key = 'timesheet'
       and target_type = 'timesheet'
       and target_id = p_timesheet_id
       and status = 'pending';

    update public.timesheets
       set status = 'draft',
           approved_by = null,
           approved_at = null,
           submitted_at = null,
           review_comment = coalesce(p_comment, ''),
           updated_at = v_now
     where id = p_timesheet_id;

    return jsonb_build_object('ok', true, 'status', 'draft');
  end if;

  raise exception 'Unknown action';
end;
$$;

alter function public.psa_resolve_timesheet_assignees(bigint) owner to postgres;
alter function public.psa_timesheet_action(bigint, text, text) owner to postgres;

revoke all on function public.psa_resolve_timesheet_assignees(bigint) from public, anon, authenticated;
revoke all on function public.psa_timesheet_action(bigint, text, text) from public, anon, authenticated;
grant execute on function public.psa_timesheet_action(bigint, text, text) to authenticated;

commit;
