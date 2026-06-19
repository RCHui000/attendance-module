-- Smoke-test the submitted-timesheet withdraw transaction.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/smoke-timesheet-withdraw.sql
--
-- This script selects one submitted timesheet with a running approval graph,
-- simulates the submitter's Supabase/PostgREST JWT claims, calls
-- psa_timesheet_action(..., 'withdraw', ..., NULL::bigint) inside a transaction,
-- asserts the expected graph/document state, then rolls the transaction back.
-- It must not permanently modify business data.

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DROP TABLE IF EXISTS pg_temp.smoke_timesheet_withdraw_target;
CREATE TEMP TABLE smoke_timesheet_withdraw_target AS
SELECT
  t.id AS timesheet_id,
  t.user_id AS submitter_employee_id,
  e.auth_user_id AS submitter_auth_user_id,
  t.status AS original_timesheet_status,
  bd.id AS business_document_id,
  bd.lifecycle_status AS original_business_document_status,
  (
    SELECT count(*)::int
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.target_id = t.id
      AND i.status = 'running'
  ) AS original_running_instances,
  (
    SELECT count(*)::int
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE i.target_type = 'timesheet'
      AND i.target_id = t.id
      AND n.status IN (
        'waiting', 'pending', 'active', 'waiting_revision',
        'revision_required', 'needs_revision', 'needs_reapproval'
      )
  ) AS original_open_nodes,
  (
    SELECT count(*)::int
    FROM public.approval_node_assignees a
    JOIN public.approval_nodes n ON n.id = a.node_id
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE i.target_type = 'timesheet'
      AND i.target_id = t.id
      AND a.status = 'pending'
  ) AS original_pending_assignees,
  (
    SELECT count(*)::int
    FROM public.approval_project_review_records_view v
    WHERE v.timesheet_id = t.id
  ) AS original_project_review_rows
FROM public.timesheets t
JOIN public.employees e ON e.id = t.user_id
JOIN public.business_documents bd
  ON bd.document_type = 'timesheet'
 AND bd.business_id = t.id
 AND bd.business_version = 1
WHERE t.status = 'submitted'
  AND e.auth_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.target_id = t.id
      AND i.status = 'running'
  )
ORDER BY t.submitted_at DESC NULLS LAST, t.id DESC
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM smoke_timesheet_withdraw_target) THEN
    RAISE EXCEPTION
      'No submitted timesheet with a running approval instance and submitter auth_user_id was found';
  END IF;
END $$;

\echo Selected withdraw smoke-test target:
SELECT * FROM smoke_timesheet_withdraw_target;

BEGIN;

SELECT
  set_config('request.jwt.claim.sub', submitter_auth_user_id::text, true) AS jwt_sub,
  set_config('request.jwt.claim.role', 'authenticated', true) AS jwt_role,
  set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', submitter_auth_user_id::text,
      'role', 'authenticated'
    )::text,
    true
  ) AS jwt_claims
FROM smoke_timesheet_withdraw_target;

SELECT
  public.psa_timesheet_action(
    timesheet_id,
    'withdraw',
    'smoke-timesheet-withdraw rollback test',
    NULL::bigint
  ) AS withdraw_result
FROM smoke_timesheet_withdraw_target;

DO $$
DECLARE
  v_state record;
