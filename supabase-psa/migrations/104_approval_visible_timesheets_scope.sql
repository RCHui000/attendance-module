BEGIN;

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
  AND (
    public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1
      FROM public.approval_nodes user_node
      LEFT JOIN public.approval_node_assignees user_assignee
        ON user_assignee.node_id = user_node.id
      WHERE user_node.instance_id = i.id
        AND (
          user_node.assignee_user_id = public.current_employee_id()
          OR user_assignee.assignee_user_id = public.current_employee_id()
        )
    )
  )
GROUP BY i.target_id, t.user_id, t.week_start_date, t.status, t.submitted_at;

GRANT SELECT ON public.approval_visible_timesheets_view TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
