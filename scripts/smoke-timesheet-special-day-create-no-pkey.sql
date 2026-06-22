-- Smoke-test authenticated creation of weekly timesheets for statutory holiday
-- and non-normal workday dates without hitting timesheets_pkey.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/smoke-timesheet-special-day-create-no-pkey.sql
--
-- The script simulates a normal authenticated employee, creates two draft
-- timesheets with DEFAULT ids for:
--   - 2026-10-01, a statutory rest day in frontend/src/lib/constants.ts
--   - 2026-09-20, an adjusted Sunday workday in frontend/src/lib/constants.ts
-- writes one entry for each special date, asserts the generated ids are beyond
-- the pre-smoke max(id), then rolls back the table changes. PostgreSQL
-- sequences are non-transactional, so sequence counters may advance.

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.smoke_timesheet_special_day_target;
CREATE TEMP TABLE smoke_timesheet_special_day_target AS
WITH special_dates(kind, work_date) AS (
  VALUES
    ('statutory_rest_day'::text, DATE '2026-10-01'),
    ('adjusted_weekend_workday'::text, DATE '2026-09-20')
),
periods AS (
  SELECT
    kind,
    work_date,
    GREATEST(
      (work_date - (EXTRACT(ISODOW FROM work_date)::int - 1))::date,
      date_trunc('month', work_date)::date
    ) AS period_start
  FROM special_dates
),
access_levels(access_level, access_rank) AS (
  VALUES ('none'::text, 0), ('read'::text, 1), ('write'::text, 2)
),
employee_candidate AS (
  SELECT e.id AS employee_id, e.auth_user_id
  FROM public.employees e
  LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
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
    AND NOT EXISTS (
      SELECT 1
      FROM public.timesheets t
      JOIN periods p ON p.period_start = t.week_start_date
      WHERE t.user_id = e.id
    )
  ORDER BY e.id
  LIMIT 1
),
project_candidate AS (
  SELECT p.id AS project_id
  FROM public.projects p
  WHERE COALESCE(p.status, 'active') <> 'deleted'
  ORDER BY p.id
  LIMIT 1
),
sequence_state AS (
  SELECT
    COALESCE((SELECT max(id) FROM public.timesheets), 0) AS max_timesheet_id_before,
    pg_get_serial_sequence('public.timesheets', 'id') AS timesheets_sequence
)
SELECT
  p.kind,
  p.work_date,
  p.period_start,
  e.employee_id,
  e.auth_user_id,
  project.project_id,
  s.max_timesheet_id_before,
  s.timesheets_sequence,
  -(900000000000100000::bigint + row_number() OVER (ORDER BY p.kind)) AS entry_id
FROM periods p
CROSS JOIN employee_candidate e
CROSS JOIN project_candidate project
CROSS JOIN sequence_state s;

DO $$
DECLARE
  v_target_rows int;
  v_distinct_periods int;
  v_sequence_name text;
  v_conflicting_entry_ids int;
BEGIN
  SELECT
    count(*)::int,
    count(DISTINCT period_start)::int,
    max(timesheets_sequence)
  INTO v_target_rows, v_distinct_periods, v_sequence_name
  FROM pg_temp.smoke_timesheet_special_day_target;

  IF v_target_rows <> 2 THEN
    RAISE EXCEPTION
      'No special-day smoke target found. Need one active authenticated employee with timesheet write permission, no existing sheets for 2026-09-14/2026-10-01, and at least one active project.';
  END IF;

  IF v_distinct_periods <> 2 THEN
    RAISE EXCEPTION 'Expected two distinct special-day timesheet periods, found %', v_distinct_periods;
  END IF;

  IF v_sequence_name IS NULL THEN
    RAISE EXCEPTION 'timesheets.id has no serial/identity sequence default';
  END IF;

  SELECT count(*)::int
  INTO v_conflicting_entry_ids
  FROM public.timesheet_entries te
  JOIN pg_temp.smoke_timesheet_special_day_target target ON target.entry_id = te.id;

  IF v_conflicting_entry_ids <> 0 THEN
    RAISE EXCEPTION 'Generated smoke entry ids conflict with existing timesheet_entries rows: %', v_conflicting_entry_ids;
  END IF;
