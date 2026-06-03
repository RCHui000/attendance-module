-- V0.12.4 hotfix: collapse same-person project approvals into one department summary task.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_timesheet_action(
  p_timesheet_id bigint,
  p_action text,
  p_comment text DEFAULT '',
  p_task_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id bigint;
  v_sheet public.timesheets%rowtype;
  v_task public.workflow_tasks%rowtype;
  v_now timestamptz := now();
  v_changed integer := 0;
  v_pending integer := 0;
  v_project_pending integer := 0;
  v_project_count integer := 0;
  v_summary_count integer := 0;
  v_department_reviewer_id bigint;
  v_summary_first boolean := false;
  v_to_status text;
BEGIN
  v_actor_id := public.current_employee_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
    INTO v_sheet
    FROM public.timesheets
    WHERE id = p_timesheet_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet not found';
  END IF;

  IF p_action = 'submit' THEN
    IF v_sheet.user_id <> v_actor_id THEN
      RAISE EXCEPTION 'Cannot submit another employee timesheet';
    END IF;
    IF v_sheet.status NOT IN ('draft', 'rejected') THEN
      RAISE EXCEPTION 'Cannot submit current status';
    END IF;

    SELECT COUNT(DISTINCT project_id)
      INTO v_project_count
      FROM public.timesheet_entries
      WHERE timesheet_id = p_timesheet_id
        AND project_id IS NOT NULL;

    IF v_project_count = 0 THEN
      RAISE EXCEPTION 'No project rows found for timesheet';
    END IF;

    SELECT assignee_user_id
      INTO v_department_reviewer_id
      FROM public.psa_resolve_timesheet_department_reviewer(p_timesheet_id)
      LIMIT 1;

    SELECT COALESCE(COUNT(*) > 0 AND COUNT(DISTINCT assignee_user_id) = 1 AND MIN(assignee_user_id) = v_department_reviewer_id, false)
      INTO v_summary_first
      FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id) resolver
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.workflow_tasks approved
        WHERE approved.workflow_key = 'timesheet'
          AND approved.target_type = 'timesheet'
          AND approved.target_id = p_timesheet_id
          AND approved.scope_type = 'project'
          AND approved.scope_id = resolver.project_id
          AND approved.status = 'completed'
          AND approved.result_action = 'approve'
      );

    UPDATE public.timesheets
       SET status = 'submitted',
           submitted_at = v_now,
           review_comment = '',
           approved_by = NULL,
           approved_at = NULL,
           updated_at = v_now
     WHERE id = p_timesheet_id;

    UPDATE public.workflow_tasks
       SET status = 'completed',
           completed_by = v_actor_id,
           completed_at = v_now,
           result_action = 'cancelled',
           comment = COALESCE(p_comment, '')
     WHERE workflow_key = 'timesheet'
       AND target_type = 'timesheet'
       AND target_id = p_timesheet_id
       AND status = 'pending';

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
        resolver.assignee_role,
        resolver.assignee_user_id,
        v_actor_id,
        v_actor_id,
        v_now,
        'approve',
        'Auto-collapsed to department summary because project approver equals department reviewer',
        'project',
        resolver.project_id
      FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id) resolver
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.workflow_tasks approved
        WHERE approved.workflow_key = 'timesheet'
          AND approved.target_type = 'timesheet'
          AND approved.target_id = p_timesheet_id
          AND approved.scope_type = 'project'
          AND approved.scope_id = resolver.project_id
          AND approved.status = 'completed'
          AND approved.result_action = 'approve'
      );

      GET DIAGNOSTICS v_changed = ROW_COUNT;
    ELSE
      INSERT INTO public.workflow_tasks (
        workflow_key, target_type, target_id, status, assignee_role,
        assignee_user_id, created_by, scope_type, scope_id
      )
      SELECT
        'timesheet',
        'timesheet',
        p_timesheet_id,
        'pending',
        resolver.assignee_role,
        resolver.assignee_user_id,
        v_actor_id,
        'project',
        resolver.project_id
      FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id) resolver
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.workflow_tasks approved
        WHERE approved.workflow_key = 'timesheet'
          AND approved.target_type = 'timesheet'
          AND approved.target_id = p_timesheet_id
          AND approved.scope_type = 'project'
          AND approved.scope_id = resolver.project_id
          AND approved.status = 'completed'
          AND approved.result_action = 'approve'
      )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_changed = ROW_COUNT;
    END IF;

    IF v_summary_first OR v_changed = 0 THEN
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
        v_actor_id,
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
      IF v_summary_count = 0 THEN
        RAISE EXCEPTION 'No department reviewer found for timesheet';
      END IF;
    END IF;

    INSERT INTO public.approval_logs (
      target_type, target_id, actor_id, action, comment, from_status, to_status
    )
    VALUES (
      'timesheet', p_timesheet_id, v_actor_id, 'submit',
      COALESCE(p_comment, ''), v_sheet.status, 'submitted'
    );

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'submitted',
      'projectTaskCount', v_changed,
      'summaryTaskCount', v_summary_count,
      'summaryFirst', v_summary_first
    );
  END IF;

  IF p_action IN ('approve', 'reject') THEN
    IF v_sheet.status <> 'submitted' THEN
      RAISE EXCEPTION 'Cannot review current status';
    END IF;

    IF p_task_id IS NOT NULL THEN
      SELECT *
        INTO v_task
        FROM public.workflow_tasks
        WHERE id = p_task_id
          AND workflow_key = 'timesheet'
          AND target_type = 'timesheet'
          AND target_id = p_timesheet_id
          AND status = 'pending'
        FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending task not found';
      END IF;

      IF NOT (
        v_task.assignee_user_id = v_actor_id
        OR v_task.assignee_user_id IS NULL
        OR public.current_user_has_role('admin')
      ) THEN
        RAISE EXCEPTION 'No pending task assigned to current user';
      END IF;

      UPDATE public.workflow_tasks
         SET status = 'completed',
             completed_by = v_actor_id,
             completed_at = v_now,
             result_action = p_action,
             comment = COALESCE(p_comment, '')
       WHERE id = v_task.id;

      v_changed := 1;
    ELSE
      WITH selected_task AS (
        SELECT id
        FROM public.workflow_tasks
        WHERE workflow_key = 'timesheet'
          AND target_type = 'timesheet'
          AND target_id = p_timesheet_id
          AND status = 'pending'
          AND (
            assignee_user_id = v_actor_id
            OR assignee_user_id IS NULL
            OR public.current_user_has_role('admin')
          )
        ORDER BY
          CASE WHEN scope_type = 'project' THEN 0 ELSE 1 END,
          created_at ASC,
          id ASC
        LIMIT 1
      )
      UPDATE public.workflow_tasks wt
         SET status = 'completed',
             completed_by = v_actor_id,
             completed_at = v_now,
             result_action = p_action,
             comment = COALESCE(p_comment, '')
      FROM selected_task
      WHERE wt.id = selected_task.id
      RETURNING wt.* INTO v_task;

      GET DIAGNOSTICS v_changed = ROW_COUNT;
    END IF;

    IF v_changed = 0 THEN
      RAISE EXCEPTION 'No pending task assigned to current user';
    END IF;

    IF p_action = 'reject' THEN
      UPDATE public.workflow_tasks
         SET status = 'completed',
             completed_by = v_actor_id,
             completed_at = v_now,
             result_action = 'cancelled',
             comment = COALESCE(p_comment, '')
       WHERE workflow_key = 'timesheet'
         AND target_type = 'timesheet'
         AND target_id = p_timesheet_id
         AND status = 'pending';

      UPDATE public.timesheets
         SET status = 'rejected',
             review_comment = COALESCE(p_comment, ''),
             updated_at = v_now
       WHERE id = p_timesheet_id;

      v_to_status := 'rejected';
    ELSE
      IF COALESCE(v_task.scope_type, '') = 'department_summary' THEN
        UPDATE public.timesheets
           SET status = 'approved',
               approved_by = v_actor_id,
               approved_at = v_now,
               updated_at = v_now
         WHERE id = p_timesheet_id;
        v_to_status := 'approved';
      ELSE
        SELECT COUNT(*)
          INTO v_project_pending
          FROM public.workflow_tasks
         WHERE workflow_key = 'timesheet'
           AND target_type = 'timesheet'
           AND target_id = p_timesheet_id
           AND status = 'pending'
           AND scope_type = 'project';

        IF v_project_pending = 0 THEN
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
            v_actor_id,
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
        END IF;

        v_to_status := 'submitted';
      END IF;
    END IF;

    SELECT COUNT(*)
      INTO v_pending
      FROM public.workflow_tasks
     WHERE workflow_key = 'timesheet'
       AND target_type = 'timesheet'
       AND target_id = p_timesheet_id
       AND status = 'pending';

    INSERT INTO public.approval_logs (
      target_type, target_id, actor_id, action, comment, from_status, to_status
    )
    VALUES (
      'timesheet', p_timesheet_id, v_actor_id, p_action,
      COALESCE(p_comment, ''), 'submitted', v_to_status
    );

    RETURN jsonb_build_object('ok', true, 'status', v_to_status, 'pendingTaskCount', v_pending);
  END IF;

  IF p_action = 'reopen' THEN
    IF NOT (v_sheet.user_id = v_actor_id OR public.current_user_has_role('admin')) THEN
      RAISE EXCEPTION 'Cannot reopen this timesheet';
    END IF;

    UPDATE public.workflow_tasks
       SET status = 'completed',
           completed_by = v_actor_id,
           completed_at = v_now,
           result_action = 'cancelled',
           comment = COALESCE(p_comment, '')
     WHERE workflow_key = 'timesheet'
       AND target_type = 'timesheet'
       AND target_id = p_timesheet_id
       AND status = 'pending';

    UPDATE public.timesheets
       SET status = 'draft',
           approved_by = NULL,
           approved_at = NULL,
           submitted_at = NULL,
           review_comment = COALESCE(p_comment, ''),
           updated_at = v_now
     WHERE id = p_timesheet_id;

    RETURN jsonb_build_object('ok', true, 'status', 'draft');
  END IF;

  RAISE EXCEPTION 'Unknown action';
