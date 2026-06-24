-- V0.18.15: Keep project platform role sync as an internal/system function.

BEGIN;

REVOKE ALL ON FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
