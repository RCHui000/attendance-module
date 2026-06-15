-- V0.15.2 Beta1 hotfix: resolve login aliases through a narrow Supabase RPC.
-- Anonymous users cannot read profiles/employees under RLS, so the frontend
-- must not query those tables directly before authentication.

CREATE OR REPLACE FUNCTION public.psa_resolve_login_email(p_login TEXT)
RETURNS TABLE (
  auth_email TEXT,
  auth_user_id UUID,
  is_active BOOLEAN,
  employment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_login TEXT := btrim(COALESCE(p_login, ''));
BEGIN
  IF v_login = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.auth_email,
    p.auth_user_id,
    COALESCE(p.is_active, TRUE) AND COALESCE(e.is_active, TRUE) AS is_active,
    COALESCE(ep.employment_status, 'active')::TEXT AS employment_status
  FROM public.profiles p
  LEFT JOIN public.employees e ON e.auth_user_id = p.auth_user_id
  LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
  WHERE lower(p.auth_email) = lower(v_login)
     OR lower(p.login_name) = lower(v_login)
     OR p.display_name = v_login
     OR lower(e.employee_no) = lower(v_login)
     OR e.name = v_login
  ORDER BY
    CASE
      WHEN lower(p.auth_email) = lower(v_login) THEN 1
      WHEN lower(p.login_name) = lower(v_login) THEN 2
      WHEN lower(e.employee_no) = lower(v_login) THEN 3
      WHEN p.display_name = v_login THEN 4
      WHEN e.name = v_login THEN 5
      ELSE 9
    END,
    e.id NULLS LAST
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.psa_resolve_login_email(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
