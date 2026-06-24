-- Assert business owner assignments stay synchronized with platform roles.
-- Run after applying migrations to a disposable database.

DO $$
DECLARE
  v_sync_definition text;
  v_save_definition text;
  v_save_org_definition text;
  v_update_employee_definition text;
  v_required_roles text[] := ARRAY[
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
  v_role text;
BEGIN
  SELECT pg_get_functiondef('public.psa_sync_business_platform_roles(bigint[])'::regprocedure)
  INTO v_sync_definition;

  SELECT pg_get_functiondef('public.psa_save_project(jsonb,jsonb,jsonb)'::regprocedure)
  INTO v_save_definition;

  SELECT pg_get_functiondef('public.psa_save_organization(jsonb,bigint[])'::regprocedure)
  INTO v_save_org_definition;

  SELECT pg_get_functiondef('public.psa_update_employee(jsonb)'::regprocedure)
  INTO v_update_employee_definition;

  IF to_regprocedure('public.psa_sync_project_platform_roles(bigint[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy project-only platform role sync wrapper should be dropped';
  END IF;

  FOREACH v_role IN ARRAY v_required_roles
  LOOP
    IF position(quote_literal(v_role) in v_sync_definition) = 0 THEN
      RAISE EXCEPTION 'psa_sync_business_platform_roles does not account for role %', v_role;
    END IF;
  END LOOP;

  IF position('organization_managers' in v_sync_definition) = 0 THEN
    RAISE EXCEPTION 'psa_sync_business_platform_roles does not account for organization_managers';
  END IF;

  IF position('project_department_owners' in v_sync_definition) = 0 THEN
    RAISE EXCEPTION 'psa_sync_business_platform_roles does not account for project_department_owners';
  END IF;

  IF position('admin' in v_sync_definition) = 0 OR position('director' in v_sync_definition) = 0 THEN
    RAISE EXCEPTION 'psa_sync_business_platform_roles must preserve admin/director roles';
  END IF;

  IF position('psa_sync_business_platform_roles' in v_save_definition) = 0 THEN
    RAISE EXCEPTION 'psa_save_project must call psa_sync_business_platform_roles after owner changes';
  END IF;

  IF position('psa_sync_business_platform_roles' in v_save_org_definition) = 0 THEN
    RAISE EXCEPTION 'psa_save_organization must call psa_sync_business_platform_roles after manager changes';
  END IF;

  IF position('psa_sync_business_platform_roles' in v_update_employee_definition) = 0 THEN
    RAISE EXCEPTION 'psa_update_employee must call psa_sync_business_platform_roles after manual role edits';
  END IF;
END;
$$;
