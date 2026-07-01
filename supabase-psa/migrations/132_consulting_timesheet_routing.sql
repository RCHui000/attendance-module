-- V0.18.34: rename CC business type to CONSULTING and keep consulting
-- project blocks on their submitter-department two-step route.

BEGIN;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS chk_projects_business_type;
ALTER TABLE public.projects
  ADD CONSTRAINT chk_projects_business_type
  CHECK (business_type IS NULL OR business_type IN ('PM', 'CC', 'CONSULTING', 'PMCC'));

ALTER TABLE public.project_role_requirements
  DROP CONSTRAINT IF EXISTS project_role_requirements_business_type_check;
ALTER TABLE public.project_role_requirements
  ADD CONSTRAINT project_role_requirements_business_type_check
  CHECK (business_type IN ('PM', 'CC', 'CONSULTING', 'PMCC'));

ALTER TABLE public.approval_submitter_business_type_route_rules
  DROP CONSTRAINT IF EXISTS chk_approval_submitter_route_business_type;
ALTER TABLE public.approval_submitter_business_type_route_rules
  ADD CONSTRAINT chk_approval_submitter_route_business_type
  CHECK (
    input_business_type IN ('PM', 'CC', 'CONSULTING', 'PMCC')
    AND result_business_type IN ('PM', 'CC', 'CONSULTING', 'PMCC')
  );

UPDATE public.projects
SET business_type = 'CONSULTING'
WHERE business_type = 'CC';

UPDATE public.project_role_requirements
SET business_type = 'CONSULTING',
    role_label = CASE role_key
      WHEN 'cc_civil_project_owner' THEN '咨询土建负责人'
      WHEN 'cc_mep_project_owner' THEN '咨询机电负责人'
      WHEN 'cc_design_project_owner' THEN '咨询设计负责人'
      WHEN 'cc_department_owner' THEN '咨询部门负责人'
      ELSE role_label
    END
WHERE business_type = 'CC';

UPDATE public.approval_templates
SET business_type = 'CONSULTING',
    name = CASE
      WHEN template_key = 'contract_approval_cc_v1' THEN '咨询合同审批'
      ELSE name
    END
WHERE business_type = 'CC';

UPDATE public.approval_template_routing_rules
SET business_type = 'CONSULTING'
WHERE business_type = 'CC';

UPDATE public.approval_business_type_source_rules
SET match_value = CASE WHEN match_value = 'CC' THEN 'CONSULTING' ELSE match_value END,
    result_business_type = CASE WHEN result_business_type = 'CC' THEN 'CONSULTING' ELSE result_business_type END,
    updated_at = now()
WHERE match_value = 'CC'
   OR result_business_type = 'CC';

UPDATE public.approval_business_type_merge_rules
SET input_business_types = ARRAY(
      SELECT CASE WHEN value = 'CC' THEN 'CONSULTING' ELSE value END
      FROM unnest(input_business_types) AS value
      ORDER BY CASE WHEN value = 'CC' THEN 'CONSULTING' ELSE value END
    ),
    result_business_type = CASE WHEN result_business_type = 'CC' THEN 'CONSULTING' ELSE result_business_type END,
    updated_at = now()
WHERE 'CC' = ANY(input_business_types)
   OR result_business_type = 'CC';

UPDATE public.approval_role_aliases
SET business_type = 'CONSULTING',
    updated_at = now()
WHERE business_type = 'CC';

UPDATE public.approval_submitter_business_type_route_rules
SET input_business_type = CASE WHEN input_business_type = 'CC' THEN 'CONSULTING' ELSE input_business_type END,
    result_business_type = CASE WHEN result_business_type = 'CC' THEN 'CONSULTING' ELSE result_business_type END,
    updated_at = now()
WHERE input_business_type = 'CC'
   OR result_business_type = 'CC';

UPDATE public.business_documents
SET business_type = 'CONSULTING',
    updated_at = now()
WHERE business_type = 'CC';

UPDATE public.approval_submitter_business_type_route_rules
SET is_active = false,
    updated_at = now()
WHERE document_type = 'timesheet'
  AND input_business_type = 'PMCC'
  AND result_business_type = 'PM'
  AND is_active = true;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS chk_projects_business_type;
