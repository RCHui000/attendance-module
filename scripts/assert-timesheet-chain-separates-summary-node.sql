-- Assert that approval-chain projection separates project-level nodes from
-- department_summary nodes even when they share the same template node key.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-timesheet-chain-separates-summary-node.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.chain_summary_projection_target;
CREATE TEMP TABLE chain_summary_projection_target AS
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
  SELECT i.target_id AS timesheet_id, n.template_node_key
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  JOIN public.approval_nodes n ON n.instance_id = i.id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.scope_type = 'department_summary'
    AND n.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.approval_nodes project_node
      WHERE project_node.instance_id = i.id
        AND project_node.template_node_key = n.template_node_key
        AND project_node.scope_type = 'project'
        AND project_node.status = 'approved'
    )
  ORDER BY i.id DESC
  LIMIT 1
)
SELECT admin_user.auth_user_id, target.timesheet_id, target.template_node_key
FROM admin_user
CROSS JOIN target;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.chain_summary_projection_target) <> 1 THEN
    RAISE EXCEPTION 'No suitable active department_summary projection target found';
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
FROM pg_temp.chain_summary_projection_target;

DO $$
DECLARE
  v_target record;
  v_project_rows int;
  v_summary_rows int;
BEGIN
  SELECT * INTO v_target FROM pg_temp.chain_summary_projection_target LIMIT 1;

  SELECT
    count(*) FILTER (
      WHERE chain.node_key = v_target.template_node_key
        AND chain.scope_type = 'project'
        AND chain.node_status = 'approved'
    )::int,
    count(*) FILTER (
      WHERE chain.node_key = v_target.template_node_key
        AND chain.scope_type = 'department_summary'
        AND chain.node_status = 'active'
    )::int
  INTO v_project_rows, v_summary_rows
  FROM public.psa_timesheet_approval_chain(v_target.timesheet_id) chain;

  IF v_project_rows <> 1 THEN
    RAISE EXCEPTION
      'Expected one approved project projection row for template node % on timesheet %, got %',
      v_target.template_node_key,
      v_target.timesheet_id,
      v_project_rows;
  END IF;

  IF v_summary_rows <> 1 THEN
    RAISE EXCEPTION
      'Expected one active department_summary projection row for template node % on timesheet %, got %',
      v_target.template_node_key,
      v_target.timesheet_id,
      v_summary_rows;
  END IF;
END $$;

ROLLBACK;

SELECT 'PASS: approval chain separates project nodes from department summary nodes' AS result;
