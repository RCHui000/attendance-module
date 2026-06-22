-- Assert that the approval chain display does not show the special
-- department-owner node unless the timesheet actually contains a special
-- project block ("请假" / "其他").
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-timesheet-chain-no-phantom-special-node.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.chain_no_phantom_special_target;
CREATE TEMP TABLE chain_no_phantom_special_target AS
WITH admin_user AS (
  SELECT e.auth_user_id
  FROM public.employees e
  JOIN public.user_roles ur ON ur.employee_id = e.id
  WHERE ur.role = 'admin'
    AND e.auth_user_id IS NOT NULL
  ORDER BY e.id
  LIMIT 1
),
target AS (
  SELECT i.target_id AS timesheet_id
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND EXISTS (
      SELECT 1
      FROM public.approval_template_nodes tn
      WHERE tn.template_id = i.template_id
        AND tn.node_key = 'special_department_owner'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.timesheet_entries te
      WHERE te.timesheet_id = i.target_id
        AND public.psa_is_timesheet_special_project(te.project_id)
    )
  ORDER BY i.id DESC
  LIMIT 1
)
SELECT admin_user.auth_user_id, target.timesheet_id
FROM admin_user
CROSS JOIN target;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.chain_no_phantom_special_target) <> 1 THEN
    RAISE EXCEPTION 'No suitable no-special-project running timesheet found for chain assertion';
  END IF;
END $$;

BEGIN;

SELECT
  set_config('request.jwt.claim.sub', auth_user_id::text, true),
  set_config('request.jwt.claim.role', 'authenticated', true),
  set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', auth_user_id::text, 'role', 'authenticated')::text,
    true
  )
FROM pg_temp.chain_no_phantom_special_target;

DO $$
DECLARE
  v_timesheet_id bigint := (SELECT timesheet_id FROM pg_temp.chain_no_phantom_special_target);
  v_phantom_count int;
BEGIN
  SELECT count(*)::int
    INTO v_phantom_count
  FROM public.psa_timesheet_approval_chain(v_timesheet_id) chain
  WHERE chain.node_key = 'special_department_owner';

  IF v_phantom_count <> 0 THEN
    RAISE EXCEPTION
      'Expected no special_department_owner chain node for timesheet % without special projects, got %',
      v_timesheet_id,
      v_phantom_count;
  END IF;
END $$;

ROLLBACK;

SELECT 'PASS: approval chain hides phantom special project node for non-special timesheets' AS result;
