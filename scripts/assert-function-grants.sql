-- Assert public schema function EXECUTE grants for the PSA/Supabase runtime.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-function-grants.sql
--
-- Expected baseline after V0.18:
--   public schema functions: 49
--   PostgreSQL PUBLIC EXECUTE grants: 0
--   anon EXECUTE grants: 3
--   authenticated EXECUTE grants: 20

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.function_grant_assertion_details;
CREATE TEMP TABLE function_grant_assertion_details AS
WITH funcs AS (
  SELECT
    p.oid,
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
    bool_or(grantee = 'authenticated' AND privilege_type = 'EXECUTE') AS has_authenticated_execute
  FROM grant_rows
  GROUP BY oid
)
SELECT
  f.oid,
  f.oid::regprocedure AS regprocedure,
  f.function_name,
  COALESCE(g.has_pg_public_execute, false) AS has_pg_public_execute,
  COALESCE(g.has_anon_execute, false) AS has_anon_execute,
  COALESCE(g.has_authenticated_execute, false) AS has_authenticated_execute
FROM funcs f
LEFT JOIN grants g ON g.oid = f.oid;

DROP TABLE IF EXISTS pg_temp.function_grant_assertion_summary;
CREATE TEMP TABLE function_grant_assertion_summary AS
SELECT
  count(*)::int AS public_schema_functions,
  count(*) FILTER (WHERE has_pg_public_execute)::int AS pg_public_execute,
  count(*) FILTER (WHERE has_anon_execute)::int AS anon_execute,
  count(*) FILTER (WHERE has_authenticated_execute)::int AS authenticated_execute
FROM function_grant_assertion_details;

DO $$
DECLARE
  v_summary record;
  v_unexpected_authenticated text[];
  v_missing_authenticated text[];
  v_missing_anon text[];
BEGIN
  SELECT * INTO v_summary
  FROM function_grant_assertion_summary;

  IF v_summary.public_schema_functions <> 49 THEN
    RAISE EXCEPTION 'Expected 49 public schema functions, got %', v_summary.public_schema_functions;
  END IF;

  IF v_summary.pg_public_execute <> 0 THEN
    RAISE EXCEPTION 'Expected 0 PostgreSQL PUBLIC EXECUTE grants, got %', v_summary.pg_public_execute;
  END IF;

  IF v_summary.anon_execute <> 3 THEN
    RAISE EXCEPTION 'Expected 3 anon EXECUTE grants, got %', v_summary.anon_execute;
  END IF;

  IF v_summary.authenticated_execute <> 20 THEN
    RAISE EXCEPTION 'Expected 20 authenticated EXECUTE grants, got %', v_summary.authenticated_execute;
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT d.function_name
    FROM function_grant_assertion_details d
    WHERE d.has_authenticated_execute
      AND d.function_name = ANY (ARRAY[
        'approve_node',
        'reject_node',
        'submit_document'
      ])
    ORDER BY d.function_name
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
      'psa_sync_timesheet_project_revisions',
      'psa_save_role_permission',
      'psa_save_approval_template',
      'psa_save_project',
      'psa_update_employee',
      'psa_timesheet_approval_chain'
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
  public_schema_functions,
  pg_public_execute,
  anon_execute,
  authenticated_execute
FROM function_grant_assertion_summary;

SELECT
  'authenticated required allowlist present' AS check_name,
  string_agg(function_name, ', ' ORDER BY function_name) AS functions
FROM function_grant_assertion_details
WHERE has_authenticated_execute
  AND function_name = ANY (ARRAY[
    'psa_timesheet_action',
    'psa_sync_timesheet_project_revisions',
    'psa_save_role_permission',
    'psa_save_approval_template',
    'psa_save_project',
    'psa_update_employee',
    'psa_timesheet_approval_chain'
  ]);

SELECT
  'anon public/login helpers present' AS check_name,
  string_agg(function_name, ', ' ORDER BY function_name) AS functions
FROM function_grant_assertion_details
WHERE has_anon_execute
  AND function_name = ANY (ARRAY[
    'psa_resolve_login_email',
    'current_user_can_access_resource',
    'current_user_can_review'
  ]);
