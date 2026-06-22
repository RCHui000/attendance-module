\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_default text;
  v_max_id bigint;
  v_seq_last bigint;
  v_seq_called boolean;
  v_next_candidate bigint;
  v_user_id bigint;
  v_inserted_id bigint;
BEGIN
  SELECT column_default
    INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'timesheets'
     AND column_name = 'id';

  IF v_default IS NULL OR v_default NOT LIKE '%timesheets_id_seq%' THEN
    RAISE EXCEPTION 'timesheets.id default is not backed by timesheets_id_seq: %', v_default;
  END IF;

  IF pg_get_serial_sequence('public.timesheets', 'id') IS DISTINCT FROM 'public.timesheets_id_seq' THEN
    RAISE EXCEPTION 'timesheets_id_seq is not owned by timesheets.id';
  END IF;

  SELECT COALESCE(MAX(id), 0) INTO v_max_id FROM public.timesheets;
  SELECT last_value, is_called INTO v_seq_last, v_seq_called FROM public.timesheets_id_seq;
  v_next_candidate := CASE WHEN v_seq_called THEN v_seq_last + 1 ELSE v_seq_last END;

  IF v_next_candidate <= v_max_id THEN
    RAISE EXCEPTION 'timesheets_id_seq next value % is not ahead of max id %', v_next_candidate, v_max_id;
  END IF;

  SELECT id INTO v_user_id
    FROM public.employees
   WHERE is_active IS DISTINCT FROM false
   ORDER BY id
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No active employee available for timesheet insert smoke';
  END IF;

  INSERT INTO public.timesheets(user_id, week_start_date)
  VALUES (v_user_id, DATE '2099-01-05')
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id <= v_max_id THEN
    RAISE EXCEPTION 'Inserted timesheet id % did not advance beyond previous max id %', v_inserted_id, v_max_id;
  END IF;
END $$;

ROLLBACK;

SELECT 'PASS: timesheets.id uses a safe database sequence default' AS result;
