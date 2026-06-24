\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  v_missing text[];
  v_bad_execute text[];
BEGIN
  SELECT ARRAY(
    SELECT expected.regproc_name
    FROM unnest(ARRAY[
      'public.psa_save_timesheet(jsonb)',
      'public.psa_save_organization(jsonb,bigint[])',
      'public.psa_create_employee_business_rows(jsonb)'
    ]) AS expected(regproc_name)
    WHERE to_regprocedure(expected.regproc_name) IS NULL
    ORDER BY expected.regproc_name
  ) INTO v_missing;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Missing backend ownership RPCs: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT ARRAY(
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'approve_node',
        'reject_node',
        'submit_document',
        'psa_activate_ready_nodes',
        'psa_expand_approval_template',
        'psa_resolve_graph_assignees',
        'psa_resolve_role_candidates',
        'psa_select_approval_template',
        'psa_timesheet_business_type'
      )
      AND acl.privilege_type = 'EXECUTE'
      AND pg_get_userbyid(acl.grantee) = 'authenticated'
    ORDER BY p.oid::regprocedure::text
  ) INTO v_bad_execute;

  IF cardinality(v_bad_execute) > 0 THEN
    RAISE EXCEPTION 'Internal functions exposed to authenticated: %', array_to_string(v_bad_execute, ', ');
  END IF;
END $$;

\echo Backend ownership RPC assertion passed.