BEGIN
  SELECT
    t.status AS timesheet_status,
    bd.lifecycle_status AS business_document_status,
    (
      SELECT count(*)::int
      FROM public.approval_instances i
      WHERE i.target_type = 'timesheet'
        AND i.target_id = c.timesheet_id
        AND i.status = 'running'
    ) AS running_instances,
    (
      SELECT count(*)::int
      FROM public.approval_instances i
      WHERE i.target_type = 'timesheet'
        AND i.target_id = c.timesheet_id
        AND i.status = 'cancelled'
    ) AS cancelled_instances,
    (
      SELECT count(*)::int
      FROM public.approval_nodes n
      JOIN public.approval_instances i ON i.id = n.instance_id
      WHERE i.target_type = 'timesheet'
        AND i.target_id = c.timesheet_id
        AND n.status IN (
          'waiting', 'pending', 'active', 'waiting_revision',
          'revision_required', 'needs_revision', 'needs_reapproval'
        )
    ) AS open_nodes,
    (
      SELECT count(*)::int
      FROM public.approval_node_assignees a
      JOIN public.approval_nodes n ON n.id = a.node_id
      JOIN public.approval_instances i ON i.id = n.instance_id
      WHERE i.target_type = 'timesheet'
        AND i.target_id = c.timesheet_id
        AND a.status = 'pending'
    ) AS pending_assignees,
    (
      SELECT count(*)::int
      FROM public.approval_project_review_records_view v
      WHERE v.timesheet_id = c.timesheet_id
    ) AS project_review_rows
  INTO v_state
  FROM smoke_timesheet_withdraw_target c
  JOIN public.timesheets t ON t.id = c.timesheet_id
  JOIN public.business_documents bd ON bd.id = c.business_document_id;

  IF v_state.timesheet_status <> 'draft' THEN
    RAISE EXCEPTION 'Expected timesheet status draft after withdraw, got %', v_state.timesheet_status;
  END IF;

  IF v_state.business_document_status <> 'draft' THEN
    RAISE EXCEPTION 'Expected business document lifecycle_status draft after withdraw, got %', v_state.business_document_status;
  END IF;

  IF v_state.running_instances <> 0 THEN
    RAISE EXCEPTION 'Expected 0 running approval instances after withdraw, got %', v_state.running_instances;
  END IF;

  IF v_state.cancelled_instances <= 0 THEN
    RAISE EXCEPTION 'Expected at least 1 cancelled approval instance after withdraw, got %', v_state.cancelled_instances;
  END IF;

  IF v_state.open_nodes <> 0 THEN
    RAISE EXCEPTION 'Expected 0 open approval nodes after withdraw, got %', v_state.open_nodes;
  END IF;

  IF v_state.pending_assignees <> 0 THEN
    RAISE EXCEPTION 'Expected 0 pending approval node assignees after withdraw, got %', v_state.pending_assignees;
  END IF;

  IF v_state.project_review_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 approval_project_review_records_view rows after withdraw, got %', v_state.project_review_rows;
  END IF;
END $$;

\echo Withdraw assertions passed inside transaction. Current transactional state:
SELECT
  'after withdraw before rollback' AS phase,
  t.id AS timesheet_id,
  t.status AS timesheet_status,
  bd.lifecycle_status AS business_document_status,
  (
    SELECT count(*)::int
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND i.status = 'running'
  ) AS running_instances,
  (
    SELECT count(*)::int
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND i.status = 'cancelled'
  ) AS cancelled_instances,
  (
    SELECT count(*)::int
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND n.status IN (
        'waiting', 'pending', 'active', 'waiting_revision',
        'revision_required', 'needs_revision', 'needs_reapproval'
      )
  ) AS open_nodes,
  (
    SELECT count(*)::int
    FROM public.approval_node_assignees a
    JOIN public.approval_nodes n ON n.id = a.node_id
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND a.status = 'pending'
  ) AS pending_assignees,
  (
    SELECT count(*)::int
    FROM public.approval_project_review_records_view v
    WHERE v.timesheet_id = c.timesheet_id
  ) AS project_review_rows
FROM smoke_timesheet_withdraw_target c
JOIN public.timesheets t ON t.id = c.timesheet_id
JOIN public.business_documents bd ON bd.id = c.business_document_id;

ROLLBACK;

\echo Rollback complete. Persisted state for the selected target:
SELECT
  'after rollback' AS phase,
  t.id AS timesheet_id,
  t.status AS timesheet_status,
  bd.lifecycle_status AS business_document_status,
  (
    SELECT count(*)::int
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND i.status = 'running'
  ) AS running_instances,
  (
    SELECT count(*)::int
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND i.status = 'cancelled'
  ) AS cancelled_instances,
  (
    SELECT count(*)::int
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND n.status IN (
        'waiting', 'pending', 'active', 'waiting_revision',
        'revision_required', 'needs_revision', 'needs_reapproval'
      )
  ) AS open_nodes,
  (
    SELECT count(*)::int
    FROM public.approval_node_assignees a
    JOIN public.approval_nodes n ON n.id = a.node_id
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE i.target_type = 'timesheet'
      AND i.target_id = c.timesheet_id
      AND a.status = 'pending'
  ) AS pending_assignees,
  (
    SELECT count(*)::int
    FROM public.approval_project_review_records_view v
    WHERE v.timesheet_id = c.timesheet_id
  ) AS project_review_rows
FROM smoke_timesheet_withdraw_target c
JOIN public.timesheets t ON t.id = c.timesheet_id
JOIN public.business_documents bd ON bd.id = c.business_document_id;
