-- Publish approval graph tables used by frontend realtime invalidation.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'timesheets',
    'timesheet_entries',
    'overtime_entries',
    'approval_nodes',
    'approval_node_assignees',
    'approval_events',
    'approval_instances',
    'timesheet_project_reviews',
    'projects',
    'project_department_owners',
    'employees',
    'employee_profiles',
    'organizations',
    'user_roles'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = v_table_name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table_name);

      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = v_table_name
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
      END IF;
    END IF;
  END LOOP;
END $$;

COMMIT;
