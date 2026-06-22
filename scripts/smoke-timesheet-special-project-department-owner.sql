-- Smoke-test that special timesheet project blocks ("请假" / "其他") route to
-- the submitter's department owner only, instead of project owner chains.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/smoke-timesheet-special-project-department-owner.sql
--
-- The script creates a temporary draft timesheet and rolls back all data.

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.special_project_department_owner_target;
CREATE TEMP TABLE special_project_department_owner_target AS
WITH access_levels(access_level, access_rank) AS (
  VALUES ('none'::text, 0), ('read'::text, 1), ('write'::text, 2)
),
employee_candidate AS (
  SELECT
    e.id AS employee_id,
    e.auth_user_id,
    ep.org_id,
    om.employee_id AS expected_owner_id
  FROM public.employees e
  JOIN public.employee_profiles ep ON ep.employee_id = e.id
  JOIN public.organizations o ON o.id = ep.org_id
  JOIN LATERAL (
    SELECT manager.employee_id
    FROM public.organization_managers manager
    WHERE manager.org_id = ep.org_id
      AND manager.manager_role = 'department_owner'
      AND manager.is_active = true
    ORDER BY manager.is_primary DESC, manager.updated_at DESC, manager.id DESC
    LIMIT 1
  ) om ON true
  WHERE e.auth_user_id IS NOT NULL
    AND COALESCE(e.is_active, true) = true
    AND lower(COALESCE(ep.employment_status, 'active')) NOT IN (
      'terminated', 'inactive', 'resigned'
    )
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_key = ur.role
      JOIN access_levels have_level ON have_level.access_level = rp.access_level
      WHERE ur.employee_id = e.id
        AND rp.resource_key = 'timesheet'
        AND have_level.access_rank >= 2
    )
  ORDER BY
    CASE WHEN o.org_code IN ('PM_DESIGN', 'PM') THEN 0 ELSE 1 END,
    e.id
  LIMIT 1
),
special_project AS (
  SELECT p.id AS project_id, p.code, p.name
  FROM public.projects p
  WHERE p.code IN (U&'\8BF7\5047', U&'\5176\4ED6')
     OR p.name IN (U&'\8BF7\5047', U&'\5176\4ED6')
  ORDER BY CASE WHEN p.code = U&'\8BF7\5047' OR p.name = U&'\8BF7\5047' THEN 0 ELSE 1 END, p.id
  LIMIT 1
),
period_candidate AS (
  SELECT gs.period_start::date AS period_start
  FROM employee_candidate e
  CROSS JOIN LATERAL generate_series(
    date_trunc('week', current_date + interval '370 days')::date,
    date_trunc('week', current_date + interval '7300 days')::date,
    interval '7 days'
  ) AS gs(period_start)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.timesheets t
    WHERE t.user_id = e.employee_id
      AND t.week_start_date = gs.period_start::date
  )
  ORDER BY gs.period_start
  LIMIT 1
),
timesheet_id_candidate AS (
  SELECT -candidate_id AS timesheet_id
  FROM generate_series(900000000010000000::bigint, 900000000010010000::bigint) AS candidate(candidate_id)
  WHERE NOT EXISTS (SELECT 1 FROM public.timesheets t WHERE t.id = -candidate_id)
  LIMIT 1
),
entry_id_candidate AS (
  SELECT -candidate_id AS entry_id
  FROM generate_series(900000000010020000::bigint, 900000000010030000::bigint) AS candidate(candidate_id)
  WHERE NOT EXISTS (SELECT 1 FROM public.timesheet_entries te WHERE te.id = -candidate_id)
  LIMIT 1
)
SELECT
  ts_id.timesheet_id,
  entry_id.entry_id,
  e.employee_id,
  e.auth_user_id,
  e.org_id,
  e.expected_owner_id,
  p.project_id,
  p.code AS project_code,
  p.name AS project_name,
  period.period_start
FROM employee_candidate e
CROSS JOIN special_project p
CROSS JOIN period_candidate period
CROSS JOIN timesheet_id_candidate ts_id
CROSS JOIN entry_id_candidate entry_id;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.special_project_department_owner_target) <> 1 THEN
    RAISE EXCEPTION 'No special project department-owner smoke-test target found';
  END IF;
END $$;

\echo Selected special project department-owner smoke-test target:
SELECT * FROM pg_temp.special_project_department_owner_target;

