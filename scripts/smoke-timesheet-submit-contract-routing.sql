-- Smoke-test that a draft weekly timesheet submit is bound to the
-- configured PM/CC/PMCC contract_approval template.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/smoke-timesheet-submit-contract-routing.sql
--
-- The script creates a temporary draft timesheet and one entry using explicit
-- negative ids, simulates the submitter's Supabase/PostgREST JWT claims, calls
-- psa_timesheet_action(..., 'submit', ..., NULL::bigint) inside a transaction,
-- asserts the selected approval instance uses a contract_approval template,
-- then rolls the transaction back. It must not permanently modify business data.

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.smoke_timesheet_submit_contract_target;
CREATE TEMP TABLE smoke_timesheet_submit_contract_target AS
WITH access_levels(access_level, access_rank) AS (
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
  ORDER BY e.id
  LIMIT 1
),
project_candidate AS (
  SELECT
    p.id AS project_id,
    COALESCE(
      NULLIF(p.business_type, ''),
      CASE
        WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC'
        WHEN upper(p.code) LIKE 'PM%' THEN 'PM'
        WHEN upper(p.code) LIKE 'CC%' THEN 'CC'
        ELSE NULL
      END
    ) AS business_type
  FROM public.projects p
  WHERE COALESCE(p.status, 'active') <> 'deleted'
    AND COALESCE(
      NULLIF(p.business_type, ''),
      CASE
        WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC'
        WHEN upper(p.code) LIKE 'PM%' THEN 'PM'
        WHEN upper(p.code) LIKE 'CC%' THEN 'CC'
        ELSE NULL
      END
    ) IN ('PM', 'CC', 'PMCC')
    AND EXISTS (
      SELECT 1
      FROM public.approval_templates tpl
      WHERE tpl.document_type = 'contract_approval'
        AND tpl.business_type = COALESCE(
          NULLIF(p.business_type, ''),
          CASE
            WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC'
            WHEN upper(p.code) LIKE 'PM%' THEN 'PM'
            WHEN upper(p.code) LIKE 'CC%' THEN 'CC'
            ELSE NULL
          END
        )
        AND tpl.status = 'active'
    )
  ORDER BY
    CASE
      WHEN COALESCE(NULLIF(p.business_type, ''), '') = 'PMCC' OR upper(p.code) LIKE 'PMCC%' THEN 0
      WHEN COALESCE(NULLIF(p.business_type, ''), '') = 'PM' OR upper(p.code) LIKE 'PM%' THEN 1
      ELSE 2
    END,
    p.id
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
  FROM generate_series(900000000000000000::bigint, 900000000000010000::bigint) AS candidate(candidate_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.timesheets t WHERE t.id = -candidate_id
  )
  LIMIT 1
),
entry_id_candidate AS (
  SELECT -candidate_id AS entry_id
  FROM generate_series(900000000000020000::bigint, 900000000000030000::bigint) AS candidate(candidate_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.timesheet_entries te WHERE te.id = -candidate_id
  )
  LIMIT 1
)
SELECT
  ts_id.timesheet_id,
  entry_id.entry_id,
  e.employee_id,
  e.auth_user_id,
  p.project_id,
  p.business_type,
  period.period_start
FROM employee_candidate e
CROSS JOIN project_candidate p
CROSS JOIN period_candidate period
CROSS JOIN timesheet_id_candidate ts_id
CROSS JOIN entry_id_candidate entry_id;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.smoke_timesheet_submit_contract_target) <> 1 THEN
    RAISE EXCEPTION
      'No submit smoke-test target found. Need an active authenticated employee with timesheet write permission, an active PM/CC/PMCC project, an active matching contract_approval template, and a free future week.';
  END IF;
END $$;

\echo Selected submit routing smoke-test target:
SELECT * FROM pg_temp.smoke_timesheet_submit_contract_target;

BEGIN;

SELECT
  set_config('request.jwt.claim.sub', auth_user_id::text, true) AS jwt_sub,
  set_config('request.jwt.claim.role', 'authenticated', true) AS jwt_role,
  set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', auth_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  ) AS jwt_claims,
  set_config('smoke.timesheet_id', timesheet_id::text, true) AS smoke_timesheet_id,
  set_config('smoke.employee_id', employee_id::text, true) AS smoke_employee_id
FROM pg_temp.smoke_timesheet_submit_contract_target;

INSERT INTO public.timesheets (
  id, user_id, week_start_date, status, remark
)
SELECT
  timesheet_id,
  employee_id,
  period_start,
  'draft',
  'smoke-timesheet-submit-contract-routing rollback test'
FROM pg_temp.smoke_timesheet_submit_contract_target;

INSERT INTO public.timesheet_entries (
  id, timesheet_id, project_id, work_date, hours, description
)
SELECT
  entry_id,
  timesheet_id,
  project_id,
  period_start,
  1.0,
  'smoke-timesheet-submit-contract-routing rollback test'
