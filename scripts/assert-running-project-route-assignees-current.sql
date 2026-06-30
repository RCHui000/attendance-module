-- Verifies that active project-role approval nodes still point at the
-- currently configured project role assignee.
--
-- Run after applying migrations:
--   docker exec -i approval-postgres psql -v ON_ERROR_STOP=1 -U psa_admin -d psa \
--     < scripts/assert-running-project-route-assignees-current.sql

DO $$
DECLARE
  v_mismatch_count int;
  v_examples text;
BEGIN
  WITH active_project_nodes AS (
    SELECT
      n.id AS node_id,
      i.document_id,
      i.target_id AS timesheet_id,
      t.week_start_date,
      submitter.name AS submitter_name,
      n.scope_id AS project_id,
      project.name AS project_name,
      a.assignee_user_id AS pending_assignee_id,
      pending_assignee.name AS pending_assignee_name,
      COALESCE(
        CASE
          WHEN n.snapshot ->> 'route_source' LIKE 'project_roles:%'
            THEN regexp_replace(n.snapshot ->> 'route_source', '^project_roles:', '')
          ELSE NULL
        END,
        NULLIF(n.assignee_role, ''),
        NULLIF(n.resolver_role, '')
      ) AS effective_role_key
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    JOIN public.timesheets t ON t.id = i.target_id
    JOIN public.approval_node_assignees a ON a.node_id = n.id AND a.status = 'pending'
    LEFT JOIN public.employees submitter ON submitter.id = t.user_id
    LEFT JOIN public.employees pending_assignee ON pending_assignee.id = a.assignee_user_id
    LEFT JOIN public.projects project ON project.id = n.scope_id
    WHERE i.target_type = 'timesheet'
      AND i.status = 'running'
      AND t.status = 'submitted'
      AND n.status = 'active'
      AND n.resolver_type = 'project_role'
      AND n.scope_type = 'project'
      AND n.scope_id IS NOT NULL
  ),
  mismatches AS (
    SELECT
      active_project_nodes.*,
      resolved.assignee_user_id AS current_assignee_id,
      current_assignee.name AS current_assignee_name
    FROM active_project_nodes
    LEFT JOIN LATERAL public.psa_resolve_graph_assignees(
      active_project_nodes.document_id,
      'project_role',
      active_project_nodes.effective_role_key,
      active_project_nodes.project_id,
      false
    ) resolved ON TRUE
    LEFT JOIN public.employees current_assignee ON current_assignee.id = resolved.assignee_user_id
    WHERE resolved.assignee_user_id IS NOT NULL
      AND resolved.assignee_user_id IS DISTINCT FROM active_project_nodes.pending_assignee_id
  )
  SELECT
    count(*),
    string_agg(
      format(
        'timesheet=%s submitter=%s week=%s project=%s role=%s pending=%s current=%s',
        timesheet_id,
        submitter_name,
        week_start_date,
        project_name,
        effective_role_key,
        pending_assignee_name,
        current_assignee_name
      ),
      E'\n'
      ORDER BY timesheet_id, node_id
    )
  INTO v_mismatch_count, v_examples
  FROM mismatches;

  IF v_mismatch_count > 0 THEN
    RAISE EXCEPTION 'stale project-role pending assignees found (%): %', v_mismatch_count, v_examples;
  END IF;
END;
$$;
