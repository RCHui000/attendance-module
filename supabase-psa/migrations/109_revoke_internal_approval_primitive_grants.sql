BEGIN;

DO $$
DECLARE
  v_function regprocedure;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'approve_node',
        'reject_node',
        'submit_document',
        'psa_activate_ready_nodes',
        'psa_expand_approval_template',
        'psa_resolve_document_business_type',
        'psa_resolve_graph_assignees',
        'psa_resolve_role_candidates',
        'psa_select_approval_template',
        'psa_timesheet_business_type'
      ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', v_function);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
