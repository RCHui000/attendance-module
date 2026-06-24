BEGIN;

DO $$
DECLARE
  v_timesheet_id bigint;
  v_round_id bigint;
  v_project_owner_status text;
  v_department_owner_status text;
  v_department_owner_assignee bigint;
BEGIN
  INSERT INTO public.timesheets(user_id, week_start_date, status, submitted_at)
  VALUES (42, DATE '2099-01-05', 'submitted', now())
  RETURNING id INTO v_timesheet_id;

  INSERT INTO public.timesheet_entries(timesheet_id, project_id, work_date, hours)
  VALUES (v_timesheet_id, 24, DATE '2099-01-05', 1.0);

  SELECT round_id INTO v_round_id
  FROM public.submit_document(
    'timesheet',
    v_timesheet_id,
    1,
    NULL,
    42,
    '{}'::jsonb,
    'smoke-collaboration-routing'
  );

  SELECT status INTO v_project_owner_status
  FROM public.approval_nodes
  WHERE round_id = v_round_id
    AND scope_id = 24
    AND template_node_key = 'cc_project_owner'
  LIMIT 1;

  SELECT status, assignee_user_id
    INTO v_department_owner_status, v_department_owner_assignee
  FROM public.approval_nodes
  WHERE round_id = v_round_id
    AND scope_id = 24
    AND template_node_key = 'cc_department_owner'
  LIMIT 1;

  IF v_project_owner_status <> 'skipped' THEN
    RAISE EXCEPTION 'Expected submitter-owned project owner node to be skipped, got %', v_project_owner_status;
  END IF;

  IF v_department_owner_status <> 'active' OR v_department_owner_assignee <> 18 THEN
    RAISE EXCEPTION 'Expected department owner node active for employee 18, got status %, assignee %',
      v_department_owner_status, v_department_owner_assignee;
  END IF;
END $$;

ROLLBACK;
