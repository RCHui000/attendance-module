-- Read-only diagnostic: approved timesheets whose current approval graph still has rejected nodes.
--
-- Run against Supabase/Postgres when deciding whether historical data needs repair.
-- This script does not mutate data.

WITH current_instances AS (
  SELECT DISTINCT ON (i.target_id)
    i.id AS instance_id,
    i.target_id AS timesheet_id,
    i.status AS instance_status
  FROM public.approval_instances i
  WHERE i.target_type = 'timesheet'
  ORDER BY i.target_id, CASE WHEN i.status = 'running' THEN 0 ELSE 1 END, i.id DESC
),
rejected_nodes AS (
  SELECT
    ci.timesheet_id,
    ci.instance_id,
    jsonb_agg(
      jsonb_build_object(
        'node_id', n.id,
        'node_key', n.node_key,
        'node_name', n.node_name,
        'scope_type', n.scope_type,
        'scope_id', n.scope_id,
        'completed_at', n.completed_at,
        'comment', n.comment
      )
      ORDER BY n.completed_at DESC NULLS LAST, n.id DESC
    ) AS rejected_node_details
  FROM current_instances ci
  JOIN public.approval_nodes n ON n.instance_id = ci.instance_id
  WHERE n.status = 'rejected'
  GROUP BY ci.timesheet_id, ci.instance_id
)
SELECT
  t.id AS timesheet_id,
  t.user_id,
  e.name AS employee_name,
  t.week_start_date,
  t.status AS timesheet_status,
  t.approved_at,
  rn.instance_id,
  rn.rejected_node_details
FROM public.timesheets t
JOIN rejected_nodes rn ON rn.timesheet_id = t.id
LEFT JOIN public.employees e ON e.id = t.user_id
WHERE t.status = 'approved'
ORDER BY t.week_start_date DESC, t.id DESC;
