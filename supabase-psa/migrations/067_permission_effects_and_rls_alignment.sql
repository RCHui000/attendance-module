-- V0.15.2 Beta1: make permission configuration map to substantive DB access.
-- This migration documents each resource's effective data surface and aligns
-- broad/legacy RLS policies with the same resource checks used by the UI.

CREATE TABLE IF NOT EXISTS public.permission_resource_effects (
  resource_key TEXT NOT NULL REFERENCES public.permission_resources(resource_key) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('read', 'write')),
  object_type TEXT NOT NULL CHECK (object_type IN ('route', 'table', 'rpc', 'realtime')),
  object_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resource_key, access_level, object_type, object_name, operation)
);

INSERT INTO public.permission_resource_effects(resource_key, access_level, object_type, object_name, operation, description)
VALUES
  ('timesheet', 'read', 'route', '/timesheet', 'view', 'Open personal timesheet page.'),
  ('timesheet', 'read', 'table', 'timesheets', 'select_own', 'Read own timesheets.'),
  ('timesheet', 'read', 'table', 'timesheet_entries', 'select_own', 'Read own regular work entries.'),
  ('timesheet', 'read', 'table', 'overtime_entries', 'select_own', 'Read own overtime entries.'),
  ('timesheet', 'write', 'rpc', 'psa_timesheet_action', 'submit_reopen_own', 'Submit or reopen own timesheets.'),
  ('timesheet', 'write', 'table', 'timesheets', 'insert_update_own_draft', 'Create/update own draft timesheets.'),
  ('timesheet', 'write', 'table', 'timesheet_entries', 'insert_delete_own_draft', 'Save own regular work entries.'),
  ('timesheet', 'write', 'table', 'overtime_entries', 'insert_delete_own_draft', 'Save own overtime entries.'),

  ('review', 'read', 'route', '/review', 'view', 'Open approval center.'),
  ('review', 'read', 'table', 'timesheets', 'select_review_scope', 'Read timesheets in approval scope.'),
  ('review', 'read', 'table', 'timesheet_entries', 'select_review_scope', 'Read entries in approval scope.'),
  ('review', 'read', 'table', 'overtime_entries', 'select_review_scope', 'Read overtime entries in approval scope.'),
  ('review', 'write', 'rpc', 'psa_timesheet_action', 'approve_reject', 'Approve or reject timesheets.'),
  ('review', 'write', 'rpc', 'psa_overtime_action', 'approve_reject', 'Approve or reject overtime.'),
  ('review', 'write', 'table', 'approval_logs', 'insert', 'Record approval decisions.'),

  ('report', 'read', 'route', '/report', 'view', 'Open project list.'),
  ('report', 'read', 'table', 'projects', 'select', 'Read projects.'),
  ('report', 'read', 'table', 'project_roles', 'select', 'Read project role assignments.'),
  ('report', 'read', 'table', 'project_department_owners', 'select', 'Read project department owners.'),
  ('report', 'read', 'table', 'timesheets', 'select_report_scope', 'Read approved/reportable timesheets for project reporting.'),
  ('report', 'read', 'table', 'timesheet_entries', 'select_report_scope', 'Read approved/reportable entries for project reporting.'),
  ('report', 'write', 'table', 'projects', 'insert_update_delete', 'Create/update/delete projects.'),
  ('report', 'write', 'table', 'project_roles', 'insert_update_delete', 'Maintain project role assignments.'),
  ('report', 'write', 'table', 'project_department_owners', 'insert_update_delete', 'Maintain project department owners.'),

  ('dashboard', 'read', 'route', '/dashboard', 'view', 'Open dashboard.'),
  ('dashboard', 'read', 'table', 'projects', 'select', 'Read project metrics.'),
  ('dashboard', 'read', 'table', 'timesheets', 'select_dashboard_scope', 'Read reportable timesheet status for dashboard.'),
  ('dashboard', 'read', 'table', 'timesheet_entries', 'select_dashboard_scope', 'Read reportable entries for dashboard.'),

  ('system_management', 'read', 'route', '/employees', 'view_employee_org', 'Open employee and organization pages.'),
  ('system_management', 'read', 'table', 'employees', 'select', 'Read employee records.'),
  ('system_management', 'read', 'table', 'employee_profiles', 'select', 'Read employee profile records.'),
  ('system_management', 'read', 'table', 'employee_contracts', 'select', 'Read contract records.'),
  ('system_management', 'read', 'table', 'employee_salary_profiles', 'select', 'Read salary records.'),
  ('system_management', 'read', 'table', 'organizations', 'select', 'Read organizations.'),
  ('system_management', 'write', 'table', 'employees', 'insert_update_delete', 'Maintain employee records.'),
  ('system_management', 'write', 'table', 'employee_profiles', 'insert_update_delete', 'Maintain employee profiles.'),
  ('system_management', 'write', 'table', 'employee_contracts', 'insert_update_delete', 'Maintain employee contracts.'),
  ('system_management', 'write', 'table', 'employee_salary_profiles', 'insert_update_delete', 'Maintain salary profiles.'),
  ('system_management', 'write', 'table', 'organizations', 'insert_update_delete', 'Maintain organizations.'),
  ('system_management', 'write', 'table', 'profiles', 'insert_update_delete', 'Maintain login profile metadata.'),

  ('permission_config', 'read', 'route', '/employees#permissions', 'view_permission_matrix', 'View permission matrix.'),
  ('permission_config', 'read', 'table', 'permission_roles', 'select', 'Read permission roles.'),
  ('permission_config', 'read', 'table', 'permission_resources', 'select', 'Read permission resources.'),
  ('permission_config', 'read', 'table', 'role_permissions', 'select', 'Read role-resource permissions.'),
  ('permission_config', 'write', 'rpc', 'psa_save_role_permission', 'update', 'Update role-resource access.'),
  ('permission_config', 'write', 'rpc', 'psa_save_role_sidebar_order', 'update', 'Update role sidebar ordering.'),
  ('permission_config', 'write', 'table', 'user_roles', 'insert_update_delete', 'Assign platform roles.')
