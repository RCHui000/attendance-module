-- V0.18.14: Revoke default PUBLIC EXECUTE from project platform role sync.

BEGIN;

REVOKE ALL ON FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