END $$;

\echo Selected special-day create smoke-test targets:
SELECT * FROM pg_temp.smoke_timesheet_special_day_target ORDER BY work_date;

BEGIN;

WITH target AS (
  SELECT
    max(employee_id)::text AS employee_id,
    max(auth_user_id::text) AS auth_user_id,
    max(project_id)::text AS project_id,
    max(work_date::text) FILTER (WHERE kind = 'statutory_rest_day') AS rest_work_date,
    max(period_start::text) FILTER (WHERE kind = 'statutory_rest_day') AS rest_period_start,
    max(entry_id::text) FILTER (WHERE kind = 'statutory_rest_day') AS rest_entry_id,
    max(work_date::text) FILTER (WHERE kind = 'adjusted_weekend_workday') AS adjusted_work_date,
    max(period_start::text) FILTER (WHERE kind = 'adjusted_weekend_workday') AS adjusted_period_start,
    max(entry_id::text) FILTER (WHERE kind = 'adjusted_weekend_workday') AS adjusted_entry_id
  FROM pg_temp.smoke_timesheet_special_day_target
)
SELECT
  set_config('request.jwt.claim.sub', auth_user_id, true) AS jwt_sub,
  set_config('request.jwt.claim.role', 'authenticated', true) AS jwt_role,
  set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', auth_user_id,
      'role', 'authenticated'
    )::text,
    true
  ) AS jwt_claims,
  set_config('smoke.employee_id', employee_id, true) AS smoke_employee_id,
  set_config('smoke.project_id', project_id, true) AS smoke_project_id,
  set_config('smoke.rest_work_date', rest_work_date, true) AS smoke_rest_work_date,
  set_config('smoke.rest_period_start', rest_period_start, true) AS smoke_rest_period_start,
  set_config('smoke.rest_entry_id', rest_entry_id, true) AS smoke_rest_entry_id,
  set_config('smoke.adjusted_work_date', adjusted_work_date, true) AS smoke_adjusted_work_date,
  set_config('smoke.adjusted_period_start', adjusted_period_start, true) AS smoke_adjusted_period_start,
  set_config('smoke.adjusted_entry_id', adjusted_entry_id, true) AS smoke_adjusted_entry_id
FROM target;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_expected_employee_id bigint := current_setting('smoke.employee_id')::bigint;
  v_actual_employee_id bigint;
BEGIN
  v_actual_employee_id := public.current_employee_id();

  IF v_actual_employee_id IS DISTINCT FROM v_expected_employee_id THEN
    RAISE EXCEPTION
      'JWT employee mismatch. Expected current_employee_id %, got %',
      v_expected_employee_id,
      v_actual_employee_id;
  END IF;
END $$;

\echo Creating special-day draft timesheets with database DEFAULT ids:
INSERT INTO public.timesheets (
  user_id, week_start_date, status, remark
)
SELECT
  current_setting('smoke.employee_id')::bigint,
  target.period_start,
  'draft',
  'smoke-timesheet-special-day-create-no-pkey:' || target.kind
FROM (
  VALUES
    ('statutory_rest_day'::text, current_setting('smoke.rest_period_start')::date, current_setting('smoke.rest_work_date')::date),
    ('adjusted_weekend_workday'::text, current_setting('smoke.adjusted_period_start')::date, current_setting('smoke.adjusted_work_date')::date)
) AS target(kind, period_start, work_date)
ORDER BY target.work_date
RETURNING id, user_id, week_start_date, status, remark;

\echo Writing one entry on each special date:
INSERT INTO public.timesheet_entries (
  id, timesheet_id, project_id, work_date, hours, description
)
SELECT
  target.entry_id,
  t.id,
  current_setting('smoke.project_id')::bigint,
  target.work_date,
  0.5,
  'smoke-timesheet-special-day-create-no-pkey rollback test'
