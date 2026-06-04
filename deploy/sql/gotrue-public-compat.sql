DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('auth.schema_migrations') IS NOT NULL
     AND to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO auth.schema_migrations (version)
    SELECT p.version::text
    FROM public.schema_migrations p
    WHERE NOT EXISTS (
      SELECT 1
      FROM auth.schema_migrations a
      WHERE a.version::text = p.version::text
    );
  END IF;

  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'auth'
      AND table_type = 'BASE TABLE'
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.tables p
        WHERE p.table_schema = 'public'
          AND p.table_name = information_schema.tables.table_name
      )
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I', r.table_name);
    EXECUTE format('CREATE VIEW public.%I AS SELECT * FROM auth.%I', r.table_name, r.table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO psa_admin', r.table_name);
  END LOOP;
END $$;
