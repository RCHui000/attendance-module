\set ON_ERROR_STOP on

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.usage_event_logs', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated must not be able to read usage_event_logs';
  END IF;

  IF has_table_privilege('authenticated', 'public.usage_event_logs', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.usage_event_logs', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated usage_event_logs access must be insert-only';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.usage_event_logs', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated must be able to insert usage_event_logs through RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'usage_event_logs'
      AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'usage_event_logs must not expose an authenticated SELECT policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'usage_event_logs'
      AND policyname = 'Users insert own usage logs'
      AND cmd = 'INSERT'
      AND roles = ARRAY['authenticated']::name[]
      AND with_check LIKE '%current_employee_id%'
      AND with_check LIKE '%organization_managers%'
      AND with_check LIKE '%app_center_items%'
  ) THEN
    RAISE EXCEPTION 'usage_event_logs insert policy is missing actor/app integrity checks';
  END IF;
END
$$;

SELECT 'usage event log access assertions passed' AS result;