FROM pg_temp.smoke_timesheet_submit_contract_target;

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

SELECT
  public.psa_timesheet_action(
    current_setting('smoke.timesheet_id')::bigint,
    'submit',
    'smoke-timesheet-submit-contract-routing rollback test',
    NULL::bigint
  ) AS submit_result
;

RESET ROLE;

DO $$
DECLARE
  v_state record;
BEGIN
  SELECT
    c.timesheet_id,
    c.business_type AS expected_business_type,
    t.status AS timesheet_status,
    bd.lifecycle_status AS business_document_status,
    bd.business_type AS business_document_business_type,
    i.id AS instance_id,
    i.status AS instance_status,
    tpl.document_type AS template_document_type,
    tpl.business_type AS template_business_type,
    (
      SELECT count(*)::int
      FROM public.approval_nodes n
      WHERE n.instance_id = i.id
        AND n.status <> 'cancelled'
    ) AS runtime_nodes,
    (
      SELECT count(*)::int
      FROM public.approval_nodes n
      LEFT JOIN public.approval_template_nodes tn
        ON tn.template_id = i.template_id
       AND tn.node_key = n.template_node_key
      WHERE n.instance_id = i.id
        AND n.status <> 'cancelled'
        AND n.node_type = 'approval'
        AND tn.id IS NULL
    ) AS bad_node_mappings
  INTO v_state
  FROM pg_temp.smoke_timesheet_submit_contract_target c
  JOIN public.timesheets t ON t.id = c.timesheet_id
  LEFT JOIN LATERAL (
    SELECT latest_i.*
    FROM public.approval_instances latest_i
    WHERE latest_i.target_type = 'timesheet'
      AND latest_i.target_id = c.timesheet_id
    ORDER BY
      CASE WHEN latest_i.status = 'running' THEN 0 ELSE 1 END,
      latest_i.id DESC
    LIMIT 1
  ) i ON true
  LEFT JOIN public.business_documents bd ON bd.id = i.document_id
  LEFT JOIN public.approval_templates tpl ON tpl.id = i.template_id;

  IF v_state.instance_id IS NULL THEN
    RAISE EXCEPTION 'Expected an approval instance for submitted smoke timesheet %, found none', v_state.timesheet_id;
  END IF;

  IF v_state.timesheet_status NOT IN ('submitted', 'approved') THEN
    RAISE EXCEPTION 'Expected timesheet status submitted or approved after submit, got %', v_state.timesheet_status;
  END IF;

  IF v_state.business_document_status NOT IN ('in_approval', 'approved') THEN
    RAISE EXCEPTION 'Expected business document lifecycle_status in_approval or approved, got %', v_state.business_document_status;
  END IF;

  IF v_state.template_document_type IS DISTINCT FROM 'contract_approval' THEN
    RAISE EXCEPTION 'Expected contract_approval template, got document_type %', v_state.template_document_type;
  END IF;

  IF v_state.template_business_type IS DISTINCT FROM v_state.expected_business_type THEN
    RAISE EXCEPTION
      'Expected template business_type %, got %',
      v_state.expected_business_type,
      v_state.template_business_type;
  END IF;

  IF v_state.business_document_business_type IS DISTINCT FROM v_state.expected_business_type THEN
    RAISE EXCEPTION
      'Expected business document business_type %, got %',
      v_state.expected_business_type,
      v_state.business_document_business_type;
  END IF;

  IF v_state.runtime_nodes <= 0 THEN
    RAISE EXCEPTION 'Expected runtime approval nodes for submitted smoke timesheet %, got %', v_state.timesheet_id, v_state.runtime_nodes;
  END IF;

  IF v_state.bad_node_mappings <> 0 THEN
    RAISE EXCEPTION 'Expected all runtime approval nodes to map to template nodes, bad mappings %', v_state.bad_node_mappings;
  END IF;
END $$;

\echo Submit routing assertions passed inside transaction. Current transactional state:
SELECT
  t.id AS timesheet_id,
  t.status AS timesheet_status,
  bd.lifecycle_status AS business_document_status,
  bd.business_type AS business_document_business_type,
  i.status AS approval_instance_status,
  tpl.template_key,
  tpl.document_type AS template_document_type,
  tpl.business_type AS template_business_type,
  (
    SELECT count(*)::int
    FROM public.approval_nodes n
    WHERE n.instance_id = i.id
      AND n.status <> 'cancelled'
  ) AS runtime_nodes
FROM pg_temp.smoke_timesheet_submit_contract_target c
JOIN public.timesheets t ON t.id = c.timesheet_id
JOIN public.approval_instances i
  ON i.target_type = 'timesheet'
 AND i.target_id = c.timesheet_id
JOIN public.business_documents bd ON bd.id = i.document_id
JOIN public.approval_templates tpl ON tpl.id = i.template_id
ORDER BY i.id DESC
LIMIT 1;

ROLLBACK;

\echo Rollback complete. Submit routing smoke-test data was not persisted.
