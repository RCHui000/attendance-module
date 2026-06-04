-- V0.12.6: Recalculate pending timesheet approval routes after project owner changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_refresh_timesheet_routes(
  p_timesheet_id bigint,
  p_project_id bigint DEFAULT NULL,
  p_reason text DEFAULT 'Route refreshed after project owner change'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id bigint;
  v_sheet public.timesheets%rowtype;
  v_now timestamptz := now();
  v_created_by bigint;
  v_department_reviewer_id bigint;
  v_project_count integer := 0;
  v_unresolved_count integer := 0;
  v_cancelled_count integer := 0;
  v_superseded_count integer := 0;
  v_inserted_project_count integer := 0;
  v_auto_approved_count integer := 0;
  v_summary_count integer := 0;
  v_summary_first boolean := false;
BEGIN
  v_actor_id := public.current_employee_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only admins can refresh timesheet routes';
  END IF;

  SELECT *
    INTO v_sheet
    FROM public.timesheets
    WHERE id = p_timesheet_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet not found';
  END IF;

  IF v_sheet.status <> 'submitted' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'timesheet is not submitted');
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id = p_project_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'project is not in timesheet');
  END IF;

  SELECT COALESCE(MIN(created_by), v_sheet.user_id, v_actor_id)
    INTO v_created_by
    FROM public.workflow_tasks
    WHERE workflow_key = 'timesheet'
      AND target_type = 'timesheet'
      AND target_id = p_timesheet_id;

  SELECT assignee_user_id
    INTO v_department_reviewer_id
    FROM public.psa_resolve_timesheet_department_reviewer(p_timesheet_id)
    LIMIT 1;

  IF v_department_reviewer_id IS NULL THEN
    RAISE EXCEPTION 'No department reviewer found for timesheet';
  END IF;

  SELECT COUNT(*)
    INTO v_project_count
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id);

  IF v_project_count = 0 THEN
    RAISE EXCEPTION 'No project approvers found for timesheet';
  END IF;

  WITH current_routes AS (
    SELECT project_id, assignee_user_id, assignee_role
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id)
  ),
  superseded AS (
    UPDATE public.workflow_tasks wt
       SET result_action = 'superseded',
           comment = COALESCE(NULLIF(wt.comment, ''), p_reason),
           completed_at = COALESCE(wt.completed_at, v_now),
           completed_by = COALESCE(wt.completed_by, v_actor_id)
      FROM current_routes route
     WHERE wt.workflow_key = 'timesheet'
       AND wt.target_type = 'timesheet'
       AND wt.target_id = p_timesheet_id
       AND wt.scope_type = 'project'
       AND wt.scope_id = route.project_id
       AND wt.status = 'completed'
       AND wt.result_action = 'approve'
       AND (p_project_id IS NULL OR wt.scope_id = p_project_id)
       AND (
         COALESCE(wt.assignee_user_id, 0) <> COALESCE(route.assignee_user_id, 0)
         OR COALESCE(wt.assignee_role, '') <> COALESCE(route.assignee_role, '')
       )
    RETURNING wt.id
  )
  SELECT COUNT(*) INTO v_superseded_count FROM superseded;

  WITH current_routes AS (
    SELECT project_id, assignee_user_id, assignee_role
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id)
  ),
  unresolved_routes AS (
    SELECT route.*
    FROM current_routes route
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workflow_tasks approved
      WHERE approved.workflow_key = 'timesheet'
        AND approved.target_type = 'timesheet'
        AND approved.target_id = p_timesheet_id
        AND approved.scope_type = 'project'
        AND approved.scope_id = route.project_id
        AND approved.status = 'completed'
        AND approved.result_action = 'approve'
    )
  ),
  cancelled AS (
    UPDATE public.workflow_tasks wt
       SET status = 'completed',
           completed_by = v_actor_id,
           completed_at = v_now,
           result_action = 'cancelled',
           comment = COALESCE(NULLIF(p_reason, ''), 'Route refreshed')
     WHERE wt.workflow_key = 'timesheet'
       AND wt.target_type = 'timesheet'
       AND wt.target_id = p_timesheet_id
       AND wt.status = 'pending'
       AND (
         wt.scope_type = 'department_summary'
         OR (
           wt.scope_type = 'project'
           AND (
             NOT EXISTS (
               SELECT 1
               FROM unresolved_routes route
               WHERE route.project_id = wt.scope_id
                 AND route.assignee_user_id = wt.assignee_user_id
                 AND route.assignee_role = wt.assignee_role
             )
             OR p_project_id IS NULL
             OR wt.scope_id = p_project_id
           )
         )
       )
    RETURNING wt.id
  )
  SELECT COUNT(*) INTO v_cancelled_count FROM cancelled;

  SELECT COUNT(*)
    INTO v_unresolved_count
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id) route
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workflow_tasks approved
      WHERE approved.workflow_key = 'timesheet'
        AND approved.target_type = 'timesheet'
        AND approved.target_id = p_timesheet_id
        AND approved.scope_type = 'project'
        AND approved.scope_id = route.project_id
        AND approved.status = 'completed'
        AND approved.result_action = 'approve'
    );

  SELECT COALESCE(
      v_unresolved_count > 0
      AND COUNT(*) = v_unresolved_count
      AND COUNT(DISTINCT route.assignee_user_id) = 1
      AND MIN(route.assignee_user_id) = v_department_reviewer_id,
      false
    )
    INTO v_summary_first
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id) route
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workflow_tasks approved
      WHERE approved.workflow_key = 'timesheet'
        AND approved.target_type = 'timesheet'
        AND approved.target_id = p_timesheet_id
        AND approved.scope_type = 'project'
        AND approved.scope_id = route.project_id
        AND approved.status = 'completed'
        AND approved.result_action = 'approve'
    );

  IF v_summary_first THEN
    INSERT INTO public.workflow_tasks (
      workflow_key, target_type, target_id, status, assignee_role,
      assignee_user_id, created_by, completed_by, completed_at,
      result_action, comment, scope_type, scope_id
    )
    SELECT
      'timesheet',
      'timesheet',
      p_timesheet_id,
      'completed',
      route.assignee_role,
      route.assignee_user_id,
      v_created_by,
      v_actor_id,
      v_now,
      'approve',
      'Auto-collapsed to department summary because project approver equals department reviewer',
      'project',
      route.project_id
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id) route
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workflow_tasks approved
      WHERE approved.workflow_key = 'timesheet'
        AND approved.target_type = 'timesheet'
        AND approved.target_id = p_timesheet_id
        AND approved.scope_type = 'project'
        AND approved.scope_id = route.project_id
        AND approved.status = 'completed'
        AND approved.result_action = 'approve'
    );

    GET DIAGNOSTICS v_auto_approved_count = ROW_COUNT;
  ELSIF v_unresolved_count > 0 THEN
    INSERT INTO public.workflow_tasks (
      workflow_key, target_type, target_id, status, assignee_role,
      assignee_user_id, created_by, scope_type, scope_id
    )
    SELECT
      'timesheet',
      'timesheet',
      p_timesheet_id,
      'pending',
      route.assignee_role,
      route.assignee_user_id,
      v_created_by,
      'project',
      route.project_id
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id) route
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workflow_tasks approved
      WHERE approved.workflow_key = 'timesheet'
        AND approved.target_type = 'timesheet'
        AND approved.target_id = p_timesheet_id
        AND approved.scope_type = 'project'
        AND approved.scope_id = route.project_id
        AND approved.status = 'completed'
        AND approved.result_action = 'approve'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM public.workflow_tasks pending
        WHERE pending.workflow_key = 'timesheet'
          AND pending.target_type = 'timesheet'
          AND pending.target_id = p_timesheet_id
          AND pending.scope_type = 'project'
          AND pending.scope_id = route.project_id
          AND pending.assignee_user_id = route.assignee_user_id
          AND pending.status = 'pending'
      )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_inserted_project_count = ROW_COUNT;
  END IF;

  IF v_summary_first OR v_unresolved_count = 0 THEN
    INSERT INTO public.workflow_tasks (
      workflow_key, target_type, target_id, status, assignee_role,
      assignee_user_id, created_by, scope_type, scope_id
    )
    SELECT
      'timesheet',
      'timesheet',
      p_timesheet_id,
      'pending',
      reviewer.assignee_role,
      reviewer.assignee_user_id,
      v_created_by,
      'department_summary',
      NULL
    FROM public.psa_resolve_timesheet_department_reviewer(p_timesheet_id) reviewer
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.workflow_tasks existing
      WHERE existing.workflow_key = 'timesheet'
        AND existing.target_type = 'timesheet'
        AND existing.target_id = p_timesheet_id
        AND existing.scope_type = 'department_summary'
        AND existing.status = 'pending'
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_summary_count = ROW_COUNT;
  END IF;

  INSERT INTO public.approval_logs (
    target_type, target_id, actor_id, action, comment, from_status, to_status
  )
  VALUES (
    'timesheet', p_timesheet_id, v_actor_id, 'refresh_routes',
    COALESCE(p_reason, ''), 'submitted', 'submitted'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'timesheetId', p_timesheet_id,
    'projectId', p_project_id,
    'supersededCount', v_superseded_count,
    'cancelledCount', v_cancelled_count,
    'insertedProjectTaskCount', v_inserted_project_count,
    'autoApprovedProjectCount', v_auto_approved_count,
    'summaryTaskCount', v_summary_count,
    'summaryFirst', v_summary_first
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_refresh_project_timesheet_routes(
  p_project_id bigint,
  p_reason text DEFAULT 'Route refreshed after project owner change'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id bigint;
  v_sheet record;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_refreshed integer := 0;
BEGIN
  v_actor_id := public.current_employee_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only admins can refresh project routes';
  END IF;

  FOR v_sheet IN
    SELECT DISTINCT t.id
    FROM public.timesheets t
    JOIN public.timesheet_entries te ON te.timesheet_id = t.id
    WHERE t.status = 'submitted'
      AND te.project_id = p_project_id
    ORDER BY t.id
  LOOP
    v_result := public.psa_refresh_timesheet_routes(v_sheet.id, p_project_id, p_reason);
    v_results := v_results || jsonb_build_array(v_result);
    v_refreshed := v_refreshed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'projectId', p_project_id,
    'refreshedTimesheetCount', v_refreshed,
    'results', v_results
  );
END;
$$;

ALTER FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) OWNER TO postgres;
ALTER FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) TO authenticated;

COMMIT;