FROM (
  VALUES
    (
      'statutory_rest_day'::text,
      current_setting('smoke.rest_work_date')::date,
      current_setting('smoke.rest_period_start')::date,
      current_setting('smoke.rest_entry_id')::bigint
    ),
    (
      'adjusted_weekend_workday'::text,
      current_setting('smoke.adjusted_work_date')::date,
      current_setting('smoke.adjusted_period_start')::date,
      current_setting('smoke.adjusted_entry_id')::bigint
    )
) AS target(kind, work_date, period_start, entry_id)
JOIN public.timesheets t
  ON t.user_id = current_setting('smoke.employee_id')::bigint
 AND t.week_start_date = target.period_start
 AND t.remark = 'smoke-timesheet-special-day-create-no-pkey:' || target.kind
ORDER BY target.work_date
RETURNING id, timesheet_id, project_id, work_date, hours;

RESET ROLE;

DO $$
DECLARE
  v_state record;
BEGIN
  SELECT
    (
      SELECT count(*)::int
      FROM public.timesheets t
      JOIN pg_temp.smoke_timesheet_special_day_target target
        ON target.employee_id = t.user_id
       AND target.period_start = t.week_start_date
       AND t.remark = 'smoke-timesheet-special-day-create-no-pkey:' || target.kind
    ) AS created_timesheets,
    (
      SELECT count(DISTINCT t.id)::int
      FROM public.timesheets t
      JOIN pg_temp.smoke_timesheet_special_day_target target
        ON target.employee_id = t.user_id
       AND target.period_start = t.week_start_date
       AND t.remark = 'smoke-timesheet-special-day-create-no-pkey:' || target.kind
    ) AS distinct_timesheet_ids,
    (
      SELECT min(t.id)
      FROM public.timesheets t
      JOIN pg_temp.smoke_timesheet_special_day_target target
        ON target.employee_id = t.user_id
       AND target.period_start = t.week_start_date
       AND t.remark = 'smoke-timesheet-special-day-create-no-pkey:' || target.kind
    ) AS min_created_timesheet_id,
    (
      SELECT max(max_timesheet_id_before)
      FROM pg_temp.smoke_timesheet_special_day_target
    ) AS max_timesheet_id_before,
    (
      SELECT count(*)::int
      FROM public.timesheet_entries te
      JOIN public.timesheets t ON t.id = te.timesheet_id
      JOIN pg_temp.smoke_timesheet_special_day_target target
        ON target.employee_id = t.user_id
       AND target.period_start = t.week_start_date
       AND target.work_date = te.work_date
       AND target.entry_id = te.id
       AND t.remark = 'smoke-timesheet-special-day-create-no-pkey:' || target.kind
    ) AS created_entries
  INTO v_state;

  IF v_state.created_timesheets <> 2 THEN
    RAISE EXCEPTION 'Expected 2 special-day draft timesheets, got %', v_state.created_timesheets;
  END IF;

  IF v_state.distinct_timesheet_ids <> 2 THEN
    RAISE EXCEPTION 'Expected 2 distinct generated timesheet ids, got %', v_state.distinct_timesheet_ids;
  END IF;

  IF v_state.min_created_timesheet_id <= v_state.max_timesheet_id_before THEN
    RAISE EXCEPTION
      'Expected generated timesheet ids to be greater than pre-smoke max id %, got minimum %',
      v_state.max_timesheet_id_before,
      v_state.min_created_timesheet_id;
  END IF;

  IF v_state.created_entries <> 2 THEN
    RAISE EXCEPTION 'Expected 2 special-day entries, got %', v_state.created_entries;
  END IF;
END $$;

\echo Special-day create assertions passed inside transaction. Current transactional state:
SELECT
  target.kind,
  target.work_date,
  target.period_start,
  t.id AS generated_timesheet_id,
  t.status,
  te.id AS entry_id,
  te.hours
FROM pg_temp.smoke_timesheet_special_day_target target
JOIN public.timesheets t
  ON t.user_id = target.employee_id
 AND t.week_start_date = target.period_start
 AND t.remark = 'smoke-timesheet-special-day-create-no-pkey:' || target.kind
JOIN public.timesheet_entries te
  ON te.timesheet_id = t.id
 AND te.work_date = target.work_date
ORDER BY target.work_date;

ROLLBACK;

\echo Rollback complete. Special-day create smoke-test table data was not persisted.
