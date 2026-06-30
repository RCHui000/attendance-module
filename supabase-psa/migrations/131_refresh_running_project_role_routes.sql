-- V0.18.33: refresh unresolved/running project-role approval graph routes.
--
-- Project role edits already call psa_refresh_pending_project_review_routes from
-- the frontend, but the graph-era implementation was a no-op. That left active
-- pending tasks assigned to old project owners after role reassignment.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_refresh_running_project_review_routes(
  p_project_id bigint DEFAULT NULL,
  p_timesheet_id bigint DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_node record;
  v_resolved_assignee_user_id bigint;
  v_route_source text;
  v_matched_org_id bigint;
  v_nodes_considered int := 0;
  v_nodes_refreshed int := 0;
  v_active_nodes_refreshed int := 0;
  v_assignees_cancelled int := 0;
  v_assignees_activated int := 0;
  v_unresolved_nodes int := 0;
  v_row_count int := 0;
  v_reason text := COALESCE(NULLIF(p_reason, ''), 'project role route refresh');
BEGIN
  FOR v_node IN
    SELECT
      n.id AS node_id,
      n.status AS node_status,
      n.assignee_user_id AS current_node_assignee_id,
      n.assignee_role AS current_node_assignee_role,
      n.resolver_role,
      n.snapshot,
      i.document_id,
      i.target_id AS timesheet_id,
      n.scope_id AS project_id,
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
    WHERE i.target_type = 'timesheet'
      AND i.status = 'running'
      AND t.status = 'submitted'
      AND n.status IN ('active', 'waiting', 'pending')
      AND n.resolver_type = 'project_role'
      AND n.scope_type = 'project'
      AND n.scope_id IS NOT NULL
      AND (p_project_id IS NULL OR n.scope_id = p_project_id)
      AND (p_timesheet_id IS NULL OR i.target_id = p_timesheet_id)
    ORDER BY n.id
  LOOP
    v_nodes_considered := v_nodes_considered + 1;

    IF v_node.effective_role_key IS NULL THEN
      v_unresolved_nodes := v_unresolved_nodes + 1;
      CONTINUE;
    END IF;

    v_resolved_assignee_user_id := NULL;
    v_route_source := NULL;
    v_matched_org_id := NULL;

    SELECT
      route.assignee_user_id,
      route.route_source,
      route.matched_org_id
      INTO v_resolved_assignee_user_id, v_route_source, v_matched_org_id
    FROM public.psa_resolve_graph_assignees(
      v_node.document_id,
      'project_role',
      v_node.effective_role_key,
      v_node.project_id,
      false
    ) route
    LIMIT 1;

    IF v_resolved_assignee_user_id IS NULL THEN
      v_unresolved_nodes := v_unresolved_nodes + 1;
      CONTINUE;
    END IF;

    IF v_resolved_assignee_user_id IS DISTINCT FROM v_node.current_node_assignee_id
       OR v_node.current_node_assignee_role IS DISTINCT FROM v_node.effective_role_key THEN
      UPDATE public.approval_nodes
      SET
        assignee_user_id = v_resolved_assignee_user_id,
        assignee_role = v_node.effective_role_key,
        snapshot = COALESCE(snapshot, '{}'::jsonb) || jsonb_build_object(
          'resolved_assignee_user_id', v_resolved_assignee_user_id,
          'route_source', v_route_source,
          'matched_org_id', v_matched_org_id,
          'route_refreshed_at', NOW(),
          'route_refresh_reason', v_reason,
          'previous_assignee_user_id', v_node.current_node_assignee_id
        ),
        updated_at = NOW()
      WHERE id = v_node.node_id;

      v_nodes_refreshed := v_nodes_refreshed + 1;
      IF v_node.node_status = 'active' THEN
        v_active_nodes_refreshed := v_active_nodes_refreshed + 1;
      END IF;
    END IF;

    IF v_node.node_status = 'active' THEN
      UPDATE public.approval_node_assignees
      SET
        status = 'cancelled',
        action = 'cancelled',
        comment = v_reason,
        acted_at = NOW()
      WHERE node_id = v_node.node_id
        AND status = 'pending'
        AND assignee_user_id IS DISTINCT FROM v_resolved_assignee_user_id;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_assignees_cancelled := v_assignees_cancelled + v_row_count;

      INSERT INTO public.approval_node_assignees (
        node_id,
        assignee_user_id,
        assignee_employee_id,
        assignee_org_id,
        status
      )
      VALUES (
        v_node.node_id,
        v_resolved_assignee_user_id,
        v_resolved_assignee_user_id,
        v_matched_org_id,
        'pending'
      )
      ON CONFLICT (node_id, assignee_user_id)
      DO UPDATE SET
        assignee_employee_id = EXCLUDED.assignee_employee_id,
        assignee_org_id = EXCLUDED.assignee_org_id,
        status = 'pending',
        action = NULL,
        comment = NULL,
        acted_at = NULL
      WHERE public.approval_node_assignees.status IN ('pending', 'cancelled', 'skipped', 'delegated')
        AND (
          public.approval_node_assignees.status <> 'pending'
          OR public.approval_node_assignees.assignee_employee_id IS DISTINCT FROM EXCLUDED.assignee_employee_id
          OR public.approval_node_assignees.assignee_org_id IS DISTINCT FROM EXCLUDED.assignee_org_id
          OR public.approval_node_assignees.action IS NOT NULL
          OR public.approval_node_assignees.comment IS NOT NULL
          OR public.approval_node_assignees.acted_at IS NOT NULL
        );

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_assignees_activated := v_assignees_activated + v_row_count;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'storage', 'approval_graph',
    'project_id', p_project_id,
    'timesheet_id', p_timesheet_id,
    'reason', v_reason,
    'nodes_considered', v_nodes_considered,
    'nodes_refreshed', v_nodes_refreshed,
    'active_nodes_refreshed', v_active_nodes_refreshed,
    'assignees_cancelled', v_assignees_cancelled,
    'assignees_activated', v_assignees_activated,
    'unresolved_nodes', v_unresolved_nodes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_refresh_pending_project_review_routes(
  p_project_id bigint,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.psa_refresh_running_project_review_routes(p_project_id, NULL, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_refresh_timesheet_routes(
  p_timesheet_id bigint,
  p_project_id bigint DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.psa_refresh_running_project_review_routes(p_project_id, p_timesheet_id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_refresh_project_timesheet_routes(
  p_project_id bigint,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.psa_refresh_pending_project_review_routes(p_project_id, p_reason);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'ALTER FUNCTION public.psa_refresh_running_project_review_routes(bigint, bigint, text) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) OWNER TO postgres';
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'psa_admin') THEN
    EXECUTE 'ALTER FUNCTION public.psa_refresh_running_project_review_routes(bigint, bigint, text) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) OWNER TO psa_admin';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.psa_refresh_running_project_review_routes(bigint, bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) TO authenticated;

SELECT public.psa_refresh_running_project_review_routes(
  NULL,
  NULL,
  'V0.18.33 repair stale running project-role approval routes'
);

NOTIFY pgrst, 'reload schema';

COMMIT;
