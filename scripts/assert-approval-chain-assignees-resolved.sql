DO $$
DECLARE
  v_unresolved_count integer;
  v_admin_sub text;
BEGIN
  SELECT e.auth_user_id::text INTO v_admin_sub
  FROM public.user_roles ur
  JOIN public.employees e ON e.id = ur.employee_id
  WHERE ur.role = 'admin'
    AND e.auth_user_id IS NOT NULL
  ORDER BY ur.employee_id
  LIMIT 1;

  IF v_admin_sub IS NULL THEN
    RAISE NOTICE 'No admin auth user found; skipping approval-chain assignee resolution assertion.';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_admin_sub, true);

  WITH running_timesheets AS (
    SELECT i.target_id AS timesheet_id
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.status = 'running'
    ORDER BY i.updated_at DESC NULLS LAST, i.id DESC
    LIMIT 50
  ),
  chain_rows AS (
    SELECT rt.timesheet_id, c.*
    FROM running_timesheets rt
    CROSS JOIN LATERAL public.psa_timesheet_approval_chain(rt.timesheet_id) c
  ),
  assignee_rows AS (
    SELECT
      cr.timesheet_id,
      cr.node_id,
      cr.node_name,
      cr.node_status,
      assignee
    FROM chain_rows cr
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(cr.assignees, '[]'::jsonb)) assignee
    WHERE cr.node_status IN ('waiting', 'active', 'pending', 'needs_reapproval')
  )
  SELECT count(*) INTO v_unresolved_count
  FROM assignee_rows
  WHERE COALESCE((assignee ->> 'assignee_user_id')::bigint, 0) = 0
     OR COALESCE(NULLIF(btrim(assignee ->> 'assignee_name'), ''), '') = '';

  IF v_unresolved_count <> 0 THEN
    RAISE EXCEPTION 'Found % unresolved approval-chain assignees in running timesheets', v_unresolved_count;
  END IF;
END $$;
