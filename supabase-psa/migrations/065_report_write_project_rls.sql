-- V0.15.2 Beta1 hotfix: align project editing RLS with platform RBAC.
-- The project list is guarded by the "report" resource in the frontend.
-- Users with report=write must be able to update projects and the related
-- project owner/role mapping rows written by the same save flow.

DROP POLICY IF EXISTS "RBAC write projects" ON public.projects;
CREATE POLICY "RBAC write projects" ON public.projects
  FOR ALL TO authenticated
  USING (public.current_user_can_access_resource('report', 'write'))
  WITH CHECK (public.current_user_can_access_resource('report', 'write'));

DROP POLICY IF EXISTS "RBAC write project department owners" ON public.project_department_owners;
CREATE POLICY "RBAC write project department owners" ON public.project_department_owners
  FOR ALL TO authenticated
  USING (public.current_user_can_access_resource('report', 'write'))
  WITH CHECK (public.current_user_can_access_resource('report', 'write'));

DROP POLICY IF EXISTS "RBAC write project roles" ON public.project_roles;
CREATE POLICY "RBAC write project roles" ON public.project_roles
  FOR ALL TO authenticated
  USING (public.current_user_can_access_resource('report', 'write'))
  WITH CHECK (public.current_user_can_access_resource('report', 'write'));

NOTIFY pgrst, 'reload schema';
