-- V0.12 report accuracy fixes: prevent duplicated reportable labor rows/tasks.

BEGIN;

-- Collapse duplicate daily project entries before adding the uniqueness guard.
WITH duplicate_entries AS (
  SELECT
    MIN(id) AS keep_id,
    ARRAY_AGG(id ORDER BY id) AS ids,
    timesheet_id,
    project_id,
    work_date,
    SUM(hours) AS total_hours,
    STRING_AGG(NULLIF(description, ''), E'\n' ORDER BY id) AS descriptions
  FROM timesheet_entries
  GROUP BY timesheet_id, project_id, work_date
  HAVING COUNT(*) > 1
),
updated_entries AS (
  UPDATE timesheet_entries te
  SET
    hours = de.total_hours,
    description = COALESCE(de.descriptions, te.description)
  FROM duplicate_entries de
  WHERE te.id = de.keep_id
  RETURNING te.id
)
DELETE FROM timesheet_entries te
USING duplicate_entries de
WHERE te.id = ANY(de.ids)
  AND te.id <> de.keep_id
  AND de.keep_id IN (SELECT id FROM updated_entries);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheet_entries_one_project_day
  ON timesheet_entries(timesheet_id, project_id, work_date);

-- A person may be both project manager and department manager; keep one pending
-- task per target/person so approval lists and status changes do not double count.
WITH ranked_tasks AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workflow_key, target_type, target_id, COALESCE(assignee_user_id, 0), status
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM workflow_tasks
  WHERE status = 'pending'
)
DELETE FROM workflow_tasks wt
USING ranked_tasks rt
WHERE wt.id = rt.id
  AND rt.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_tasks_one_pending_assignee
  ON workflow_tasks(workflow_key, target_type, target_id, (COALESCE(assignee_user_id, 0)))
  WHERE status = 'pending';

COMMIT;
