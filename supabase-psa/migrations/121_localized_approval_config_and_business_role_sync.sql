BEGIN;

-- Keep internal keys stable, but make the approval configuration read as
-- business language instead of legacy PMCC/CC database terms.
UPDATE public.approval_templates
SET name = CASE template_key
    WHEN 'contract_approval_pm_v1' THEN U&'\9879\76EE\7BA1\7406\5BA1\6279'
    WHEN 'contract_approval_cc_v1' THEN U&'QS/\8BBE\8BA1\4FA7\5BA1\6279'
    WHEN 'contract_approval_pmcc_v1' THEN U&'\603B\5DE5\529E/\9879\76EE\7BA1\7406\90E8\534F\4F5C\5BA1\6279'
    ELSE name
  END
WHERE template_key IN (
  'contract_approval_pm_v1',
  'contract_approval_cc_v1',
  'contract_approval_pmcc_v1'
);

WITH node_labels(template_key, node_key, node_name, resolver_type, resolver_role, sort_order) AS (
  VALUES
    ('contract_approval_pm_v1', 'submitter', U&'\63D0\4EA4\4EBA', 'document_creator', 'submitter', 10),
    ('contract_approval_pm_v1', 'pm_project_owner', U&'PM\9879\76EE\8D1F\8D23\4EBA', 'project_role', 'pm_project_owner', 20),
    ('contract_approval_pm_v1', 'pm_department_owner', U&'PM\90E8\95E8\8D1F\8D23\4EBA', 'project_role', 'pm_department_owner', 30),

    ('contract_approval_cc_v1', 'submitter', U&'\63D0\4EA4\4EBA', 'document_creator', 'submitter', 10),
    ('contract_approval_cc_v1', 'cc_project_owner', U&'\53D1\8D77\90E8\95E8\9879\76EE\8D1F\8D23\4EBA', 'project_role', 'cc_project_owner', 20),
    ('contract_approval_cc_v1', 'cc_department_owner', U&'\53D1\8D77\90E8\95E8\8D1F\8D23\4EBA', 'org_manager', 'department_owner', 30),

    ('contract_approval_pmcc_v1', 'cc_submitter', U&'\63D0\4EA4\4EBA', 'document_creator', 'submitter', 10),
    ('contract_approval_pmcc_v1', 'cc_project_owner', U&'\53D1\8D77\90E8\95E8\9879\76EE\8D1F\8D23\4EBA', 'project_role', 'cc_project_owner', 20),
    ('contract_approval_pmcc_v1', 'cc_department_owner', U&'\53D1\8D77\90E8\95E8\8D1F\8D23\4EBA', 'org_manager', 'department_owner', 30),
    ('contract_approval_pmcc_v1', 'pm_cost_department_owner', U&'PM\6210\672C/\8BBE\8BA1\8D1F\8D23\4EBA', 'project_role', 'pm_cost_department_owner', 40),
    ('contract_approval_pmcc_v1', 'pm_project_owner', U&'PM\9879\76EE\8D1F\8D23\4EBA', 'project_role', 'pm_project_owner', 50),
    ('contract_approval_pmcc_v1', 'pm_department_owner', U&'PM\90E8\95E8\8D1F\8D23\4EBA', 'project_role', 'pm_department_owner', 60)
)
UPDATE public.approval_template_nodes n
SET node_name = node_labels.node_name,
    resolver_type = node_labels.resolver_type,
    resolver_role = node_labels.resolver_role,
    sort_order = node_labels.sort_order
FROM public.approval_templates t, node_labels
WHERE n.template_id = t.id
  AND t.template_key = node_labels.template_key
  AND n.node_key = node_labels.node_key;

WITH pmcc_template AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pmcc_v1'
  LIMIT 1
)
DELETE FROM public.approval_template_edges e
USING pmcc_template t
WHERE e.template_id = t.id;

WITH pmcc_template AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pmcc_v1'
  LIMIT 1
),
edges(from_node_key, to_node_key, sort_no) AS (
  VALUES
    ('cc_submitter', 'cc_project_owner', 10),
    ('cc_project_owner', 'cc_department_owner', 20),
    ('cc_department_owner', 'pm_cost_department_owner', 30),
    ('pm_cost_department_owner', 'pm_project_owner', 40),
    ('pm_project_owner', 'pm_department_owner', 50)
)
INSERT INTO public.approval_template_edges(
  template_id, from_node_key, to_node_key, edge_type, condition_expr, scope_join_policy
)
SELECT t.id, e.from_node_key, e.to_node_key, 'normal', '{}'::jsonb, 'same_scope'
FROM pmcc_template t
JOIN edges e ON true
ORDER BY e.sort_no
ON CONFLICT (template_id, from_node_key, to_node_key, edge_type)
DO UPDATE SET scope_join_policy = EXCLUDED.scope_join_policy;

