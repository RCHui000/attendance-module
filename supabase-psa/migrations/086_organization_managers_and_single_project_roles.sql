-- V0.16.33: normalize organization managers and restore single assignee per project role.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organization_managers (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  manager_role TEXT NOT NULL DEFAULT 'department_owner',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_managers_active_role_employee
  ON public.organization_managers(org_id, employee_id, manager_role)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_organization_managers_org
  ON public.organization_managers(org_id)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_organization_managers_employee
  ON public.organization_managers(employee_id)
  WHERE is_active = TRUE;

INSERT INTO public.organization_managers(org_id, employee_id, manager_role, is_primary, is_active)
SELECT o.id, o.manager_user_id, 'department_owner', TRUE, TRUE
FROM public.organizations o
WHERE NULLIF(o.manager_user_id, 0) IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.psa_touch_organization_managers()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_organization_managers ON public.organization_managers;
CREATE TRIGGER trg_touch_organization_managers
BEFORE UPDATE ON public.organization_managers
FOR EACH ROW
EXECUTE FUNCTION public.psa_touch_organization_managers();

ALTER TABLE public.organization_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RBAC read organization managers" ON public.organization_managers;
CREATE POLICY "RBAC read organization managers"
  ON public.organization_managers FOR SELECT TO authenticated
  USING (
    public.current_user_can_access_resource('system_management', 'read')
    OR public.current_user_can_access_resource('review', 'read')
    OR public.current_user_can_access_resource('report', 'read')
    OR public.current_user_can_access_resource('dashboard', 'read')
    OR public.current_user_can_access_resource('timesheet', 'read')
  );

DROP POLICY IF EXISTS "RBAC write organization managers" ON public.organization_managers;
CREATE POLICY "RBAC write organization managers"
  ON public.organization_managers FOR ALL TO authenticated
  USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_managers TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.organization_managers_id_seq TO authenticated;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id, role_key
      ORDER BY COALESCE(updated_at, created_at, NOW()) DESC, id DESC
    ) AS rn
  FROM public.project_roles
  WHERE status = 'active'
)
UPDATE public.project_roles pr
SET status = 'inactive',
    updated_at = NOW()
FROM ranked r
WHERE pr.id = r.id
  AND r.rn > 1;

DROP INDEX IF EXISTS public.uq_project_roles_active_project_role_user;
DROP INDEX IF EXISTS public.uq_project_roles_active_project_role;
CREATE UNIQUE INDEX uq_project_roles_active_project_role
  ON public.project_roles(project_id, role_key)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.current_user_manages_org(target_org_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH RECURSIVE actor AS (
    SELECT e.id
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
    LIMIT 1
  ),
  admin_role AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN actor a ON a.id = ur.employee_id
      WHERE ur.role = 'admin'
    ) AS is_admin
  ),
  managed_orgs AS (
    SELECT o.id
    FROM public.organizations o
    JOIN public.organization_managers om ON om.org_id = o.id
    JOIN actor a ON a.id = om.employee_id
    WHERE o.status = 'active'
      AND om.is_active = TRUE
      AND om.manager_role = 'department_owner'
    UNION ALL
    SELECT child.id
    FROM public.organizations child
    JOIN managed_orgs parent ON parent.id = child.parent_id
    WHERE child.status = 'active'
  )
  SELECT COALESCE((SELECT is_admin FROM admin_role), FALSE)
    OR EXISTS (
      SELECT 1
      FROM managed_orgs mo
      WHERE mo.id = target_org_id
    );
$$;

CREATE OR REPLACE FUNCTION public.psa_primary_org_manager(p_org_id BIGINT)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT om.employee_id
  FROM public.organization_managers om
  JOIN public.employees e ON e.id = om.employee_id
  WHERE om.org_id = p_org_id
    AND om.is_active = TRUE
    AND om.manager_role = 'department_owner'
    AND e.is_active IS DISTINCT FROM FALSE
  ORDER BY om.is_primary DESC, om.updated_at DESC, om.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint DEFAULT NULL::bigint
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
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = bd.creator_user_id
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
    SELECT
      om.employee_id AS assignee_user_id,
      'org_manager'::text AS route_source,
      o.id AS matched_org_id,
      4 + oc.depth AS priority
    FROM org_chain oc
    JOIN public.organizations o ON o.id = oc.id
    JOIN public.organization_managers om ON om.org_id = o.id
    WHERE p_resolver_type = 'org_manager'
      AND om.is_active = TRUE
      AND om.manager_role = 'department_owner'
    ORDER BY oc.depth, om.is_primary DESC, om.updated_at DESC, om.id DESC
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

