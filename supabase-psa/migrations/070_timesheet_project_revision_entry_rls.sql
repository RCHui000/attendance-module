-- V0.15.3 hotfix: allow submitters to rewrite only their rejected project
-- block entries while the parent timesheet remains submitted.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_edit_rejected_timesheet_project_entries(
  p_timesheet_id bigint,
  p_project_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.timesheets t
    JOIN public.approval_instances i
      ON i.target_type = 'timesheet'
     AND i.target_id = t.id
     AND i.status = 'running'
    JOIN public.approval_nodes n
      ON n.round_id = i.current_round_id
     AND n.scope_type = 'project'
     AND n.scope_id = p_project_id
     AND n.status = 'rejected'
    WHERE t.id = p_timesheet_id
      AND t.user_id = public.current_employee_id()
      AND t.status = 'submitted'
      AND public.current_user_can_access_resource('timesheet', 'write')
  );
$$;

ALTER FUNCTION public.can_edit_rejected_timesheet_project_entries(bigint, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_edit_rejected_timesheet_project_entries(bigint, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_rejected_timesheet_project_entries(bigint, bigint) TO authenticated;

DROP POLICY IF EXISTS "RBAC self insert rejected project entries" ON public.timesheet_entries;
CREATE POLICY "RBAC self insert rejected project entries" ON public.timesheet_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_edit_rejected_timesheet_project_entries(timesheet_id, project_id)
  );

DROP POLICY IF EXISTS "RBAC self delete rejected project entries" ON public.timesheet_entries;
CREATE POLICY "RBAC self delete rejected project entries" ON public.timesheet_entries
  FOR DELETE TO authenticated
  USING (
    public.can_edit_rejected_timesheet_project_entries(timesheet_id, project_id)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