BEGIN;

SELECT
  set_config('request.jwt.claim.sub', auth_user_id::text, true),
  set_config('request.jwt.claim.role', 'authenticated', true),
  set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', auth_user_id::text, 'role', 'authenticated')::text,
    true
  ),
  set_config('smoke.timesheet_id', timesheet_id::text, true),
  set_config('smoke.project_id', project_id::text, true),
  set_config('smoke.employee_id', employee_id::text, true),
  set_config('smoke.expected_owner_id', expected_owner_id::text, true)
FROM pg_temp.special_project_department_owner_target;

INSERT INTO public.timesheets (id, user_id, week_start_date, status, remark)
SELECT
  timesheet_id,
  employee_id,
  period_start,
  'draft',
  'smoke-timesheet-special-project-department-owner rollback test'
FROM pg_temp.special_project_department_owner_target;

INSERT INTO public.timesheet_entries (
  id, timesheet_id, project_id, work_date, hours, description
)
SELECT
  entry_id,
  timesheet_id,
  project_id,
  period_start,
  1.0,
  'smoke-timesheet-special-project-department-owner rollback test'
FROM pg_temp.special_project_department_owner_target;

SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF public.current_employee_id() IS DISTINCT FROM current_setting('smoke.employee_id')::bigint THEN
    RAISE EXCEPTION 'JWT employee mismatch';
  END IF;
END $$;

SELECT public.psa_timesheet_action(
  current_setting('smoke.timesheet_id')::bigint,
  'submit',
  'smoke-timesheet-special-project-department-owner rollback test',
  NULL::bigint
) AS submit_result;

RESET ROLE;

DO $$
DECLARE
  v_state record;
BEGIN
  SELECT
    count(*)::int AS node_count,
    count(*) FILTER (WHERE n.resolver_type = 'org_manager')::int AS org_manager_nodes,
    count(*) FILTER (WHERE n.resolver_role = 'department_owner')::int AS department_owner_nodes,
    count(*) FILTER (WHERE n.assignee_user_id = current_setting('smoke.expected_owner_id')::bigint)::int AS expected_owner_nodes,
    count(*) FILTER (WHERE n.resolver_type = 'project_role')::int AS project_role_nodes
  INTO v_state
  FROM public.approval_instances i
  JOIN public.approval_nodes n ON n.instance_id = i.id
  WHERE i.target_type = 'timesheet'
    AND i.target_id = current_setting('smoke.timesheet_id')::bigint
    AND n.scope_type = 'project'
    AND n.scope_id = current_setting('smoke.project_id')::bigint
    AND n.status <> 'cancelled';

  IF v_state.node_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one special project approval node, got %', v_state.node_count;
  END IF;

  IF v_state.org_manager_nodes <> 1 OR v_state.department_owner_nodes <> 1 THEN
    RAISE EXCEPTION 'Expected special project node to resolve via org_manager department_owner, got org_manager=% department_owner=%',
      v_state.org_manager_nodes, v_state.department_owner_nodes;
  END IF;

  IF v_state.expected_owner_nodes <> 1 THEN
    RAISE EXCEPTION 'Expected special project node assignee to be submitter department owner %, matched nodes %',
      current_setting('smoke.expected_owner_id')::bigint, v_state.expected_owner_nodes;
  END IF;

  IF v_state.project_role_nodes <> 0 THEN
    RAISE EXCEPTION 'Special project block must not use project_role resolver nodes, got %', v_state.project_role_nodes;
  END IF;
END $$;

\echo Special project department-owner assertions passed inside transaction. Current transactional state:
SELECT
  n.id AS node_id,
  n.template_node_key,
  n.node_name,
  n.scope_type,
  n.scope_id,
  n.status,
  n.resolver_type,
  n.resolver_role,
  n.assignee_user_id,
  e.name AS assignee_name,
  n.snapshot ->> 'route_source' AS route_source
FROM public.approval_instances i
JOIN public.approval_nodes n ON n.instance_id = i.id
LEFT JOIN public.employees e ON e.id = n.assignee_user_id
WHERE i.target_type = 'timesheet'
  AND i.target_id = current_setting('smoke.timesheet_id')::bigint
ORDER BY n.id;

ROLLBACK;

\echo Rollback complete. Special project department-owner smoke-test data was not persisted.
