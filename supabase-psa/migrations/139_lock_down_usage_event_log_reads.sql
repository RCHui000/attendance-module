-- V0.16.53: keep usage logs write-only from the app surface.

DROP POLICY IF EXISTS "Managers read usage logs" ON public.usage_event_logs;

REVOKE SELECT ON public.usage_event_logs FROM authenticated;
REVOKE SELECT ON public.usage_event_logs FROM anon;

GRANT INSERT ON public.usage_event_logs TO authenticated;
GRANT ALL ON public.usage_event_logs TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT ALL ON public.usage_event_logs TO postgres;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
