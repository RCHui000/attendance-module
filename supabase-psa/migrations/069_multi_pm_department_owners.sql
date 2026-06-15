-- V0.15.3: allow multiple project role assignees per role and route all of
-- them through timesheet project-block approval chains.

BEGIN;

DROP INDEX IF EXISTS public.uq_project_roles_active_project_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_roles_active_project_role_user
  ON public.project_roles(project_id, role_key, user_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.psa_timesheet_project_approval_chain(p_timesheet_id bigint)
RETURNS TABLE(
  project_id bigint,
  step_order int,
  node_key text,
  node_name text,
  resolver_role text,
  assignee_user_id bigint,
  route_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH sheet AS (
    SELECT
      t.id,
      t.user_id,
      ep.org_id,
      ep.cost_specialty,
      o.org_code,
      parent.org_code AS parent_org_code
    FROM public.timesheets t
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = t.user_id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN public.organizations parent ON parent.id = o.parent_id
    WHERE t.id = p_timesheet_id
  ),
  project_scopes AS (
    SELECT DISTINCT
      te.project_id,
      COALESCE(
        NULLIF(p.business_type, ''),
        CASE
          WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC'
          WHEN upper(p.code) LIKE 'PM%' THEN 'PM'
          WHEN upper(p.code) LIKE 'CC%' THEN 'CC'
          ELSE NULL
        END
      ) AS business_type
    FROM public.timesheet_entries te
    JOIN public.projects p ON p.id = te.project_id
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id IS NOT NULL
  ),
  desired_steps AS (
    SELECT
      ps.project_id,
      v.step_order,
      v.node_name,
      v.role_candidates
    FROM project_scopes ps
    CROSS JOIN sheet s
    CROSS JOIN LATERAL (
      VALUES
        (
          10,
          'CC Project Owner',
          CASE
            WHEN s.org_code = 'CC' AND s.cost_specialty = 'mep' AND ps.business_type IN ('CC', 'PMCC')
              THEN ARRAY['cc_mep_project_owner', 'cc_project_owner']
            WHEN s.org_code = 'CC' AND ps.business_type IN ('CC', 'PMCC')
              THEN ARRAY['cc_civil_project_owner', 'cc_project_owner']
            ELSE ARRAY[]::text[]
          END
        ),
        (
          20,
          'PM Cost Department Owner',
          CASE
            WHEN s.org_code = 'CC' AND ps.business_type = 'PMCC'
              THEN ARRAY['pm_cost_department_owner']
            WHEN s.org_code = 'PM_COST'
              THEN ARRAY['pm_cost_department_owner']
            ELSE ARRAY[]::text[]
          END
        ),
        (
          30,
          'PM Project Owner',
          CASE
            WHEN (s.org_code = 'CC' AND ps.business_type = 'PMCC')
              OR s.org_code LIKE 'PM_%'
              OR s.parent_org_code = 'PM'
              OR s.org_code = 'PM'
              THEN ARRAY['pm_project_owner']
            ELSE ARRAY[]::text[]
          END
        ),
        (
          40,
          'Department Owner',
          CASE
            WHEN s.org_code = 'CC' AND ps.business_type = 'CC'
              THEN ARRAY['cc_department_owner']
            WHEN (s.org_code = 'CC' AND ps.business_type = 'PMCC')
              OR s.org_code LIKE 'PM_%'
              OR s.parent_org_code = 'PM'
              OR s.org_code = 'PM'
              THEN ARRAY['pm_department_owner']
            ELSE ARRAY[]::text[]
          END
        )
    ) AS v(step_order, node_name, role_candidates)
    WHERE cardinality(v.role_candidates) > 0
  ),
  resolved_steps AS (
    SELECT
      ds.project_id,
      ds.step_order,
      ds.node_name,
      pr.role_key,
      pr.user_id AS assignee_user_id,
      array_position(ds.role_candidates, pr.role_key) AS role_priority,
      pr.id AS project_role_id
    FROM desired_steps ds
    JOIN public.project_roles pr
      ON pr.project_id = ds.project_id
     AND pr.role_key = ANY(ds.role_candidates)
     AND pr.status = 'active'
     AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
     AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
  ),
  role_ranked AS (
    SELECT
      rs.*,
      min(role_priority) OVER (PARTITION BY project_id, step_order, assignee_user_id) AS best_role_priority
    FROM resolved_steps rs
  ),
  role_deduped AS (
    SELECT DISTINCT ON (project_id, step_order, assignee_user_id)
      project_id,
      step_order,
      node_name,
      role_key,
      assignee_user_id,
      role_priority,
      project_role_id
    FROM role_ranked
    WHERE role_priority = best_role_priority
    ORDER BY project_id, step_order, assignee_user_id, role_priority, project_role_id DESC
  ),
  compressed AS (
    SELECT DISTINCT ON (project_id, assignee_user_id)
      project_id,
      step_order,
      node_name,
      role_key,
      assignee_user_id
    FROM role_deduped
    ORDER BY project_id, assignee_user_id, step_order DESC, role_priority DESC
  )
  SELECT
    c.project_id,
    c.step_order,
    'project_' || c.project_id::text || '_' || c.step_order::text || '_' || c.role_key || '_' || c.assignee_user_id::text AS node_key,
    c.node_name,
    c.role_key AS resolver_role,
    c.assignee_user_id,
    'project_roles:' || c.role_key AS route_source
  FROM compressed c
  ORDER BY c.project_id, c.step_order, c.assignee_user_id;
$$;

ALTER FUNCTION public.psa_timesheet_project_approval_chain(bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_timesheet_project_approval_chain(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_project_approval_chain(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
