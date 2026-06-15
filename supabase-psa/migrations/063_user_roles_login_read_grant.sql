-- V0.15.2 Beta1: allow the Supabase/PostgREST login bootstrap path to read user roles.

GRANT SELECT ON public.user_roles TO authenticated;

DROP POLICY IF EXISTS "RBAC read user roles" ON public.user_roles;
CREATE POLICY "RBAC read user roles" ON public.user_roles
  FOR SELECT USING (
    employee_id = public.current_employee_id()
    OR public.current_user_can_access_resource('system_management', 'read')
    OR public.current_user_can_access_resource('permission_config', 'read')
  );

NOTIFY pgrst, 'reload schema';
