-- Assert public schema function EXECUTE grants for the PSA/Supabase runtime.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-function-grants.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.function_grant_assertion_details;
CREATE TEMP TABLE function_grant_assertion_details AS
WITH funcs AS (
  SELECT
    p.oid,
    p.oid::regprocedure AS regprocedure,
    p.proname AS function_name,
    p.proacl,
    p.proowner
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
grant_rows AS (
  SELECT
    f.oid,
    CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
    acl.privilege_type
  FROM funcs f
  CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) AS acl
),
grants AS (
  SELECT
    oid,
    bool_or(grantee = 'PUBLIC' AND privilege_type = 'EXECUTE') AS has_pg_public_execute,
    bool_or(grantee = 'anon' AND privilege_type = 'EXECUTE') AS has_anon_execute,
    bool_or(grantee = 'authenticated' AND privilege_type = 'EXECUTE') AS has_authenticated_execute,
    bool_or(grantee = 'service_role' AND privilege_type = 'EXECUTE') AS has_service_role_execute
  FROM grant_rows
  GROUP BY oid
)
SELECT
  f.oid,
  f.regprocedure,
  f.function_name,
  COALESCE(g.has_pg_public_execute, false) AS has_pg_public_execute,
  COALESCE(g.has_anon_execute, false) AS has_anon_execute,
  COALESCE(g.has_authenticated_execute, false) AS has_authenticated_execute,
  COALESCE(g.has_service_role_execute, false) AS has_service_role_execute
FROM funcs f
LEFT JOIN grants g ON g.oid = f.oid;

DO $$
DECLARE
  v_pg_public text[];
  v_unexpected_authenticated text[];
  v_missing_authenticated text[];
  v_missing_anon text[];
BEGIN
  SELECT ARRAY(
    SELECT regprocedure::text
    FROM function_grant_assertion_details
    WHERE has_pg_public_execute
    ORDER BY regprocedure::text
  ) INTO v_pg_public;

  IF cardinality(v_pg_public) > 0 THEN
    RAISE EXCEPTION
      'PostgreSQL PUBLIC must not have function EXECUTE grants: %',
      array_to_string(v_pg_public, ', ');
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT d.regprocedure::text
    FROM function_grant_assertion_details d
    WHERE d.has_authenticated_execute
      AND d.function_name = ANY (ARRAY[
        'approve_node',
        'reject_node',
        'submit_document',
        'psa_activate_ready_nodes',
        'psa_expand_approval_template',
        'psa_resolve_document_business_type',
        'psa_resolve_graph_assignees',
        'psa_resolve_role_candidates',
        'psa_select_approval_template',
        'psa_timesheet_business_type'
      ])
    ORDER BY d.regprocedure::text
  ) INTO v_unexpected_authenticated;

  IF cardinality(v_unexpected_authenticated) > 0 THEN
    RAISE EXCEPTION
      'authenticated must not execute internal approval primitives: %',
      array_to_string(v_unexpected_authenticated, ', ');
  END IF;

  SELECT ARRAY(
    SELECT expected.function_name
    FROM unnest(ARRAY[
      'psa_timesheet_action',
      'psa_overtime_action',
      'psa_save_timesheet',
      'psa_save_role_permission',
      'psa_save_approval_template',
      'psa_save_project',
      'psa_save_organization',
      'psa_update_employee',
      'psa_create_employee_business_rows',
      'psa_timesheet_approval_chain',
      'psa_dashboard_analysis'
    ]) AS expected(function_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM function_grant_assertion_details d
      WHERE d.function_name = expected.function_name
        AND d.has_authenticated_execute
    )
    ORDER BY expected.function_name
  ) INTO v_missing_authenticated;

  IF cardinality(v_missing_authenticated) > 0 THEN
    RAISE EXCEPTION
      'authenticated must execute required RPC/helper functions: %',
      array_to_string(v_missing_authenticated, ', ');
  END IF;

  SELECT ARRAY(
    SELECT expected.function_name
    FROM unnest(ARRAY[
      'psa_resolve_login_email',
      'current_user_can_access_resource',
      'current_user_can_review'
    ]) AS expected(function_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM function_grant_assertion_details d
      WHERE d.function_name = expected.function_name
        AND d.has_anon_execute
    )
    ORDER BY expected.function_name
  ) INTO v_missing_anon;

  IF cardinality(v_missing_anon) > 0 THEN
    RAISE EXCEPTION
      'anon must execute public login/RLS helper functions: %',
      array_to_string(v_missing_anon, ', ');
  END IF;
END $$;

\echo Function grant assertion passed.

SELECT
  'PASS' AS result,
  count(*) AS public_schema_functions,
  count(*) FILTER (WHERE has_anon_execute) AS anon_execute,
  count(*) FILTER (WHERE has_authenticated_execute) AS authenticated_execute
FROM function_grant_assertion_details;
