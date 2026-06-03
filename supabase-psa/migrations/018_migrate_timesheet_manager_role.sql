-- V0.12.3: Normalize legacy timesheet workflow role names.
--
-- Earlier iterations used "manager" for weekly timesheet approvals. The current
-- workflow resolves approvers as project_owner, department_head, or admin.
-- Keep historical records, but remove duplicate pending work caused by the old
-- role so reviewers only see one actionable task per timesheet/person.

BEGIN;

WITH duplicate_pending_manager_tasks AS (
  SELECT wt.id
  FROM workflow_tasks wt
  WHERE wt.workflow_key = 'timesheet'
    AND wt.target_type = 'timesheet'
    AND wt.status = 'pending'
    AND wt.assignee_role = 'manager'
    AND EXISTS (
      SELECT 1
      FROM workflow_tasks canonical
      WHERE canonical.workflow_key = wt.workflow_key
        AND canonical.target_type = wt.target_type
        AND canonical.target_id = wt.target_id
        AND canonical.status = 'pending'
        AND canonical.assignee_user_id IS NOT DISTINCT FROM wt.assignee_user_id
        AND canonical.assignee_role IN ('department_head', 'project_owner', 'admin')
        AND canonical.id <> wt.id
    )
)
UPDATE workflow_tasks wt
SET
  status = 'completed',
  completed_at = COALESCE(wt.completed_at, now()),
  result_action = 'superseded',
  comment = COALESCE(NULLIF(wt.comment, ''), 'Migrated legacy manager approval task')
FROM duplicate_pending_manager_tasks duplicate
WHERE wt.id = duplicate.id;

UPDATE workflow_tasks
SET assignee_role = 'department_head'
WHERE workflow_key = 'timesheet'
  AND target_type = 'timesheet'
  AND assignee_role = 'manager';

COMMIT;
