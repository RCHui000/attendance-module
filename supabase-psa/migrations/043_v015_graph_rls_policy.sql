-- V0.15: replace the legacy workflow_tasks-based timesheet approver read policy.

BEGIN;

DROP POLICY IF EXISTS "Approver read assigned timesheet" ON public.timesheets;
CREATE POLICY "Approver read assigned timesheet" ON public.timesheets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.approval_instances i
      JOIN public.approval_nodes n ON n.instance_id = i.id
      JOIN public.approval_node_assignees a ON a.node_id = n.id
      WHERE i.target_type = 'timesheet'
        AND i.target_id = timesheets.id
        AND a.assignee_user_id = public.current_employee_id()
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
