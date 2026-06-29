-- Restrict approval audit scope configuration to platform admins.
--
-- Employee/system managers may edit normal employee metadata, but reviewed
-- timesheet audit visibility is a sensitive permission boundary.

BEGIN;

DROP POLICY IF EXISTS "System write approval audit scopes" ON public.approval_audit_scopes;
CREATE POLICY "System write approval audit scopes"
  ON public.approval_audit_scopes FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

NOTIFY pgrst, 'reload schema';

COMMIT;
