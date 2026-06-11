-- V0.13: Refresh pending project review routes by project.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_refresh_pending_project_review_routes(
  p_project_id bigint,
  p_reason text DEFAULT 'Route refreshed after project department owner change'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor_id bigint;
  v_result jsonb;
BEGIN
  v_actor_id := public.current_employee_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only admins can refresh project routes';
  END IF;

  v_result := public.psa_refresh_project_timesheet_routes(p_project_id, p_reason);

  UPDATE public.timesheet_project_reviews r
     SET project_owner_id_snapshot = route.assignee_user_id,
         route_source = route.route_source,
         last_action_by = v_actor_id,
         last_action_at = now()
    FROM public.timesheets t
    JOIN public.employee_profiles_v2 ep ON ep.employee_id = t.user_id
    JOIN LATERAL public.psa_resolve_project_review_assignee(p_project_id, t.user_id, ep.org_id) route ON true
   WHERE r.timesheet_id = t.id
     AND r.project_id = p_project_id
     AND r.status IN ('pending_project_review', 'needs_revision', 'needs_reapproval');

  INSERT INTO public.approval_logs (
    target_type, target_id, actor_id, action, comment, from_status, to_status
  )
  VALUES (
    'project', p_project_id, v_actor_id, 'refresh_pending_project_review_routes',
    COALESCE(p_reason, ''), 'pending', 'pending'
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('v13ReviewSnapshotsUpdated', true);
END;
$$;

ALTER FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) TO authenticated;

COMMIT;
