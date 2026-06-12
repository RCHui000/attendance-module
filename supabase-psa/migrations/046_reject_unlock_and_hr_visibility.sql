-- V0.15: make rejection roll back prior approvals and grant HR full org visibility.

BEGIN;

CREATE OR REPLACE FUNCTION public.reject_node(
  p_node_id bigint,
  p_actor_user_id bigint DEFAULT NULL,
  p_reject_policy text DEFAULT 'back_to_creator',
  p_target_node_key text DEFAULT NULL,
  p_comment text DEFAULT '',
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor bigint := COALESCE(p_actor_user_id, public.current_employee_id());
  v_node public.approval_nodes%rowtype;
  v_assignee public.approval_node_assignees%rowtype;
BEGIN
  SELECT * INTO v_node FROM public.approval_nodes WHERE id = p_node_id FOR UPDATE;
  IF v_node.id IS NULL OR v_node.status <> 'active' THEN
    RAISE EXCEPTION 'Node is not active';
  END IF;

  SELECT * INTO v_assignee
  FROM public.approval_node_assignees
  WHERE node_id = p_node_id AND assignee_user_id = v_actor AND status = 'pending'
  FOR UPDATE;
  IF v_assignee.id IS NULL THEN
    RAISE EXCEPTION 'Actor is not a pending assignee for this node';
  END IF;

  UPDATE public.approval_node_assignees
  SET status = 'rejected',
      action = 'reject',
      comment = COALESCE(p_comment, ''),
      acted_at = now()
  WHERE id = v_assignee.id
    AND status = 'pending';

  UPDATE public.approval_node_assignees
  SET status = 'cancelled',
      action = 'cancelled',
      acted_at = now()
  WHERE node_id = p_node_id
    AND id <> v_assignee.id
    AND status = 'pending';

  UPDATE public.approval_nodes
  SET status = 'rejected',
      result_action = 'reject',
      comment = COALESCE(p_comment, ''),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_node_id
    AND status = 'active';

  UPDATE public.approval_node_assignees a
  SET status = 'pending',
      action = NULL,
      comment = NULL,
      acted_at = NULL
  FROM public.approval_nodes n
  WHERE a.node_id = n.id
    AND n.round_id = v_node.round_id
    AND n.id <> p_node_id
    AND n.status IN ('approved', 'skipped')
    AND a.status IN ('approved', 'skipped');

  UPDATE public.approval_nodes
  SET status = 'needs_reapproval',
      result_action = NULL,
      completed_at = NULL,
      comment = COALESCE(NULLIF(comment, ''), 'Rolled back after downstream rejection'),
      updated_at = now()
  WHERE round_id = v_node.round_id
    AND id <> p_node_id
    AND status IN ('approved', 'skipped');

  UPDATE public.approval_node_assignees a
  SET status = 'cancelled',
      action = 'cancelled',
      acted_at = now()
  FROM public.approval_nodes n
  WHERE a.node_id = n.id
    AND n.round_id = v_node.round_id
    AND n.id <> p_node_id
    AND n.status IN ('waiting', 'active', 'pending')
    AND a.status = 'pending';

  UPDATE public.approval_nodes
  SET status = 'cancelled',
      result_action = 'cancelled',
      updated_at = now()
  WHERE round_id = v_node.round_id
    AND id <> p_node_id
    AND status IN ('waiting', 'active', 'pending');

  UPDATE public.approval_rounds
  SET status = 'revision_required',
      completed_at = COALESCE(completed_at, now()),
      updated_at = now()
  WHERE id = v_node.round_id;

  UPDATE public.approval_instances
  SET status = 'revision_required',
      completed_at = COALESCE(completed_at, now()),
      updated_at = now()
  WHERE id = v_node.instance_id;

  UPDATE public.business_documents d
  SET lifecycle_status = 'revision_required',
      approved_at = NULL,
      cancelled_at = NULL,
      updated_at = now()
  FROM public.approval_instances i
  WHERE i.id = v_node.instance_id
    AND d.id = i.document_id;

  UPDATE public.timesheets t
  SET status = 'rejected',
      review_comment = COALESCE(p_comment, ''),
      approved_by = NULL,
      approved_at = NULL,
      updated_at = now()
  FROM public.approval_instances i
  WHERE i.id = v_node.instance_id
    AND i.target_type = 'timesheet'
    AND t.id = i.target_id;

  PERFORM public.psa_write_approval_event(
    v_node.instance_id, v_node.round_id, v_node.id, v_assignee.id, v_actor,
    'assignee_rejected', 'pending', 'rejected', p_request_id, p_comment,
    jsonb_build_object('reject_policy', p_reject_policy, 'target_node_key', p_target_node_key)
  );

  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id, 'rolled_back', true);
END;
$$;

DROP POLICY IF EXISTS "HR read all employees" ON public.employees;
CREATE POLICY "HR read all employees"
  ON public.employees
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_role('hr'));

DROP POLICY IF EXISTS "HR read all profiles v2" ON public.employee_profiles_v2;
CREATE POLICY "HR read all profiles v2"
  ON public.employee_profiles_v2
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_role('hr'));

DROP POLICY IF EXISTS "HR read all organizations" ON public.organizations;
CREATE POLICY "HR read all organizations"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (public.current_user_has_role('hr'));

DROP VIEW IF EXISTS public.approval_project_review_records_view;
CREATE VIEW public.approval_project_review_records_view AS
SELECT
  COALESCE(i.target_id, d.business_id) AS timesheet_id,
  n.scope_id AS project_id,
  CASE
    WHEN n.status = 'approved' THEN 'project_approved'
    WHEN n.status = 'rejected' THEN 'needs_revision'
    WHEN n.status = 'skipped' THEN 'project_approved'
    WHEN n.status = 'needs_reapproval' THEN 'pending'
    ELSE 'pending'
  END AS status,
  COALESCE(n.snapshot ->> 'route_source', n.assignee_role, n.resolver_role) AS route_source,
  n.completed_at AS project_approved_at,
  NULL::timestamptz AS final_confirmed_at,
  COALESCE(n.completed_at, n.activated_at, n.created_at) AS last_action_at,
  n.result_action,
  n.comment
FROM public.approval_nodes n
JOIN public.approval_instances i ON i.id = n.instance_id
LEFT JOIN public.business_documents d ON d.id = i.document_id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND n.round_id = i.current_round_id
  AND n.scope_type = 'project'
  AND n.scope_id IS NOT NULL
  AND n.status <> 'cancelled';

GRANT SELECT ON public.approval_project_review_records_view TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_node(bigint, bigint, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
