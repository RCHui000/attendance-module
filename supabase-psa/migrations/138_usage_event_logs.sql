-- V0.16.52: lightweight usage logs for department-owner logins and app-center opens.

CREATE TABLE IF NOT EXISTS public.usage_event_logs (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('department_owner_login', 'app_center_open')),
  actor_employee_id BIGINT REFERENCES public.employees(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  app_center_item_id BIGINT REFERENCES public.app_center_items(id) ON DELETE SET NULL,
  app_name TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_usage_event_logs_occurred_at
  ON public.usage_event_logs(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_event_logs_event_time
  ON public.usage_event_logs(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_event_logs_actor_time
  ON public.usage_event_logs(actor_employee_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_event_logs_app_time
  ON public.usage_event_logs(app_center_item_id, occurred_at DESC)
  WHERE app_center_item_id IS NOT NULL;

ALTER TABLE public.usage_event_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own usage logs" ON public.usage_event_logs;
CREATE POLICY "Users insert own usage logs"
  ON public.usage_event_logs FOR INSERT TO authenticated
  WITH CHECK (
    actor_employee_id = public.current_employee_id()
    AND COALESCE(actor_name, '') <> ''
    AND (
      event_type = 'app_center_open'
      OR (
        event_type = 'department_owner_login'
        AND EXISTS (
          SELECT 1
          FROM public.organization_managers om
          WHERE om.employee_id = actor_employee_id
            AND om.manager_role = 'department_owner'
            AND om.is_active = TRUE
        )
      )
    )
    AND (
      event_type <> 'app_center_open'
      OR app_center_item_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.app_center_items app
        WHERE app.id = app_center_item_id
          AND app.is_active = TRUE
      )
    )
  );

DROP POLICY IF EXISTS "Managers read usage logs" ON public.usage_event_logs;
CREATE POLICY "Managers read usage logs"
  ON public.usage_event_logs FOR SELECT TO authenticated
  USING (
    public.current_user_can_access_resource('system_management', 'read')
    OR public.current_user_can_access_resource('apps', 'write')
  );

GRANT SELECT, INSERT ON public.usage_event_logs TO authenticated;
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
