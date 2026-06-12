-- V0.15: repair legacy duplicate project nodes produced before the graph cutover.

BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_graph_history_repair_audit (
  id BIGSERIAL PRIMARY KEY,
  release_version TEXT NOT NULL,
  cancelled_duplicate_project_nodes INT NOT NULL DEFAULT 0,
  deleted_duplicate_edges INT NOT NULL DEFAULT 0,
  reset_auto_collapsed_project_nodes INT NOT NULL DEFAULT 0,
  reset_premature_summary_nodes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP VIEW IF EXISTS public.approval_project_review_records_view;
DROP VIEW IF EXISTS public.approval_reviewed_timesheets_view;
DROP VIEW IF EXISTS public.approval_pending_tasks_view;

DO $$
DECLARE
  v_duplicate_nodes INT := 0;
  v_deleted_edges INT := 0;
  v_reset_projects INT := 0;
  v_reset_summaries INT := 0;
BEGIN
  CREATE TEMP TABLE v015_duplicate_project_nodes ON COMMIT DROP AS
  SELECT dup.id
  FROM public.approval_nodes dup
  WHERE dup.scope_type = 'project'
    AND dup.node_key LIKE 'workflow_task_%'
    AND EXISTS (
      SELECT 1
      FROM public.approval_nodes canonical
      WHERE canonical.instance_id = dup.instance_id
        AND canonical.scope_type = 'project'
        AND canonical.scope_id = dup.scope_id
        AND canonical.id <> dup.id
        AND canonical.node_key NOT LIKE 'workflow_task_%'
    );

  SELECT count(*) INTO v_duplicate_nodes FROM v015_duplicate_project_nodes;

  DELETE FROM public.approval_edges e
  USING v015_duplicate_project_nodes d
  WHERE e.from_node_id = d.id OR e.to_node_id = d.id;
  GET DIAGNOSTICS v_deleted_edges = ROW_COUNT;

  UPDATE public.approval_node_assignees a
  SET status = 'cancelled',
      action = 'cancelled',
      acted_at = COALESCE(acted_at, now()),
      comment = COALESCE(NULLIF(comment, ''), 'V0.15 duplicate legacy project node repair')
  FROM v015_duplicate_project_nodes d
  WHERE a.node_id = d.id
    AND a.status <> 'cancelled';

  UPDATE public.approval_nodes n
  SET status = 'cancelled',
      result_action = 'cancelled',
      comment = COALESCE(NULLIF(comment, ''), 'V0.15 duplicate legacy project node repair'),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('v015_history_repair', true),
      updated_at = now()
  FROM v015_duplicate_project_nodes d
  WHERE n.id = d.id
    AND n.status <> 'cancelled';

  CREATE TEMP TABLE v015_inconsistent_instances ON COMMIT DROP AS
  SELECT DISTINCT i.id AS instance_id
  FROM public.approval_instances i
  JOIN public.approval_nodes summary_node
    ON summary_node.instance_id = i.id
   AND summary_node.scope_type = 'department_summary'
   AND summary_node.status = 'active'
  JOIN public.approval_nodes project_node
    ON project_node.instance_id = i.id
   AND project_node.scope_type = 'project'
   AND project_node.status = 'active'
  WHERE i.target_type = 'timesheet';

  UPDATE public.approval_node_assignees a
  SET status = 'pending',
      action = NULL,
      acted_at = NULL,
      comment = NULL
  FROM public.approval_nodes n
  JOIN v015_inconsistent_instances bad ON bad.instance_id = n.instance_id
  WHERE a.node_id = n.id
    AND n.scope_type = 'project'
    AND n.status = 'approved'
    AND n.comment ILIKE 'Auto-collapsed%'
    AND a.status = 'approved';

  UPDATE public.approval_nodes n
  SET status = 'active',
      result_action = NULL,
      completed_at = NULL,
      comment = '',
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('v015_history_repair', 'reset_auto_collapsed_project'),
      updated_at = now()
  FROM v015_inconsistent_instances bad
  WHERE n.instance_id = bad.instance_id
    AND n.scope_type = 'project'
    AND n.status = 'approved'
    AND n.comment ILIKE 'Auto-collapsed%';
  GET DIAGNOSTICS v_reset_projects = ROW_COUNT;

  UPDATE public.approval_node_assignees a
  SET status = 'pending',
      action = NULL,
      acted_at = NULL,
      comment = NULL
  FROM public.approval_nodes n
  JOIN v015_inconsistent_instances bad ON bad.instance_id = n.instance_id
  WHERE a.node_id = n.id
    AND n.scope_type = 'department_summary'
    AND n.status = 'active';

  UPDATE public.approval_nodes n
  SET status = 'waiting',
      result_action = NULL,
      completed_at = NULL,
      comment = COALESCE(NULLIF(comment, ''), 'V0.15 premature summary repair'),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('v015_history_repair', 'reset_premature_summary'),
      updated_at = now()
  FROM v015_inconsistent_instances bad
  WHERE n.instance_id = bad.instance_id
    AND n.scope_type = 'department_summary'
    AND n.status = 'active';
  GET DIAGNOSTICS v_reset_summaries = ROW_COUNT;

  INSERT INTO public.approval_graph_history_repair_audit (
    release_version,
    cancelled_duplicate_project_nodes,
    deleted_duplicate_edges,
    reset_auto_collapsed_project_nodes,
    reset_premature_summary_nodes
  )
  VALUES ('V0.15', v_duplicate_nodes, v_deleted_edges, v_reset_projects, v_reset_summaries);
END;
$$;

CREATE VIEW public.approval_pending_tasks_view AS
SELECT
  n.id,
  n.id AS task_id,
  COALESCE(i.target_type, d.document_type) AS target_type,
  COALESCE(i.target_id, d.business_id) AS target_id,
  n.scope_type,
  n.scope_id,
  n.assignee_role,
  a.assignee_user_id,
  n.activated_at AS created_at,
  'pending'::text AS status,
  NULL::text AS result_action,
  NULL::timestamptz AS completed_at,
  n.comment,
  n.node_name,
  d.document_type,
  d.business_id,
  d.creator_user_id
FROM public.approval_nodes n
JOIN public.approval_instances i ON i.id = n.instance_id
LEFT JOIN public.business_documents d ON d.id = i.document_id
JOIN public.approval_node_assignees a ON a.node_id = n.id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND n.status = 'active'
  AND a.status = 'pending';

CREATE VIEW public.approval_reviewed_timesheets_view AS
SELECT
  n.id,
  n.id AS task_id,
  COALESCE(i.target_type, d.document_type) AS target_type,
  COALESCE(i.target_id, d.business_id) AS target_id,
  COALESCE(i.target_id, d.business_id) AS timesheet_id,
  n.scope_type,
  n.scope_id,
  n.assignee_role,
  a.assignee_user_id,
  CASE
    WHEN a.action IN ('approve', 'reject') THEN a.action
    WHEN a.status = 'approved' THEN 'approve'
    WHEN a.status = 'rejected' THEN 'reject'
    ELSE a.action
  END AS result_action,
  a.comment,
  a.acted_at AS completed_at
FROM public.approval_node_assignees a
JOIN public.approval_nodes n ON n.id = a.node_id
JOIN public.approval_instances i ON i.id = n.instance_id
LEFT JOIN public.business_documents d ON d.id = i.document_id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND a.status IN ('approved', 'rejected', 'delegated', 'skipped');

CREATE VIEW public.approval_project_review_records_view AS
SELECT
  COALESCE(i.target_id, d.business_id) AS timesheet_id,
  n.scope_id AS project_id,
  CASE
    WHEN n.status = 'approved' THEN 'project_approved'
    WHEN n.status = 'rejected' THEN 'needs_revision'
    WHEN n.status = 'skipped' THEN 'project_approved'
    ELSE 'pending'
  END AS status,
  COALESCE(n.snapshot ->> 'route_source', n.assignee_role, n.resolver_role) AS route_source,
  n.completed_at AS project_approved_at,
  NULL::timestamptz AS final_confirmed_at,
  COALESCE(n.completed_at, n.activated_at, n.created_at) AS last_action_at,
  n.result_action,
  n.comment
FROM public.approval_nodes n
JOIN public.approval_instances i ON i.id = n.instance_id
LEFT JOIN public.business_documents d ON d.id = i.document_id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND n.scope_type = 'project'
  AND n.scope_id IS NOT NULL
  AND n.status <> 'cancelled';

GRANT SELECT ON public.approval_pending_tasks_view TO authenticated;
GRANT SELECT ON public.approval_reviewed_timesheets_view TO authenticated;
GRANT SELECT ON public.approval_project_review_records_view TO authenticated;
GRANT SELECT ON public.approval_graph_history_repair_audit TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
