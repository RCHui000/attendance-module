BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS planned_labor_days numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_budget_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS chk_projects_planned_labor_days_nonnegative;

ALTER TABLE public.projects
  ADD CONSTRAINT chk_projects_planned_labor_days_nonnegative
  CHECK (planned_labor_days >= 0);

ALTER TABLE public.projects
  DROP CONSTRAINT IF EXISTS chk_projects_labor_budget_amount_nonnegative;

ALTER TABLE public.projects
  ADD CONSTRAINT chk_projects_labor_budget_amount_nonnegative
  CHECK (labor_budget_amount >= 0);

CREATE OR REPLACE FUNCTION public.psa_dashboard_daily_rate(
  p_contract_type text,
  p_monthly_salary numeric,
  p_daily_wage numeric,
  p_standard_monthly_workdays numeric
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_contract_type = 'service' THEN COALESCE(p_daily_wage, 0)
    ELSE COALESCE(p_monthly_salary, 0) / NULLIF(COALESCE(p_standard_monthly_workdays, 21.75), 0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.psa_dashboard_analysis(
  p_start_date date,
  p_end_date date,
  p_grain text DEFAULT 'month'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_grain text := lower(COALESCE(NULLIF(p_grain, ''), 'month'));
  v_start date := LEAST(p_start_date, p_end_date);
  v_end date := GREATEST(p_start_date, p_end_date);
  v_previous_start date;
  v_previous_end date;
  v_result jsonb;
BEGIN
  IF NOT public.current_user_can_access_resource('dashboard', 'read') THEN
    RAISE EXCEPTION 'Missing dashboard read permission';
  END IF;

  IF v_grain NOT IN ('week', 'month') THEN
    RAISE EXCEPTION 'Unsupported dashboard grain: %', p_grain
      USING ERRCODE = '22023';
  END IF;

  v_previous_end := v_start - 1;
  v_previous_start := v_start - ((v_end - v_start) + 1);

  WITH current_entries AS (
    SELECT
      te.id AS entry_id,
      te.timesheet_id,
      te.project_id,
      te.work_date,
      te.hours,
      t.user_id AS employee_id,
      t.week_start_date,
      t.status AS timesheet_status,
      t.submitted_at,
      p.code AS project_code,
      p.name AS project_name,
      COALESCE(p.work_kind, 'project') AS work_kind,
      p.contract_amount,
      p.received_amount,
      p.receivable_amount,
      p.planned_labor_days,
      p.labor_budget_amount,
      e.employee_name,
      COALESCE(e.org_name, '未分配部门') AS department,
      public.psa_dashboard_daily_rate(
        e.contract_type,
        e.monthly_salary,
        e.daily_wage,
        e.standard_monthly_workdays
      ) AS daily_rate
    FROM public.timesheet_entries te
    JOIN public.timesheets t ON t.id = te.timesheet_id
    JOIN public.projects p ON p.id = te.project_id
    LEFT JOIN public.hr_employee_current_view e ON e.employee_id = t.user_id
    WHERE te.work_date BETWEEN v_start AND v_end
      AND t.status IN ('approved', 'locked', 'summarized')
      AND COALESCE(p.status, 'active') <> 'deleted'
      AND COALESCE(p.work_kind, 'project') <> 'leave'
  ),
  previous_entries AS (
    SELECT
      te.project_id,
      SUM(te.hours) AS previous_labor_days
    FROM public.timesheet_entries te
    JOIN public.timesheets t ON t.id = te.timesheet_id
    JOIN public.projects p ON p.id = te.project_id
    WHERE te.work_date BETWEEN v_previous_start AND v_previous_end
      AND t.status IN ('approved', 'locked', 'summarized')
      AND COALESCE(p.status, 'active') <> 'deleted'
      AND COALESCE(p.work_kind, 'project') <> 'leave'
    GROUP BY te.project_id
  ),
  active_projects AS (
    SELECT
      p.id,
      p.code,
      p.name,
      p.contract_amount,
      p.received_amount,
      p.receivable_amount,
      p.planned_labor_days,
      p.labor_budget_amount
    FROM public.projects p
    WHERE COALESCE(p.status, 'active') <> 'deleted'
      AND COALESCE(p.work_kind, 'project') <> 'leave'
  ),
  project_labor AS (
    SELECT
      ce.project_id,
      SUM(ce.hours) AS labor_days,
      SUM(ce.hours * ce.daily_rate) AS labor_cost,
      COUNT(DISTINCT ce.employee_id) AS people_count,
      COUNT(DISTINCT ce.department) AS department_count,
      COUNT(DISTINCT ce.timesheet_id) AS timesheet_count
    FROM current_entries ce
    GROUP BY ce.project_id
  ),
  project_rows AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'project_id', ap.id,
        'project_code', ap.code,
        'project_name', ap.name,
        'contract_amount', COALESCE(ap.contract_amount, 0),
        'received_amount', COALESCE(ap.received_amount, 0),
        'receivable_amount', COALESCE(ap.receivable_amount, 0),
        'planned_labor_days', COALESCE(ap.planned_labor_days, 0),
        'labor_budget_amount', COALESCE(ap.labor_budget_amount, 0),
        'labor_days', COALESCE(pl.labor_days, 0),
        'labor_cost', ROUND(COALESCE(pl.labor_cost, 0), 2),
        'people_count', COALESCE(pl.people_count, 0),
        'department_count', COALESCE(pl.department_count, 0),
        'timesheet_count', COALESCE(pl.timesheet_count, 0),
        'previous_labor_days', COALESCE(pe.previous_labor_days, 0),
        'labor_days_delta', COALESCE(pl.labor_days, 0) - COALESCE(pe.previous_labor_days, 0),
        'labor_days_used_ratio', CASE WHEN COALESCE(ap.planned_labor_days, 0) > 0 THEN COALESCE(pl.labor_days, 0) / ap.planned_labor_days ELSE NULL END,
        'labor_budget_used_ratio', CASE WHEN COALESCE(ap.labor_budget_amount, 0) > 0 THEN COALESCE(pl.labor_cost, 0) / ap.labor_budget_amount ELSE NULL END,
        'labor_cost_contract_ratio', CASE WHEN COALESCE(ap.contract_amount, 0) > 0 THEN COALESCE(pl.labor_cost, 0) / ap.contract_amount ELSE NULL END
      )
      ORDER BY COALESCE(pl.labor_days, 0) DESC, ap.code
    ) AS rows
    FROM active_projects ap
    LEFT JOIN project_labor pl ON pl.project_id = ap.id
    LEFT JOIN previous_entries pe ON pe.project_id = ap.id
  ),
  department_rows AS (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data ->> 'labor_days')::numeric DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT jsonb_build_object(
        'project_id', ce.project_id,
        'project_code', max(ce.project_code),
        'project_name', max(ce.project_name),
        'department', ce.department,
        'labor_days', SUM(ce.hours),
        'labor_cost', ROUND(SUM(ce.hours * ce.daily_rate), 2),
        'people_count', COUNT(DISTINCT ce.employee_id),
        'timesheet_count', COUNT(DISTINCT ce.timesheet_id)
      ) AS row_data
      FROM current_entries ce
      GROUP BY ce.project_id, ce.department
    ) rows
  ),
  employee_rows AS (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY (row_data ->> 'labor_days')::numeric DESC), '[]'::jsonb) AS rows
    FROM (
      SELECT jsonb_build_object(
        'project_id', ce.project_id,
        'project_code', max(ce.project_code),
        'project_name', max(ce.project_name),
        'employee_id', ce.employee_id,
        'employee_name', COALESCE(max(ce.employee_name), ''),
        'department', max(ce.department),
        'labor_days', SUM(ce.hours),
        'work_days', COUNT(DISTINCT ce.work_date),
        'daily_rate', ROUND(max(ce.daily_rate), 2),
        'labor_cost', ROUND(SUM(ce.hours * ce.daily_rate), 2),
        'project_count', COUNT(DISTINCT ce.project_id)
      ) AS row_data
      FROM current_entries ce
      GROUP BY ce.project_id, ce.employee_id
    ) rows
  ),
  trend_rows AS (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data ->> 'bucket_start', row_data ->> 'project_code'), '[]'::jsonb) AS rows
    FROM (
      SELECT jsonb_build_object(
        'bucket_start', bucket_start,
        'bucket_label',
        CASE WHEN v_grain = 'month'
          THEN to_char(bucket_start, 'YYYY-MM')
          ELSE to_char(bucket_start, 'YYYY-MM-DD')
        END,
        'project_id', project_id,
        'project_code', max(project_code),
        'project_name', max(project_name),
        'labor_days', SUM(hours),
        'labor_cost', ROUND(SUM(hours * daily_rate), 2),
        'people_count', COUNT(DISTINCT employee_id)
      ) AS row_data
      FROM (
        SELECT
          CASE WHEN v_grain = 'month'
          THEN date_trunc('month', ce.work_date)::date
          ELSE date_trunc('week', ce.work_date)::date
          END AS bucket_start,
          ce.project_id,
          ce.project_code,
          ce.project_name,
          ce.hours,
          ce.daily_rate,
          ce.employee_id
        FROM current_entries ce
      ) bucketed
      GROUP BY bucket_start, project_id
    ) rows
  ),
  source_rows AS (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY row_data ->> 'week_start_date', row_data ->> 'employee_name', row_data ->> 'project_code'), '[]'::jsonb) AS rows
    FROM (
      SELECT jsonb_build_object(
        'timesheet_id', ce.timesheet_id,
        'project_id', ce.project_id,
        'project_code', max(ce.project_code),
        'project_name', max(ce.project_name),
        'work_kind', max(ce.work_kind),
        'employee_id', ce.employee_id,
        'employee_name', COALESCE(max(ce.employee_name), ''),
        'department', max(ce.department),
        'week_start_date', ce.week_start_date,
        'timesheet_status', max(ce.timesheet_status),
        'submitted_at', max(ce.submitted_at),
        'total_hours', SUM(ce.hours),
        'work_days', COUNT(DISTINCT ce.work_date),
        'labor_cost', ROUND(SUM(ce.hours * ce.daily_rate), 2)
      ) AS row_data
      FROM current_entries ce
      GROUP BY ce.timesheet_id, ce.project_id, ce.employee_id, ce.week_start_date
    ) rows
  ),
  summary_row AS (
    SELECT jsonb_build_object(
      'start_date', v_start,
      'end_date', v_end,
      'grain', v_grain,
      'project_count', COUNT(DISTINCT ce.project_id),
      'employee_count', COUNT(DISTINCT ce.employee_id),
      'department_count', COUNT(DISTINCT ce.department),
      'timesheet_count', COUNT(DISTINCT ce.timesheet_id),
      'labor_days', COALESCE(SUM(ce.hours), 0),
      'labor_cost', ROUND(COALESCE(SUM(ce.hours * ce.daily_rate), 0), 2)
    ) AS row
    FROM current_entries ce
  )
  SELECT jsonb_build_object(
    'summary', COALESCE((SELECT row FROM summary_row), '{}'::jsonb),
    'projects', COALESCE((SELECT rows FROM project_rows), '[]'::jsonb),
    'departments', COALESCE((SELECT rows FROM department_rows), '[]'::jsonb),
    'employees', COALESCE((SELECT rows FROM employee_rows), '[]'::jsonb),
    'trend', COALESCE((SELECT rows FROM trend_rows), '[]'::jsonb),
    'sources', COALESCE((SELECT rows FROM source_rows), '[]'::jsonb)
  )
    INTO v_result;

  RETURN v_result;
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

REVOKE ALL ON FUNCTION public.psa_dashboard_daily_rate(text, numeric, numeric, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_dashboard_analysis(date, date, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.psa_dashboard_daily_rate(text, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_dashboard_analysis(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