CREATE OR REPLACE FUNCTION public.psa_resolve_project_review_assignee(
  p_project_id bigint,
  p_submitter_user_id bigint,
  p_submitter_org_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH RECURSIVE submitter_org AS (
    SELECT COALESCE(
      NULLIF(p_submitter_org_id, 0),
      NULLIF((SELECT ep.org_id FROM public.employee_profiles ep WHERE ep.employee_id = p_submitter_user_id LIMIT 1), 0)
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
    SELECT pdo.project_owner_id AS employee_id,
      CASE WHEN oc.depth = 0 THEN 'project_department_owner_exact' ELSE 'project_department_owner_parent' END AS source,
      pdo.org_id, oc.depth, 1 AS priority
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
    SELECT p.project_owner_id AS employee_id, 'project_default_owner'::text AS source, NULL::bigint AS org_id, 0 AS depth, 2 AS priority
    FROM public.projects p
    WHERE p.id = p_project_id
      AND NULLIF(p.project_owner_id, 0) IS NOT NULL
  ),
  submitter_org_manager AS (
    SELECT om.employee_id, 'submitter_org_manager'::text AS source, o.id AS org_id, oc.depth, 3 AS priority
    FROM org_chain oc
    JOIN public.organizations o ON o.id = oc.id
    JOIN public.organization_managers om ON om.org_id = o.id
    WHERE om.is_active = TRUE
      AND om.manager_role = 'department_owner'
    ORDER BY oc.depth ASC, om.is_primary DESC, om.updated_at DESC, om.id DESC
    LIMIT 1
  ),
  admin_fallback AS (
    SELECT ur.employee_id, 'admin_fallback'::text AS source, NULL::bigint AS org_id, 0 AS depth, 4 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.employee_id
    LIMIT 1
  ),
  candidates AS (
    SELECT * FROM department_owner
    UNION ALL SELECT * FROM project_default_owner
    UNION ALL SELECT * FROM submitter_org_manager
    UNION ALL SELECT * FROM admin_fallback
  )
  SELECT employee_id AS assignee_user_id, source AS route_source, org_id AS matched_org_id
  FROM candidates
  WHERE employee_id IS NOT NULL AND employee_id <> 0
  ORDER BY priority, depth, employee_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_assignees(p_timesheet_id bigint)
RETURNS TABLE(assignee_user_id bigint, assignee_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH sheet AS (
    SELECT user_id
    FROM public.timesheets
    WHERE id = p_timesheet_id
  ),
  employee_profile AS (
    SELECT ep.manager_user_id, ep.org_id
    FROM public.employee_profiles ep
    JOIN sheet s ON s.user_id = ep.employee_id
    LIMIT 1
  ),
  department_head AS (
    SELECT COALESCE(
      NULLIF(ep.manager_user_id, 0),
      public.psa_primary_org_manager(ep.org_id),
      0
    ) AS employee_id
    FROM employee_profile ep
  ),
  project_heads AS (
    SELECT COALESCE(
      NULLIF(p.project_owner_id, 0),
      public.psa_primary_org_manager(p.owner_org_id),
      NULLIF((SELECT employee_id FROM department_head), 0),
      0
    ) AS employee_id
    FROM public.timesheet_entries te
    JOIN public.projects p ON p.id = te.project_id
    WHERE te.timesheet_id = p_timesheet_id
  ),
  candidates AS (
    SELECT employee_id, 'project_owner'::text AS assignee_role, 1 AS priority
    FROM project_heads
    WHERE employee_id <> 0
    UNION ALL
    SELECT employee_id, 'department_head'::text AS assignee_role, 2 AS priority
    FROM department_head
    WHERE employee_id <> 0
    UNION ALL
    SELECT ur.employee_id, 'admin'::text AS assignee_role, 3 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
      AND NOT EXISTS (SELECT 1 FROM project_heads WHERE employee_id <> 0)
      AND NOT EXISTS (SELECT 1 FROM department_head WHERE employee_id <> 0)
    ORDER BY priority
    LIMIT 20
  )
  SELECT DISTINCT ON (employee_id)
    employee_id AS assignee_user_id,
    assignee_role
  FROM candidates
  WHERE employee_id IS NOT NULL AND employee_id <> 0
  ORDER BY employee_id, priority;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_department_reviewer(p_timesheet_id bigint)
RETURNS TABLE(assignee_user_id bigint, assignee_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH sheet AS (
    SELECT user_id
    FROM public.timesheets
    WHERE id = p_timesheet_id
  ),
  employee_profile AS (
    SELECT ep.manager_user_id, ep.org_id
    FROM public.employee_profiles ep
    JOIN sheet s ON s.user_id = ep.employee_id
    LIMIT 1
  ),
  department_head AS (
    SELECT COALESCE(
      NULLIF(ep.manager_user_id, 0),
      public.psa_primary_org_manager(ep.org_id),
      0
    ) AS employee_id
    FROM employee_profile ep
  ),
  candidates AS (
    SELECT employee_id, 'department_head'::text AS assignee_role, 1 AS priority
    FROM department_head
    WHERE employee_id <> 0
    UNION ALL
    SELECT ur.employee_id, 'admin'::text AS assignee_role, 2 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
      AND NOT EXISTS (SELECT 1 FROM department_head WHERE employee_id <> 0)
  )
  SELECT employee_id AS assignee_user_id, assignee_role
  FROM candidates
  WHERE employee_id IS NOT NULL AND employee_id <> 0
  ORDER BY priority, employee_id
  LIMIT 1;
$$;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS manager_user_id;

INSERT INTO public.permission_resource_effects(
  resource_key, access_level, object_type, object_name, operation, description
)
VALUES
  ('system_management', 'read', 'table', 'organization_managers', 'select', 'Read organization manager assignments.'),
  ('system_management', 'write', 'table', 'organization_managers', 'insert_update_delete', 'Maintain organization manager assignments.')
ON CONFLICT (resource_key, access_level, object_type, object_name, operation) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = NOW();

GRANT EXECUTE ON FUNCTION public.current_user_manages_org(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psa_primary_org_manager(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_resolve_project_review_assignee(bigint, bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_resolve_timesheet_assignees(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_resolve_timesheet_department_reviewer(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
