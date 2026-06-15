-- Role-specific sidebar ordering for the configurable RBAC matrix.

ALTER TABLE public.role_permissions
  ADD COLUMN IF NOT EXISTS sidebar_order INTEGER;

WITH default_sidebar(resource_key, sidebar_order) AS (
  VALUES
    ('dashboard', 10),
    ('review', 20),
    ('timesheet', 30),
    ('leave', 40),
    ('report', 50),
    ('system_management', 60),
    ('apps', 70)
)
UPDATE public.permission_resources pr
SET sort_order = ds.sidebar_order
FROM default_sidebar ds
WHERE pr.resource_key = ds.resource_key
  AND pr.resource_group = 'sidebar';

WITH default_sidebar(resource_key, sidebar_order) AS (
  VALUES
    ('dashboard', 10),
    ('review', 20),
    ('timesheet', 30),
    ('leave', 40),
    ('report', 50),
    ('system_management', 60),
    ('apps', 70)
)
UPDATE public.role_permissions rp
SET sidebar_order = ds.sidebar_order
FROM default_sidebar ds
JOIN public.permission_resources pr
  ON pr.resource_key = ds.resource_key
 AND pr.resource_group = 'sidebar'
WHERE rp.resource_key = ds.resource_key
  AND rp.sidebar_order IS NULL;

CREATE OR REPLACE FUNCTION public.psa_save_role_sidebar_order(
  p_role_key TEXT,
  p_resource_key TEXT,
  p_sidebar_order INTEGER
)
RETURNS TABLE(role_key TEXT, resource_key TEXT, sidebar_order INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_can_access_resource('permission_config', 'write') THEN
    RAISE EXCEPTION 'Permission config write access is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_sidebar_order IS NULL OR p_sidebar_order < 0 THEN
    RAISE EXCEPTION 'Invalid sidebar order: %', p_sidebar_order
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
    WHERE res.resource_key = p_resource_key
      AND res.resource_group = 'sidebar'
      AND res.is_active
  ) THEN
    RAISE EXCEPTION 'Unknown sidebar permission resource: %', p_resource_key
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.role_permissions(role_key, resource_key, access_level, sidebar_order, updated_at)
  VALUES (p_role_key, p_resource_key, 'none', p_sidebar_order, NOW())
  ON CONFLICT ON CONSTRAINT role_permissions_pkey DO UPDATE
  SET sidebar_order = EXCLUDED.sidebar_order,
      updated_at = NOW();

  RETURN QUERY
  SELECT rp.role_key, rp.resource_key, rp.sidebar_order
  FROM public.role_permissions rp
  WHERE rp.role_key = p_role_key
    AND rp.resource_key = p_resource_key;
END;
$$;

ALTER FUNCTION public.psa_save_role_sidebar_order(TEXT, TEXT, INTEGER) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.psa_save_role_sidebar_order(TEXT, TEXT, INTEGER) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
