BEGIN;

DO $$
DECLARE
  v_func regprocedure;
BEGIN
  FOR v_func IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_func);
  END LOOP;
END $$;

-- Login and RLS policy helpers. These are evaluated by PostgREST under
-- anon/authenticated roles, so they must remain executable by those roles.
GRANT EXECUTE ON FUNCTION public.psa_resolve_login_email(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_resource(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_review() TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_manages_org(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_employee(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_rejected_timesheet_project_entries(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_insert_timesheet_project_revision_entries(bigint, bigint) TO authenticated;

-- Public RPC entrypoints used by the application. Internal approval graph
-- helpers stay callable only by owners/service roles through SECURITY DEFINER
-- wrappers instead of being directly exposed as RPCs to every signed-in user.
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_overtime_action(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_role_permission(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_role_sidebar_order(text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_sync_timesheet_project_revisions(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
