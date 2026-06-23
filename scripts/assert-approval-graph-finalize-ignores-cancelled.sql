-- Assert that cancelled historical graph nodes do not keep an approval graph
-- instance in running/submitted after all effective nodes are terminal.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-approval-graph-finalize-ignores-cancelled.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DO $$
DECLARE
  v_stuck_count int;
  v_examples text;
BEGIN
  WITH running AS (
    SELECT
      i.id AS instance_id,
      i.target_id AS timesheet_id,
      i.current_round_id AS round_id,
      t.user_id,
      t.week_start_date
    FROM public.approval_instances i
    JOIN public.timesheets t ON t.id = i.target_id
    WHERE i.target_type = 'timesheet'
      AND i.status = 'running'
      AND t.status = 'submitted'
  ),
  effective AS (
    SELECT
      r.instance_id,
      r.timesheet_id,
      r.week_start_date,
      count(n.id) FILTER (
        WHERE n.status <> 'cancelled'
          AND n.status NOT IN ('approved', 'skipped')
      ) AS noncancelled_unapproved_nodes,
      count(n.id) FILTER (WHERE n.status = 'cancelled') AS cancelled_nodes,
      count(n.id) FILTER (WHERE n.status <> 'cancelled') AS effective_nodes
    FROM running r
    JOIN public.approval_nodes n ON n.round_id = r.round_id
    GROUP BY r.instance_id, r.timesheet_id, r.week_start_date
  ),
  stuck AS (
    SELECT *
    FROM effective
    WHERE effective_nodes > 0
      AND cancelled_nodes > 0
      AND noncancelled_unapproved_nodes = 0
  )
  SELECT
    count(*)::int,
    string_agg(timesheet_id::text, ', ' ORDER BY week_start_date, timesheet_id)
  INTO v_stuck_count, v_examples
  FROM stuck;

  IF v_stuck_count <> 0 THEN
    RAISE EXCEPTION
      'Approval graph finalize is blocked by cancelled historical nodes for % timesheets: %',
      v_stuck_count,
      v_examples;
  END IF;
END $$;

SELECT 'PASS: approval graph finalize ignores cancelled historical nodes' AS result;
