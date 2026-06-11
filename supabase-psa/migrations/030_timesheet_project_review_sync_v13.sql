-- V0.13: Backfill and keep project reviews in sync with workflow tasks.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_project_review_status_from_task(
  p_task_status text,
  p_result_action text,
  p_timesheet_status text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_timesheet_status = 'approved' AND p_result_action = 'approve' THEN 'final_confirmed'
    WHEN p_task_status = 'pending' THEN 'pending_project_review'
    WHEN p_result_action = 'approve' THEN 'project_approved'
    WHEN p_result_action = 'reject' THEN 'needs_revision'
    WHEN p_result_action = 'cancelled' THEN 'cancelled'
    ELSE 'pending_project_review'
  END
$$;

CREATE OR REPLACE FUNCTION public.psa_sync_timesheet_project_review_from_task(p_task_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_task public.workflow_tasks%rowtype;
  v_sheet public.timesheets%rowtype;
  v_submitter_org_id bigint;
  v_department_manager_id bigint;
  v_route record;
  v_review_id bigint;
  v_status text;
BEGIN
  SELECT *
    INTO v_task
    FROM public.workflow_tasks
    WHERE id = p_task_id;

  IF NOT FOUND
     OR v_task.workflow_key <> 'timesheet'
     OR COALESCE(v_task.scope_type, '') <> 'project'
     OR v_task.scope_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
    INTO v_sheet
    FROM public.timesheets
    WHERE id = v_task.target_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT ep.org_id
    INTO v_submitter_org_id
    FROM public.employee_profiles_v2 ep
    WHERE ep.employee_id = v_sheet.user_id
    LIMIT 1;

  SELECT assignee_user_id
    INTO v_department_manager_id
    FROM public.psa_resolve_timesheet_department_reviewer(v_sheet.id)
    LIMIT 1;

  SELECT *
    INTO v_route
    FROM public.psa_resolve_project_review_assignee(v_task.scope_id, v_sheet.user_id, v_submitter_org_id)
    LIMIT 1;

  v_status := public.psa_project_review_status_from_task(v_task.status, v_task.result_action, v_sheet.status);

  INSERT INTO public.timesheet_project_reviews (
    timesheet_id,
    project_id,
    submitter_user_id,
    submitter_org_id_snapshot,
    project_owner_id_snapshot,
    department_manager_id_snapshot,
    route_source,
    status,
    round_no,
    submitted_at,
    project_approved_at,
    final_confirmed_at,
    last_action_by,
    last_action_at,
    reject_reason
  )
  VALUES (
    v_sheet.id,
    v_task.scope_id,
    v_sheet.user_id,
    v_submitter_org_id,
    COALESCE(v_task.assignee_user_id, v_route.assignee_user_id),
    v_department_manager_id,
    COALESCE(NULLIF(v_task.route_source, ''), v_route.route_source, 'legacy_workflow_task'),
    v_status,
    1,
    v_sheet.submitted_at,
    CASE WHEN v_status IN ('project_approved', 'final_confirmed') THEN v_task.completed_at ELSE NULL END,
    CASE WHEN v_status = 'final_confirmed' THEN COALESCE(v_sheet.approved_at, v_task.completed_at) ELSE NULL END,
    COALESCE(v_task.completed_by, v_task.assignee_user_id),
    COALESCE(v_task.completed_at, v_task.created_at),
    CASE WHEN v_status = 'needs_revision' THEN v_task.comment ELSE NULL END
  )
  ON CONFLICT (timesheet_id, project_id, round_no)
  DO UPDATE SET
    submitter_org_id_snapshot = COALESCE(public.timesheet_project_reviews.submitter_org_id_snapshot, EXCLUDED.submitter_org_id_snapshot),
    project_owner_id_snapshot = COALESCE(EXCLUDED.project_owner_id_snapshot, public.timesheet_project_reviews.project_owner_id_snapshot),
    department_manager_id_snapshot = COALESCE(public.timesheet_project_reviews.department_manager_id_snapshot, EXCLUDED.department_manager_id_snapshot),
    route_source = COALESCE(NULLIF(EXCLUDED.route_source, ''), public.timesheet_project_reviews.route_source),
    status = CASE
      WHEN public.timesheet_project_reviews.status = 'final_confirmed' THEN 'final_confirmed'
      WHEN EXCLUDED.status = 'final_confirmed' THEN 'final_confirmed'
      WHEN public.timesheet_project_reviews.status = 'project_approved' AND EXCLUDED.status = 'pending_project_review' THEN 'project_approved'
      ELSE EXCLUDED.status
    END,
    submitted_at = COALESCE(public.timesheet_project_reviews.submitted_at, EXCLUDED.submitted_at),
    project_approved_at = COALESCE(EXCLUDED.project_approved_at, public.timesheet_project_reviews.project_approved_at),
    final_confirmed_at = COALESCE(EXCLUDED.final_confirmed_at, public.timesheet_project_reviews.final_confirmed_at),
    last_action_by = COALESCE(EXCLUDED.last_action_by, public.timesheet_project_reviews.last_action_by),
    last_action_at = COALESCE(EXCLUDED.last_action_at, public.timesheet_project_reviews.last_action_at),
    reject_reason = COALESCE(EXCLUDED.reject_reason, public.timesheet_project_reviews.reject_reason)
  RETURNING id INTO v_review_id;

  UPDATE public.workflow_tasks
     SET review_id = v_review_id,
         route_source = COALESCE(NULLIF(route_source, ''), v_route.route_source, 'legacy_workflow_task')
   WHERE id = v_task.id
     AND review_id IS DISTINCT FROM v_review_id;

  RETURN v_review_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_sync_timesheet_project_review_task_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  PERFORM public.psa_sync_timesheet_project_review_from_task(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_project_reviews_from_tasks ON public.workflow_tasks;
CREATE TRIGGER trg_sync_project_reviews_from_tasks
AFTER INSERT OR UPDATE OF status, result_action, assignee_user_id, completed_by, completed_at, comment, scope_type, scope_id
ON public.workflow_tasks
FOR EACH ROW
WHEN (NEW.workflow_key = 'timesheet' AND NEW.scope_type = 'project' AND NEW.scope_id IS NOT NULL)
EXECUTE FUNCTION public.psa_sync_timesheet_project_review_task_trigger();

WITH project_tasks AS (
  SELECT id
  FROM public.workflow_tasks
  WHERE workflow_key = 'timesheet'
    AND scope_type = 'project'
    AND scope_id IS NOT NULL
)
SELECT public.psa_sync_timesheet_project_review_from_task(id)
FROM project_tasks;

CREATE OR REPLACE VIEW public.timesheet_project_review_status_view AS
SELECT
  r.id AS review_id,
  r.timesheet_id,
  r.project_id,
  p.code AS project_code,
  p.name AS project_name,
  r.submitter_user_id,
  e.name AS submitter_name,
  r.submitter_org_id_snapshot AS submitter_org_id,
  o.org_name AS submitter_org_name,
  r.project_owner_id_snapshot,
  owner.name AS project_owner_name,
  r.department_manager_id_snapshot,
  manager.name AS department_manager_name,
  r.route_source,
  r.status,
  r.round_no,
  r.submitted_at,
  r.project_approved_at,
  r.final_confirmed_at,
  r.last_action_by,
  actor.name AS last_action_by_name,
  r.last_action_at,
  r.reject_reason
FROM public.timesheet_project_reviews r
JOIN public.projects p ON p.id = r.project_id
JOIN public.employees e ON e.id = r.submitter_user_id
LEFT JOIN public.organizations o ON o.id = r.submitter_org_id_snapshot
LEFT JOIN public.employees owner ON owner.id = r.project_owner_id_snapshot
LEFT JOIN public.employees manager ON manager.id = r.department_manager_id_snapshot
LEFT JOIN public.employees actor ON actor.id = r.last_action_by;

CREATE OR REPLACE VIEW public.approval_pending_tasks_view AS
SELECT
  wt.id AS task_id,
  wt.status,
  wt.target_type,
  wt.target_id,
  wt.review_id,
  wt.target_id AS timesheet_id,
  r.project_id,
  p.name AS project_name,
  t.user_id AS submitter_user_id,
  e.name AS submitter_name,
  r.submitter_org_id_snapshot AS submitter_org_id,
  o.org_name AS submitter_org_name,
  wt.assignee_user_id,
  wt.scope_type,
  wt.scope_id,
  COALESCE(wt.route_source, r.route_source) AS route_source,
  wt.created_at
FROM public.workflow_tasks wt
JOIN public.timesheets t ON t.id = wt.target_id
JOIN public.employees e ON e.id = t.user_id
LEFT JOIN public.timesheet_project_reviews r ON r.id = wt.review_id
LEFT JOIN public.projects p ON p.id = COALESCE(r.project_id, wt.scope_id)
LEFT JOIN public.organizations o ON o.id = r.submitter_org_id_snapshot
WHERE wt.workflow_key = 'timesheet'
  AND wt.status = 'pending';

CREATE OR REPLACE VIEW public.approval_reviewed_timesheets_view AS
SELECT
  t.id AS timesheet_id,
  t.user_id AS submitter_user_id,
  e.name AS submitter_name,
  t.week_start_date,
  t.status,
  t.submitted_at,
  t.approved_at,
  MAX(wt.completed_at) AS last_reviewed_at,
  COUNT(*) FILTER (WHERE wt.scope_type = 'project' AND wt.result_action = 'approve') AS approved_project_blocks,
  COUNT(*) FILTER (WHERE wt.result_action = 'reject') AS rejected_blocks
FROM public.timesheets t
JOIN public.workflow_tasks wt
  ON wt.workflow_key = 'timesheet'
 AND wt.target_type = 'timesheet'
 AND wt.target_id = t.id
 AND wt.status = 'completed'
 AND wt.result_action IN ('approve', 'reject')
JOIN public.employees e ON e.id = t.user_id
GROUP BY t.id, t.user_id, e.name, t.week_start_date, t.status, t.submitted_at, t.approved_at;

CREATE OR REPLACE VIEW public.approval_project_review_records_view AS
SELECT *
FROM public.timesheet_project_review_status_view;

GRANT SELECT ON public.timesheet_project_review_status_view TO authenticated;
GRANT SELECT ON public.approval_pending_tasks_view TO authenticated;
GRANT SELECT ON public.approval_reviewed_timesheets_view TO authenticated;
GRANT SELECT ON public.approval_project_review_records_view TO authenticated;

ALTER FUNCTION public.psa_sync_timesheet_project_review_from_task(bigint) OWNER TO postgres;
ALTER FUNCTION public.psa_sync_timesheet_project_review_task_trigger() OWNER TO postgres;
ALTER FUNCTION public.psa_project_review_status_from_task(text, text, text) OWNER TO postgres;

COMMIT;
