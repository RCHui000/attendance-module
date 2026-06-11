-- V0.13: Publish new approval routing tables for realtime invalidation.

BEGIN;

ALTER TABLE public.project_department_owners REPLICA IDENTITY FULL;
ALTER TABLE public.timesheet_project_reviews REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'project_department_owners'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.project_department_owners;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'timesheet_project_reviews'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.timesheet_project_reviews;
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
