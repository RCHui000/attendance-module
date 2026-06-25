-- Assert BI dashboard analysis backend contract.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-dashboard-analysis-workbench.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DO $$
DECLARE
  v_payload jsonb;
  v_project_count int;
  v_source_total numeric;
  v_project_total numeric;
  v_leave_rows int;
  v_dashboard_user_sub text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'planned_labor_days'
  ) THEN
    RAISE EXCEPTION 'projects.planned_labor_days is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'labor_budget_amount'
  ) THEN
    RAISE EXCEPTION 'projects.labor_budget_amount is missing';
  END IF;

  IF to_regprocedure('public.psa_dashboard_analysis(date,date,text)') IS NULL THEN
    RAISE EXCEPTION 'psa_dashboard_analysis(date,date,text) is missing';
  END IF;

  SELECT e.auth_user_id::text INTO v_dashboard_user_sub
  FROM public.user_roles ur
  JOIN public.employees e ON e.id = ur.employee_id
  JOIN public.role_permissions rp ON rp.role_key = ur.role
  WHERE rp.resource_key = 'dashboard'
    AND rp.access_level IN ('read', 'write')
    AND e.auth_user_id IS NOT NULL
    AND COALESCE(e.is_active, true) = true
  ORDER BY CASE WHEN ur.role = 'admin' THEN 0 ELSE 1 END, ur.employee_id
  LIMIT 1;

  IF v_dashboard_user_sub IS NULL THEN
    RAISE EXCEPTION 'No authenticated user with dashboard read permission is available for assertion';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_dashboard_user_sub, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', v_dashboard_user_sub)::text,
    true
  );

  v_payload := public.psa_dashboard_analysis(current_date - 365, current_date + 365, 'month');

  IF jsonb_typeof(v_payload -> 'projects') <> 'array'
     OR jsonb_typeof(v_payload -> 'departments') <> 'array'
     OR jsonb_typeof(v_payload -> 'employees') <> 'array'
     OR jsonb_typeof(v_payload -> 'trend') <> 'array'
     OR jsonb_typeof(v_payload -> 'sources') <> 'array'
     OR jsonb_typeof(v_payload -> 'summary') <> 'object' THEN
    RAISE EXCEPTION 'psa_dashboard_analysis returned an invalid payload shape: %', v_payload;
  END IF;

  SELECT count(*) INTO v_project_count
  FROM jsonb_array_elements(v_payload -> 'projects') project_row
  WHERE project_row ? 'planned_labor_days'
    AND project_row ? 'labor_budget_amount'
    AND project_row ? 'labor_days_used_ratio'
    AND project_row ? 'labor_budget_used_ratio'
    AND project_row ? 'labor_cost_contract_ratio'
    AND project_row ? 'previous_labor_days'
    AND project_row ? 'labor_days_delta';

  IF v_project_count <> jsonb_array_length(v_payload -> 'projects') THEN
    RAISE EXCEPTION 'Project rows are missing budget or trend fields';
  END IF;

  SELECT count(*) INTO v_leave_rows
  FROM jsonb_array_elements(v_payload -> 'sources') source_row
  WHERE source_row ->> 'work_kind' = 'leave';

  IF v_leave_rows <> 0 THEN
    RAISE EXCEPTION 'Leave rows must not appear in dashboard analysis sources';
  END IF;

  SELECT COALESCE(sum((source_row ->> 'total_hours')::numeric), 0)
    INTO v_source_total
  FROM jsonb_array_elements(v_payload -> 'sources') source_row;

  SELECT COALESCE(sum((project_row ->> 'labor_days')::numeric), 0)
    INTO v_project_total
  FROM jsonb_array_elements(v_payload -> 'projects') project_row;

  IF abs(v_source_total - v_project_total) > 0.01 THEN
    RAISE EXCEPTION 'Source total % does not match project total %', v_source_total, v_project_total;
  END IF;

  PERFORM public.psa_dashboard_analysis(current_date - 365, current_date + 365, 'week');

  BEGIN
    PERFORM public.psa_dashboard_analysis(current_date - 365, current_date + 365, 'day');
    RAISE EXCEPTION 'Invalid grain did not fail';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
END $$;

SELECT 'PASS: dashboard analysis workbench contract is valid' AS result;
