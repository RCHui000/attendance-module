-- V0.15: include login profiles in system management RBAC writes.

BEGIN;

GRANT SELECT ON public.profiles TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role, postgres;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

DROP POLICY IF EXISTS "RBAC read profiles" ON public.profiles;
CREATE POLICY "RBAC read profiles" ON public.profiles
  FOR SELECT
  USING (
    auth_user_id = auth.uid()
    OR public.current_user_can_access_resource('system_management', 'read')
  );

DROP POLICY IF EXISTS "RBAC write profiles" ON public.profiles;
CREATE POLICY "RBAC write profiles" ON public.profiles
  FOR ALL
  USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

NOTIFY pgrst, 'reload schema';

COMMIT;
