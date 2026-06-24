-- V0.18.11: Keep project owner configuration synchronized with platform roles.

BEGIN;

DROP FUNCTION IF EXISTS public.psa_sync_project_platform_roles(BIGINT[]);

CREATE OR REPLACE FUNCTION public.psa_sync_project_platform_roles(p_employee_ids BIGINT[] DEFAULT NULL)
RETURNS TABLE(synced_employee_id BIGINT, synced_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF session_user <> 'postgres' AND NOT (
    public.current_user_can_access_resource('report', 'write')
    OR public.current_user_can_access_resource('permission_config', 'write')
  ) THEN
    RAISE EXCEPTION 'permission denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_ids IS NOT NULL AND cardinality(p_employee_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH managed_project_roles(role_key, platform_role, priority) AS (
    VALUES
      ('cc_civil_project_owner', 'lead', 20),
      ('cc_mep_project_owner', 'lead', 20),
      ('cc_project_owner', 'lead', 20),
      ('project_owner', 'lead', 20),
      ('cc_design_project_owner', 'lead', 20),
      ('cc_department_owner', 'manager', 30),
      ('pm_cost_department_owner', 'lead', 20),
      ('pm_design_project_owner', 'lead', 20),
      ('pm_project_owner', 'lead', 20),
      ('pm_department_owner', 'manager', 30)
  ),
  targets AS (
    SELECT DISTINCT e.id AS employee_id
    FROM public.employees e
    WHERE p_employee_ids IS NULL OR e.id = ANY(p_employee_ids)
  ),
  active_assignments AS (
    SELECT DISTINCT
      COALESCE(pr.user_id, pr.employee_id) AS employee_id,
      m.platform_role,
      m.priority
    FROM public.project_roles pr
    JOIN public.projects p ON p.id = pr.project_id
    JOIN managed_project_roles m ON m.role_key = pr.role_key
    WHERE pr.status = 'active'
      AND COALESCE(p.status, 'active') <> 'deleted'
      AND COALESCE(pr.user_id, pr.employee_id) IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      pdo.project_owner_id AS employee_id,
      m.platform_role,
      m.priority
    FROM public.project_department_owners pdo
    JOIN public.projects p ON p.id = pdo.project_id
    JOIN managed_project_roles m ON m.role_key = COALESCE(pdo.role_key, 'cc_project_owner')
    WHERE pdo.is_active = true
      AND COALESCE(p.status, 'active') <> 'deleted'
      AND pdo.project_owner_id IS NOT NULL
  ),
  desired AS (
    SELECT
      t.employee_id,
      COALESCE(
        (ARRAY_AGG(a.platform_role ORDER BY a.priority DESC))[1],
        'employee'
      ) AS desired_platform_role
    FROM targets t
    LEFT JOIN active_assignments a ON a.employee_id = t.employee_id
    GROUP BY t.employee_id
  ),
  preserved AS (
    SELECT DISTINCT ur.employee_id
    FROM public.user_roles ur
    JOIN desired d ON d.employee_id = ur.employee_id
    WHERE ur.role IN ('admin', 'director')
  ),
  changed AS (
    SELECT d.employee_id, d.desired_platform_role
    FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM preserved p WHERE p.employee_id = d.employee_id
    )
  ),
  inserted AS (
    INSERT INTO public.user_roles(employee_id, role)
    SELECT c.employee_id, c.desired_platform_role
    FROM changed c
    ON CONFLICT ON CONSTRAINT user_roles_employee_id_role_key DO NOTHING
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM public.user_roles ur
    USING changed c
    WHERE ur.employee_id = c.employee_id
      AND ur.role <> c.desired_platform_role
    RETURNING 1
  )
  SELECT c.employee_id, c.desired_platform_role
  FROM changed c;
END;
$$;

ALTER FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) TO authenticated, service_role;

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
      NULLIF(p_project ->> 'business_type', ''),
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
        business_type = NULLIF(p_project ->> 'business_type', ''),
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

  IF jsonb_typeof(COALESCE(p_department_owners, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(p_department_owners, '[]'::jsonb)) > 0 THEN
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

  PERFORM public.psa_sync_project_platform_roles(NULL::bigint[]);

  RETURN jsonb_build_object('ok', true, 'project_id', v_project_id);
END;
$$;

REVOKE ALL ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) TO authenticated;

SELECT public.psa_sync_project_platform_roles(NULL::bigint[]);

NOTIFY pgrst, 'reload schema';

COMMIT;
