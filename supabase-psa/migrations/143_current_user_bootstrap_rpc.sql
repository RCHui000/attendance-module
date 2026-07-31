BEGIN;

CREATE OR REPLACE FUNCTION public.psa_current_user_bootstrap()
RETURNS TABLE (
  id bigint,
  name text,
  role text,
  department text,
  is_active boolean,
  permissions jsonb,
  sidebar_order jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH actor AS (
    SELECT
      e.id,
      e.name,
      COALESCE(role_row.role, 'employee') AS role,
      COALESCE(o.org_name, '') AS department,
      COALESCE(e.is_active, true) AS is_active
    FROM public.employees e
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN LATERAL (
      SELECT ur.role
      FROM public.user_roles ur
      LEFT JOIN public.permission_roles pr ON pr.role_key = ur.role
      WHERE ur.employee_id = e.id
      ORDER BY COALESCE(pr.sort_order, 0) DESC, ur.role DESC
      LIMIT 1
    ) role_row ON true
    WHERE e.auth_user_id = auth.uid()
      AND COALESCE(e.is_active, true) = true
      AND lower(COALESCE(ep.employment_status, 'active')) NOT IN (
        'terminated', 'inactive', 'resigned', '离职', '已离职'
      )
    LIMIT 1
  )
  SELECT
    actor.id,
    actor.name,
    actor.role,
    actor.department,
    actor.is_active,
    COALESCE(
      (
        SELECT jsonb_object_agg(rp.resource_key, COALESCE(rp.access_level, 'none') ORDER BY rp.resource_key)
        FROM public.role_permissions rp
        WHERE rp.role_key = actor.role
      ),
      '{}'::jsonb
    ) AS permissions,
    COALESCE(
      (
        SELECT jsonb_object_agg(
          rp.resource_key,
          COALESCE(rp.sidebar_order, resource.sort_order, 0)
          ORDER BY resource.sort_order, rp.resource_key
        )
        FROM public.role_permissions rp
        JOIN public.permission_resources resource
          ON resource.resource_key = rp.resource_key
         AND resource.resource_group = 'sidebar'
         AND resource.is_active = true
        WHERE rp.role_key = actor.role
      ),
      '{}'::jsonb
    ) AS sidebar_order
  FROM actor;
$$;

ALTER FUNCTION public.psa_current_user_bootstrap() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_current_user_bootstrap() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_current_user_bootstrap() TO authenticated;

COMMENT ON FUNCTION public.psa_current_user_bootstrap() IS
  'Returns the active authenticated employee identity, permissions, and sidebar order in one request.';

NOTIFY pgrst, 'reload schema';

COMMIT;
