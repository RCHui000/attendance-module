-- Restore runtime grants required by PostgREST after dump/restore deployments.
-- RLS still defines row-level access; these grants only allow authenticated
-- requests to reach the policies/functions they are supposed to use.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

GRANT SELECT ON public.employees TO anon;
GRANT SELECT ON public.employee_profiles TO anon;
GRANT SELECT ON public.organizations TO anon;
GRANT SELECT ON public.profiles TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.psa_resolve_login_email(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_resource(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_review() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
