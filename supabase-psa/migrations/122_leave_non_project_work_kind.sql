BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS work_kind text;

UPDATE public.projects
SET work_kind = 'project'
WHERE NULLIF(work_kind, '') IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN work_kind SET DEFAULT 'project';

ALTER TABLE public.projects
  ALTER COLUMN work_kind SET NOT NULL;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS chk_projects_work_kind;

ALTER TABLE public.projects
  ADD CONSTRAINT chk_projects_work_kind
  CHECK (work_kind IN ('project', 'leave'));

DO $$
DECLARE
  v_leave_project_id bigint;
  v_old_leave_project_ids bigint[] := ARRAY[]::bigint[];
BEGIN
  SELECT id INTO v_leave_project_id
  FROM public.projects
  WHERE upper(btrim(code)) = 'LEAVE'
  ORDER BY id
  LIMIT 1;

  IF v_leave_project_id IS NULL THEN
    SELECT id INTO v_leave_project_id
    FROM public.projects
    WHERE btrim(code) = '请假'
       OR btrim(name) = '请假'
       OR work_kind = 'leave'
    ORDER BY id
    LIMIT 1;
  END IF;

  IF v_leave_project_id IS NULL THEN
    INSERT INTO public.projects(
      code, name, business_type, contract_amount, received_amount,
      owner_org_id, project_owner_id, status, work_kind
    )
    VALUES ('LEAVE', '请假', NULL, 0, 0, NULL, NULL, 'active', 'leave')
    RETURNING id INTO v_leave_project_id;
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::bigint[])
    INTO v_old_leave_project_ids
  FROM public.projects
  WHERE id <> v_leave_project_id
    AND (
      work_kind = 'leave'
      OR upper(btrim(code)) = 'LEAVE'
      OR btrim(code) = '请假'
      OR btrim(name) = '请假'
    );

  IF cardinality(v_old_leave_project_ids) > 0 THEN
    UPDATE public.timesheet_entries
    SET project_id = v_leave_project_id
    WHERE project_id = ANY(v_old_leave_project_ids);

    UPDATE public.projects
    SET work_kind = 'leave',
        business_type = NULL,
        contract_amount = 0,
        received_amount = 0,
        owner_org_id = NULL,
        project_owner_id = NULL,
        status = 'deleted'
    WHERE id = ANY(v_old_leave_project_ids);
  END IF;

  UPDATE public.projects
  SET code = 'LEAVE',
      name = '请假',
      business_type = NULL,
      contract_amount = 0,
      received_amount = 0,
      owner_org_id = NULL,
      project_owner_id = NULL,
      status = 'active',
      work_kind = 'leave'
  WHERE id = v_leave_project_id;

  UPDATE public.project_roles
  SET status = 'inactive',
      updated_at = now()
  WHERE project_id = v_leave_project_id
    AND status = 'active';

  UPDATE public.project_department_owners
  SET is_active = false,
      effective_to = COALESCE(effective_to, current_date),
      updated_at = now()
  WHERE project_id = v_leave_project_id
    AND is_active = true;
END $$;