ALTER TABLE public.projects
  ADD CONSTRAINT chk_projects_business_type
  CHECK (business_type IS NULL OR business_type IN ('PM', 'CONSULTING', 'PMCC'));

ALTER TABLE public.project_role_requirements
  DROP CONSTRAINT IF EXISTS project_role_requirements_business_type_check;
ALTER TABLE public.project_role_requirements
  ADD CONSTRAINT project_role_requirements_business_type_check
  CHECK (business_type IN ('PM', 'CONSULTING', 'PMCC'));

ALTER TABLE public.approval_submitter_business_type_route_rules
  DROP CONSTRAINT IF EXISTS chk_approval_submitter_route_business_type;
ALTER TABLE public.approval_submitter_business_type_route_rules
  ADD CONSTRAINT chk_approval_submitter_route_business_type
  CHECK (
    input_business_type IN ('PM', 'CONSULTING', 'PMCC')
    AND result_business_type IN ('PM', 'CONSULTING', 'PMCC')
  );

CREATE OR REPLACE FUNCTION public.psa_project_code_prefix(p_business_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_business_type, '')) = 'PMCC' THEN 'PMCC'
    WHEN upper(coalesce(p_business_type, '')) = 'PM' THEN 'PM'
    WHEN upper(coalesce(p_business_type, '')) = 'CONSULTING' THEN 'CC'
    ELSE public.psa_normalize_number_prefix(p_business_type)
  END;
$$;

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
  v_planned_labor_days numeric := GREATEST(COALESCE(NULLIF(coalesce(p_project ->> 'planned_labor_days', p_project ->> 'plannedLaborDays'), '')::numeric, 0), 0);
  v_labor_budget_amount numeric := GREATEST(COALESCE(NULLIF(coalesce(p_project ->> 'labor_budget_amount', p_project ->> 'laborBudgetAmount'), '')::numeric, 0), 0);
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

  IF v_business_type IS NOT NULL THEN
    v_business_type := upper(v_business_type);
    IF v_business_type = 'CC' THEN
      v_business_type := 'CONSULTING';
    END IF;
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
    v_planned_labor_days := 0;
    v_labor_budget_amount := 0;
  ELSIF v_business_type IS NULL AND v_code <> '' THEN
    v_business_type := CASE
      WHEN upper(v_code) LIKE 'PMCC%' THEN 'PMCC'
      WHEN upper(v_code) LIKE 'PM%' THEN 'PM'
      WHEN upper(v_code) LIKE 'CC%' THEN 'CONSULTING'
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
      owner_org_id, project_owner_id, status, work_kind, planned_labor_days, labor_budget_amount
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
      v_work_kind,
      v_planned_labor_days,
      v_labor_budget_amount
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
        work_kind = v_work_kind,
        planned_labor_days = v_planned_labor_days,
        labor_budget_amount = v_labor_budget_amount
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
          WHEN upper(p.code) LIKE 'CC%' THEN 'CONSULTING'
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
    WHEN bool_or(business_type = 'PM') AND bool_or(business_type = 'CONSULTING') THEN 'PMCC'
    WHEN bool_or(business_type = 'PM') THEN 'PM'
    WHEN bool_or(business_type = 'CONSULTING') THEN 'CONSULTING'
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

