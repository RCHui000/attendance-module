-- V0.18.31 data repair: final timesheets must not keep stale revision nodes active.
--
-- Some early migrated approval graphs kept old rejected / needs_revision nodes in
-- the current approved instance after the timesheet was later approved. Those
-- nodes are historical actions, but their node.status still made the reviewed
-- list display "revision_required". Keep assignee action history intact and
-- cancel only the stale runtime node state.

BEGIN;

WITH repair_candidates AS (
  SELECT
    n.id,
    n.status AS previous_status,
    n.result_action AS previous_result_action,
    t.approved_at
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'approved'
    AND t.status IN ('approved', 'locked', 'summarized')
    AND n.status IN ('rejected', 'needs_revision', 'waiting_revision', 'revision_required')
    AND NOT EXISTS (
      SELECT 1
      FROM public.approval_nodes open_node
      WHERE open_node.instance_id = i.id
        AND open_node.status IN ('active', 'waiting', 'pending')
    )
)
UPDATE public.approval_nodes n
SET
  status = 'cancelled',
  result_action = 'cancelled',
  completed_at = COALESCE(n.completed_at, repair_candidates.approved_at, NOW()),
  metadata = COALESCE(n.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'stale_revision_repair', '130_repair_final_timesheet_stale_revision_nodes',
      'previous_status', repair_candidates.previous_status,
      'previous_result_action', repair_candidates.previous_result_action,
      'repaired_at', NOW()
    ),
  updated_at = NOW()
FROM repair_candidates
WHERE n.id = repair_candidates.id;

NOTIFY pgrst, 'reload schema';

COMMIT;
