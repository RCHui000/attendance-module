\set ON_ERROR_STOP on
\pset pager off

DO $$
DECLARE
  v_admin_access text;
  v_non_admin_defaults integer;
  v_bad_policy text[];
  v_function_source text;
BEGIN
  SELECT access_level INTO v_admin_access
  FROM public.role_permissions
  WHERE role_key = 'admin'
    AND resource_key = 'approval_config';

  IF v_admin_access <> 'write' THEN
    RAISE EXCEPTION 'Expected admin approval_config permission to be write, got %', COALESCE(v_admin_access, '<missing>');
  END IF;

  SELECT count(*) INTO v_non_admin_defaults
  FROM public.role_permissions
  WHERE resource_key = 'approval_config'
    AND role_key <> 'admin'
    AND access_level <> 'none';

  IF v_non_admin_defaults > 0 THEN
    RAISE EXCEPTION 'Only admin should receive approval_config by default; non-admin rows with access: %', v_non_admin_defaults;
  END IF;

  SELECT ARRAY(
    SELECT schemaname || '.' || tablename || ':' || policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('approval_templates', 'approval_template_nodes', 'approval_template_edges')
      AND cmd = 'SELECT'
      AND qual !~ 'approval_config'
    ORDER BY tablename, policyname
  ) INTO v_bad_policy;

  IF cardinality(v_bad_policy) > 0 THEN
    RAISE EXCEPTION 'Approval template SELECT policies must require approval_config: %', array_to_string(v_bad_policy, ', ');
  END IF;

  SELECT pg_get_functiondef('public.psa_save_approval_template(bigint,text,text,integer,jsonb)'::regprocedure)
  INTO v_function_source;

  IF v_function_source !~ 'current_user_can_access_resource\(''approval_config'',\s*''write''\)' THEN
    RAISE EXCEPTION 'psa_save_approval_template must require approval_config:write';
  END IF;

  IF v_function_source ~ 'current_user_has_role\(''admin''\)' THEN
    RAISE EXCEPTION 'psa_save_approval_template must not be admin-only after RBAC migration';
  END IF;
END $$;

\echo Approval config RBAC smoke passed.
