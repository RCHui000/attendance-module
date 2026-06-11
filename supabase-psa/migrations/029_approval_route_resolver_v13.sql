-- V0.13: Resolve project review assignees by project + submitter department.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_resolve_project_review_assignee(
  p_project_id bigint,
  p_submitter_user_id bigint,
  p_submitter_org_id bigint DEFAULT NULL
)
RETURNS TABLE(
  assignee_user_id bigint,
  route_source text,
  matched_org_id bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH RECURSIVE submitter_org AS (
    SELECT COALESCE(
      NULLIF(p_submitter_org_id, 0),
      NULLIF((SELECT ep.org_id FROM public.employee_profiles_v2 ep WHERE ep.employee_id = p_submitter_user_id LIMIT 1), 0)
    ) AS org_id
  ),
  org_chain AS (
    SELECT o.id, o.parent_id, 0 AS depth
    FROM public.organizations o
    JOIN submitter_org so ON so.org_id = o.id
    UNION ALL
    SELECT parent.id, parent.parent_id, child.depth + 1
    FROM public.organizations parent
    JOIN org_chain child ON child.parent_id = parent.id
  ),
  department_owner AS (
    SELECT
      pdo.project_owner_id AS employee_id,
      CASE WHEN oc.depth = 0
        THEN 'project_department_owner_exact'
        ELSE 'project_department_owner_parent'
      END AS source,
      pdo.org_id,
      oc.depth,
      1 AS priority
    FROM public.project_department_owners pdo
    JOIN org_chain oc ON oc.id = pdo.org_id
    WHERE pdo.project_id = p_project_id
      AND pdo.role_key = 'project_owner'
      AND pdo.is_active = true
      AND (pdo.effective_from IS NULL OR pdo.effective_from <= current_date)
      AND (pdo.effective_to IS NULL OR pdo.effective_to >= current_date)
    ORDER BY oc.depth ASC, pdo.id DESC
    LIMIT 1
  ),
  project_default_owner AS (
    SELECT
      p.project_owner_id AS employee_id,
      'project_default_owner'::text AS source,
      NULL::bigint AS org_id,
      0 AS depth,
      2 AS priority
    FROM public.projects p
    WHERE p.id = p_project_id
      AND NULLIF(p.project_owner_id, 0) IS NOT NULL
  ),
  submitter_org_manager AS (
    SELECT
      o.manager_user_id AS employee_id,
      'submitter_org_manager'::text AS source,
      o.id AS org_id,
      oc.depth,
      3 AS priority
    FROM org_chain oc
    JOIN public.organizations o ON o.id = oc.id
    WHERE NULLIF(o.manager_user_id, 0) IS NOT NULL
    ORDER BY oc.depth ASC
    LIMIT 1
  ),
  admin_fallback AS (
    SELECT
      ur.employee_id,
      'admin_fallback'::text AS source,
      NULL::bigint AS org_id,
      0 AS depth,
      4 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.employee_id
    LIMIT 1
  ),
  candidates AS (
    SELECT * FROM department_owner
    UNION ALL
    SELECT * FROM project_default_owner
    UNION ALL
    SELECT * FROM submitter_org_manager
    UNION ALL
    SELECT * FROM admin_fallback
  )
  SELECT employee_id AS assignee_user_id, source AS route_source, org_id AS matched_org_id
  FROM candidates
  WHERE employee_id IS NOT NULL AND employee_id <> 0
  ORDER BY priority, depth, employee_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_project_assignees(p_timesheet_id bigint)
RETURNS TABLE(project_id bigint, assignee_user_id bigint, assignee_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH sheet AS (
    SELECT t.id, t.user_id, ep.org_id
    FROM public.timesheets t
    LEFT JOIN public.employee_profiles_v2 ep ON ep.employee_id = t.user_id
    WHERE t.id = p_timesheet_id
  ),
  project_scopes AS (
    SELECT DISTINCT te.project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id IS NOT NULL
  )
  SELECT
    ps.project_id,
    route.assignee_user_id,
    CASE
      WHEN route.route_source IN (
        'project_department_owner_exact',
        'project_department_owner_parent',
        'project_default_owner'
      ) THEN 'project_owner'
      WHEN route.route_source = 'submitter_org_manager' THEN 'department_head'
      ELSE 'admin'
    END AS assignee_role
  FROM project_scopes ps
  CROSS JOIN sheet s
  JOIN LATERAL public.psa_resolve_project_review_assignee(ps.project_id, s.user_id, s.org_id) route ON true
  WHERE route.assignee_user_id IS NOT NULL;
$$;

ALTER FUNCTION public.psa_resolve_project_review_assignee(bigint, bigint, bigint) OWNER TO postgres;
ALTER FUNCTION public.psa_resolve_timesheet_project_assignees(bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.psa_resolve_project_review_assignee(bigint, bigint, bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_resolve_timesheet_project_assignees(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_resolve_project_review_assignee(bigint, bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_resolve_timesheet_project_assignees(bigint) TO authenticated;

COMMIT;
