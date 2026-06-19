-- Audit public schema function exposure for the PSA/Supabase runtime.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/audit-public-function-grants.sql
--
-- Notes:
--   PostgreSQL PUBLIC grants are different from this project's "PUBLIC" tier
--   in supabase-psa/FUNCTION_PERMISSION_INVENTORY.md. After V0.16.45 there
--   should be no PostgreSQL PUBLIC EXECUTE grants on public schema functions.

\pset pager off
\pset format aligned

WITH funcs AS (
  SELECT
    p.oid,
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS identity_args,
    pg_get_function_result(p.oid) AS result_type,
    pg_get_userbyid(p.proowner) AS owner_name,
    p.prosecdef AS security_definer,
    p.provolatile AS volatility,
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
    acl.privilege_type,
    acl.is_grantable
  FROM funcs f
  CROSS JOIN LATERAL aclexplode(COALESCE(f.proacl, acldefault('f', f.proowner))) AS acl
),
grants AS (
  SELECT
    oid,
    string_agg(
      grantee || ':' || privilege_type || CASE WHEN is_grantable THEN '*' ELSE '' END,
      ', '
      ORDER BY grantee, privilege_type
    ) AS execute_grants,
    bool_or(grantee = 'PUBLIC' AND privilege_type = 'EXECUTE') AS has_pg_public_execute,
    bool_or(grantee = 'anon' AND privilege_type = 'EXECUTE') AS has_anon_execute,
    bool_or(grantee = 'authenticated' AND privilege_type = 'EXECUTE') AS has_authenticated_execute
  FROM grant_rows
  GROUP BY oid
),
function_defs AS (
  SELECT f.oid, lower(pg_get_functiondef(f.oid)) AS def
  FROM funcs f
),
view_defs AS (
  SELECT c.oid, lower(pg_get_viewdef(c.oid, true)) AS def
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('v', 'm')
),
policy_defs AS (
  SELECT
    pol.oid,
    lower(
      coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
      coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    ) AS def
  FROM pg_policy pol
),
trigger_refs AS (
  SELECT tgfoid AS oid, count(*) AS trigger_count
  FROM pg_trigger
  WHERE NOT tgisinternal
  GROUP BY tgfoid
),
function_refs AS (
  SELECT f.oid, count(DISTINCT d.oid) AS called_by_function_count
  FROM funcs f
  JOIN function_defs d
    ON d.oid <> f.oid
   AND d.def LIKE '%' || lower(f.function_name) || '(%'
  GROUP BY f.oid
),
view_refs AS (
  SELECT f.oid, count(DISTINCT v.oid) AS referenced_by_view_count
  FROM funcs f
  JOIN view_defs v ON v.def LIKE '%' || lower(f.function_name) || '(%'
  GROUP BY f.oid
),
policy_refs AS (
  SELECT f.oid, count(DISTINCT p.oid) AS referenced_by_policy_count
  FROM funcs f
  JOIN policy_defs p ON p.def LIKE '%' || lower(f.function_name) || '(%'
  GROUP BY f.oid
)
SELECT
  f.oid::regprocedure AS regprocedure,
  f.function_name,
  f.identity_args,
  f.result_type,
  f.owner_name,
  f.security_definer,
  f.volatility,
  COALESCE(g.execute_grants, '') AS execute_grants,
  COALESCE(g.has_pg_public_execute, false) AS has_pg_public_execute,
  COALESCE(g.has_anon_execute, false) AS has_anon_execute,
  COALESCE(g.has_authenticated_execute, false) AS has_authenticated_execute,
  COALESCE(t.trigger_count, 0) AS trigger_count,
  COALESCE(fr.called_by_function_count, 0) AS called_by_function_count,
  COALESCE(vr.referenced_by_view_count, 0) AS referenced_by_view_count,
  COALESCE(pr.referenced_by_policy_count, 0) AS referenced_by_policy_count
FROM funcs f
LEFT JOIN grants g ON g.oid = f.oid
LEFT JOIN trigger_refs t ON t.oid = f.oid
LEFT JOIN function_refs fr ON fr.oid = f.oid
LEFT JOIN view_refs vr ON vr.oid = f.oid
LEFT JOIN policy_refs pr ON pr.oid = f.oid
ORDER BY f.function_name, f.identity_args;

WITH funcs AS (
  SELECT p.oid, p.proacl, p.proowner
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
  count(*) AS public_schema_function_count,
  count(*) FILTER (WHERE COALESCE(g.has_pg_public_execute, false)) AS pg_public_execute_count,
  count(*) FILTER (WHERE COALESCE(g.has_anon_execute, false)) AS anon_execute_count,
  count(*) FILTER (WHERE COALESCE(g.has_authenticated_execute, false)) AS authenticated_execute_count
FROM funcs f
LEFT JOIN grants g ON g.oid = f.oid;
