-- V0.14.12: Align contract routes with PM/CC/PMCC diagram and harden review views.

BEGIN;

WITH pmcc_templates AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN ('contract_pmcc_v1', 'contract_approval_pmcc_v1')
),
nodes AS (
  SELECT *
  FROM (VALUES
    ('cc_submitter', 'CC Employee Submitter', 'document_creator', 'submitter', 10),
    ('cc_project_owner', 'CC Project Owner', 'project_role', 'cc_project_owner', 20),
    ('pm_cost_department_owner', 'PM Cost Department Owner', 'project_role', 'pm_cost_department_owner', 30),
    ('cc_department_owner', 'CC Department Owner', 'project_role', 'cc_department_owner', 40),
    ('pm_project_owner', 'PM Project Owner', 'project_role', 'pm_project_owner', 50),
    ('pm_department_owner', 'PM Department Owner', 'project_role', 'pm_department_owner', 60)
  ) AS v(node_key, node_name, resolver_type, resolver_role, sort_order)
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, sort_order
)
SELECT t.id, n.node_key, n.node_name, 'approval', n.resolver_type, n.resolver_role,
       'single', 'back_to_creator', n.sort_order
FROM pmcc_templates t
CROSS JOIN nodes n
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    approval_policy = EXCLUDED.approval_policy,
    reject_policy = EXCLUDED.reject_policy,
    sort_order = EXCLUDED.sort_order;

DELETE FROM public.approval_template_edges
WHERE template_id IN (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN ('contract_pmcc_v1', 'contract_approval_pmcc_v1')
);

WITH linear_edges(template_key, from_node_key, to_node_key) AS (
  VALUES
    ('contract_pmcc_v1', 'cc_submitter', 'cc_project_owner'),
    ('contract_pmcc_v1', 'cc_project_owner', 'pm_cost_department_owner'),
    ('contract_pmcc_v1', 'pm_cost_department_owner', 'cc_department_owner'),
    ('contract_pmcc_v1', 'cc_department_owner', 'pm_project_owner'),
    ('contract_pmcc_v1', 'pm_project_owner', 'pm_department_owner'),
    ('contract_approval_pmcc_v1', 'cc_submitter', 'cc_project_owner'),
    ('contract_approval_pmcc_v1', 'cc_project_owner', 'pm_cost_department_owner'),
    ('contract_approval_pmcc_v1', 'pm_cost_department_owner', 'cc_department_owner'),
    ('contract_approval_pmcc_v1', 'cc_department_owner', 'pm_project_owner'),
    ('contract_approval_pmcc_v1', 'pm_project_owner', 'pm_department_owner')
)
INSERT INTO public.approval_template_edges(template_id, from_node_key, to_node_key, edge_type, condition_expr)
SELECT t.id, e.from_node_key, e.to_node_key, 'normal', '{}'::jsonb
FROM linear_edges e
JOIN public.approval_templates t ON t.template_key = e.template_key;

CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint DEFAULT NULL
)
RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH doc AS (
    SELECT *
    FROM public.business_documents
    WHERE id = p_document_id
  ),
  project_role_match AS (
    SELECT pr.user_id AS assignee_user_id, 'project_roles'::text AS route_source, pr.org_id AS matched_org_id, 1 AS priority
    FROM public.project_roles pr
    JOIN doc d ON d.project_id = pr.project_id OR pr.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND pr.role_key = COALESCE(p_resolver_role, 'project_owner')
      AND pr.status = 'active'
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY pr.org_id NULLS LAST, pr.id DESC
    LIMIT 1
  ),
  cc_specialty_fallback AS (
    SELECT pr.user_id AS assignee_user_id, 'project_roles:cc_specialty_fallback'::text AS route_source, pr.org_id AS matched_org_id, 2 AS priority
    FROM public.project_roles pr
    JOIN doc d ON d.project_id = pr.project_id OR pr.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND p_resolver_role = 'cc_project_owner'
      AND pr.role_key IN ('cc_civil_project_owner', 'cc_mep_project_owner')
      AND pr.status = 'active'
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY CASE pr.role_key WHEN 'cc_civil_project_owner' THEN 1 ELSE 2 END, pr.id DESC
    LIMIT 1
  ),
  timesheet_project_owner AS (
    SELECT route.assignee_user_id, route.route_source, route.matched_org_id, 3 AS priority
    FROM doc d
    JOIN LATERAL public.psa_resolve_project_review_assignee(
      COALESCE(p_scope_id, d.project_id),
      d.creator_user_id,
      d.creator_org_id
    ) route ON true
    WHERE p_resolver_type = 'project_role'
      AND p_resolver_role IN ('project_owner', 'pm_project_owner', 'cc_project_owner', 'cost_project_owner')
      AND d.document_type = 'timesheet'
      AND COALESCE(p_scope_id, d.project_id) IS NOT NULL
    LIMIT 1
  ),
  org_manager AS (
    SELECT o.manager_user_id AS assignee_user_id, 'org_manager'::text AS route_source, o.id AS matched_org_id, 4 AS priority
    FROM doc d
    JOIN public.organizations o ON o.id = d.creator_org_id
    WHERE p_resolver_type = 'org_manager'
      AND NULLIF(o.manager_user_id, 0) IS NOT NULL
    LIMIT 1
  ),
  creator AS (
    SELECT d.creator_user_id AS assignee_user_id, 'document_creator'::text AS route_source, d.creator_org_id AS matched_org_id, 5 AS priority
    FROM doc d
    WHERE p_resolver_type = 'document_creator'
  ),
  admin_fallback AS (
    SELECT ur.employee_id AS assignee_user_id, 'admin_fallback'::text AS route_source, NULL::bigint AS matched_org_id, 99 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.employee_id
    LIMIT 1
  ),
  candidates AS (
    SELECT * FROM project_role_match
    UNION ALL SELECT * FROM cc_specialty_fallback
    UNION ALL SELECT * FROM timesheet_project_owner
    UNION ALL SELECT * FROM org_manager
    UNION ALL SELECT * FROM creator
    UNION ALL SELECT * FROM admin_fallback
  )
  SELECT assignee_user_id, route_source, matched_org_id
  FROM candidates
  WHERE assignee_user_id IS NOT NULL AND assignee_user_id <> 0
  ORDER BY priority
  LIMIT 1;
$$;

DROP VIEW IF EXISTS public.approval_project_review_records_view;
DROP VIEW IF EXISTS public.approval_reviewed_timesheets_view;
DROP VIEW IF EXISTS public.approval_pending_tasks_view;

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
WHERE n.status = 'active'
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
  AND n.scope_id IS NOT NULL;

GRANT SELECT ON public.approval_pending_tasks_view TO authenticated;
GRANT SELECT ON public.approval_reviewed_timesheets_view TO authenticated;
GRANT SELECT ON public.approval_project_review_records_view TO authenticated;
ALTER FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint) OWNER TO postgres;

NOTIFY pgrst, 'reload schema';

COMMIT;
