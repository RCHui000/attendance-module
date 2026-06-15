-- V0.15.2 Beta1: normalize grants for approval graph tables touched by
-- timesheet save/submit/review flows. RLS and RPCs still decide effective
-- access; these grants keep NAS and cloud behavior consistent.

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'approval_instances',
    'approval_rounds',
    'approval_nodes',
    'approval_node_assignees',
    'approval_events',
    'approval_logs',
    'business_documents',
    'workflow_tasks',
    'timesheet_project_reviews'
  ]
  LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', table_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  seq_name TEXT;
BEGIN
  FOREACH seq_name IN ARRAY ARRAY[
    'approval_instances_id_seq',
    'approval_rounds_id_seq',
    'approval_nodes_id_seq',
    'approval_node_assignees_id_seq',
    'approval_events_id_seq',
    'approval_logs_id_seq',
    'business_documents_id_seq',
    'workflow_tasks_id_seq',
    'timesheet_project_reviews_id_seq'
  ]
  LOOP
    IF to_regclass('public.' || seq_name) IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO authenticated', seq_name);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