ON CONFLICT (resource_key, access_level, object_type, object_name, operation) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = NOW();

GRANT SELECT ON public.permission_resource_effects TO authenticated;
GRANT ALL ON public.permission_resource_effects TO service_role, postgres;

ALTER TABLE public.permission_resource_effects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read permission resource effects" ON public.permission_resource_effects;
CREATE POLICY "Authenticated read permission resource effects" ON public.permission_resource_effects
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "RBAC write permission resource effects" ON public.permission_resource_effects;
CREATE POLICY "RBAC write permission resource effects" ON public.permission_resource_effects
  FOR ALL USING (public.current_user_can_access_resource('permission_config', 'write'))
  WITH CHECK (public.current_user_can_access_resource('permission_config', 'write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_contracts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_salary_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permission_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permission_resources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheet_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.overtime_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_logs TO authenticated;

DO $$
DECLARE
  seq_name TEXT;
BEGIN
  FOREACH seq_name IN ARRAY ARRAY[
    'employees_id_seq',
    'employee_profiles_id_seq',
    'employee_contracts_id_seq',
    'employee_salary_profiles_id_seq',
    'organizations_id_seq',
    'profiles_id_seq',
    'user_roles_id_seq',
    'timesheets_id_seq',
    'timesheet_entries_id_seq',
    'overtime_entries_id_seq',
    'approval_logs_id_seq'
  ]
  LOOP
    IF to_regclass('public.' || seq_name) IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO authenticated', seq_name);
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "auth_read_projects" ON public.projects;
DROP POLICY IF EXISTS "Authenticated read active projects" ON public.projects;
DROP POLICY IF EXISTS "RBAC read projects" ON public.projects;
CREATE POLICY "RBAC read projects" ON public.projects
  FOR SELECT TO authenticated
  USING (
    COALESCE(status, 'active') <> 'deleted'
    AND (
      public.current_user_can_access_resource('report', 'read')
      OR public.current_user_can_access_resource('dashboard', 'read')
      OR public.current_user_can_access_resource('timesheet', 'read')
      OR public.current_user_can_access_resource('review', 'read')
    )
  );

DROP POLICY IF EXISTS "Authenticated read project roles" ON public.project_roles;
DROP POLICY IF EXISTS "RBAC read project roles" ON public.project_roles;
CREATE POLICY "RBAC read project roles" ON public.project_roles
  FOR SELECT TO authenticated
  USING (
    public.current_user_can_access_resource('report', 'read')
    OR public.current_user_can_access_resource('dashboard', 'read')
    OR public.current_user_can_access_resource('review', 'read')
  );

DROP POLICY IF EXISTS "Authenticated read project department owners" ON public.project_department_owners;
DROP POLICY IF EXISTS "RBAC read project department owners" ON public.project_department_owners;
CREATE POLICY "RBAC read project department owners" ON public.project_department_owners
  FOR SELECT TO authenticated
  USING (
    public.current_user_can_access_resource('report', 'read')
    OR public.current_user_can_access_resource('dashboard', 'read')
    OR public.current_user_can_access_resource('review', 'read')
  );

DROP POLICY IF EXISTS "Self read own timesheet" ON public.timesheets;
DROP POLICY IF EXISTS "Self insert timesheet" ON public.timesheets;
DROP POLICY IF EXISTS "Self update draft rejected timesheet" ON public.timesheets;
DROP POLICY IF EXISTS "auth_read_timesheets" ON public.timesheets;

CREATE POLICY "RBAC self read timesheets" ON public.timesheets
  FOR SELECT TO authenticated
  USING (
    user_id = public.current_employee_id()
    AND public.current_user_can_access_resource('timesheet', 'read')
  );

CREATE POLICY "RBAC self insert timesheet" ON public.timesheets
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = public.current_employee_id()
    AND public.current_user_can_access_resource('timesheet', 'write')
  );

CREATE POLICY "RBAC self update draft rejected timesheet" ON public.timesheets
  FOR UPDATE TO authenticated
  USING (
    user_id = public.current_employee_id()
    AND status = ANY (ARRAY['draft'::text, 'rejected'::text])
    AND public.current_user_can_access_resource('timesheet', 'write')
  )
  WITH CHECK (
    user_id = public.current_employee_id()
    AND public.current_user_can_access_resource('timesheet', 'write')
  );

CREATE POLICY "RBAC report dashboard read timesheets" ON public.timesheets
  FOR SELECT TO authenticated
  USING (
    public.current_user_can_access_resource('report', 'read')
    OR public.current_user_can_access_resource('dashboard', 'read')
  );

DROP POLICY IF EXISTS "Self insert entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "Self delete draft entries" ON public.timesheet_entries;
DROP POLICY IF EXISTS "auth_read_entries" ON public.timesheet_entries;

CREATE POLICY "RBAC read timesheet entries" ON public.timesheet_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = timesheet_entries.timesheet_id
        AND (
          (t.user_id = public.current_employee_id() AND public.current_user_can_access_resource('timesheet', 'read'))
          OR public.current_user_can_access_resource('review', 'read')
          OR public.current_user_can_access_resource('report', 'read')
          OR public.current_user_can_access_resource('dashboard', 'read')
        )
    )
  );

