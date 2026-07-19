-- V0.19.0: keep operational usage events write-only and bind labels to server data.

DROP POLICY IF EXISTS "Users insert own usage logs" ON public.usage_event_logs;
CREATE POLICY "Users insert own usage logs"
  ON public.usage_event_logs FOR INSERT TO authenticated
  WITH CHECK (
    actor_employee_id = public.current_employee_id()
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = actor_employee_id
        AND employee.is_active = TRUE
        AND employee.name = actor_name
    )
    AND (
      (
        event_type = 'department_owner_login'
        AND app_center_item_id IS NULL
        AND app_name = ''
        AND metadata = '{}'::jsonb
        AND EXISTS (
          SELECT 1
          FROM public.organization_managers manager
          WHERE manager.employee_id = actor_employee_id
            AND manager.manager_role = 'department_owner'
            AND manager.is_active = TRUE
        )
      )
      OR
      (
        event_type = 'app_center_open'
        AND EXISTS (
          SELECT 1
          FROM public.app_center_items app
          WHERE app.id = app_center_item_id
            AND app.is_active = TRUE
            AND app.name = app_name
            AND metadata = jsonb_build_object(
              'app_key', COALESCE(app.app_key, ''),
              'is_internal', app.is_internal
            )
        )
      )
    )
  );

REVOKE ALL ON public.usage_event_logs FROM authenticated;
REVOKE ALL ON public.usage_event_logs FROM anon;
GRANT INSERT ON public.usage_event_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.usage_event_logs_id_seq TO authenticated;

NOTIFY pgrst, 'reload schema';
