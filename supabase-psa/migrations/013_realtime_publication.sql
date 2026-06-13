-- V0.12.2: enable Supabase Realtime publication for LAN testing.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER TABLE timesheets REPLICA IDENTITY FULL;
ALTER TABLE timesheet_entries REPLICA IDENTITY FULL;
ALTER TABLE overtime_entries REPLICA IDENTITY FULL;
ALTER TABLE workflow_tasks REPLICA IDENTITY FULL;
ALTER TABLE projects REPLICA IDENTITY FULL;
ALTER TABLE employees REPLICA IDENTITY FULL;
ALTER TABLE employee_profiles REPLICA IDENTITY FULL;
ALTER TABLE organizations REPLICA IDENTITY FULL;
ALTER TABLE user_roles REPLICA IDENTITY FULL;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'timesheets',
    'timesheet_entries',
    'overtime_entries',
    'workflow_tasks',
    'projects',
    'employees',
    'employee_profiles',
    'organizations',
    'user_roles'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', table_name);
    END IF;
  END LOOP;
END $$;

COMMIT;