END;
$$;

ALTER FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;

WITH same_person_pending AS (
  SELECT
    t.id AS timesheet_id,
    MIN(wt.created_by) AS created_by,
    reviewer.assignee_user_id AS department_reviewer_id
  FROM public.timesheets t
  JOIN public.workflow_tasks wt
    ON wt.workflow_key = 'timesheet'
   AND wt.target_type = 'timesheet'
   AND wt.target_id = t.id
   AND wt.status = 'pending'
   AND wt.scope_type = 'project'
  JOIN LATERAL public.psa_resolve_timesheet_department_reviewer(t.id) reviewer ON true
  WHERE t.status = 'submitted'
  GROUP BY t.id, reviewer.assignee_user_id
  HAVING COUNT(*) > 0
     AND COUNT(DISTINCT wt.assignee_user_id) = 1
     AND MIN(wt.assignee_user_id) = reviewer.assignee_user_id
),
collapsed_projects AS (
  UPDATE public.workflow_tasks wt
     SET status = 'completed',
         completed_by = spp.department_reviewer_id,
         completed_at = now(),
         result_action = 'approve',
         comment = COALESCE(NULLIF(wt.comment, ''), 'Auto-collapsed to department summary because project approver equals department reviewer')
  FROM same_person_pending spp
  WHERE wt.workflow_key = 'timesheet'
    AND wt.target_type = 'timesheet'
    AND wt.target_id = spp.timesheet_id
    AND wt.status = 'pending'
    AND wt.scope_type = 'project'
  RETURNING wt.target_id
)
INSERT INTO public.workflow_tasks (
  workflow_key, target_type, target_id, status, assignee_role,
  assignee_user_id, created_by, scope_type, scope_id
)
SELECT
  'timesheet',
  'timesheet',
  spp.timesheet_id,
  'pending',
  reviewer.assignee_role,
  reviewer.assignee_user_id,
  spp.created_by,
  'department_summary',
  NULL
FROM same_person_pending spp
JOIN LATERAL public.psa_resolve_timesheet_department_reviewer(spp.timesheet_id) reviewer ON true
WHERE EXISTS (SELECT 1 FROM collapsed_projects cp WHERE cp.target_id = spp.timesheet_id)
  AND NOT EXISTS (
    SELECT 1
    FROM public.workflow_tasks existing
    WHERE existing.workflow_key = 'timesheet'
      AND existing.target_type = 'timesheet'
      AND existing.target_id = spp.timesheet_id
      AND existing.status = 'pending'
      AND existing.scope_type = 'department_summary'
  )
ON CONFLICT DO NOTHING;

COMMIT;