CREATE POLICY "RBAC self insert entries" ON public.timesheet_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = timesheet_entries.timesheet_id
        AND t.user_id = public.current_employee_id()
        AND t.status = ANY (ARRAY['draft'::text, 'rejected'::text])
        AND public.current_user_can_access_resource('timesheet', 'write')
    )
  );

CREATE POLICY "RBAC self delete draft entries" ON public.timesheet_entries
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = timesheet_entries.timesheet_id
        AND t.user_id = public.current_employee_id()
        AND t.status = ANY (ARRAY['draft'::text, 'rejected'::text])
        AND public.current_user_can_access_resource('timesheet', 'write')
    )
  );

DROP POLICY IF EXISTS "Self insert overtime" ON public.overtime_entries;
DROP POLICY IF EXISTS "Self delete draft overtime" ON public.overtime_entries;
DROP POLICY IF EXISTS "auth_read_overtime" ON public.overtime_entries;

CREATE POLICY "RBAC read overtime entries" ON public.overtime_entries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = overtime_entries.timesheet_id
        AND (
          (t.user_id = public.current_employee_id() AND public.current_user_can_access_resource('timesheet', 'read'))
          OR public.current_user_can_access_resource('review', 'read')
          OR public.current_user_can_access_resource('report', 'read')
          OR public.current_user_can_access_resource('dashboard', 'read')
        )
    )
  );

CREATE POLICY "RBAC self insert overtime" ON public.overtime_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = overtime_entries.timesheet_id
        AND t.user_id = public.current_employee_id()
        AND t.status = ANY (ARRAY['draft'::text, 'rejected'::text])
        AND public.current_user_can_access_resource('timesheet', 'write')
    )
  );

CREATE POLICY "RBAC self delete draft overtime" ON public.overtime_entries
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.timesheets t
      WHERE t.id = overtime_entries.timesheet_id
        AND t.user_id = public.current_employee_id()
        AND t.status = ANY (ARRAY['draft'::text, 'rejected'::text])
        AND public.current_user_can_access_resource('timesheet', 'write')
    )
  );

NOTIFY pgrst, 'reload schema';
