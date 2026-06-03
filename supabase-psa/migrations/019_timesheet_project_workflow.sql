-- V0.12.4: Route weekly timesheet approvals by project, then department summary.

BEGIN;

ALTER TABLE workflow_tasks
  ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'timesheet',
  ADD COLUMN IF NOT EXISTS scope_id BIGINT;

UPDATE workflow_tasks
SET scope_type = 'timesheet'
WHERE scope_type IS NULL;

DROP INDEX IF EXISTS idx_workflow_tasks_one_pending_assignee;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_tasks_one_pending_scope_assignee
  ON workflow_tasks(
    workflow_key,
    target_type,
    target_id,
    scope_type,
    COALESCE(scope_id, 0),
    COALESCE(assignee_user_id, 0)
  )
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_department_reviewer(p_timesheet_id bigint)
RETURNS TABLE(assignee_user_id bigint, assignee_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH sheet AS (
    SELECT user_id
    FROM public.timesheets
    WHERE id = p_timesheet_id
  ),
  employee_profile AS (
    SELECT ep.manager_user_id, ep.org_id
    FROM public.employee_profiles_v2 ep
    JOIN sheet s ON s.user_id = ep.employee_id
    LIMIT 1
  ),
  department_head AS (
    SELECT COALESCE(
      NULLIF(ep.manager_user_id, 0),
      NULLIF(org.manager_user_id, 0),
      0
    ) AS employee_id
    FROM employee_profile ep
    LEFT JOIN public.organizations org ON org.id = ep.org_id
  ),
  candidates AS (
    SELECT employee_id, 'department_head'::text AS assignee_role, 1 AS priority
    FROM department_head
    WHERE employee_id <> 0
    UNION ALL
    SELECT ur.employee_id, 'admin'::text AS assignee_role, 2 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
      AND NOT EXISTS (SELECT 1 FROM department_head WHERE employee_id <> 0)
  )
  SELECT employee_id AS assignee_user_id, assignee_role
  FROM candidates
  WHERE employee_id IS NOT NULL AND employee_id <> 0
  ORDER BY priority, employee_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_project_assignees(p_timesheet_id bigint)
RETURNS TABLE(project_id bigint, assignee_user_id bigint, assignee_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH project_scopes AS (
    SELECT DISTINCT te.project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id IS NOT NULL
  ),
  department_reviewer AS (
    SELECT assignee_user_id
    FROM public.psa_resolve_timesheet_department_reviewer(p_timesheet_id)
    LIMIT 1
  ),
  admin_reviewer AS (
    SELECT ur.employee_id
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.employee_id
    LIMIT 1
  )
  SELECT
    ps.project_id,
    COALESCE(
      NULLIF(p.project_owner_id, 0),
      NULLIF(owner_org.manager_user_id, 0),
      (SELECT assignee_user_id FROM department_reviewer),
      (SELECT employee_id FROM admin_reviewer)
    ) AS assignee_user_id,
    CASE
      WHEN NULLIF(p.project_owner_id, 0) IS NOT NULL THEN 'project_owner'
      WHEN NULLIF(owner_org.manager_user_id, 0) IS NOT NULL THEN 'project_owner'
      WHEN (SELECT assignee_user_id FROM department_reviewer) IS NOT NULL THEN 'department_head'
      ELSE 'admin'
    END AS assignee_role
  FROM project_scopes ps
  JOIN public.projects p ON p.id = ps.project_id
  LEFT JOIN public.organizations owner_org ON owner_org.id = p.owner_org_id
  WHERE COALESCE(
    NULLIF(p.project_owner_id, 0),
    NULLIF(owner_org.manager_user_id, 0),
    (SELECT assignee_user_id FROM department_reviewer),
    (SELECT employee_id FROM admin_reviewer)
  ) IS NOT NULL;
$$;

DROP FUNCTION IF EXISTS public.psa_timesheet_action(bigint, text, text);
DROP FUNCTION IF EXISTS public.psa_timesheet_action(bigint, text, text, bigint);

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

    INSERT INTO public.workflow_tasks (
      workflow_key,
      target_type,
      target_id,
      status,
      assignee_role,
      assignee_user_id,
      created_by,
      scope_type,
      scope_id
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
    );

    GET DIAGNOSTICS v_changed = ROW_COUNT;

    IF v_changed = 0 THEN
      INSERT INTO public.workflow_tasks (
        workflow_key,
        target_type,
        target_id,
        status,
        assignee_role,
        assignee_user_id,
        created_by,
        scope_type,
        scope_id
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
      );

      GET DIAGNOSTICS v_summary_count = ROW_COUNT;
      IF v_summary_count = 0 THEN
        RAISE EXCEPTION 'No approver found for timesheet';
      END IF;
    END IF;

    INSERT INTO public.approval_logs (
      target_type,
      target_id,
      actor_id,
      action,
      comment,
      from_status,
      to_status
    )
    VALUES (
      'timesheet',
      p_timesheet_id,
      v_actor_id,
      'submit',
      COALESCE(p_comment, ''),
      v_sheet.status,
      'submitted'
    );

    RETURN jsonb_build_object(
      'ok', true,
      'status', 'submitted',
      'projectTaskCount', v_changed,
      'summaryTaskCount', v_summary_count
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
        ORDER BY created_at ASC, id ASC
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
      SELECT COUNT(*)
        INTO v_project_pending
        FROM public.workflow_tasks
       WHERE workflow_key = 'timesheet'
         AND target_type = 'timesheet'
         AND target_id = p_timesheet_id
         AND status = 'pending'
         AND scope_type = 'project';

      IF v_project_pending = 0 THEN
        SELECT COUNT(*)
          INTO v_summary_count
          FROM public.workflow_tasks
         WHERE workflow_key = 'timesheet'
           AND target_type = 'timesheet'
           AND target_id = p_timesheet_id
           AND status = 'pending'
           AND scope_type = 'department_summary';

        SELECT COUNT(*)
          INTO v_project_count
          FROM public.workflow_tasks
         WHERE workflow_key = 'timesheet'
           AND target_type = 'timesheet'
           AND target_id = p_timesheet_id
           AND scope_type = 'project'
           AND status = 'completed'
           AND result_action = 'approve';

        IF v_summary_count = 0 AND v_project_count > 0 THEN
          IF COALESCE(v_task.scope_type, '') = 'department_summary' THEN
            UPDATE public.timesheets
               SET status = 'approved',
                   approved_by = v_actor_id,
                   approved_at = v_now,
                   updated_at = v_now
             WHERE id = p_timesheet_id;
            v_to_status := 'approved';
          ELSE
            INSERT INTO public.workflow_tasks (
              workflow_key,
              target_type,
              target_id,
              status,
              assignee_role,
              assignee_user_id,
              created_by,
              scope_type,
              scope_id
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
            FROM public.psa_resolve_timesheet_department_reviewer(p_timesheet_id) reviewer;

            GET DIAGNOSTICS v_summary_count = ROW_COUNT;
            IF v_summary_count = 0 THEN
              RAISE EXCEPTION 'No department reviewer found for timesheet';
            END IF;
            v_to_status := 'submitted';
          END IF;
        ELSE
          v_to_status := 'submitted';
        END IF;
      ELSE
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
      target_type,
      target_id,
      actor_id,
      action,
      comment,
      from_status,
      to_status
    )
    VALUES (
      'timesheet',
      p_timesheet_id,
      v_actor_id,
      p_action,
      COALESCE(p_comment, ''),
      'submitted',
      v_to_status
    );

    RETURN jsonb_build_object(
      'ok', true,
      'status', v_to_status,
      'pendingTaskCount', v_pending
    );
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

ALTER FUNCTION public.psa_resolve_timesheet_department_reviewer(bigint) OWNER TO postgres;
ALTER FUNCTION public.psa_resolve_timesheet_project_assignees(bigint) OWNER TO postgres;
ALTER FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.psa_resolve_timesheet_department_reviewer(bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_resolve_timesheet_project_assignees(bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;

WITH legacy_pending AS (
  UPDATE public.workflow_tasks wt
     SET status = 'completed',
         completed_at = COALESCE(wt.completed_at, now()),
         result_action = 'superseded',
         comment = COALESCE(NULLIF(wt.comment, ''), 'Migrated to project-scoped approval task')
  FROM public.timesheets t
  WHERE wt.workflow_key = 'timesheet'
    AND wt.target_type = 'timesheet'
    AND wt.target_id = t.id
    AND wt.status = 'pending'
    AND wt.scope_type = 'timesheet'
    AND t.status = 'submitted'
  RETURNING wt.target_id, wt.created_by
),
submitted_sheets AS (
  SELECT DISTINCT target_id AS timesheet_id, created_by
  FROM legacy_pending
),
project_task_insert AS (
  INSERT INTO public.workflow_tasks (
    workflow_key,
    target_type,
    target_id,
    status,
    assignee_role,
    assignee_user_id,
    created_by,
    scope_type,
    scope_id
  )
  SELECT
    'timesheet',
    'timesheet',
    ss.timesheet_id,
    'pending',
    resolver.assignee_role,
    resolver.assignee_user_id,
    ss.created_by,
    'project',
    resolver.project_id
  FROM submitted_sheets ss
  CROSS JOIN LATERAL public.psa_resolve_timesheet_project_assignees(ss.timesheet_id) resolver
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.workflow_tasks approved
    WHERE approved.workflow_key = 'timesheet'
      AND approved.target_type = 'timesheet'
      AND approved.target_id = ss.timesheet_id
      AND approved.scope_type = 'project'
      AND approved.scope_id = resolver.project_id
      AND approved.status = 'completed'
      AND approved.result_action = 'approve'
  )
  ON CONFLICT DO NOTHING
  RETURNING target_id
)
INSERT INTO public.workflow_tasks (
  workflow_key,
  target_type,
  target_id,
  status,
  assignee_role,
  assignee_user_id,
  created_by,
  scope_type,
  scope_id
)
SELECT
  'timesheet',
  'timesheet',
  ss.timesheet_id,
  'pending',
  reviewer.assignee_role,
  reviewer.assignee_user_id,
  ss.created_by,
  'department_summary',
  NULL
FROM submitted_sheets ss
CROSS JOIN LATERAL public.psa_resolve_timesheet_department_reviewer(ss.timesheet_id) reviewer
WHERE NOT EXISTS (
    SELECT 1
    FROM project_task_insert inserted_project
    WHERE inserted_project.target_id = ss.timesheet_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.workflow_tasks pending_project
    WHERE pending_project.workflow_key = 'timesheet'
      AND pending_project.target_type = 'timesheet'
      AND pending_project.target_id = ss.timesheet_id
      AND pending_project.scope_type = 'project'
      AND pending_project.status = 'pending'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.workflow_tasks pending_summary
    WHERE pending_summary.workflow_key = 'timesheet'
      AND pending_summary.target_type = 'timesheet'
      AND pending_summary.target_id = ss.timesheet_id
      AND pending_summary.scope_type = 'department_summary'
      AND pending_summary.status = 'pending'
  )
ON CONFLICT DO NOTHING;

COMMIT;