CREATE OR REPLACE FUNCTION public.psa_sync_business_platform_roles(p_employee_ids BIGINT[] DEFAULT NULL)
RETURNS TABLE(synced_employee_id BIGINT, synced_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF session_user NOT IN ('postgres', 'psa_admin') AND NOT (
    public.current_user_can_access_resource('report', 'write')
    OR public.current_user_can_access_resource('permission_config', 'write')
    OR current_user = 'service_role'
    OR current_setting('request.jwt.claim.role', true) = 'service_role'
  ) THEN
    RAISE EXCEPTION 'permission denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_ids IS NOT NULL AND cardinality(p_employee_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH role_rank(role_key, role_rank) AS (
    VALUES
      ('employee', 10),
      ('lead', 20),
      ('manager', 30),
      ('director', 40),
      ('admin', 50)
  ),
  managed_project_roles(role_key, platform_role, priority) AS (
    VALUES
      ('cc_civil_project_owner', 'lead', 20),
      ('cc_mep_project_owner', 'lead', 20),
      ('cc_project_owner', 'lead', 20),
      ('project_owner', 'lead', 20),
      ('cc_design_project_owner', 'lead', 20),
      ('pm_cost_department_owner', 'lead', 20),
      ('pm_design_project_owner', 'lead', 20),
      ('pm_project_owner', 'lead', 20),
      ('cc_department_owner', 'manager', 30),
      ('pm_department_owner', 'manager', 30)
  ),
  targets AS (
    SELECT DISTINCT e.id AS employee_id
    FROM public.employees e
    WHERE p_employee_ids IS NULL OR e.id = ANY(p_employee_ids)
  ),
  business_assignments AS (
    SELECT DISTINCT
      om.employee_id,
      'manager'::text AS platform_role,
      30 AS priority
    FROM public.organization_managers om
    JOIN targets t ON t.employee_id = om.employee_id
    WHERE om.is_active = true
      AND om.manager_role = 'department_owner'

    UNION ALL

    SELECT DISTINCT
      COALESCE(pr.user_id, pr.employee_id) AS employee_id,
      m.platform_role,
      m.priority
    FROM public.project_roles pr
    JOIN public.projects p ON p.id = pr.project_id
    JOIN managed_project_roles m ON m.role_key = pr.role_key
    JOIN targets t ON t.employee_id = COALESCE(pr.user_id, pr.employee_id)
    WHERE pr.status = 'active'
      AND COALESCE(p.status, 'active') <> 'deleted'
      AND COALESCE(pr.user_id, pr.employee_id) IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      pdo.project_owner_id AS employee_id,
      CASE
        WHEN COALESCE(pdo.role_key, '') IN ('cc_department_owner', 'pm_department_owner') THEN 'manager'
        ELSE 'lead'
      END AS platform_role,
      CASE
        WHEN COALESCE(pdo.role_key, '') IN ('cc_department_owner', 'pm_department_owner') THEN 30
        ELSE 20
      END AS priority
    FROM public.project_department_owners pdo
    JOIN public.projects p ON p.id = pdo.project_id
    JOIN targets t ON t.employee_id = pdo.project_owner_id
    WHERE pdo.is_active = true
      AND COALESCE(p.status, 'active') <> 'deleted'
      AND pdo.project_owner_id IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      p.project_owner_id AS employee_id,
      'lead'::text AS platform_role,
      20 AS priority
    FROM public.projects p
    JOIN targets t ON t.employee_id = p.project_owner_id
    WHERE COALESCE(p.status, 'active') <> 'deleted'
      AND p.project_owner_id IS NOT NULL
  ),
  business_desired AS (
    SELECT DISTINCT ON (ba.employee_id)
      ba.employee_id,
      ba.platform_role
    FROM business_assignments ba
    ORDER BY ba.employee_id, ba.priority DESC, ba.platform_role
  ),
  protected_desired AS (
    SELECT DISTINCT ON (ur.employee_id)
      ur.employee_id,
      ur.role AS platform_role
    FROM public.user_roles ur
    JOIN targets t ON t.employee_id = ur.employee_id
    JOIN role_rank rr ON rr.role_key = ur.role
    WHERE ur.role IN ('admin', 'director')
    ORDER BY ur.employee_id, rr.role_rank DESC
  ),
  desired AS (
    SELECT
      t.employee_id,
      COALESCE(pd.platform_role, bd.platform_role, 'employee') AS platform_role
    FROM targets t
    LEFT JOIN protected_desired pd ON pd.employee_id = t.employee_id
    LEFT JOIN business_desired bd ON bd.employee_id = t.employee_id
  ),
  inserted AS (
    INSERT INTO public.user_roles(employee_id, role)
    SELECT d.employee_id, d.platform_role
    FROM desired d
    ON CONFLICT ON CONSTRAINT user_roles_employee_id_role_key DO NOTHING
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM public.user_roles ur
    USING desired d
    WHERE ur.employee_id = d.employee_id
      AND ur.role <> d.platform_role
    RETURNING 1
  )
  SELECT d.employee_id, d.platform_role
  FROM desired d;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'ALTER FUNCTION public.psa_sync_business_platform_roles(BIGINT[]) OWNER TO postgres';
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'psa_admin') THEN
    EXECUTE 'ALTER FUNCTION public.psa_sync_business_platform_roles(BIGINT[]) OWNER TO psa_admin';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.psa_sync_business_platform_roles(BIGINT[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_sync_business_platform_roles(BIGINT[]) TO service_role;

CREATE OR REPLACE FUNCTION public.psa_save_project(
  p_project jsonb,
  p_department_owners jsonb DEFAULT '[]'::jsonb,
  p_project_roles jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_project_id bigint := NULLIF(p_project ->> 'id', '')::bigint;
  v_business_type text := NULLIF(coalesce(p_project ->> 'business_type', p_project ->> 'businessType'), '');
  v_code text := btrim(COALESCE(p_project ->> 'code', ''));
  v_existing bigint;
  v_role jsonb;
  v_owner jsonb;
  v_role_key text;
  v_employee_id bigint;
  v_org_id bigint;
  v_existing_role_id bigint;
  v_existing_owner_id bigint;
  v_active_role_keys text[] := ARRAY[]::text[];
  v_active_owner_keys text[] := ARRAY[]::text[];
  v_managed_role_keys text[] := ARRAY[
    'cc_civil_project_owner',
    'cc_mep_project_owner',
    'cc_project_owner',
    'cc_design_project_owner',
    'cc_department_owner',
    'pm_cost_department_owner',
    'pm_design_project_owner',
    'pm_project_owner',
    'pm_department_owner'
  ];
BEGIN
  IF NOT public.current_user_can_access_resource('report', 'write') THEN
    RAISE EXCEPTION 'Missing report write permission';
  END IF;

  IF v_business_type IS NULL AND v_code <> '' THEN
    v_business_type := CASE
      WHEN upper(v_code) LIKE 'PMCC%' THEN 'PMCC'
      WHEN upper(v_code) LIKE 'PM%' THEN 'PM'
      WHEN upper(v_code) LIKE 'CC%' THEN 'CC'
      ELSE NULL
    END;
  END IF;

  IF v_code = '' THEN
    v_code := public.psa_next_number(
      'public.projects'::regclass,
      'code',
      public.psa_project_code_prefix(v_business_type)
    );
  END IF;

  IF v_code = '' THEN
    RAISE EXCEPTION 'Project code is required';
  END IF;

  SELECT id INTO v_existing
  FROM public.projects
  WHERE code = v_code
    AND COALESCE(status, 'active') <> 'deleted'
    AND (v_project_id IS NULL OR id <> v_project_id)
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Project code already exists: %', v_code;
  END IF;

  IF v_project_id IS NULL THEN
    INSERT INTO public.projects(
      code, name, signed_date, business_type, contract_amount, received_amount,
      owner_org_id, project_owner_id, status
    )
    VALUES (
      v_code,
      p_project ->> 'name',
      NULLIF(p_project ->> 'signed_date', '')::date,
      v_business_type,
      COALESCE(NULLIF(p_project ->> 'contract_amount', '')::numeric, 0),
      COALESCE(NULLIF(p_project ->> 'received_amount', '')::numeric, 0),
      NULLIF(p_project ->> 'owner_org_id', '')::bigint,
      NULLIF(p_project ->> 'project_owner_id', '')::bigint,
      'active'
    )
    RETURNING id INTO v_project_id;
  ELSE
    UPDATE public.projects
    SET code = v_code,
        name = p_project ->> 'name',
        signed_date = NULLIF(p_project ->> 'signed_date', '')::date,
        business_type = v_business_type,
        contract_amount = COALESCE(NULLIF(p_project ->> 'contract_amount', '')::numeric, 0),
        received_amount = COALESCE(NULLIF(p_project ->> 'received_amount', '')::numeric, 0),
        owner_org_id = NULLIF(p_project ->> 'owner_org_id', '')::bigint,
        project_owner_id = NULLIF(p_project ->> 'project_owner_id', '')::bigint,
        status = 'active'
    WHERE id = v_project_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Project not found';
    END IF;
  END IF;

  FOR v_role IN SELECT * FROM jsonb_array_elements(COALESCE(p_project_roles, '[]'::jsonb))
  LOOP
    v_role_key := COALESCE(v_role ->> 'role_key', v_role ->> 'roleKey');
    v_employee_id := COALESCE(
      NULLIF(v_role ->> 'user_id', '')::bigint,
      NULLIF(v_role ->> 'userId', '')::bigint,
      NULLIF(v_role ->> 'employee_id', '')::bigint,
      NULLIF(v_role ->> 'employeeId', '')::bigint
    );

    IF v_role_key IS NULL OR NOT (v_role_key = ANY(v_managed_role_keys)) OR v_employee_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(NULLIF(v_role ->> 'org_id', '')::bigint, ep.org_id)
    INTO v_org_id
    FROM public.employee_profiles ep
    WHERE ep.employee_id = v_employee_id
    LIMIT 1;

    SELECT id INTO v_existing_role_id
    FROM public.project_roles
    WHERE project_id = v_project_id
      AND role_key = v_role_key
      AND status = 'active'
    LIMIT 1;

    IF v_existing_role_id IS NULL THEN
      INSERT INTO public.project_roles(project_id, role_key, employee_id, user_id, org_id, status)
      VALUES (v_project_id, v_role_key, v_employee_id, v_employee_id, v_org_id, 'active');
    ELSE
      UPDATE public.project_roles
      SET employee_id = v_employee_id,
          user_id = v_employee_id,
          org_id = v_org_id,
          status = 'active',
          updated_at = now()
      WHERE id = v_existing_role_id;
    END IF;

    v_active_role_keys := array_append(v_active_role_keys, v_role_key);
  END LOOP;

  UPDATE public.project_roles
  SET status = 'inactive',
      updated_at = now()
  WHERE project_id = v_project_id
    AND status = 'active'
    AND role_key = ANY(v_managed_role_keys)
    AND NOT (role_key = ANY(v_active_role_keys));

  IF jsonb_typeof(COALESCE(p_department_owners, '[]'::jsonb)) = 'array' THEN
    FOR v_owner IN SELECT * FROM jsonb_array_elements(p_department_owners)
    LOOP
      v_org_id := COALESCE(NULLIF(v_owner ->> 'org_id', '')::bigint, NULLIF(v_owner ->> 'orgId', '')::bigint);
      v_employee_id := COALESCE(
        NULLIF(v_owner ->> 'project_owner_id', '')::bigint,
        NULLIF(v_owner ->> 'projectOwnerId', '')::bigint,
        NULLIF(v_owner ->> 'employee_id', '')::bigint,
        NULLIF(v_owner ->> 'employeeId', '')::bigint,
        NULLIF(v_owner ->> 'user_id', '')::bigint,
        NULLIF(v_owner ->> 'userId', '')::bigint
      );
      v_role_key := COALESCE(NULLIF(v_owner ->> 'role_key', ''), NULLIF(v_owner ->> 'roleKey', ''), 'project_owner');

      IF v_org_id IS NULL OR v_employee_id IS NULL THEN
        CONTINUE;
      END IF;

      SELECT id INTO v_existing_owner_id
      FROM public.project_department_owners
      WHERE project_id = v_project_id
        AND org_id = v_org_id
        AND role_key = v_role_key
        AND is_active = true
      LIMIT 1;

      IF v_existing_owner_id IS NULL THEN
        INSERT INTO public.project_department_owners(
          project_id, org_id, project_owner_id, role_key, is_active, effective_from
        )
        VALUES (v_project_id, v_org_id, v_employee_id, v_role_key, true, current_date);
      ELSE
        UPDATE public.project_department_owners
        SET project_owner_id = v_employee_id,
            is_active = true,
            updated_at = now()
        WHERE id = v_existing_owner_id;
      END IF;

      v_active_owner_keys := array_append(v_active_owner_keys, v_org_id::text || ':' || v_role_key);
    END LOOP;

    UPDATE public.project_department_owners
    SET is_active = false,
        effective_to = COALESCE(effective_to, current_date),
        updated_at = now()
    WHERE project_id = v_project_id
      AND is_active = true
      AND NOT ((org_id::text || ':' || role_key) = ANY(v_active_owner_keys));
  END IF;

  PERFORM public.psa_sync_business_platform_roles(NULL::bigint[]);

  RETURN jsonb_build_object('ok', true, 'project_id', v_project_id, 'code', v_code);
END;
$$;

DROP FUNCTION IF EXISTS public.psa_sync_project_platform_roles(BIGINT[]);

CREATE OR REPLACE FUNCTION public.psa_save_organization(
  p_organization jsonb,
  p_manager_ids bigint[] DEFAULT ARRAY[]::bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id bigint := NULLIF(p_organization ->> 'id', '')::bigint;
  v_row public.organizations%rowtype;
  v_manager_id bigint;
  v_active_ids bigint[] := ARRAY[]::bigint[];
  v_existing_id bigint;
BEGIN
  IF NOT public.current_user_can_access_resource('permission_config', 'write') THEN
    RAISE EXCEPTION 'Missing permission_config write permission' USING ERRCODE = '42501';
  END IF;

  IF v_id IS NULL THEN
    v_id := nextval('public.organizations_id_seq'::regclass);
    INSERT INTO public.organizations(id, org_code, org_name, org_type, parent_id, color_token, status)
    VALUES (
      v_id,
      coalesce(NULLIF(p_organization ->> 'org_code', ''), 'D' || lpad(v_id::text, 3, '0')),
      p_organization ->> 'org_name',
      coalesce(NULLIF(p_organization ->> 'org_type', ''), 'department'),
      NULLIF(p_organization ->> 'parent_id', '')::bigint,
      NULLIF(p_organization ->> 'color_token', ''),
      'active'
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.organizations
    SET org_name = p_organization ->> 'org_name',
        org_type = coalesce(NULLIF(p_organization ->> 'org_type', ''), 'department'),
        parent_id = NULLIF(p_organization ->> 'parent_id', '')::bigint,
        color_token = NULLIF(p_organization ->> 'color_token', ''),
        status = 'active'
    WHERE id = v_id
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Organization not found';
    END IF;
  END IF;

  FOREACH v_manager_id IN ARRAY coalesce(p_manager_ids, ARRAY[]::bigint[])
  LOOP
    IF v_manager_id IS NULL OR v_manager_id = 0 THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_existing_id
    FROM public.organization_managers
    WHERE org_id = v_row.id
      AND employee_id = v_manager_id
      AND manager_role = 'department_owner'
      AND is_active = true
    LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.organization_managers(org_id, employee_id, manager_role, is_primary, is_active)
      VALUES (v_row.id, v_manager_id, 'department_owner', false, true)
      RETURNING id INTO v_existing_id;
    ELSE
      UPDATE public.organization_managers
      SET is_active = true,
          updated_at = now()
      WHERE id = v_existing_id;
    END IF;

    v_active_ids := array_append(v_active_ids, v_existing_id);
  END LOOP;

  UPDATE public.organization_managers
  SET is_active = false,
      updated_at = now()
  WHERE org_id = v_row.id
    AND manager_role = 'department_owner'
    AND is_active = true
    AND NOT (id = ANY(v_active_ids));

  PERFORM public.psa_sync_business_platform_roles(NULL::bigint[]);

  RETURN jsonb_build_object('ok', true, 'organization_id', v_row.id, 'organization', to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_update_employee(p_employee jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id bigint := NULLIF(p_employee ->> 'id', '')::bigint;
  v_contract_type text := COALESCE(NULLIF(p_employee ->> 'contract_type', ''), 'labor');
  v_next_role text := COALESCE(NULLIF(p_employee ->> 'role', ''), 'employee');
  v_current_employee_id bigint := public.current_employee_id();
  v_synced_role text;
BEGIN
  IF NOT public.current_user_can_access_resource('system_management', 'write') THEN
    RAISE EXCEPTION 'Missing system management write permission';
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Employee id is required';
  END IF;

  UPDATE public.employees
  SET name = p_employee ->> 'name',
      employee_no = COALESCE(NULLIF(p_employee ->> 'employee_no', ''), employee_no),
      is_active = COALESCE(NULLIF(p_employee ->> 'status', ''), 'active') <> 'terminated'
  WHERE id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  INSERT INTO public.employee_profiles(
    employee_id, org_id, position_name, cost_specialty, employment_status,
    manager_user_id, hire_date
  )
  VALUES (
    v_id,
    NULLIF(p_employee ->> 'org_id', '')::bigint,
    COALESCE(p_employee ->> 'position_name', ''),
    NULLIF(p_employee ->> 'cost_specialty', ''),
    COALESCE(NULLIF(p_employee ->> 'status', ''), 'active'),
    NULLIF(p_employee ->> 'manager_user_id', '')::bigint,
    NULLIF(p_employee ->> 'hire_date', '')::date
  )
  ON CONFLICT (employee_id) DO UPDATE
  SET org_id = EXCLUDED.org_id,
      position_name = EXCLUDED.position_name,
      cost_specialty = EXCLUDED.cost_specialty,
      employment_status = EXCLUDED.employment_status,
      manager_user_id = EXCLUDED.manager_user_id,
      hire_date = EXCLUDED.hire_date;

  UPDATE public.employee_contracts SET is_current = false WHERE employee_id = v_id;
  INSERT INTO public.employee_contracts(employee_id, contract_type, employment_type, is_current)
  VALUES (
    v_id,
    v_contract_type,
    COALESCE(NULLIF(p_employee ->> 'employment_type', ''), 'labor'),
    true
  );

  UPDATE public.employee_salary_profiles SET is_current = false WHERE employee_id = v_id;
  INSERT INTO public.employee_salary_profiles(
    employee_id, salary_mode, monthly_salary, daily_wage, is_current
  )
  VALUES (
    v_id,
    CASE WHEN v_contract_type = 'service' THEN 'daily_wage' ELSE 'monthly_salary' END,
    CASE WHEN v_contract_type = 'service' THEN 0 ELSE COALESCE(NULLIF(p_employee ->> 'monthly_salary', '')::numeric, 0) END,
    CASE WHEN v_contract_type = 'service' THEN COALESCE(NULLIF(p_employee ->> 'daily_wage', '')::numeric, 0) ELSE 0 END,
    true
  );

  IF (p_employee ? 'role') AND public.current_user_can_access_resource('permission_config', 'write') THEN
    IF v_current_employee_id = v_id AND v_next_role <> 'admin' THEN
      RAISE EXCEPTION 'Cannot remove admin role from current user';
    END IF;

    INSERT INTO public.user_roles(employee_id, role)
    VALUES (v_id, v_next_role)
    ON CONFLICT ON CONSTRAINT user_roles_employee_id_role_key DO NOTHING;

    DELETE FROM public.user_roles
    WHERE employee_id = v_id
      AND role <> v_next_role;
  END IF;

  SELECT synced_role INTO v_synced_role
  FROM public.psa_sync_business_platform_roles(ARRAY[v_id])
  WHERE synced_employee_id = v_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_id,
    'role', COALESCE(v_synced_role, v_next_role)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_create_employee_business_rows(p_employee jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_name text := btrim(coalesce(p_employee ->> 'name', ''));
  v_org_id bigint := coalesce(NULLIF(p_employee ->> 'orgId', '')::bigint, NULLIF(p_employee ->> 'org_id', '')::bigint);
  v_employee_no text := btrim(coalesce(p_employee ->> 'employeeNo', p_employee ->> 'employee_no', ''));
  v_employee_id bigint;
  v_auth_user_id uuid := NULLIF(p_employee ->> 'auth_user_id', '')::uuid;
  v_login_name text := btrim(coalesce(p_employee ->> 'login_name', p_employee ->> 'loginName', ''));
  v_auth_email text := btrim(coalesce(p_employee ->> 'auth_email', p_employee ->> 'authEmail', ''));
  v_role text := coalesce(NULLIF(p_employee ->> 'role', ''), 'employee');
  v_contract_type text := coalesce(NULLIF(p_employee ->> 'contractType', ''), NULLIF(p_employee ->> 'contract_type', ''), 'labor');
  v_synced_role text;
BEGIN
  IF NOT (
    public.current_user_has_role('admin')
    OR public.current_user_can_access_resource('employee', 'write')
    OR session_user IN ('postgres', 'psa_admin')
  ) THEN
    RAISE EXCEPTION 'Missing employee write permission' USING ERRCODE = '42501';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Employee name is required';
  END IF;
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'auth_user_id is required';
  END IF;
  IF v_login_name = '' OR v_auth_email = '' THEN
    RAISE EXCEPTION 'login_name and auth_email are required';
  END IF;

  IF v_employee_no = '' THEN
    v_employee_no := public.psa_next_number(
      'public.employees'::regclass,
      'employee_no',
      public.psa_employee_number_prefix(v_org_id)
    );
  END IF;

  INSERT INTO public.employees(employee_no, name, auth_user_id, is_active)
  VALUES (v_employee_no, v_name, v_auth_user_id, true)
  RETURNING id INTO v_employee_id;

  INSERT INTO public.profiles(login_name, auth_email, auth_user_id, display_name, is_active, must_change_password)
  VALUES (v_login_name, v_auth_email, v_auth_user_id, v_name, true, true);

  INSERT INTO public.employee_profiles(
    employee_id, org_id, position_name, cost_specialty, employment_status, manager_user_id, hire_date
  )
  VALUES (
    v_employee_id,
    v_org_id,
    coalesce(p_employee ->> 'positionName', p_employee ->> 'position_name', ''),
    NULLIF(coalesce(p_employee ->> 'costSpecialty', p_employee ->> 'cost_specialty'), ''),
    coalesce(NULLIF(p_employee ->> 'status', ''), 'active'),
    coalesce(NULLIF(p_employee ->> 'managerUserId', '')::bigint, NULLIF(p_employee ->> 'manager_user_id', '')::bigint),
    coalesce(NULLIF(p_employee ->> 'hireDate', '')::date, NULLIF(p_employee ->> 'hire_date', '')::date)
  );

  INSERT INTO public.employee_contracts(employee_id, contract_type, employment_type, is_current)
  VALUES (
    v_employee_id,
    v_contract_type,
    coalesce(NULLIF(p_employee ->> 'employmentType', ''), NULLIF(p_employee ->> 'employment_type', ''), 'labor'),
    true
  );

  INSERT INTO public.employee_salary_profiles(
    employee_id, salary_mode, monthly_salary, daily_wage, is_current
  )
  VALUES (
    v_employee_id,
    CASE WHEN v_contract_type = 'service' THEN 'daily_wage' ELSE 'monthly_salary' END,
    CASE WHEN v_contract_type = 'service' THEN 0 ELSE coalesce(NULLIF(p_employee ->> 'monthlySalary', '')::numeric, NULLIF(p_employee ->> 'monthly_salary', '')::numeric, 0) END,
    CASE WHEN v_contract_type = 'service' THEN coalesce(NULLIF(p_employee ->> 'dailyWage', '')::numeric, NULLIF(p_employee ->> 'daily_wage', '')::numeric, 0) ELSE 0 END,
    true
  );

  INSERT INTO public.user_roles(employee_id, role)
  VALUES (v_employee_id, v_role)
  ON CONFLICT ON CONSTRAINT user_roles_employee_id_role_key DO NOTHING;

  SELECT synced_role INTO v_synced_role
  FROM public.psa_sync_business_platform_roles(ARRAY[v_employee_id])
  WHERE synced_employee_id = v_employee_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'employee_id', v_employee_id,
    'employee_no', v_employee_no,
    'role', COALESCE(v_synced_role, v_role)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.psa_save_organization(jsonb, bigint[]) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_update_employee(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_create_employee_business_rows(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_organization(jsonb, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_update_employee(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_create_employee_business_rows(jsonb) TO authenticated, service_role;

SELECT public.psa_sync_business_platform_roles(NULL::bigint[]);

NOTIFY pgrst, 'reload schema';

COMMIT;
