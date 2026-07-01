\set ON_ERROR_STOP on
\pset pager off
\pset format aligned

BEGIN;

DO $$
DECLARE
  v_employee_id bigint := 990000001;
  v_employee_id_fail bigint := 990000002;
  v_event_id uuid;
  v_fail_event_id uuid;
  v_result jsonb;
  v_count integer;
BEGIN
  DELETE FROM public.nas_sync_events WHERE employee_id IN (v_employee_id, v_employee_id_fail);
  DELETE FROM public.employees WHERE id IN (v_employee_id, v_employee_id_fail);

  INSERT INTO public.employees(id, employee_no, auth_user_id, name, is_active)
  VALUES (v_employee_id, 'NSYNC990001', gen_random_uuid(), 'NAS同步测试员工', true);

  SELECT count(*)
  INTO v_count
  FROM public.nas_sync_events
  WHERE employee_id = v_employee_id
    AND event_type = 'employee.created'
    AND status = 'pending';

  SELECT id
  INTO v_event_id
  FROM public.nas_sync_events
  WHERE employee_id = v_employee_id
    AND event_type = 'employee.created'
    AND status = 'pending'
  LIMIT 1;

  IF v_count <> 1 OR v_event_id IS NULL THEN
    RAISE EXCEPTION 'Expected one pending employee.created event, got %', v_count;
  END IF;

  INSERT INTO public.nas_sync_events(employee_id, employee_name, event_type)
  VALUES (v_employee_id, 'NAS同步测试员工', 'employee.created')
  ON CONFLICT ON CONSTRAINT nas_sync_events_employee_event_key DO NOTHING;

  SELECT count(*) INTO v_count
  FROM public.nas_sync_events
  WHERE employee_id = v_employee_id
    AND event_type = 'employee.created';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected unique employee/event queue row, got %', v_count;
  END IF;

  v_result := public.psa_nas_sync_claim_event(v_event_id, repeat('a', 64), 300);
  IF v_result ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'First claim should succeed: %', v_result;
  END IF;

  v_result := public.psa_nas_sync_claim_event(v_event_id, repeat('b', 64), 300);
  IF v_result ->> 'ok' <> 'false' OR v_result ->> 'code' <> 'conflict' THEN
    RAISE EXCEPTION 'Second claim should return conflict: %', v_result;
  END IF;

  v_result := public.psa_nas_sync_complete_event(v_event_id, repeat('c', 64), 'NAS同步测试员工');
  IF v_result ->> 'ok' <> 'false' OR v_result ->> 'code' <> 'conflict' THEN
    RAISE EXCEPTION 'Complete with wrong claim should return conflict: %', v_result;
  END IF;

  v_result := public.psa_nas_sync_complete_event(v_event_id, repeat('a', 64), 'NAS同步测试员工');
  IF v_result ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'Complete with correct claim should succeed: %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.nas_sync_events
    WHERE id = v_event_id
      AND status = 'completed'
      AND nas_username = 'NAS同步测试员工'
      AND completed_at IS NOT NULL
      AND claim_token_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'Completed event persisted unexpected state';
  END IF;

  INSERT INTO public.employees(id, employee_no, auth_user_id, name, is_active)
  VALUES (v_employee_id_fail, 'NSYNC990002', gen_random_uuid(), 'NAS同步失败测试员工', true);

  SELECT id INTO v_fail_event_id
  FROM public.nas_sync_events
  WHERE employee_id = v_employee_id_fail
    AND event_type = 'employee.created';

  v_result := public.psa_nas_sync_claim_event(v_fail_event_id, repeat('d', 64), 300);
  IF v_result ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'Fail-path claim should succeed: %', v_result;
  END IF;

  v_result := public.psa_nas_sync_fail_event(v_fail_event_id, repeat('e', 64), 'wrong claim');
  IF v_result ->> 'ok' <> 'false' OR v_result ->> 'code' <> 'conflict' THEN
    RAISE EXCEPTION 'Fail with wrong claim should return conflict: %', v_result;
  END IF;

  v_result := public.psa_nas_sync_fail_event(v_fail_event_id, repeat('d', 64), 'NAS timeout');
  IF v_result ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'Fail with correct claim should succeed: %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.nas_sync_events
    WHERE id = v_fail_event_id
      AND status = 'pending'
      AND attempts = 1
      AND last_error = 'NAS timeout'
      AND claim_token_hash IS NULL
  ) THEN
    RAISE EXCEPTION 'Failed attempt should return to pending before max attempts';
  END IF;

  UPDATE public.nas_sync_events
  SET status = 'processing',
      attempts = 5,
      claim_token_hash = repeat('f', 64),
      claim_expires_at = now() + interval '5 minutes'
  WHERE id = v_fail_event_id;

  v_result := public.psa_nas_sync_fail_event(v_fail_event_id, repeat('f', 64), 'NAS unavailable');
  IF v_result ->> 'ok' <> 'true' THEN
    RAISE EXCEPTION 'Final fail should succeed: %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.nas_sync_events
    WHERE id = v_fail_event_id
      AND status = 'failed'
      AND attempts = 5
      AND last_error = 'NAS unavailable'
  ) THEN
    RAISE EXCEPTION 'Fifth failed attempt should enter failed status';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public'
      AND routine_name IN (
        'psa_nas_sync_claim_event',
        'psa_nas_sync_complete_event',
        'psa_nas_sync_fail_event'
      )
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
      AND privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'NAS sync RPCs must not be executable by PUBLIC, anon, or authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'nas_sync_events'
  ) THEN
    RAISE EXCEPTION 'nas_sync_events must be in supabase_realtime publication';
  END IF;
END $$;

ROLLBACK;

\echo NAS sync event assertions passed.
