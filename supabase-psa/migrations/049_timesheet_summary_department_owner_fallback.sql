-- V0.15: use project-level department owners for timesheet summary when org managers are not configured.

BEGIN;

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
  WITH RECURSIVE doc AS (
    SELECT bd.*, ep.org_id, ep.cost_specialty, o.org_code, parent.org_code AS parent_org_code
    FROM public.business_documents bd
    LEFT JOIN public.employee_profiles_v2 ep ON ep.employee_id = bd.creator_user_id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN public.organizations parent ON parent.id = o.parent_id
    WHERE bd.id = p_document_id
  ),
  org_chain AS (
    SELECT o.id, o.parent_id, 0 AS depth
    FROM public.organizations o
    JOIN doc d ON d.creator_org_id = o.id
    UNION ALL
    SELECT parent.id, parent.parent_id, child.depth + 1
    FROM public.organizations parent
    JOIN org_chain child ON child.parent_id = parent.id
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
  timesheet_project_owner AS (
    SELECT route.assignee_user_id, route.assignee_role AS route_source, NULL::bigint AS matched_org_id, 3 AS priority
    FROM doc d
    JOIN LATERAL public.psa_resolve_timesheet_project_assignees(d.business_id) route ON route.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND d.document_type = 'timesheet'
      AND COALESCE(p_scope_id, d.project_id) IS NOT NULL
    LIMIT 1
  ),
  org_manager AS (
    SELECT o.manager_user_id AS assignee_user_id, 'org_manager'::text AS route_source, o.id AS matched_org_id, 4 + oc.depth AS priority
    FROM org_chain oc
    JOIN public.organizations o ON o.id = oc.id
    WHERE p_resolver_type = 'org_manager'
      AND NULLIF(o.manager_user_id, 0) IS NOT NULL
    ORDER BY oc.depth
    LIMIT 1
  ),
  summary_department_role AS (
    SELECT pr.user_id AS assignee_user_id, pr.role_key AS route_source, pr.org_id AS matched_org_id, 10 AS priority
    FROM doc d
    JOIN public.project_roles pr ON pr.project_id = d.project_id
    WHERE p_resolver_type = 'org_manager'
      AND d.document_type = 'timesheet'
      AND pr.status = 'active'
      AND pr.role_key = CASE
        WHEN d.org_code = 'CC' THEN 'cc_department_owner'
        WHEN d.org_code LIKE 'PM_%' OR d.parent_org_code = 'PM' OR d.org_code = 'PM' THEN 'pm_department_owner'
        ELSE 'pm_department_owner'
      END
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY pr.id DESC
    LIMIT 1
  ),
  creator AS (
    SELECT d.creator_user_id AS assignee_user_id, 'document_creator'::text AS route_source, d.creator_org_id AS matched_org_id, 20 AS priority
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
    UNION ALL SELECT * FROM timesheet_project_owner
    UNION ALL SELECT * FROM org_manager
    UNION ALL SELECT * FROM summary_department_role
    UNION ALL SELECT * FROM creator
    UNION ALL SELECT * FROM admin_fallback
  )
  SELECT assignee_user_id, route_source, matched_org_id
  FROM candidates
  WHERE assignee_user_id IS NOT NULL AND assignee_user_id <> 0
  ORDER BY priority
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
