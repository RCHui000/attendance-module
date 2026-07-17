-- V0.16.54: restrict app-facing usage log access to inserts only.

REVOKE ALL ON public.usage_event_logs FROM authenticated;
REVOKE ALL ON public.usage_event_logs FROM anon;

GRANT INSERT ON public.usage_event_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.usage_event_logs_id_seq TO authenticated;

GRANT ALL ON public.usage_event_logs TO service_role;
GRANT ALL ON SEQUENCE public.usage_event_logs_id_seq TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT ALL ON public.usage_event_logs TO postgres;
    GRANT ALL ON SEQUENCE public.usage_event_logs_id_seq TO postgres;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
