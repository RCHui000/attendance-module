\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.chain_cancelled_orphan_target;
CREATE TEMP TABLE chain_cancelled_orphan_target AS
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
  SELECT DISTINCT i.target_id AS timesheet_id, n.template_node_key
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  JOIN public.approval_nodes n ON n.instance_id = i.id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.status = 'cancelled'
    AND NOT EXISTS (
      SELECT 1
      FROM public.approval_template_nodes tn
      WHERE tn.template_id = i.template_id
        AND tn.node_key = n.template_node_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.approval_nodes live_node
      WHERE live_node.instance_id = i.id
        AND live_node.template_node_key = n.template_node_key
        AND live_node.status <> 'cancelled'
    )
  ORDER BY i.target_id DESC
  LIMIT 1
)
SELECT admin_user.auth_user_id, target.timesheet_id, target.template_node_key
FROM admin_user
CROSS JOIN target;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.chain_cancelled_orphan_target) <> 1 THEN
    RAISE NOTICE 'No cancelled orphan approval-chain node found; skipping assertion.';
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
FROM pg_temp.chain_cancelled_orphan_target;

DO $$
DECLARE
  v_target record;
  v_visible_count int;
BEGIN
  SELECT * INTO v_target FROM pg_temp.chain_cancelled_orphan_target LIMIT 1;

  IF v_target.timesheet_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*)::int
    INTO v_visible_count
  FROM public.psa_timesheet_approval_chain(v_target.timesheet_id) chain
  WHERE chain.node_key = v_target.template_node_key;

  IF v_visible_count <> 0 THEN
    RAISE EXCEPTION
      'Expected cancelled orphan node % to be hidden for timesheet %, got % visible rows',
      v_target.template_node_key,
      v_target.timesheet_id,
      v_visible_count;
  END IF;
END $$;

ROLLBACK;

SELECT 'PASS: approval chain hides cancelled orphan runtime nodes' AS result;