CREATE OR REPLACE FUNCTION public.psa_pmcc_project_node_applicable(
  p_node_key text,
  p_project_business_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_project_business_type = 'CONSULTING'
      THEN p_node_key IN ('cc_project_owner', 'cc_department_owner')
    WHEN p_project_business_type = 'PM'
      THEN p_node_key IN ('pm_project_owner', 'pm_department_owner')
    ELSE true
  END;
$$;

CREATE OR REPLACE FUNCTION public.psa_expand_approval_template(
  p_document_id bigint,
  p_instance_id bigint,
  p_round_id bigint,
  p_template_id bigint,
  p_business_id bigint,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_doc record;
  v_node record;
  v_scope record;
  v_node_key text;
  v_scope_type text;
  v_scope_id bigint;
  v_edge record;
  v_special_template_id bigint;
  v_template_key text;
BEGIN
  SELECT bd.document_type, bd.business_id
    INTO v_doc
    FROM public.business_documents bd
   WHERE bd.id = p_document_id;

  SELECT template_key INTO v_template_key
  FROM public.approval_templates
  WHERE id = p_template_id;

  IF v_doc.document_type IS NULL THEN
    RAISE EXCEPTION 'No approval business_document found for id=%', p_document_id;
  END IF;

  FOR v_node IN
    SELECT *
    FROM public.approval_template_nodes
    WHERE template_id = p_template_id
    ORDER BY sort_order, node_key
  LOOP
    IF COALESCE(v_node.scope_strategy, 'once_per_document') = 'submitter_virtual' THEN
      CONTINUE;
    END IF;

    IF COALESCE(v_node.scope_strategy, 'once_per_document') = 'per_project'
       AND COALESCE(v_node.scope_source, 'document') = 'timesheet_projects' THEN
      FOR v_scope IN
        SELECT DISTINCT
          te.project_id AS scope_id,
          COALESCE(p.business_type, 'PM') AS project_business_type
        FROM public.timesheet_entries te
        JOIN public.projects p ON p.id = te.project_id
        WHERE te.timesheet_id = p_business_id
          AND te.project_id IS NOT NULL
          AND (
            (
              v_node.node_key = 'special_department_owner'
              AND public.psa_is_timesheet_special_project(te.project_id)
            )
            OR (
              v_node.node_key <> 'special_department_owner'
              AND NOT public.psa_is_timesheet_special_project(te.project_id)
            )
          )
        ORDER BY te.project_id
      LOOP
        v_scope_id := v_scope.scope_id;
        v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), 'project');
        v_node_key := replace(
          replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
          '{scope_id}',
          v_scope_id::text
        );

        INSERT INTO public.approval_nodes (
          round_id, instance_id, node_key, template_node_key, node_name, node_type,
          scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
          reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
        )
        VALUES (
          p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
          v_scope_type, v_scope_id,
          CASE
            WHEN v_template_key = 'contract_approval_pmcc_v1'
             AND NOT public.psa_pmcc_project_node_applicable(v_node.node_key, v_scope.project_business_type)
              THEN 'skipped'
            ELSE 'waiting'
          END,
          v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
          v_node.reject_policy,
          to_jsonb(v_node) || jsonb_build_object(
            'project_id', v_scope_id,
            'project_business_type', v_scope.project_business_type
          ),
          to_jsonb(v_node) || jsonb_build_object(
            'project_id', v_scope_id,
            'project_business_type', v_scope.project_business_type,
            'template_driven_timesheet', true,
            'template_key', v_template_key,
            'special_timesheet_project', v_node.node_key = 'special_department_owner',
            'non_applicable_for_project_business_type',
              v_template_key = 'contract_approval_pmcc_v1'
              AND NOT public.psa_pmcc_project_node_applicable(v_node.node_key, v_scope.project_business_type)
          ),
          v_node.scope_strategy,
          v_node.missing_assignee_policy
        );

        IF v_template_key = 'contract_approval_pmcc_v1'
           AND NOT public.psa_pmcc_project_node_applicable(v_node.node_key, v_scope.project_business_type) THEN
          UPDATE public.approval_nodes
          SET result_action = 'skipped',
              completed_at = now(),
              comment = 'Not applicable for project business type',
              snapshot = snapshot || jsonb_build_object('route_source', 'not_applicable_project_business_type'),
              updated_at = now()
          WHERE round_id = p_round_id
            AND node_key = v_node_key;
        END IF;
      END LOOP;
    ELSE
      v_scope_id := NULLIF((p_context ->> 'scope_id')::bigint, 0);
      v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), v_doc.document_type);
      v_node_key := replace(
        replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
        '{scope_id}',
        COALESCE(v_scope_id::text, '')
      );

      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
      )
      VALUES (
        p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
        v_scope_type, v_scope_id, 'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
        v_node.reject_policy,
        to_jsonb(v_node),
        to_jsonb(v_node) || jsonb_build_object('template_key', v_template_key),
        v_node.scope_strategy,
        v_node.missing_assignee_policy
      );
    END IF;
  END LOOP;

  IF v_doc.document_type = 'timesheet' THEN
    SELECT id INTO v_special_template_id
    FROM public.approval_templates
    WHERE template_key = 'timesheet_special_department_owner_v1'
      AND status = 'active'
    LIMIT 1;

    IF v_special_template_id IS NOT NULL THEN
      FOR v_node IN
        SELECT *
        FROM public.approval_template_nodes
        WHERE template_id = v_special_template_id
          AND node_key = 'special_department_owner'
        ORDER BY sort_order, node_key
      LOOP
        FOR v_scope IN
          SELECT DISTINCT te.project_id AS scope_id
          FROM public.timesheet_entries te
          WHERE te.timesheet_id = p_business_id
            AND te.project_id IS NOT NULL
            AND public.psa_is_timesheet_special_project(te.project_id)
          ORDER BY te.project_id
        LOOP
          v_scope_id := v_scope.scope_id;
          v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), 'project');
          v_node_key := replace(
            replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
            '{scope_id}',
            v_scope_id::text
          );

          INSERT INTO public.approval_nodes (
            round_id, instance_id, node_key, template_node_key, node_name, node_type,
            scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
            reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
          )
          VALUES (
            p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
            v_scope_type, v_scope_id, 'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
            v_node.reject_policy,
            to_jsonb(v_node) || jsonb_build_object('project_id', v_scope_id),
            to_jsonb(v_node) || jsonb_build_object(
              'project_id', v_scope_id,
              'template_driven_timesheet', true,
              'template_key', 'timesheet_special_department_owner_v1',
              'special_timesheet_project', true
            ),
            v_node.scope_strategy,
            v_node.missing_assignee_policy
          )
          ON CONFLICT DO NOTHING;
        END LOOP;
      END LOOP;
    END IF;
  END IF;

  FOR v_edge IN
    SELECT *
    FROM public.approval_template_edges
    WHERE template_id = p_template_id
  LOOP
    INSERT INTO public.approval_edges (
      round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr
    )
    SELECT
      p_round_id,
      p_instance_id,
      from_node.id,
      to_node.id,
      v_edge.edge_type,
      v_edge.edge_type,
      v_edge.condition_expr
    FROM public.approval_nodes from_node
    JOIN public.approval_nodes to_node
      ON to_node.round_id = p_round_id
     AND to_node.template_node_key = v_edge.to_node_key
     AND to_node.scope_type = from_node.scope_type
     AND to_node.scope_id IS NOT DISTINCT FROM from_node.scope_id
    WHERE from_node.round_id = p_round_id
      AND from_node.template_node_key = v_edge.from_node_key
      AND COALESCE(v_edge.scope_join_policy, 'same_scope') = 'same_scope'
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_rebuild_running_timesheet_routes_for_business_type(
  p_reason text DEFAULT 'consulting business type route repair'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_candidate record;
  v_template public.approval_templates%rowtype;
  v_new_round_id bigint;
  v_new_round_no int;
  v_rebuilt int := 0;
  v_skipped int := 0;
BEGIN
  FOR v_candidate IN
    WITH desired AS (
      SELECT
        t.id AS timesheet_id,
        t.user_id,
        i.id AS instance_id,
        i.current_round_id,
        i.document_id,
        bd.business_type AS current_business_type,
        public.psa_timesheet_business_type(t.id) AS desired_business_type,
        i.template_id AS current_template_id
      FROM public.timesheets t
      JOIN public.approval_instances i ON i.target_type = 'timesheet' AND i.target_id = t.id
      JOIN public.business_documents bd ON bd.id = i.document_id
      WHERE t.status = 'submitted'
        AND i.status = 'running'
    ),
    target_template AS (
      SELECT
        desired.*,
        tpl.id AS desired_template_id
      FROM desired
      LEFT JOIN LATERAL public.psa_select_approval_template(
        'timesheet',
        desired.timesheet_id,
        desired.desired_business_type,
        '{}'::jsonb
      ) tpl ON true
      WHERE desired.desired_business_type IN ('CONSULTING', 'PMCC')
    )
    SELECT *
    FROM target_template
    WHERE desired_template_id IS NOT NULL
      AND (
        desired_business_type IS DISTINCT FROM current_business_type
        OR desired_template_id IS DISTINCT FROM current_template_id
      )
    ORDER BY timesheet_id
  LOOP
    SELECT * INTO v_template
    FROM public.approval_templates
    WHERE id = v_candidate.desired_template_id;

    IF v_template.id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    UPDATE public.approval_node_assignees a
    SET status = 'cancelled',
        action = 'cancelled',
        comment = p_reason,
        acted_at = now()
    FROM public.approval_nodes n
    WHERE n.round_id = v_candidate.current_round_id
      AND a.node_id = n.id
      AND a.status = 'pending';

    UPDATE public.approval_nodes
    SET status = 'cancelled',
        result_action = 'cancelled',
        comment = COALESCE(NULLIF(comment, ''), p_reason),
        completed_at = COALESCE(completed_at, now()),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'superseded_by_route_repair', true,
          'route_repair_reason', p_reason,
          'previous_business_type', v_candidate.current_business_type,
          'desired_business_type', v_candidate.desired_business_type
        ),
        updated_at = now()
    WHERE round_id = v_candidate.current_round_id
      AND status <> 'cancelled';

    UPDATE public.approval_rounds
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, now()),
        reason = COALESCE(NULLIF(reason, ''), p_reason),
        updated_at = now()
    WHERE id = v_candidate.current_round_id;

    SELECT COALESCE(max(round_no), 0) + 1
      INTO v_new_round_no
    FROM public.approval_rounds
    WHERE instance_id = v_candidate.instance_id;

    INSERT INTO public.approval_rounds (
      instance_id, round_no, round_type, status, started_by, created_by, reason
    )
    VALUES (
      v_candidate.instance_id,
      v_new_round_no,
      'backfill',
      'running',
      v_candidate.user_id,
      v_candidate.user_id,
      p_reason
    )
    RETURNING id INTO v_new_round_id;

    UPDATE public.business_documents
    SET business_type = v_candidate.desired_business_type,
        lifecycle_status = 'in_approval',
        updated_at = now()
    WHERE id = v_candidate.document_id;

    UPDATE public.approval_instances
    SET template_id = v_template.id,
        template_version = v_template.version,
        template_snapshot = public.psa_template_snapshot(v_template.id),
        current_round_id = v_new_round_id,
        current_round = v_new_round_no,
        status = 'running',
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_candidate.instance_id;

    PERFORM public.psa_expand_approval_template(
      v_candidate.document_id,
      v_candidate.instance_id,
      v_new_round_id,
      v_template.id,
      v_candidate.timesheet_id,
      '{}'::jsonb
    );

    PERFORM public.psa_activate_ready_nodes(v_new_round_id);
    v_rebuilt := v_rebuilt + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'rebuilt', v_rebuilt,
    'skipped', v_skipped,
    'reason', p_reason
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'ALTER FUNCTION public.psa_project_code_prefix(text) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_resolve_document_business_type(text, bigint, jsonb) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_timesheet_business_type(bigint) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_pmcc_project_node_applicable(text, text) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_expand_approval_template(bigint, bigint, bigint, bigint, bigint, jsonb) OWNER TO postgres';
    EXECUTE 'ALTER FUNCTION public.psa_rebuild_running_timesheet_routes_for_business_type(text) OWNER TO postgres';
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'psa_admin') THEN
    EXECUTE 'ALTER FUNCTION public.psa_project_code_prefix(text) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_resolve_document_business_type(text, bigint, jsonb) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_timesheet_business_type(bigint) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_pmcc_project_node_applicable(text, text) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_expand_approval_template(bigint, bigint, bigint, bigint, bigint, jsonb) OWNER TO psa_admin';
    EXECUTE 'ALTER FUNCTION public.psa_rebuild_running_timesheet_routes_for_business_type(text) OWNER TO psa_admin';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.psa_pmcc_project_node_applicable(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_rebuild_running_timesheet_routes_for_business_type(text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_rebuild_running_timesheet_routes_for_business_type(text) TO service_role;

SELECT public.psa_rebuild_running_timesheet_routes_for_business_type(
  'V0.18.34 consulting contract route repair'
);

NOTIFY pgrst, 'reload schema';

COMMIT;
