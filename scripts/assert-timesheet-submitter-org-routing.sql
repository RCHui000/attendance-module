-- Verify consulting and PMCC timesheet approval routing keeps the longest applicable chain.
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-timesheet-submitter-org-routing.sql

\pset pager off

DO $$
DECLARE
  v_pm_design_timesheet_id bigint;
  v_cc_timesheet_id bigint;
  v_route_type text;
BEGIN
  SELECT t.id INTO v_pm_design_timesheet_id
  FROM public.timesheets t
  JOIN public.employee_profiles ep ON ep.employee_id = t.user_id
  JOIN public.organizations o ON o.id = ep.org_id
  WHERE o.org_code = 'PM_DESIGN'
    AND EXISTS (
      SELECT 1
      FROM public.timesheet_entries te
      JOIN public.projects p ON p.id = te.project_id
      WHERE te.timesheet_id = t.id
        AND COALESCE(NULLIF(p.business_type, ''), CASE WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC' END) = 'PMCC'
    )
  ORDER BY t.id DESC
  LIMIT 1;

  IF v_pm_design_timesheet_id IS NULL THEN
    RAISE NOTICE 'No PM_DESIGN + PMCC timesheet fixture found; skipping PM-side assertion.';
  ELSE
    SELECT public.psa_timesheet_business_type(v_pm_design_timesheet_id) INTO v_route_type;
    IF v_route_type IS DISTINCT FROM 'PMCC' THEN
      RAISE EXCEPTION 'Expected PM_DESIGN + PMCC timesheet % to route as PMCC, got %',
        v_pm_design_timesheet_id,
        v_route_type;
    END IF;
  END IF;

  SELECT t.id INTO v_cc_timesheet_id
  FROM public.timesheets t
  JOIN public.employee_profiles ep ON ep.employee_id = t.user_id
  JOIN public.organizations o ON o.id = ep.org_id
  WHERE o.org_code = 'CC'
    AND EXISTS (
      SELECT 1
      FROM public.timesheet_entries te
      JOIN public.projects p ON p.id = te.project_id
      WHERE te.timesheet_id = t.id
        AND COALESCE(NULLIF(p.business_type, ''), CASE WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC' END) = 'PMCC'
    )
  ORDER BY t.id DESC
  LIMIT 1;

  IF v_cc_timesheet_id IS NULL THEN
    RAISE NOTICE 'No CC + PMCC timesheet fixture found; skipping CC-side assertion.';
  ELSE
    SELECT public.psa_timesheet_business_type(v_cc_timesheet_id) INTO v_route_type;
    IF v_route_type IS DISTINCT FROM 'PMCC' THEN
      RAISE EXCEPTION 'Expected CC + PMCC timesheet % to route as PMCC, got %',
        v_cc_timesheet_id,
        v_route_type;
    END IF;
  END IF;
END $$;

SELECT
  'PASS' AS result,
  'timesheet submitter-org routing' AS check_name;