CREATE OR REPLACE FUNCTION public.psa_is_timesheet_special_project(p_project_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.work_kind = 'leave'
  );
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_document_business_type(
  p_document_type text,
  p_business_id bigint,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_enabled boolean := true;
  v_business_type text;
  v_routed_business_type text;
  v_submitter_org_code text;
  v_submitter_parent_org_code text;
  v_has_leave_entries boolean := false;
  v_has_project_entries boolean := false;
BEGIN
  SELECT COALESCE((setting_value ->> 'enabled')::boolean, true)
    INTO v_enabled
    FROM public.approval_engine_settings
   WHERE setting_key = 'data_driven_business_type_enabled';

  v_enabled := COALESCE(v_enabled, true);

  IF p_document_type <> 'timesheet' THEN
    RETURN NULLIF(p_context ->> 'business_type', '');
  END IF;

  SELECT o.org_code, parent.org_code
    INTO v_submitter_org_code, v_submitter_parent_org_code
    FROM public.timesheets t
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = t.user_id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN public.organizations parent ON parent.id = o.parent_id
   WHERE t.id = p_business_id
   LIMIT 1;

  SELECT
      bool_or(p.work_kind = 'leave'),
      bool_or(COALESCE(p.work_kind, 'project') <> 'leave')
    INTO v_has_leave_entries, v_has_project_entries
  FROM public.timesheet_entries te
  JOIN public.projects p ON p.id = te.project_id
  WHERE te.timesheet_id = p_business_id
    AND te.project_id IS NOT NULL;

  v_has_leave_entries := COALESCE(v_has_leave_entries, false);
  v_has_project_entries := COALESCE(v_has_project_entries, false);

  IF v_enabled THEN
    WITH project_types AS (
      SELECT DISTINCT resolved.result_business_type
      FROM public.timesheet_entries te
      JOIN public.projects p ON p.id = te.project_id
      JOIN LATERAL (
        SELECT r.result_business_type
        FROM public.approval_business_type_source_rules r
        WHERE r.document_type = p_document_type
          AND r.source_scope = 'project'
          AND r.is_active = true
          AND (
            (
              r.match_field = 'project_business_type'
              AND upper(r.match_value) = upper(NULLIF(p.business_type, ''))
            )
            OR (
              r.match_field = 'project_code_prefix'
              AND upper(p.code) LIKE upper(r.match_value) || '%'
            )
          )
        ORDER BY r.priority, r.id
        LIMIT 1
      ) resolved ON true
      WHERE te.timesheet_id = p_business_id
        AND te.project_id IS NOT NULL
        AND COALESCE(p.work_kind, 'project') <> 'leave'
    ),
    type_set AS (
      SELECT COALESCE(array_agg(DISTINCT result_business_type ORDER BY result_business_type), ARRAY[]::text[]) AS business_types
      FROM project_types
      WHERE result_business_type IS NOT NULL
    )
    SELECT r.result_business_type
      INTO v_business_type
      FROM public.approval_business_type_merge_rules r
      CROSS JOIN type_set ts
     WHERE r.document_type = p_document_type
       AND r.is_active = true
       AND (
         (r.match_mode = 'any' AND r.input_business_types && ts.business_types)
         OR (
           r.match_mode = 'exact_set'
           AND ARRAY(SELECT unnest(r.input_business_types) ORDER BY 1) = ts.business_types
         )
       )
     ORDER BY r.priority, r.id
     LIMIT 1;

    IF v_business_type IS NOT NULL THEN
      SELECT r.result_business_type
        INTO v_routed_business_type
        FROM public.approval_submitter_business_type_route_rules r
       WHERE r.document_type = p_document_type
         AND r.input_business_type = v_business_type
         AND r.is_active = true
         AND (r.submitter_org_code IS NULL OR r.submitter_org_code = v_submitter_org_code)
         AND (r.submitter_parent_org_code IS NULL OR r.submitter_parent_org_code = v_submitter_parent_org_code)
       ORDER BY
         CASE WHEN r.submitter_org_code IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN r.submitter_parent_org_code IS NOT NULL THEN 0 ELSE 1 END,
         r.priority,
         r.id
       LIMIT 1;

      RETURN COALESCE(v_routed_business_type, v_business_type);
    END IF;
  END IF;

  WITH project_types AS (
    SELECT DISTINCT
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
    WHERE te.timesheet_id = p_business_id
      AND te.project_id IS NOT NULL
      AND COALESCE(p.work_kind, 'project') <> 'leave'
  )
  SELECT CASE
    WHEN bool_or(business_type = 'PMCC') THEN 'PMCC'
    WHEN bool_or(business_type = 'PM') AND bool_or(business_type = 'CC') THEN 'PMCC'
    WHEN bool_or(business_type = 'PM') THEN 'PM'
    WHEN bool_or(business_type = 'CC') THEN 'CC'
    ELSE NULL
  END
    INTO v_business_type
    FROM project_types;

  IF v_business_type IS NULL AND v_has_leave_entries AND NOT v_has_project_entries THEN
    RETURN 'LEAVE';
  END IF;

  SELECT r.result_business_type
    INTO v_routed_business_type
    FROM public.approval_submitter_business_type_route_rules r
   WHERE r.document_type = p_document_type
     AND r.input_business_type = v_business_type
     AND r.is_active = true
     AND (r.submitter_org_code IS NULL OR r.submitter_org_code = v_submitter_org_code)
     AND (r.submitter_parent_org_code IS NULL OR r.submitter_parent_org_code = v_submitter_parent_org_code)
   ORDER BY
     CASE WHEN r.submitter_org_code IS NOT NULL THEN 0 ELSE 1 END,
     CASE WHEN r.submitter_parent_org_code IS NOT NULL THEN 0 ELSE 1 END,
     r.priority,
     r.id
   LIMIT 1;

  RETURN COALESCE(v_routed_business_type, v_business_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_timesheet_business_type(p_timesheet_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.psa_resolve_document_business_type('timesheet', p_timesheet_id, '{}'::jsonb);
$$;

WITH special_template AS (
  INSERT INTO public.approval_templates(
    template_key, document_type, business_type, name, version, status
  )
  VALUES (
    'timesheet_special_department_owner_v1',
    'timesheet_project',
    NULL,
    '请假部门负责人确认',
    1,
    'active'
  )
  ON CONFLICT (template_key) DO UPDATE
  SET document_type = EXCLUDED.document_type,
      business_type = EXCLUDED.business_type,
      name = EXCLUDED.name,
      version = EXCLUDED.version,
      status = EXCLUDED.status
  RETURNING id
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, allow_delegate, allow_skip, sort_order,
  scope_strategy, scope_source, runtime_scope_type, runtime_node_key_template,
  missing_assignee_policy
)
SELECT
  id,
  'special_department_owner',
  '所属部门负责人确认',
  'approval',
  'org_manager',
  'department_owner',
  'single',
  'back_to_creator',
  false,
  false,
  15,
  'per_project',
  'timesheet_projects',
  'project',
  'project_{scope_id}_{node_key}',
  'required'
FROM special_template
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    approval_policy = EXCLUDED.approval_policy,
    reject_policy = EXCLUDED.reject_policy,
    sort_order = EXCLUDED.sort_order,
    scope_strategy = EXCLUDED.scope_strategy,
    scope_source = EXCLUDED.scope_source,
    runtime_scope_type = EXCLUDED.runtime_scope_type,
    runtime_node_key_template = EXCLUDED.runtime_node_key_template,
    missing_assignee_policy = EXCLUDED.missing_assignee_policy;

WITH contract_templates AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN (
    'contract_approval_pm_v1',
    'contract_approval_cc_v1',
    'contract_approval_pmcc_v1'
  )
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, allow_delegate, allow_skip, sort_order,
  scope_strategy, scope_source, runtime_scope_type, runtime_node_key_template,
  missing_assignee_policy
)
SELECT
  id,
  'special_department_owner',
  '所属部门负责人确认',
  'approval',
  'org_manager',
  'department_owner',
  'single',
  'back_to_creator',
  false,
  false,
  15,
  'per_project',
  'timesheet_projects',
  'project',
  'project_{scope_id}_{node_key}',
  'required'
FROM contract_templates
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    approval_policy = EXCLUDED.approval_policy,
    reject_policy = EXCLUDED.reject_policy,
    sort_order = EXCLUDED.sort_order,
    scope_strategy = EXCLUDED.scope_strategy,
    scope_source = EXCLUDED.scope_source,
    runtime_scope_type = EXCLUDED.runtime_scope_type,
    runtime_node_key_template = EXCLUDED.runtime_node_key_template,
    missing_assignee_policy = EXCLUDED.missing_assignee_policy;

INSERT INTO public.approval_template_routing_rules(
  source_document_type, target_document_type, business_type, template_key, priority, is_active
)
SELECT 'timesheet', 'timesheet_project', 'LEAVE', 'timesheet_special_department_owner_v1', 10, true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_template_routing_rules r
  WHERE r.source_document_type = 'timesheet'
    AND r.target_document_type = 'timesheet_project'
    AND r.business_type = 'LEAVE'
    AND r.template_key = 'timesheet_special_department_owner_v1'
);

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
  v_work_kind text := lower(NULLIF(coalesce(p_project ->> 'work_kind', p_project ->> 'workKind'), ''));
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

  IF (v_work_kind IS NULL OR v_work_kind NOT IN ('project', 'leave')) AND v_project_id IS NOT NULL THEN
    SELECT work_kind INTO v_work_kind
    FROM public.projects
    WHERE id = v_project_id;
  END IF;

  IF v_work_kind IS NULL OR v_work_kind NOT IN ('project', 'leave') THEN
    v_work_kind := 'project';
  END IF;

  IF v_work_kind = 'leave' THEN
    v_business_type := NULL;
    v_code := 'LEAVE';
  ELSIF v_business_type IS NULL AND v_code <> '' THEN
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
      owner_org_id, project_owner_id, status, work_kind
    )
    VALUES (
      v_code,
      CASE WHEN v_work_kind = 'leave' THEN '请假' ELSE p_project ->> 'name' END,
      NULLIF(p_project ->> 'signed_date', '')::date,
      v_business_type,
      CASE WHEN v_work_kind = 'leave' THEN 0 ELSE COALESCE(NULLIF(p_project ->> 'contract_amount', '')::numeric, 0) END,
      CASE WHEN v_work_kind = 'leave' THEN 0 ELSE COALESCE(NULLIF(p_project ->> 'received_amount', '')::numeric, 0) END,
      CASE WHEN v_work_kind = 'leave' THEN NULL ELSE NULLIF(p_project ->> 'owner_org_id', '')::bigint END,
      CASE WHEN v_work_kind = 'leave' THEN NULL ELSE NULLIF(p_project ->> 'project_owner_id', '')::bigint END,
      'active',
      v_work_kind
    )
    RETURNING id INTO v_project_id;
  ELSE
    UPDATE public.projects
    SET code = v_code,
        name = CASE WHEN v_work_kind = 'leave' THEN '请假' ELSE p_project ->> 'name' END,
        signed_date = NULLIF(p_project ->> 'signed_date', '')::date,
        business_type = v_business_type,
        contract_amount = CASE WHEN v_work_kind = 'leave' THEN 0 ELSE COALESCE(NULLIF(p_project ->> 'contract_amount', '')::numeric, 0) END,
        received_amount = CASE WHEN v_work_kind = 'leave' THEN 0 ELSE COALESCE(NULLIF(p_project ->> 'received_amount', '')::numeric, 0) END,
        owner_org_id = CASE WHEN v_work_kind = 'leave' THEN NULL ELSE NULLIF(p_project ->> 'owner_org_id', '')::bigint END,
        project_owner_id = CASE WHEN v_work_kind = 'leave' THEN NULL ELSE NULLIF(p_project ->> 'project_owner_id', '')::bigint END,
        status = 'active',
        work_kind = v_work_kind
    WHERE id = v_project_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Project not found';
    END IF;
  END IF;

  IF v_work_kind <> 'leave' THEN
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
  END IF;

  UPDATE public.project_roles
  SET status = 'inactive',
      updated_at = now()
  WHERE project_id = v_project_id
    AND status = 'active'
    AND role_key = ANY(v_managed_role_keys)
    AND NOT (role_key = ANY(v_active_role_keys));

  IF v_work_kind <> 'leave' AND jsonb_typeof(COALESCE(p_department_owners, '[]'::jsonb)) = 'array' THEN
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
  END IF;

  UPDATE public.project_department_owners
  SET is_active = false,
      effective_to = COALESCE(effective_to, current_date),
      updated_at = now()
  WHERE project_id = v_project_id
    AND is_active = true
    AND NOT ((org_id::text || ':' || role_key) = ANY(v_active_owner_keys));

  PERFORM public.psa_sync_business_platform_roles(NULL::bigint[]);

  RETURN jsonb_build_object('ok', true, 'project_id', v_project_id, 'code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.psa_is_timesheet_special_project(bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_resolve_document_business_type(text, bigint, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_timesheet_business_type(bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.psa_is_timesheet_special_project(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_resolve_document_business_type(text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_business_type(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
