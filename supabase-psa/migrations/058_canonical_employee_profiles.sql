-- V0.15: collapse employee_profiles_v2 into the canonical employee_profiles table.

BEGIN;

DO $$
DECLARE
  v_name text;
BEGIN
  IF to_regclass('public.employee_profiles_v2') IS NOT NULL
     AND to_regclass('public.employee_profiles') IS NULL THEN
    ALTER TABLE public.employee_profiles_v2 RENAME TO employee_profiles;
  ELSIF to_regclass('public.employee_profiles_v2') IS NOT NULL
     AND to_regclass('public.employee_profiles') IS NOT NULL THEN
    INSERT INTO public.employee_profiles (
      employee_id, org_id, position_name, employment_status, manager_user_id,
      hire_date, row_locked, row_lock_reason, created_at, updated_at, cost_specialty
    )
    SELECT
      old.employee_id, old.org_id, old.position_name, old.employment_status, old.manager_user_id,
      old.hire_date, old.row_locked, old.row_lock_reason, old.created_at, old.updated_at, old.cost_specialty
    FROM public.employee_profiles_v2 old
    WHERE NOT EXISTS (
      SELECT 1 FROM public.employee_profiles ep WHERE ep.employee_id = old.employee_id
    );
    DROP TABLE public.employee_profiles_v2;
  END IF;

  IF to_regclass('public.employee_profiles_v2_id_seq') IS NOT NULL
     AND to_regclass('public.employee_profiles_id_seq') IS NULL THEN
    ALTER SEQUENCE public.employee_profiles_v2_id_seq RENAME TO employee_profiles_id_seq;
  END IF;

  IF to_regclass('public.employee_profiles_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE public.employee_profiles_id_seq OWNED BY public.employee_profiles.id;
    ALTER TABLE public.employee_profiles
      ALTER COLUMN id SET DEFAULT nextval('public.employee_profiles_id_seq'::regclass);
  END IF;

  FOR v_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.employee_profiles'::regclass
      AND conname LIKE '%employee_profiles_v2%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.employee_profiles RENAME CONSTRAINT %I TO %I',
      v_name,
      replace(v_name, 'employee_profiles_v2', 'employee_profiles')
    );
  END LOOP;

  FOR v_name IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'employee_profiles'
      AND indexname LIKE '%employee_profiles_v2%'
  LOOP
    EXECUTE format(
      'ALTER INDEX public.%I RENAME TO %I',
      v_name,
      replace(v_name, 'employee_profiles_v2', 'employee_profiles')
    );
  END LOOP;
END $$;

INSERT INTO public.employee_profiles (
  employee_id, org_id, position_name, cost_specialty, employment_status, manager_user_id, hire_date
)
SELECT
  e.id,
  NULL,
  '',
  NULL,
  CASE WHEN e.is_active THEN 'active' ELSE 'terminated' END,
  NULL,
  NULL
FROM public.employees e
WHERE NOT EXISTS (
  SELECT 1 FROM public.employee_profiles ep WHERE ep.employee_id = e.id
);

ALTER TABLE public.employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_profiles REPLICA IDENTITY FULL;
GRANT SELECT ON public.employee_profiles TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.employee_profiles TO authenticated;
GRANT ALL ON public.employee_profiles TO service_role, postgres;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF to_regclass('public.employee_profiles_v2') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'employee_profiles_v2'
       ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.employee_profiles_v2;
    END IF;

    IF to_regclass('public.employee_profiles') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'employee_profiles'
       ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.employee_profiles;
    END IF;
  END IF;
END $$;

DROP POLICY IF EXISTS "Self read profile v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "Self read own profile v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "Manager read org profiles v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "Admin all profiles v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "Reviewer read profiles v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "Department manager update profiles v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "HR read all profiles v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "RBAC read profiles v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "RBAC write profiles v2" ON public.employee_profiles;
DROP POLICY IF EXISTS "auth_read_profiles_v2" ON public.employee_profiles;

