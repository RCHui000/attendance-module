-- V0.18.16: Move identity, numbering, and bulk write ownership back to Postgres.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_normalize_number_prefix(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.psa_current_year_suffix()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT to_char(current_date, 'YY');
$$;

CREATE OR REPLACE FUNCTION public.psa_next_number(p_table regclass, p_field text, p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text := public.psa_normalize_number_prefix(p_prefix);
  v_base text;
  v_max integer := 0;
BEGIN
  IF v_prefix = '' THEN
    RETURN '';
  END IF;

  v_base := v_prefix || public.psa_current_year_suffix();

  EXECUTE format(
    'SELECT COALESCE(MAX((regexp_match(%1$I, %2$L))[1]::int), 0)
       FROM %3$s
      WHERE %1$I ~* %4$L',
    p_field,
    '^' || v_base || '([0-9]{3})$',
    p_table,
    '^' || v_base || '[0-9]{3}$'
  )
  INTO v_max;

  RETURN v_base || lpad((v_max + 1)::text, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_employee_number_prefix(p_org_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org record;
  v_code text;
BEGIN
  SELECT org_code, org_name INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  v_code := public.psa_normalize_number_prefix(v_org.org_code);

  RETURN CASE
    WHEN v_code IN ('CC', 'COMP') THEN 'QS'
    WHEN v_code IN ('PM', 'PMMANAGE', 'PMPROJECT') THEN 'PM'
    WHEN v_code IN ('PMDESIGN', 'D009') THEN 'DES'
    WHEN v_code IN ('D016', 'D008') THEN 'HR'
    WHEN v_code = 'D017' THEN 'DIR'
    WHEN v_code = 'PMCOST' THEN 'CM'
    WHEN coalesce(v_org.org_name, '') LIKE '%成本招采%' THEN 'CM'
    WHEN coalesce(v_org.org_name, '') LIKE '%造价%'
      OR coalesce(v_org.org_name, '') LIKE '%成本合约%' THEN 'QS'
    WHEN coalesce(v_org.org_name, '') LIKE '%设计%' THEN 'DES'
    WHEN coalesce(v_org.org_name, '') LIKE '%人事%' THEN 'HR'
    WHEN coalesce(v_org.org_name, '') LIKE '%董事%' THEN 'DIR'
    WHEN v_code LIKE 'PM%'
      OR coalesce(v_org.org_name, '') LIKE '%项目管理%'
      OR coalesce(v_org.org_name, '') LIKE '%工程管理%' THEN 'PM'
    ELSE coalesce(nullif(v_code, ''), 'D' || lpad(coalesce(p_org_id, 0)::text, 3, '0'))
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_project_code_prefix(p_business_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_business_type, '')) = 'PMCC' THEN 'PMCC'
    WHEN upper(coalesce(p_business_type, '')) = 'PM' THEN 'PM'
    WHEN upper(coalesce(p_business_type, '')) = 'CC' THEN 'CC'
    ELSE public.psa_normalize_number_prefix(p_business_type)
  END;
$$;

CREATE OR REPLACE FUNCTION public.psa_ensure_core_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE SEQUENCE IF NOT EXISTS public.organizations_id_seq;
  CREATE SEQUENCE IF NOT EXISTS public.projects_id_seq;
  CREATE SEQUENCE IF NOT EXISTS public.employees_id_seq;
  CREATE SEQUENCE IF NOT EXISTS public.timesheets_id_seq;
  CREATE SEQUENCE IF NOT EXISTS public.timesheet_entries_id_seq;
  CREATE SEQUENCE IF NOT EXISTS public.overtime_entries_id_seq;

  ALTER SEQUENCE public.organizations_id_seq OWNED BY public.organizations.id;
  ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;
  ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;
  ALTER SEQUENCE public.timesheets_id_seq OWNED BY public.timesheets.id;
  ALTER SEQUENCE public.timesheet_entries_id_seq OWNED BY public.timesheet_entries.id;
  ALTER SEQUENCE public.overtime_entries_id_seq OWNED BY public.overtime_entries.id;

  ALTER TABLE public.organizations ALTER COLUMN id SET DEFAULT nextval('public.organizations_id_seq'::regclass);
  ALTER TABLE public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);
  ALTER TABLE public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);
  ALTER TABLE public.timesheets ALTER COLUMN id SET DEFAULT nextval('public.timesheets_id_seq'::regclass);
  ALTER TABLE public.timesheet_entries ALTER COLUMN id SET DEFAULT nextval('public.timesheet_entries_id_seq'::regclass);
  ALTER TABLE public.overtime_entries ALTER COLUMN id SET DEFAULT nextval('public.overtime_entries_id_seq'::regclass);

  PERFORM setval('public.organizations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.organizations), false);
  PERFORM setval('public.projects_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.projects), false);
  PERFORM setval('public.employees_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.employees), false);
  PERFORM setval('public.timesheets_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.timesheets), false);
  PERFORM setval('public.timesheet_entries_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.timesheet_entries), false);
  PERFORM setval('public.overtime_entries_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM public.overtime_entries), false);
END;
$$;

SELECT public.psa_ensure_core_sequences();

CREATE OR REPLACE FUNCTION public.psa_period_end(p_period_start date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(
    (date_trunc('week', p_period_start)::date + 6),
    (date_trunc('month', p_period_start)::date + interval '1 month - 1 day')::date
  );
$$;

CREATE OR REPLACE FUNCTION public.psa_regular_workday_capacity(p_period_start date)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT count(*)::numeric
  FROM generate_series(p_period_start, public.psa_period_end(p_period_start), interval '1 day') AS d(day)
  WHERE extract(isodow from d.day)::int <> 7;
$$;

CREATE OR REPLACE FUNCTION public.psa_save_timesheet(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id bigint := public.current_employee_id();
  v_week_start date := NULLIF(p_payload ->> 'weekStart', '')::date;
  v_sheet public.timesheets%rowtype;
  v_entry jsonb;
  v_overtime jsonb;
  v_revision jsonb;
  v_hours numeric;
  v_project_id bigint;
  v_work_date date;
  v_allowed_end date;
  v_daily record;
  v_week_total numeric;
  v_capacity numeric;
  v_rejected_project_ids bigint[] := ARRAY[]::bigint[];
  v_locked_project_ids bigint[] := ARRAY[]::bigint[];
  v_project_revisions jsonb := coalesce(p_payload -> 'projectRevisions', p_payload -> 'project_revisions', '[]'::jsonb);
  v_can_edit_submitted_revision boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_week_start IS NULL THEN
    RAISE EXCEPTION 'weekStart is required';
  END IF;

  INSERT INTO public.timesheets(user_id, week_start_date)
  VALUES (v_user_id, v_week_start)
  ON CONFLICT (user_id, week_start_date) DO UPDATE
    SET updated_at = public.timesheets.updated_at
  RETURNING * INTO v_sheet;

  SELECT * INTO v_sheet
  FROM public.timesheets
  WHERE id = v_sheet.id
  FOR UPDATE;

  SELECT COALESCE(array_agg(DISTINCT project_id), ARRAY[]::bigint[])
  INTO v_rejected_project_ids
  FROM public.approval_project_review_records_view
  WHERE timesheet_id = v_sheet.id
    AND (status = 'needs_revision' OR result_action = 'reject');

  v_can_edit_submitted_revision := v_sheet.status = 'submitted' AND cardinality(v_rejected_project_ids) > 0;

  IF v_sheet.status NOT IN ('draft', 'rejected', 'revision_required') AND NOT v_can_edit_submitted_revision THEN
    RAISE EXCEPTION 'Submitted or approved timesheets cannot be edited';
  END IF;

  IF v_can_edit_submitted_revision THEN
    SELECT COALESCE(array_agg(DISTINCT project_id), ARRAY[]::bigint[])
    INTO v_locked_project_ids
    FROM public.timesheet_entries
    WHERE timesheet_id = v_sheet.id
      AND NOT (project_id = ANY(v_rejected_project_ids));
  ELSIF v_sheet.status IN ('rejected', 'revision_required') THEN
    v_locked_project_ids := ARRAY[]::bigint[];
  ELSE
    SELECT COALESCE(array_agg(DISTINCT project_id), ARRAY[]::bigint[])
    INTO v_locked_project_ids
    FROM public.approval_project_review_records_view
    WHERE timesheet_id = v_sheet.id
      AND (status = 'project_approved' OR result_action = 'approve');
  END IF;

  UPDATE public.timesheets
  SET remark = coalesce(p_payload ->> 'remark', ''),
      updated_at = now()
  WHERE id = v_sheet.id;

  IF cardinality(v_locked_project_ids) > 0 THEN
    DELETE FROM public.timesheet_entries
    WHERE timesheet_id = v_sheet.id
      AND NOT (project_id = ANY(v_locked_project_ids));
  ELSE
    DELETE FROM public.timesheet_entries
    WHERE timesheet_id = v_sheet.id;
  END IF;

  v_allowed_end := public.psa_period_end(v_sheet.week_start_date);

  FOR v_entry IN SELECT * FROM jsonb_array_elements(coalesce(p_payload -> 'entries', '[]'::jsonb))
  LOOP
    v_hours := coalesce(NULLIF(v_entry ->> 'hours', '')::numeric, 0);
    v_project_id := coalesce(NULLIF(v_entry ->> 'projectId', '')::bigint, NULLIF(v_entry ->> 'project_id', '')::bigint);
    v_work_date := coalesce(NULLIF(v_entry ->> 'workDate', '')::date, NULLIF(v_entry ->> 'work_date', '')::date);

    IF v_hours <= 0 OR v_project_id IS NULL OR v_work_date IS NULL THEN
      CONTINUE;
    END IF;
    IF v_project_id = ANY(v_locked_project_ids) THEN
      CONTINUE;
    END IF;
    IF v_work_date < v_sheet.week_start_date OR v_work_date > v_allowed_end THEN
      RAISE EXCEPTION '% is outside the timesheet period', v_work_date;
    END IF;
    IF v_hours > 1.0001 THEN
      RAISE EXCEPTION '% project workdays exceed 1.0', v_work_date;
    END IF;

    INSERT INTO public.timesheet_entries(timesheet_id, project_id, work_date, hours, description)
    VALUES (
      v_sheet.id,
      v_project_id,
      v_work_date,
      v_hours,
      coalesce(v_entry ->> 'description', '')
    );
  END LOOP;

  FOR v_daily IN
    SELECT work_date, sum(hours) AS total_hours
    FROM public.timesheet_entries
    WHERE timesheet_id = v_sheet.id
    GROUP BY work_date
  LOOP
    IF v_daily.total_hours > 1.0001 THEN
      RAISE EXCEPTION '% regular workday total exceeds 1.0', v_daily.work_date;
    END IF;
  END LOOP;

  SELECT coalesce(sum(hours), 0) INTO v_week_total
  FROM public.timesheet_entries
  WHERE timesheet_id = v_sheet.id;

  v_capacity := public.psa_regular_workday_capacity(v_sheet.week_start_date);
  IF v_week_total > v_capacity + 0.0001 THEN
    RAISE EXCEPTION 'Weekly regular workdays % exceed %', v_week_total, v_capacity;
  END IF;

  IF v_can_edit_submitted_revision AND jsonb_array_length(v_project_revisions) > 0 THEN
    PERFORM public.psa_sync_timesheet_project_revisions(
      v_sheet.id,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'old_project_id', coalesce(NULLIF(item ->> 'oldProjectId', '')::bigint, NULLIF(item ->> 'old_project_id', '')::bigint),
            'new_project_id', coalesce(NULLIF(item ->> 'newProjectId', '')::bigint, NULLIF(item ->> 'new_project_id', '')::bigint)
          )
        )
        FROM jsonb_array_elements(v_project_revisions) item
      )
    );
  END IF;

  IF NOT v_can_edit_submitted_revision THEN
    DELETE FROM public.overtime_entries WHERE timesheet_id = v_sheet.id;
    FOR v_overtime IN SELECT * FROM jsonb_array_elements(coalesce(p_payload -> 'overtime', '[]'::jsonb))
    LOOP
      v_hours := coalesce(NULLIF(v_overtime ->> 'hours', '')::numeric, NULLIF(v_overtime ->> 'overtime_hours', '')::numeric, 0);
      v_work_date := coalesce(NULLIF(v_overtime ->> 'workDate', '')::date, NULLIF(v_overtime ->> 'work_date', '')::date);
      IF (v_hours <= 0 AND coalesce(v_overtime ->> 'reason', '') = '') OR v_work_date IS NULL THEN
        CONTINUE;
      END IF;
      INSERT INTO public.overtime_entries(timesheet_id, work_date, overtime_hours, reason, status)
      VALUES (v_sheet.id, v_work_date, v_hours, coalesce(v_overtime ->> 'reason', ''), 'pending');
    END LOOP;
  END IF;

  SELECT * INTO v_sheet FROM public.timesheets WHERE id = v_sheet.id;
  RETURN jsonb_build_object('ok', true, 'timesheet_id', v_sheet.id, 'timesheet', to_jsonb(v_sheet));
END;
$$;

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

  RETURN jsonb_build_object('ok', true, 'organization_id', v_row.id, 'organization', to_jsonb(v_row));
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

  RETURN jsonb_build_object('ok', true, 'employee_id', v_employee_id, 'employee_no', v_employee_no);
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

  RETURN jsonb_build_object('ok', true, 'project_id', v_project_id, 'code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.psa_save_timesheet(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_save_organization(jsonb, bigint[]) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_create_employee_business_rows(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_normalize_number_prefix(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_current_year_suffix() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_next_number(regclass, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_employee_number_prefix(bigint) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_project_code_prefix(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_ensure_core_sequences() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_period_end(date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_regular_workday_capacity(date) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.psa_save_timesheet(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_organization(jsonb, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_create_employee_business_rows(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psa_normalize_number_prefix(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_current_year_suffix() TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_next_number(regclass, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_employee_number_prefix(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.psa_project_code_prefix(text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
