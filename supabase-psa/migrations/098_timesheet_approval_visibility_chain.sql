-- V0.18: expose runtime approval chain state for timesheet visibility.

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
  SELECT
    n.id AS node_id,
    n.node_key,
    COALESCE(n.node_name, n.node_key) AS node_name,
    n.scope_type,
    n.scope_id,
    n.status AS node_status,
    n.assignee_role,
    n.resolver_role,
    n.approval_policy,
    COALESCE(tn.sort_order, 9999) AS sort_order,
    n.activated_at,
    n.completed_at,
    n.result_action,
    n.comment,
    (
      n.status = 'active'
      AND (
        EXISTS (
          SELECT 1
          FROM public.approval_node_assignees action_assignee
          WHERE action_assignee.node_id = n.id
            AND action_assignee.status = 'pending'
            AND action_assignee.assignee_user_id = public.current_employee_id()
        )
        OR public.current_user_has_role('admin')
      )
    ) AS can_current_user_act,
    COALESCE(assignee_rows.assignees, '[]'::jsonb) AS assignees,
    COALESCE(blocker_rows.blocking_nodes, '[]'::jsonb) AS blocking_nodes
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  LEFT JOIN public.approval_template_nodes tn
    ON tn.template_id = i.template_id
   AND tn.node_key = COALESCE(n.template_node_key, n.node_key)
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'assignee_user_id', a.assignee_user_id,
        'assignee_name', e.name,
        'status', a.status,
        'action', a.action,
        'comment', a.comment,
        'acted_at', a.acted_at
      )
      ORDER BY a.id
    ) AS assignees
    FROM public.approval_node_assignees a
    LEFT JOIN public.employees e ON e.id = a.assignee_user_id
    WHERE a.node_id = n.id
  ) assignee_rows ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'node_id', prev.id,
        'node_name', COALESCE(prev.node_name, prev.node_key),
        'status', prev.status
      )
      ORDER BY prev.id
    ) AS blocking_nodes
    FROM public.approval_edges edge
    JOIN public.approval_nodes prev ON prev.id = edge.from_node_id
    WHERE edge.to_node_id = n.id
      AND COALESCE(edge.condition_result, true) = true
      AND prev.status NOT IN ('approved', 'skipped')
  ) blocker_rows ON true
  WHERE COALESCE(i.target_type, '') = 'timesheet'
    AND i.target_id = p_timesheet_id
    AND (
      public.current_user_can_access_resource('review', 'read')
      OR EXISTS (
        SELECT 1
        FROM public.timesheets t
        WHERE t.id = p_timesheet_id
          AND t.user_id = public.current_employee_id()
      )
    )
  ORDER BY COALESCE(tn.sort_order, 9999), n.id;
$$;

CREATE OR REPLACE VIEW public.approval_visible_timesheets_view AS
SELECT
  i.target_id AS timesheet_id,
  t.user_id,
  t.week_start_date,
  t.status AS timesheet_status,
  t.submitted_at,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'node_id', n.id,
        'node_name', COALESCE(n.node_name, n.node_key),
        'scope_type', n.scope_type,
        'scope_id', n.scope_id,
        'node_status', n.status
      )
    ) FILTER (WHERE n.status = 'active'),
    '[]'::jsonb
  ) AS current_nodes,
  COALESCE(
    jsonb_agg(
      DISTINCT jsonb_build_object(
        'assignee_user_id', a.assignee_user_id,
        'assignee_name', e.name,
        'node_id', n.id
      )
    ) FILTER (WHERE n.status = 'active' AND a.status = 'pending'),
    '[]'::jsonb
  ) AS current_assignees
FROM public.approval_instances i
JOIN public.timesheets t ON t.id = i.target_id
LEFT JOIN public.approval_nodes n ON n.instance_id = i.id
LEFT JOIN public.approval_node_assignees a ON a.node_id = n.id
LEFT JOIN public.employees e ON e.id = a.assignee_user_id
WHERE i.target_type = 'timesheet'
  AND i.status = 'running'
  AND t.status = 'submitted'
  AND public.current_user_can_access_resource('review', 'read')
GROUP BY i.target_id, t.user_id, t.week_start_date, t.status, t.submitted_at;

REVOKE ALL ON FUNCTION public.psa_timesheet_approval_chain(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_approval_chain(bigint) TO authenticated;
GRANT SELECT ON public.approval_visible_timesheets_view TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
