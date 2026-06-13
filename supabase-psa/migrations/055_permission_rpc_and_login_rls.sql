-- V0.15: stabilize RBAC writes and keep login identity resolution readable.

GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT SELECT ON public.employees TO authenticated, anon;
GRANT SELECT ON public.employee_profiles TO authenticated, anon;
GRANT SELECT ON public.organizations TO authenticated, anon;

DROP POLICY IF EXISTS "Self read employee by auth uid" ON public.employees;
CREATE POLICY "Self read employee by auth uid" ON public.employees
  FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "RBAC write role permissions" ON public.role_permissions;
CREATE POLICY "RBAC write role permissions" ON public.role_permissions
  FOR ALL USING (public.current_user_can_access_resource('permission_config', 'write'))
  WITH CHECK (public.current_user_can_access_resource('permission_config', 'write'));

CREATE OR REPLACE FUNCTION public.psa_save_role_permission(
  p_role_key TEXT,
  p_resource_key TEXT,
  p_access_level TEXT
)
RETURNS TABLE(role_key TEXT, resource_key TEXT, access_level TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_can_access_resource('permission_config', 'write') THEN
    RAISE EXCEPTION 'Permission config write access is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_access_level NOT IN ('none', 'read', 'write') THEN
    RAISE EXCEPTION 'Invalid permission access level: %', p_access_level
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permission_roles pr
    WHERE pr.role_key = p_role_key AND pr.is_active
  ) THEN
    RAISE EXCEPTION 'Unknown permission role: %', p_role_key
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permission_resources res
    WHERE res.resource_key = p_resource_key AND res.is_active
  ) THEN
    RAISE EXCEPTION 'Unknown permission resource: %', p_resource_key
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.role_permissions(role_key, resource_key, access_level, updated_at)
  VALUES (p_role_key, p_resource_key, p_access_level, NOW())
  ON CONFLICT ON CONSTRAINT role_permissions_pkey DO UPDATE
  SET access_level = EXCLUDED.access_level,
      updated_at = NOW();

  RETURN QUERY
  SELECT rp.role_key, rp.resource_key, rp.access_level
  FROM public.role_permissions rp
  WHERE rp.role_key = p_role_key
    AND rp.resource_key = p_resource_key;
END;
$$;

ALTER FUNCTION public.psa_save_role_permission(TEXT, TEXT, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.psa_save_role_permission(TEXT, TEXT, TEXT) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
