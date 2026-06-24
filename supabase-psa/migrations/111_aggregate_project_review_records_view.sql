BEGIN;

CREATE OR REPLACE VIEW public.approval_project_review_records_view AS
WITH project_nodes AS (
  SELECT
    COALESCE(i.target_id, d.business_id) AS timesheet_id,
    n.scope_id AS project_id,
    n.status,
    n.completed_at,
    n.activated_at,
    n.created_at,
    n.result_action,
    n.comment,
    n.assignee_role,
    n.resolver_role,
    n.snapshot
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  LEFT JOIN public.business_documents d ON d.id = i.document_id
  WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
    AND i.status <> 'cancelled'
    AND n.round_id = i.current_round_id
    AND n.scope_type = 'project'
    AND n.scope_id IS NOT NULL
    AND n.status <> 'cancelled'
)
SELECT
  timesheet_id,
  project_id,
  CASE
    WHEN bool_or(status = 'rejected') THEN 'needs_revision'
    WHEN bool_or(status IN ('active', 'waiting', 'pending', 'waiting_revision', 'needs_revision', 'needs_reapproval')) THEN 'pending'
    WHEN bool_and(status IN ('approved', 'skipped')) THEN 'project_approved'
    ELSE 'pending'
  END AS status,
  string_agg(
    DISTINCT COALESCE(snapshot ->> 'route_source', assignee_role, resolver_role),
    ',' ORDER BY COALESCE(snapshot ->> 'route_source', assignee_role, resolver_role)
  ) AS route_source,
  max(completed_at) FILTER (WHERE status IN ('approved', 'skipped')) AS project_approved_at,
  NULL::timestamptz AS final_confirmed_at,
  max(COALESCE(completed_at, activated_at, created_at)) AS last_action_at,
  CASE
    WHEN bool_or(status = 'rejected') THEN 'reject'
    WHEN bool_and(status IN ('approved', 'skipped')) THEN 'approve'
    ELSE NULL
  END AS result_action,
  (array_agg(comment ORDER BY COALESCE(completed_at, activated_at, created_at) DESC))[1] AS comment
FROM project_nodes
GROUP BY timesheet_id, project_id;

GRANT SELECT ON public.approval_project_review_records_view TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
