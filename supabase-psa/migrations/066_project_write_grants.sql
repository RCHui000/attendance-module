-- V0.15.2 Beta1 hotfix: normalize table grants for project editing.
-- RLS policies decide who may write; these grants let authenticated users
-- reach those policies consistently across cloud and NAS deployments.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_department_owners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_roles TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.projects_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.project_department_owners_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.project_roles_id_seq TO authenticated;

NOTIFY pgrst, 'reload schema';
