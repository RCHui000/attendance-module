BEGIN;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT e.id
  FROM public.employees e
  LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
  WHERE e.auth_user_id = auth.uid()
    AND COALESCE(e.is_active, true) = true
    AND lower(COALESCE(ep.employment_status, 'active')) NOT IN ('terminated', 'inactive', 'resigned', '离职', '已离职')
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_user_has_role(role_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.employees e ON e.id = ur.employee_id
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
    WHERE e.auth_user_id = auth.uid()
      AND COALESCE(e.is_active, true) = true
      AND lower(COALESCE(ep.employment_status, 'active')) NOT IN ('terminated', 'inactive', 'resigned', '离职', '已离职')
      AND ur.role = role_name
  )
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_access_resource(
  p_resource_key text,
  p_min_access text DEFAULT 'read'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH levels AS (
    SELECT 'none'::text AS access_level, 0 AS rank
    UNION ALL SELECT 'read', 1
    UNION ALL SELECT 'write', 2
  ),
  needed AS (
    SELECT rank FROM levels WHERE access_level = COALESCE(NULLIF(p_min_access, ''), 'read')
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.employees e ON e.id = ur.employee_id
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
    JOIN public.role_permissions rp ON rp.role_key = ur.role
    JOIN levels have ON have.access_level = rp.access_level
    CROSS JOIN needed
    WHERE e.auth_user_id = auth.uid()
      AND COALESCE(e.is_active, true) = true
      AND lower(COALESCE(ep.employment_status, 'active')) NOT IN ('terminated', 'inactive', 'resigned', '离职', '已离职')
      AND rp.resource_key = p_resource_key
      AND have.rank >= needed.rank
  );
$$;

REVOKE ALL ON FUNCTION public.current_employee_id() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_has_role(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_can_access_resource(text, text) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_resource(text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
