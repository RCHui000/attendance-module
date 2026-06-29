-- Rollback-only smoke test for the NAS sync event queue.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/smoke-nas-sync-events.sql

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

DO $$
DECLARE
  v_employee_id BIGINT;
  v_event_id UUID;
  v_claimed_id UUID;
  v_ok BOOLEAN;
  v_status TEXT;
  i INTEGER;
BEGIN
  SELECT COALESCE(MAX(id), 0) + 1000000
  INTO v_employee_id
  FROM public.employees;

  INSERT INTO public.employees (id, employee_no, name, is_active)
  VALUES (
    v_employee_id,
    'NAS-SMOKE-' || v_employee_id::text,
    'NAS同步冒烟测试',
    true
  );

  SELECT id
  INTO v_event_id
  FROM public.nas_sync_events
  WHERE employee_id = v_employee_id
    AND event_type = 'employee.created'
    AND status = 'pending';

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Expected active employee insert to enqueue a pending NAS sync event';
  END IF;

  INSERT INTO public.nas_sync_events (employee_id, employee_name, event_type)
  VALUES (v_employee_id, 'NAS同步冒烟测试', 'employee.created')
  ON CONFLICT (employee_id, event_type) DO NOTHING;

  IF (
    SELECT COUNT(*)
    FROM public.nas_sync_events
    WHERE employee_id = v_employee_id
      AND event_type = 'employee.created'
  ) <> 1 THEN
    RAISE EXCEPTION 'Expected duplicate NAS sync event enqueue to be idempotent';
  END IF;

  SELECT c.id
  INTO v_claimed_id
  FROM public.psa_nas_sync_claim_event(v_event_id, 'claim-1') c;

  IF v_claimed_id IS DISTINCT FROM v_event_id THEN
    RAISE EXCEPTION 'Expected claim to return the claimed event';
  END IF;

  SELECT public.psa_nas_sync_fail_event(v_event_id, 'wrong-token', 'wrong token should fail')
  INTO v_ok;

  IF v_ok THEN
    RAISE EXCEPTION 'Expected wrong claim token to be rejected';
  END IF;

  SELECT public.psa_nas_sync_fail_event(v_event_id, 'claim-1', 'first failure')
  INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Expected correct claim token to record failure';
  END IF;

  FOR i IN 2..5 LOOP
    SELECT c.id
    INTO v_claimed_id
    FROM public.psa_nas_sync_claim_event(v_event_id, 'claim-' || i::text) c;

    IF v_claimed_id IS DISTINCT FROM v_event_id THEN
      RAISE EXCEPTION 'Expected retry claim % to succeed', i;
    END IF;

    SELECT public.psa_nas_sync_fail_event(v_event_id, 'claim-' || i::text, 'retry failure')
    INTO v_ok;

    IF NOT v_ok THEN
      RAISE EXCEPTION 'Expected retry failure % to be accepted', i;
    END IF;
  END LOOP;

  SELECT status
  INTO v_status
  FROM public.nas_sync_events
  WHERE id = v_event_id;

  IF v_status <> 'failed' THEN
    RAISE EXCEPTION 'Expected event to become failed after five attempts, got %', v_status;
  END IF;
END $$;

ROLLBACK;

\echo NAS sync rollback smoke passed.