DROP POLICY IF EXISTS "Self read profile" ON public.employee_profiles;
CREATE POLICY "Self read profile" ON public.employee_profiles
  FOR SELECT TO authenticated
  USING (employee_id = public.current_employee_id());

DROP POLICY IF EXISTS "Reviewer read profiles" ON public.employee_profiles;
CREATE POLICY "Reviewer read profiles" ON public.employee_profiles
  FOR SELECT TO authenticated
  USING (public.current_user_can_review());

DROP POLICY IF EXISTS "Department manager update profiles" ON public.employee_profiles;
CREATE POLICY "Department manager update profiles" ON public.employee_profiles
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_employee(employee_id))
  WITH CHECK (public.current_user_can_manage_employee(employee_id));

DROP POLICY IF EXISTS "HR read all profiles" ON public.employee_profiles;
CREATE POLICY "HR read all profiles" ON public.employee_profiles
  FOR SELECT TO authenticated
  USING (public.current_user_has_role('hr'));

DROP POLICY IF EXISTS "RBAC read profiles" ON public.employee_profiles;
CREATE POLICY "RBAC read profiles" ON public.employee_profiles
  FOR SELECT USING (public.current_user_can_access_resource('system_management', 'read'));

DROP POLICY IF EXISTS "RBAC write profiles" ON public.employee_profiles;
CREATE POLICY "RBAC write profiles" ON public.employee_profiles
  FOR ALL USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));
CREATE OR REPLACE FUNCTION public.current_user_can_manage_employee(target_employee_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1
      FROM public.employee_profiles ep
      WHERE ep.employee_id = target_employee_id
        AND ep.org_id IS NOT NULL
        AND public.current_user_manages_org(ep.org_id)
    );
$function$;

CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(p_document_id bigint, p_resolver_type text, p_resolver_role text, p_scope_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.psa_resolve_project_review_assignee(p_project_id bigint, p_submitter_user_id bigint, p_submitter_org_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_assignees(p_timesheet_id bigint)
 RETURNS TABLE(assignee_user_id bigint, assignee_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  with sheet as (
    select user_id
    from public.timesheets
    where id = p_timesheet_id
  ),
  employee_profile as (
    select ep.manager_user_id, ep.org_id
    from public.employee_profiles ep
    join sheet s on s.user_id = ep.employee_id
    limit 1
  ),
  department_head as (
    select coalesce(
      nullif(ep.manager_user_id, 0),
      nullif(org.manager_user_id, 0),
      0
    ) as employee_id
    from employee_profile ep
    left join public.organizations org on org.id = ep.org_id
  ),
  project_heads as (
    select coalesce(
      nullif(p.project_owner_id, 0),
      nullif(owner_org.manager_user_id, 0),
      nullif((select employee_id from department_head), 0),
      0
    ) as employee_id
    from public.timesheet_entries te
    join public.projects p on p.id = te.project_id
    left join public.organizations owner_org on owner_org.id = p.owner_org_id
    where te.timesheet_id = p_timesheet_id
  ),
  candidates as (
    select employee_id, 'project_owner'::text as assignee_role, 1 as priority
    from project_heads
    where employee_id <> 0
    union all
    select employee_id, 'department_head'::text as assignee_role, 2 as priority
    from department_head
    where employee_id <> 0
    union all
    select ur.employee_id, 'admin'::text as assignee_role, 3 as priority
    from public.user_roles ur
    where ur.role = 'admin'
      and not exists (select 1 from project_heads where employee_id <> 0)
      and not exists (select 1 from department_head where employee_id <> 0)
    order by priority
    limit 20
  )
  select distinct on (employee_id)
    employee_id as assignee_user_id,
    assignee_role
  from candidates
  where employee_id is not null and employee_id <> 0
  order by employee_id, priority;
$function$;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_department_reviewer(p_timesheet_id bigint)
 RETURNS TABLE(assignee_user_id bigint, assignee_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
      NULLIF(org.manager_user_id, 0),
      0
    ) AS employee_id
    FROM employee_profile ep
    LEFT JOIN public.organizations org ON org.id = ep.org_id
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
$function$;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_project_assignees(p_timesheet_id bigint)
 RETURNS TABLE(project_id bigint, assignee_user_id bigint, assignee_role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
    SELECT DISTINCT te.project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id IS NOT NULL
  ),
  desired_roles AS (
    SELECT
      ps.project_id,
      CASE
        WHEN s.org_code = 'CC' AND s.cost_specialty = 'mep' THEN ARRAY['cc_mep_project_owner', 'cc_project_owner', 'cc_department_owner']
        WHEN s.org_code = 'CC' THEN ARRAY['cc_civil_project_owner', 'cc_project_owner', 'cc_department_owner']
        WHEN s.org_code = 'PM_COST' THEN ARRAY['pm_cost_department_owner', 'pm_project_owner', 'pm_department_owner']
        WHEN s.org_code LIKE 'PM_%' OR s.parent_org_code = 'PM' OR s.org_code = 'PM' THEN ARRAY['pm_project_owner', 'pm_department_owner']
        ELSE ARRAY['project_owner', 'pm_project_owner', 'cc_project_owner']
      END AS role_keys
    FROM project_scopes ps
    CROSS JOIN sheet s
  ),
  role_matches AS (
    SELECT
      dr.project_id,
      pr.user_id AS assignee_user_id,
      pr.role_key AS assignee_role,
      array_position(dr.role_keys, pr.role_key) AS priority,
      pr.id
    FROM desired_roles dr
    JOIN public.project_roles pr ON pr.project_id = dr.project_id
     AND pr.role_key = ANY(dr.role_keys)
     AND pr.status = 'active'
     AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
     AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
  ),
  ranked_role_matches AS (
    SELECT DISTINCT ON (project_id)
      project_id,
      assignee_user_id,
      assignee_role
    FROM role_matches
    WHERE assignee_user_id IS NOT NULL
    ORDER BY project_id, priority, id DESC
  ),
  fallback_matches AS (
    SELECT
      ps.project_id,
      route.assignee_user_id,
      CASE
        WHEN route.route_source IN ('project_department_owner_exact', 'project_department_owner_parent', 'project_default_owner') THEN 'project_owner'
        WHEN route.route_source = 'submitter_org_manager' THEN 'department_head'
        ELSE 'admin'
      END AS assignee_role
    FROM project_scopes ps
    CROSS JOIN sheet s
    JOIN LATERAL public.psa_resolve_project_review_assignee(ps.project_id, s.user_id, s.org_id) route ON true
    WHERE NOT EXISTS (
      SELECT 1 FROM ranked_role_matches rm WHERE rm.project_id = ps.project_id
    )
  )
  SELECT project_id, assignee_user_id, assignee_role
  FROM ranked_role_matches
  UNION ALL
  SELECT project_id, assignee_user_id, assignee_role
  FROM fallback_matches
  WHERE assignee_user_id IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.psa_timesheet_project_approval_chain(p_timesheet_id bigint)
 RETURNS TABLE(project_id bigint, step_order integer, node_key text, node_name text, resolver_role text, assignee_user_id bigint, route_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
      pr.user_id AS assignee_user_id
    FROM desired_steps ds
    JOIN LATERAL (
      SELECT pr.*
      FROM public.project_roles pr
      WHERE pr.project_id = ds.project_id
        AND pr.role_key = ANY(ds.role_candidates)
        AND pr.status = 'active'
        AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
        AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
      ORDER BY array_position(ds.role_candidates, pr.role_key), pr.id DESC
      LIMIT 1
    ) pr ON true
  ),
  with_lag AS (
    SELECT
      rs.*,
      lag(rs.assignee_user_id) OVER (PARTITION BY rs.project_id ORDER BY rs.step_order) AS previous_assignee_user_id
    FROM resolved_steps rs
  ),
  grouped AS (
    SELECT
      wl.*,
      sum(CASE WHEN wl.previous_assignee_user_id = wl.assignee_user_id THEN 0 ELSE 1 END)
        OVER (PARTITION BY wl.project_id ORDER BY wl.step_order) AS same_assignee_group
    FROM with_lag wl
  ),
  compressed AS (
    SELECT DISTINCT ON (project_id, same_assignee_group)
      project_id,
      step_order,
      node_name,
      role_key,
      assignee_user_id
    FROM grouped
    ORDER BY project_id, same_assignee_group, step_order DESC
  )
  SELECT
    c.project_id,
    c.step_order,
    'project_' || c.project_id::text || '_' || c.step_order::text || '_' || c.role_key AS node_key,
    c.node_name,
    c.role_key AS resolver_role,
    c.assignee_user_id,
    'project_roles:' || c.role_key AS route_source
  FROM compressed c
  ORDER BY c.project_id, c.step_order;
$function$;

CREATE OR REPLACE FUNCTION public.submit_document(p_document_type text, p_business_id bigint, p_business_version integer DEFAULT 1, p_business_type text DEFAULT NULL::text, p_creator_user_id bigint DEFAULT NULL::bigint, p_context jsonb DEFAULT '{}'::jsonb, p_request_id text DEFAULT NULL::text)
 RETURNS TABLE(document_id bigint, instance_id bigint, round_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_creator bigint := COALESCE(p_creator_user_id, public.current_employee_id());
  v_creator_org bigint;
  v_project_id bigint;
  v_template public.approval_templates%rowtype;
  v_snapshot jsonb;
  v_doc_id bigint;
  v_instance_id bigint;
  v_round_id bigint;
  v_node record;
  v_new_node_id bigint;
  v_previous_node_id bigint;
  v_from_id bigint;
  v_to_id bigint;
  v_project_id_for_skip bigint;
  v_terminal_unapproved int;
BEGIN
  SELECT ep.org_id INTO v_creator_org
  FROM public.employee_profiles ep
  WHERE ep.employee_id = v_creator
  LIMIT 1;

  IF p_document_type = 'timesheet' THEN
    SELECT te.project_id INTO v_project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_business_id
    ORDER BY te.project_id
    LIMIT 1;
  ELSE
    v_project_id := NULLIF((p_context ->> 'project_id')::bigint, 0);
  END IF;

  SELECT * INTO v_template
  FROM public.approval_templates
  WHERE document_type = p_document_type
    AND status = 'active'
    AND (business_type IS NULL OR business_type = p_business_type)
  ORDER BY CASE WHEN business_type = p_business_type THEN 0 ELSE 1 END, version DESC, id DESC
  LIMIT 1;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'No active approval template for document_type=% business_type=%', p_document_type, p_business_type;
  END IF;

  INSERT INTO public.business_documents (
    document_type, business_id, business_version, creator_user_id, creator_employee_id,
    creator_org_id, project_id, business_type, lifecycle_status, submitted_at
  )
  VALUES (
    p_document_type, p_business_id, p_business_version, v_creator, v_creator,
    v_creator_org, v_project_id, p_business_type, 'in_approval', now()
  )
  ON CONFLICT (document_type, business_id, business_version) DO UPDATE
  SET lifecycle_status = 'in_approval',
      submitted_at = COALESCE(public.business_documents.submitted_at, now()),
      updated_at = now()
  RETURNING id INTO v_doc_id;

  SELECT ai.id INTO v_instance_id
  FROM public.approval_instances ai
  WHERE ai.document_id = v_doc_id
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    SELECT ai.id INTO v_instance_id
    FROM public.approval_instances ai
    WHERE ai.target_type = p_document_type
      AND ai.target_id = p_business_id
    LIMIT 1;

    IF v_instance_id IS NOT NULL THEN
      UPDATE public.approval_instances ai
      SET document_id = v_doc_id,
          template_id = v_template.id,
          template_version = v_template.version,
          template_snapshot = public.psa_template_snapshot(v_template.id),
          status = 'running',
          updated_at = now()
      WHERE ai.id = v_instance_id;
    END IF;
  END IF;

  IF v_instance_id IS NOT NULL THEN
    SELECT ai.current_round_id INTO v_round_id
    FROM public.approval_instances ai
    WHERE ai.id = v_instance_id;
    submit_document.document_id := v_doc_id;
    submit_document.instance_id := v_instance_id;
    submit_document.round_id := v_round_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_snapshot := public.psa_template_snapshot(v_template.id);

  INSERT INTO public.approval_instances (
    approval_key, target_type, target_id, document_id, template_id, template_version,
    template_snapshot, status, current_round, created_by
  )
  VALUES (
    p_document_type, p_document_type, p_business_id, v_doc_id, v_template.id, v_template.version,
    v_snapshot, 'running', 1, v_creator
  )
  RETURNING id INTO v_instance_id;

  INSERT INTO public.approval_rounds (
    instance_id, round_no, round_type, status, started_by, created_by, reason
  )
  VALUES (v_instance_id, 1, 'initial_submit', 'running', v_creator, v_creator, 'submit_document')
  RETURNING id INTO v_round_id;

  UPDATE public.approval_instances ai
  SET current_round_id = v_round_id, current_round = 1, updated_at = now()
  WHERE ai.id = v_instance_id;

  IF p_document_type <> 'timesheet' THEN
    FOR v_node IN
      SELECT *
      FROM public.approval_template_nodes
      WHERE template_id = v_template.id
      ORDER BY sort_order, node_key
    LOOP
      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, v_node.node_key, v_node.node_key, v_node.node_name, v_node.node_type,
        p_document_type, NULL,
        'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
        v_node.reject_policy, to_jsonb(v_node), to_jsonb(v_node)
      )
      RETURNING id INTO v_new_node_id;
    END LOOP;
  ELSE
    FOR v_node IN
      SELECT *
      FROM public.psa_timesheet_project_approval_chain(p_business_id)
      ORDER BY project_id, step_order
    LOOP
      IF v_previous_node_id IS NOT NULL AND v_project_id_for_skip IS DISTINCT FROM v_node.project_id THEN
        v_previous_node_id := NULL;
      END IF;

      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, assignee_user_id, assignee_role, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, v_node.node_key, 'timesheet_serial_project_review',
        v_node.node_name, 'approval', 'project', v_node.project_id, 'waiting',
        'project_role', v_node.resolver_role, 'single', 'back_to_creator',
        v_node.assignee_user_id, v_node.resolver_role,
        jsonb_build_object(
          'resolved_assignee_user_id', v_node.assignee_user_id,
          'assignee_role', v_node.resolver_role,
          'route_source', v_node.route_source,
          'serial_step_order', v_node.step_order
        ),
        jsonb_build_object(
          'project_id', v_node.project_id,
          'optional', true,
          'serial_step_order', v_node.step_order,
          'compressed_serial_chain', true
        )
      )
      RETURNING id INTO v_new_node_id;

      IF v_previous_node_id IS NOT NULL THEN
        INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type)
        VALUES (v_round_id, v_instance_id, v_previous_node_id, v_new_node_id, 'normal', 'all_approved')
        ON CONFLICT DO NOTHING;
      END IF;

      v_previous_node_id := v_new_node_id;
      v_project_id_for_skip := v_node.project_id;
    END LOOP;

    FOR v_project_id_for_skip IN
      SELECT DISTINCT te.project_id
      FROM public.timesheet_entries te
      WHERE te.timesheet_id = p_business_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.approval_nodes n
          WHERE n.round_id = v_round_id
            AND n.scope_type = 'project'
            AND n.scope_id = te.project_id
        )
    LOOP
      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, completed_at, result_action, comment, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, 'project_' || v_project_id_for_skip::text || '_skipped_unresolved',
        'timesheet_serial_project_review', 'Project Review Skipped', 'approval',
        'project', v_project_id_for_skip, 'skipped', 'project_role', 'unresolved_optional',
        'single', 'back_to_creator', now(), 'skipped', 'No configured approver; optional node skipped',
        jsonb_build_object('route_source', 'optional_unresolved_skipped'),
        jsonb_build_object('project_id', v_project_id_for_skip, 'optional', true, 'unresolved_skipped', true)
      );
    END LOOP;
  END IF;

  IF p_document_type <> 'timesheet' THEN
    FOR v_node IN
      SELECT e.*
      FROM public.approval_template_edges e
      WHERE e.template_id = v_template.id
    LOOP
      SELECT n.id INTO v_from_id FROM public.approval_nodes n WHERE n.round_id = v_round_id AND n.node_key = v_node.from_node_key LIMIT 1;
      SELECT n.id INTO v_to_id FROM public.approval_nodes n WHERE n.round_id = v_round_id AND n.node_key = v_node.to_node_key LIMIT 1;
      IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
        INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr)
        VALUES (v_round_id, v_instance_id, v_from_id, v_to_id, v_node.edge_type, v_node.edge_type, v_node.condition_expr)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.psa_activate_ready_nodes(v_round_id);
  PERFORM public.psa_write_approval_event(
    v_instance_id, v_round_id, NULL, NULL, v_creator, 'document_submitted',
    'draft', 'in_approval', p_request_id, '', p_context
  );

  SELECT count(*) INTO v_terminal_unapproved
  FROM public.approval_nodes n
  WHERE n.round_id = v_round_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.approval_edges e
      WHERE e.round_id = v_round_id
        AND e.from_node_id = n.id
        AND e.condition_result = true
    )
    AND n.status NOT IN ('approved', 'skipped');

  IF v_terminal_unapproved = 0 THEN
    UPDATE public.approval_rounds
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_round_id AND status = 'running';

    UPDATE public.approval_instances
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_instance_id AND status = 'running';

    UPDATE public.business_documents
    SET lifecycle_status = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
    WHERE id = v_doc_id;

    IF p_document_type = 'timesheet' THEN
      UPDATE public.timesheets
      SET status = 'approved', approved_at = now(), updated_at = now()
      WHERE id = p_business_id;
    END IF;
  END IF;

  submit_document.document_id := v_doc_id;
  submit_document.instance_id := v_instance_id;
  submit_document.round_id := v_round_id;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE VIEW public.hr_employee_current_view
WITH (security_invoker = true)
AS
SELECT
    e.id                    AS employee_id,
    e.auth_user_id,
    e.employee_no,
    e.name                  AS employee_name,
    p.display_name,
    p.login_name,
    p.auth_email,
    ep.org_id,
    o.org_name,
    ep.position_name,
    ep.employment_status,
    ep.manager_user_id,
    ep.hire_date,
    ep.row_locked,
    ec.contract_type,
    ec.employment_type,
    ec.contract_start,
    ec.contract_end,
    esp.salary_mode,
    esp.monthly_salary,
    esp.daily_wage,
    esp.standard_monthly_workdays,
    e.is_active,
    ep.cost_specialty
FROM public.employees e
LEFT JOIN public.profiles p ON p.auth_user_id = e.auth_user_id
LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
LEFT JOIN public.organizations o ON o.id = ep.org_id
LEFT JOIN public.employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = TRUE
LEFT JOIN public.employee_salary_profiles esp ON esp.employee_id = e.id AND esp.is_current = TRUE;
NOTIFY pgrst, 'reload schema';

COMMIT;
