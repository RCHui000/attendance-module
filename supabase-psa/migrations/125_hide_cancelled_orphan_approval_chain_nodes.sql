BEGIN;

CREATE OR REPLACE FUNCTION public.psa_timesheet_approval_chain(p_timesheet_id bigint)
RETURNS TABLE (
  node_id bigint,
  node_key text,
  node_name text,
  scope_type text,
  scope_id bigint,
  node_status text,
  assignee_role text,
  resolver_role text,
  approval_policy text,
  sort_order integer,
  activated_at timestamptz,
  completed_at timestamptz,
  result_action text,
  comment text,
  can_current_user_act boolean,
  assignees jsonb,
  blocking_nodes jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH instance_row AS (
    SELECT i.*
    FROM public.approval_instances i
    WHERE COALESCE(i.target_type, '') = 'timesheet'
      AND i.target_id = p_timesheet_id
    ORDER BY CASE WHEN i.status = 'running' THEN 0 ELSE 1 END, i.id DESC
    LIMIT 1
  ),
  runtime_nodes AS (
    SELECT
      n.*,
      i.document_id,
      p.code AS project_code,
      p.name AS project_name,
      CASE
        WHEN n.scope_type = 'project' THEN 'project'
        WHEN n.scope_type = 'department_summary' THEN 'department_summary'
        ELSE COALESCE(NULLIF(n.scope_type, ''), 'template_node')
      END AS projection_scope_type,
      CASE
        WHEN n.scope_type = 'project' THEN 0
        WHEN n.scope_type = 'department_summary' THEN 1
        ELSE 0
      END AS projection_scope_rank
    FROM instance_row i
    JOIN public.approval_nodes n ON n.instance_id = i.id
    LEFT JOIN public.projects p ON p.id = n.scope_id AND n.scope_type = 'project'
    WHERE COALESCE(n.status, '') <> 'cancelled'
  ),
  template_nodes AS (
    SELECT
      tn.id,
      tn.node_key,
      tn.node_name,
      tn.resolver_role,
      tn.approval_policy,
      tn.sort_order
    FROM instance_row i
    JOIN public.approval_template_nodes tn ON tn.template_id = i.template_id
    WHERE tn.node_type = 'approval'
      AND tn.resolver_type <> 'document_creator'
      AND COALESCE(tn.resolver_role, '') <> 'submitter'
    UNION ALL
    SELECT
      -min(rn.id) AS id,
      rn.template_node_key AS node_key,
      max(rn.node_name) AS node_name,
      max(rn.resolver_role) AS resolver_role,
      max(rn.approval_policy) AS approval_policy,
      max(COALESCE(NULLIF(rn.snapshot ->> 'sort_order', '')::integer, 90)) AS sort_order
    FROM runtime_nodes rn
    WHERE NOT EXISTS (
      SELECT 1
      FROM instance_row i
      JOIN public.approval_template_nodes tn ON tn.template_id = i.template_id
      WHERE tn.node_key = rn.template_node_key
    )
      AND rn.node_type = 'approval'
      AND rn.resolver_type <> 'document_creator'
      AND COALESCE(rn.resolver_role, '') <> 'submitter'
    GROUP BY rn.template_node_key
  ),
  runtime_assignees AS (
    SELECT
      rn.template_node_key,
      rn.projection_scope_type,
      jsonb_agg(
        jsonb_build_object(
          'node_id', rn.id,
          'node_name', rn.node_name,
          'node_status', rn.status,
          'scope_type', rn.scope_type,
          'scope_id', rn.scope_id,
          'project_id', CASE WHEN rn.scope_type = 'project' THEN rn.scope_id ELSE NULL END,
          'project_code', COALESCE(rn.project_code, ''),
          'project_name', COALESCE(rn.project_name, ''),
          'assignee_user_id', COALESCE(NULLIF(a.assignee_user_id, 0), rn.assignee_user_id, dyn.assignee_user_id, 0),
          'assignee_name', e.name,
          'assignee_route_source', COALESCE(dyn.route_source, rn.snapshot ->> 'route_source', rn.assignee_role, rn.resolver_role),
          'status', COALESCE(a.status, rn.status),
          'action', COALESCE(a.action, rn.result_action),
          'comment', COALESCE(a.comment, rn.comment),
          'acted_at', a.acted_at,
          'template_key', COALESCE(rn.metadata ->> 'template_key', rn.snapshot ->> 'template_key')
        )
        ORDER BY rn.id, a.id NULLS LAST
      ) FILTER (WHERE rn.id IS NOT NULL) AS assignees
    FROM runtime_nodes rn
    LEFT JOIN public.approval_node_assignees a ON a.node_id = rn.id
    LEFT JOIN LATERAL public.psa_resolve_graph_assignees(
      rn.document_id,
      rn.resolver_type,
      rn.resolver_role,
      rn.scope_id,
      false
    ) dyn ON COALESCE(rn.status, '') IN ('waiting', 'pending', 'active', 'needs_reapproval', 'skipped')
      AND (
        a.id IS NULL
        OR COALESCE(a.assignee_user_id, 0) = 0
      )
    LEFT JOIN public.employees e ON e.id = COALESCE(NULLIF(a.assignee_user_id, 0), rn.assignee_user_id, dyn.assignee_user_id)
    GROUP BY rn.template_node_key, rn.projection_scope_type
  ),
  blocker_rows AS (
    SELECT
      rn.template_node_key,
      rn.projection_scope_type,
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'node_id', prev.id,
          'node_name', COALESCE(prev.node_name, prev.node_key),
          'status', prev.status
        )
      ) FILTER (WHERE prev.id IS NOT NULL) AS blocking_nodes
    FROM runtime_nodes rn
    JOIN public.approval_edges edge ON edge.to_node_id = rn.id
    JOIN public.approval_nodes prev ON prev.id = edge.from_node_id
    WHERE COALESCE(edge.condition_result, true) = true
      AND prev.status NOT IN ('approved', 'skipped', 'cancelled')
    GROUP BY rn.template_node_key, rn.projection_scope_type
  ),
  grouped AS (
    SELECT
      tn.id AS template_node_id,
      tn.node_key,
      tn.node_name,
      tn.resolver_role,
      tn.approval_policy,
      tn.sort_order,
      rn.projection_scope_type,
      min(rn.projection_scope_rank) AS projection_scope_rank,
      min(rn.id) AS first_node_id,
      min(rn.activated_at) FILTER (WHERE rn.activated_at IS NOT NULL) AS activated_at,
      max(rn.completed_at) FILTER (WHERE rn.completed_at IS NOT NULL) AS completed_at,
      bool_or(
        rn.status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM public.approval_node_assignees action_assignee
            WHERE action_assignee.node_id = rn.id
              AND action_assignee.status = 'pending'
              AND action_assignee.assignee_user_id = public.current_employee_id()
          )
          OR public.current_user_has_role('admin')
        )
      ) AS can_current_user_act,
      count(rn.id) AS runtime_count,
      bool_or(rn.status = 'rejected') AS has_rejected,
      bool_or(rn.status = 'active') AS has_active,
      bool_or(rn.status IN ('waiting', 'pending', 'waiting_revision', 'needs_revision', 'needs_reapproval')) AS has_waiting,
      bool_or(rn.status = 'approved') AS has_approved,
      bool_and(rn.status IN ('approved', 'skipped', 'cancelled')) FILTER (WHERE rn.id IS NOT NULL) AS all_terminal,
      bool_and(rn.status = 'cancelled') FILTER (WHERE rn.id IS NOT NULL) AS all_cancelled,
      bool_and(rn.status = 'skipped') FILTER (WHERE rn.id IS NOT NULL) AS all_skipped,
      max(rn.result_action) FILTER (WHERE rn.result_action IS NOT NULL) AS result_action,
      max(rn.comment) FILTER (WHERE rn.comment IS NOT NULL AND rn.comment <> '') AS comment
    FROM template_nodes tn
    LEFT JOIN runtime_nodes rn ON rn.template_node_key = tn.node_key
    GROUP BY
      tn.id,
      tn.node_key,
      tn.node_name,
      tn.resolver_role,
      tn.approval_policy,
      tn.sort_order,
      rn.projection_scope_type
  )
  SELECT
    COALESCE(g.first_node_id, -g.template_node_id) AS node_id,
    g.node_key,
    g.node_name,
    COALESCE(g.projection_scope_type, 'template_node') AS scope_type,
    NULL::bigint AS scope_id,
    CASE
      WHEN g.has_rejected THEN 'rejected'
      WHEN g.has_active THEN 'active'
      WHEN g.has_waiting THEN 'waiting'
      WHEN g.all_cancelled THEN 'cancelled'
      WHEN g.all_skipped THEN 'skipped'
      WHEN g.all_terminal AND g.has_approved THEN 'approved'
      ELSE 'waiting'
    END AS node_status,
    g.resolver_role AS assignee_role,
    g.resolver_role,
    g.approval_policy,
    (g.sort_order * 10 + COALESCE(g.projection_scope_rank, 0))::integer AS sort_order,
    g.activated_at,
    g.completed_at,
    g.result_action,
    g.comment,
    COALESCE(g.can_current_user_act, false) AS can_current_user_act,
    COALESCE(ra.assignees, '[]'::jsonb) AS assignees,
    COALESCE(br.blocking_nodes, '[]'::jsonb) AS blocking_nodes
  FROM grouped g
  LEFT JOIN runtime_assignees ra
    ON ra.template_node_key = g.node_key
   AND ra.projection_scope_type = g.projection_scope_type
  LEFT JOIN blocker_rows br
    ON br.template_node_key = g.node_key
   AND br.projection_scope_type = g.projection_scope_type
  WHERE g.runtime_count > 0
    AND (
      public.current_user_can_access_resource('review', 'read')
      OR EXISTS (
        SELECT 1
        FROM public.timesheets t
        WHERE t.id = p_timesheet_id
          AND t.user_id = public.current_employee_id()
      )
    )
  ORDER BY g.sort_order, COALESCE(g.projection_scope_rank, 0), g.node_key;
$$;

REVOKE ALL ON FUNCTION public.psa_timesheet_approval_chain(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_approval_chain(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
